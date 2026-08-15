/**
 * Turns a refused Groq call into a brief for the calling model.
 *
 * When a tool reaches generation, `groqChatJSON` throws
 * DelegatedGenerationError rather than spending a token (see
 * ../lib/ai-context.ts for why). This module catches that at the tool
 * boundary and returns the prompts that were about to be sent, together with
 * the `ai` fields to hand the answers back on.
 *
 * The prompt is reused verbatim rather than rewritten for the client: it is
 * already tuned, and a second copy would drift from the one the CLI uses.
 */
import { pendingDelegations } from '../lib/ai-context.js';
import { DelegatedGenerationError, type GenerationStep } from '../lib/groq.js';
import type { ToolContent, ToolResult } from './shared.js';

/**
 * What each generation step is called in the `ai` parameter, and the JSON
 * shape the answer takes.
 *
 * Keyed on the step rather than the tool because one tool needs several:
 * `preview_short` writes narration, then describes frames, then assigns them.
 * All of them come back in one `ai` object on the next call, so a run costs
 * two round trips however many steps it turns out to need.
 */
const STEPS: Record<GenerationStep, { field: string; shape: string }> = {
  narration: { field: 'narration', shape: '"<the finished narration text>"' },
  demo_script: {
    field: 'demo_script',
    shape: '{"narration": "<full script>", "short_narration": "<hook-first version>"}',
  },
  frame_descriptions: {
    field: 'frame_descriptions',
    shape: '["<one short description per frame, in order>"]',
  },
  frame_assignment: {
    field: 'frame_assignment',
    shape: '[<one frame index per narration line, never decreasing>]',
  },
  highlights: {
    field: 'highlights',
    shape: '[{"start": <sec>, "end": <sec>, "reason": "<short why>"}]',
  },
  batch_highlights: {
    field: 'batch_highlights',
    shape:
      '{"shorts": [{"score": <0-100>, "angle": "<label>", "clips": [{"start": <sec>, ' +
      '"end": <sec>, "reason": "<short why>"}]}]}',
  },
  post_copy: {
    field: 'post_copy',
    shape: '{"title": "...", "description": "...", "tags": ["..."]}',
  },
  titles: { field: 'titles', shape: '{"a": "<variant A>", "b": "<variant B>"}' },
  hashtags: { field: 'hashtags', shape: '["#tag", ...]' },
  hashtag_sets: {
    field: 'hashtag_sets',
    shape: '{"popular": ["<6 established tags>"], "trending": ["<6 rising tags>"]}',
  },
};

/** One step's section of the brief. */
function section(e: DelegatedGenerationError, index: number): string {
  const step = e.step ? STEPS[e.step] : null;
  const field = step?.field ?? 'unknown';
  return [
    `### ${index}. ${field}`,
    ``,
    e.system ? `${e.system}` : '',
    e.prompt ? `\n${e.prompt}` : '',
    e.images.length ? `\n(${e.images.length} frame(s) attached below, in order)` : '',
    ``,
    `Answer as \`${field}\`: ${step?.shape ?? '<see the instructions above>'}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Format every refused step as one brief the model can answer in a single go.
 *
 * Not an error result: nothing went wrong, and marking it `isError` makes
 * clients surface it as a failure rather than a step.
 */
export function delegatedBrief(pending: DelegatedGenerationError[]): ToolResult {
  const tool = pending[0]?.tool ?? 'this tool';
  const fields = pending.map((e) => (e.step ? STEPS[e.step].field : 'unknown'));

  const content: ToolContent[] = [
    {
      type: 'text',
      text: [
        `\`${tool}\` needs ${pending.length === 1 ? 'a piece of' : pending.length + ' pieces of'} writing,`,
        `and you are a stronger model than anything it would call, so it is yours to do`,
        `rather than the server's. Nothing has been rendered yet.`,
        ``,
        ...pending.map((e, i) => `${section(e, i + 1)}\n`),
        `## Next`,
        ``,
        `Call \`${tool}\` again with the same arguments plus \`ai\`, an object carrying`,
        `every field above:`,
        ``,
        '```json',
        `{ "ai": { ${fields.map((f) => `"${f}": ...`).join(', ')} } }`,
        '```',
        ``,
        `Each value is used verbatim, and no further writing will be asked for.`,
      ].join('\n'),
    },
  ];

  // Vision prompts sent Groq base64 JPEGs; the client gets the same frames as
  // real image blocks so it can look at them rather than take our word.
  for (const e of pending) {
    for (const data of e.images) {
      content.push({ type: 'image', data, mimeType: 'image/jpeg' });
    }
  }

  return { content };
}

/**
 * Run a handler, converting a refused Groq call into a brief.
 *
 * Checked on both paths, and after a normal return as well: a handler that
 * caught the refusal and carried on would otherwise hand back output that
 * quietly skipped the writing step.
 */
export async function withDelegation(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    const result = await fn();
    // Checked after a normal return too: the AI call sites swallow failures
    // and carry on with a fallback, so a handler can finish having quietly
    // skipped every writing step.
    const pending = pendingDelegations();
    return pending.length ? delegatedBrief(pending) : result;
  } catch (e) {
    const pending = pendingDelegations();
    // An unrelated failure after a refusal is usually a consequence of the
    // missing text, so the brief is the more useful answer either way.
    if (pending.length) return delegatedBrief(pending);
    if (e instanceof DelegatedGenerationError) return delegatedBrief([e]);
    throw e;
  }
}
