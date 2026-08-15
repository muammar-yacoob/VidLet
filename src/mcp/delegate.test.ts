import { describe, expect, it } from 'vitest';
import { runInMcpTool } from '../lib/ai-context.js';
import { DelegatedGenerationError, groqChatJSON } from '../lib/groq.js';
import { delegatedBrief, withDelegation } from './delegate.js';
import type { ToolResult } from './shared.js';

const ok: ToolResult = { content: [{ type: 'text', text: 'done' }] };

describe('delegatedBrief', () => {
  const err = new DelegatedGenerationError(
    'generate_short',
    [
      { role: 'system', content: 'You write voiceover.' },
      { role: 'user', content: 'the raw script' },
    ],
    'narration'
  );

  it('is not an error result', () => {
    // Nothing failed - marking it isError makes clients render a red step.
    expect(delegatedBrief(err).isError).toBeUndefined();
  });

  it('names the parameter to answer on', () => {
    const text = delegatedBrief(err).content[0];
    expect(text.type === 'text' && text.text).toContain('final_script');
  });

  it('passes the original instructions through verbatim', () => {
    const text = delegatedBrief(err).content[0];
    expect(text.type === 'text' && text.text).toContain('You write voiceover.');
    expect(text.type === 'text' && text.text).toContain('the raw script');
  });

  it('attaches vision frames as image content', () => {
    const withFrames = new DelegatedGenerationError(
      'create_demo',
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
          ],
        },
      ],
      'frame_descriptions'
    );
    const images = delegatedBrief(withFrames).content.filter((c) => c.type === 'image');
    expect(images).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
  });

  it('says so when the tool cannot take the answer back yet', () => {
    // frame_descriptions has no parameter. Telling the caller to retry with
    // one would loop: the tool would ignore it and return this brief again.
    const noParam = new DelegatedGenerationError(
      'preview_short',
      [{ role: 'user', content: 'describe' }],
      'frame_descriptions'
    );
    const text = delegatedBrief(noParam).content[0];
    const body = text.type === 'text' ? text.text : '';
    expect(body).toContain('has no parameter for this yet');
    expect(body).not.toContain('call `preview_short` again');
  });

  it('does not invent a parameter for an unlabelled step', () => {
    const unlabelled = new DelegatedGenerationError('create_short', [
      { role: 'user', content: 'something' },
    ]);
    const text = delegatedBrief(unlabelled).content[0];
    expect(text.type === 'text' && text.text).toContain('has no parameter for this yet');
  });
});

describe('withDelegation', () => {
  it('passes a normal result straight through', async () => {
    const result = await runInMcpTool('probe_video', () => withDelegation(async () => ok));
    expect(result).toBe(ok);
  });

  it('converts a thrown refusal into a brief', async () => {
    const result = await runInMcpTool('generate_short', () =>
      withDelegation(async () => {
        await groqChatJSON([{ role: 'user', content: 'write it' }], undefined, 'narration');
        return ok;
      })
    );
    const text = result.content[0];
    expect(text.type === 'text' && text.text).toContain('final_script');
  });

  it('returns the brief even when the handler swallowed the refusal', async () => {
    // The degradation path this exists for: rephraseScript catches, returns
    // null, and the pipeline renders a Short with an unwritten script.
    const result = await runInMcpTool('generate_short', () =>
      withDelegation(async () => {
        try {
          await groqChatJSON([{ role: 'user', content: 'write it' }], undefined, 'narration');
        } catch {
          /* swallowed, as the real call sites do */
        }
        return ok;
      })
    );
    expect(result).not.toBe(ok);
    const text = result.content[0];
    expect(text.type === 'text' && text.text).toContain('final_script');
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
