/**
 * Turns a refused Groq call into a brief for the calling model.
 *
 * When a tool reaches generation, `groqChatJSON` throws
 * DelegatedGenerationError rather than spending a token (see
 * ../lib/ai-context.ts for why). This module catches that at the tool
 * boundary and returns the prompt that was about to be sent, plus the name of
 * the parameter to hand the answer back on.
 *
 * The prompt is reused verbatim rather than rewritten for the client: it is
 * already tuned, and a second copy would drift from the one the CLI uses.
 */
import { pendingDelegation } from '../lib/ai-context.js';
import { DelegatedGenerationError, type GenerationStep } from '../lib/groq.js';
import type { ToolContent, ToolResult } from './shared.js';

/**
 * How each generation step is handed back.
 *
 * Keyed on the step rather than the tool because one tool can need several:
 * `preview_short` writes narration, then describes frames, then assigns them.
 * Keying on the tool told the caller to resupply the parameter it had just
 * supplied, which loops forever.
 *
 * `param: null` means the tool has no input for that answer yet. Saying so is
 * the honest result - naming a parameter that does not exist sends the caller
 * round again with an argument the tool ignores.
 */
const STEPS: Record<GenerationStep, { param: string | null; shape: string }> = {
  narration: {
    // Already existed for the human approval round: "approved narration, used
    // verbatim". Delegation reuses that contract rather than adding a parallel one.
    param: 'final_script',
    shape: 'the finished narration text',
  },
  titles: {
    // upload_to_youtube's confirm round already took these.
    param: 'title_a` / `title_b',
    shape: 'two title variants to A/B test',
  },
  hashtags: { param: 'tags', shape: 'the hashtags, as an array of strings' },
  frame_descriptions: { param: null, shape: 'one short description per frame, in order' },
  frame_assignment: { param: null, shape: 'which frame belongs to each narration beat' },
  highlights: { param: null, shape: 'the spans worth keeping' },
  post_copy: { param: null, shape: 'the post title, description and tags' },
};

const UNLABELLED = { param: null, shape: 'the generated text' };

/**
 * Format the refusal as a tool result the model can act on.
 *
 * Not an error result: nothing went wrong, and marking it `isError` makes
 * clients surface it as a failure rather than a step.
 */
export function delegatedBrief(e: DelegatedGenerationError): ToolResult {
  const { param, shape } = (e.step ? STEPS[e.step] : UNLABELLED) ?? UNLABELLED;

  const next = param
    ? [
        `Write ${shape} to the instructions above, then call \`${e.tool}\` again with the`,
        `same arguments plus \`${param}\`. The tool will use it verbatim and finish the job.`,
      ]
    : [
        `Write ${shape} to the instructions above.`,
        ``,
        `\`${e.tool}\` has no parameter for this yet, so it cannot finish this run: report`,
        `what you wrote to the user rather than calling the tool again, which would only`,
        `return this same brief.`,
      ];

  const content: ToolContent[] = [
    {
      type: 'text',
      text: [
        `This step needs writing, and you are a stronger model than anything this tool would`,
        `call, so it is yours to do rather than the server's.`,
        ``,
        e.system ? `## Instructions\n\n${e.system}` : '',
        ``,
        `## Material\n\n${e.prompt}`,
        ``,
        e.images.length
          ? `## Frames\n\n${e.images.length} frame(s) from the video follow this message.`
          : '',
        ``,
        `## Next`,
        ``,
        ...next,
      ]
        .filter((line) => line !== '')
        .join('\n'),
    },
  ];

  // Vision prompts sent Groq base64 JPEGs; the client gets the same frames as
  // real image blocks so it can look at them rather than take our word.
  for (const data of e.images) {
    content.push({ type: 'image', data, mimeType: 'image/jpeg' });
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
    const swallowed = pendingDelegation();
    return swallowed ? delegatedBrief(swallowed) : result;
  } catch (e) {
    if (e instanceof DelegatedGenerationError) return delegatedBrief(e);
    const pending = pendingDelegation();
    // A refusal that was caught downstream and then failed for an unrelated
    // reason still needs the brief - the unrelated failure is usually a
    // consequence of the missing text.
    if (pending) return delegatedBrief(pending);
    throw e;
  }
}
