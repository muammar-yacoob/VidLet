import { describe, expect, it } from 'vitest';
import { abortBeforeExpensiveWork, runInMcpTool } from '../lib/ai-context.js';
import { DelegatedGenerationError, groqChatJSON } from '../lib/groq.js';
import { delegatedBrief, withDelegation } from './delegate.js';
import type { ToolResult } from './shared.js';

const ok: ToolResult = { content: [{ type: 'text', text: 'done' }] };

/** The text block of a result, for asserting on. */
function body(result: ToolResult): string {
  const first = result.content[0];
  return first.type === 'text' ? first.text : '';
}

const narration = new DelegatedGenerationError(
  'generate_short',
  [
    { role: 'system', content: 'You write voiceover.' },
    { role: 'user', content: 'the raw script' },
  ],
  'narration'
);

const frames = new DelegatedGenerationError(
  'generate_short',
  [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe these' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    },
  ],
  'frame_descriptions'
);

describe('delegatedBrief', () => {
  it('is not an error result', () => {
    // Nothing failed - marking it isError makes clients render a red step.
    expect(delegatedBrief([narration]).isError).toBeUndefined();
  });

  it('names the ai field to answer on', () => {
    expect(body(delegatedBrief([narration]))).toContain('"narration": ...');
  });

  it('passes the original instructions through verbatim', () => {
    const text = body(delegatedBrief([narration]));
    expect(text).toContain('You write voiceover.');
    expect(text).toContain('the raw script');
  });

  it('asks for every step in one object', () => {
    const text = body(delegatedBrief([narration, frames]));
    expect(text).toContain('"narration": ..., "frame_descriptions": ...');
    // Both briefs present, so the caller can answer them together.
    expect(text).toContain('You write voiceover.');
    expect(text).toContain('describe these');
  });

  it('says nothing was rendered, so the caller knows no work was wasted', () => {
    expect(body(delegatedBrief([narration]))).toContain('Nothing has been rendered yet');
  });

  it('attaches vision frames as image content', () => {
    const images = delegatedBrief([narration, frames]).content.filter((c) => c.type === 'image');
    expect(images).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
  });
});

describe('withDelegation', () => {
  it('passes a normal result straight through', async () => {
    const result = await runInMcpTool('probe_video', () => withDelegation(async () => ok));
    expect(result).toBe(ok);
  });

  it('collects every step a pipeline reaches, not just the first', async () => {
    // The whole point of the swallowing call sites: one pass discovers all
    // the writing a run needs, so it costs two round trips rather than four.
    const result = await runInMcpTool('generate_short', () =>
      withDelegation(async () => {
        for (const [content, step] of [
          ['write the script', 'narration'],
          ['describe the frames', 'frame_descriptions'],
          ['assign them', 'frame_assignment'],
        ] as const) {
          try {
            await groqChatJSON([{ role: 'user', content }], undefined, step);
          } catch {
            /* swallowed, as the real call sites do */
          }
        }
        return ok;
      })
    );
    const text = body(result);
    expect(text).toContain('"narration": ..., "frame_descriptions": ..., "frame_assignment": ...');
    expect(text).toContain('3 pieces of writing');
  });

  it('does not brief the same step twice when a stage retries', async () => {
    const result = await runInMcpTool('create_demo', () =>
      withDelegation(async () => {
        // describeTimeline loops over candidate models on failure.
        for (const model of ['vision-a', 'vision-b']) {
          try {
            await groqChatJSON(
              [{ role: 'user', content: 'describe' }],
              model,
              'frame_descriptions'
            );
          } catch {
            /* try the next candidate */
          }
        }
        return ok;
      })
    );
    expect(body(result)).toContain('a piece of writing');
  });

  it('rethrows unrelated failures', async () => {
    await expect(
      runInMcpTool('trim_video', () =>
        withDelegation(async () => {
          throw new Error('ffmpeg exited 1');
        })
      )
    ).rejects.toThrow('ffmpeg exited 1');
  });
});

describe('abortBeforeExpensiveWork', () => {
  it('stops a run that is missing its writing', async () => {
    const result = await runInMcpTool('generate_short', () =>
      withDelegation(async () => {
        try {
          await groqChatJSON([{ role: 'user', content: 'script' }], undefined, 'narration');
        } catch {
          /* swallowed */
        }
        abortBeforeExpensiveWork();
        throw new Error('encoder should never be reached');
      })
    );
    expect(body(result)).toContain('"narration": ...');
  });

  it('does nothing when every step was answered', async () => {
    await expect(
      runInMcpTool('generate_short', async () => {
        abortBeforeExpensiveWork();
        return 'encoded';
      })
    ).resolves.toBe('encoded');
  });

  it('does nothing outside an MCP call', () => {
    expect(() => abortBeforeExpensiveWork()).not.toThrow();
  });
});
