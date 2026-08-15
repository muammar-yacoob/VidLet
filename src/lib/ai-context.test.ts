/**
 * The invariant these pin: no MCP tool ever reaches Groq.
 *
 * The interesting cases are not the direct refusal but the two ways it could
 * leak - a cached answer served without a network call, and a caller that
 * catches AI failures and carries on with a fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentMcpTool,
  pendingDelegations,
  recordDelegation,
  runInMcpTool,
} from './ai-context.js';
import { DelegatedGenerationError, groqChatJSON } from './groq.js';

describe('MCP tool context', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test_key_not_used';
  });

  it('reports no tool outside an MCP call', () => {
    expect(currentMcpTool()).toBeNull();
  });

  it('reports the running tool inside one', async () => {
    await runInMcpTool('generate_short', async () => {
      expect(currentMcpTool()).toBe('generate_short');
    });
  });

  it('keeps concurrent tool calls separate', async () => {
    const seen: string[] = [];
    await Promise.all([
      runInMcpTool('create_short', async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(currentMcpTool() ?? 'none');
      }),
      runInMcpTool('create_demo', async () => {
        seen.push(currentMcpTool() ?? 'none');
      }),
    ]);
    expect(seen.sort()).toEqual(['create_demo', 'create_short']);
  });
});

describe('groqChatJSON refuses to run for an MCP tool', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test_key_not_used';
  });

  it('throws instead of calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      runInMcpTool('generate_short', () =>
        groqChatJSON([{ role: 'user', content: 'write me a script' }])
      )
    ).rejects.toBeInstanceOf(DelegatedGenerationError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('carries the prompt and the system instructions into the brief', async () => {
    const err = (await runInMcpTool('generate_short', () =>
      groqChatJSON([
        { role: 'system', content: 'You write voiceover.' },
        { role: 'user', content: 'the raw script' },
      ])
    ).catch((e) => e)) as DelegatedGenerationError;

    expect(err).toBeInstanceOf(DelegatedGenerationError);
    expect(err.tool).toBe('generate_short');
    expect(err.system).toContain('You write voiceover.');
    expect(err.prompt).toContain('the raw script');
  });

  it('extracts vision frames so the client can see them', async () => {
    const err = (await runInMcpTool('create_demo', () =>
      groqChatJSON([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe these' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
          ],
        },
      ])
    ).catch((e) => e)) as DelegatedGenerationError;

    expect(err.images).toEqual(['AAAA', 'BBBB']);
    expect(err.prompt).toBe('describe these');
  });

  it('still runs normally outside an MCP call', async () => {
    // The CLI has no model to delegate to, so Groq stays correct there.
    // The prompt is unique per run because withResponseCache persists to
    // disk: a fixed one is served from the previous run's entry and never
    // reaches fetch.
    const prompt = `cli call ${Math.random()}`;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
      })
    );
    await expect(groqChatJSON([{ role: 'user', content: prompt }])).resolves.toEqual({
      ok: true,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});

describe('recorded delegation', () => {
  it('survives a caller that swallows the error', async () => {
    const swallowed = await runInMcpTool('generate_short', async () => {
      try {
        await groqChatJSON([{ role: 'user', content: 'rewrite this' }]);
      } catch {
        // exactly what rephraseScript and the hashtag helpers do
      }
      return pendingDelegations();
    });
    expect(swallowed).toHaveLength(1);
    expect(swallowed[0]).toBeInstanceOf(DelegatedGenerationError);
  });

  it('keeps every distinct step a pipeline needs, in order', async () => {
    const all = await runInMcpTool('generate_short', async () => {
      recordDelegation(
        new DelegatedGenerationError(
          'generate_short',
          [{ role: 'user', content: 'narration' }],
          'narration'
        )
      );
      recordDelegation(
        new DelegatedGenerationError(
          'generate_short',
          [{ role: 'user', content: 'hashtags' }],
          'hashtags'
        )
      );
      return pendingDelegations();
    });
    expect(all.map((e) => e.prompt)).toEqual(['narration', 'hashtags']);
  });

  it('deduplicates a step a stage retried', async () => {
    const all = await runInMcpTool('create_demo', async () => {
      for (const model of ['a', 'b']) {
        recordDelegation(
          new DelegatedGenerationError(
            'create_demo',
            [{ role: 'user', content: `describe with ${model}` }],
            'frame_descriptions'
          )
        );
      }
      return pendingDelegations();
    });
    expect(all).toHaveLength(1);
  });

  it('records nothing when no generation was attempted', async () => {
    const pending = await runInMcpTool('probe_video', async () => pendingDelegations());
    expect(pending).toEqual([]);
  });
});
