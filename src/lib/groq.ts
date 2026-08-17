/**
 * Groq client - minimal fetch wrapper for JSON-mode chat completions.
 * Bring-your-own key (free tier at https://console.groq.com/keys), same
 * requirement model as QuickPeek. No SDK dependency.
 */

import { CACHEABLE_TEMP_MAX, cacheKey, withResponseCache } from './ai-cache.js';
import { currentMcpTool, recordDelegation, suppliedAnswer } from './ai-context.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Model tiers - use the cheapest model that does the job:
 *  - CREATIVE for writing narration/highlight judgement
 *  - FAST for mechanical text transforms
 *  - VISION for describing keyframes (cheap multimodal)
 */
export const GROQ_MODELS = {
  CREATIVE: 'openai/gpt-oss-120b',
  FAST: 'openai/gpt-oss-20b',
  VISION: 'qwen/qwen3.6-27b',
} as const;

const DEFAULT_MODEL = GROQ_MODELS.CREATIVE;

export function getGroqKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'GROQ_API_KEY not set. Get a free key at https://console.groq.com/keys then:\n' +
        '  export GROQ_API_KEY=gsk_...'
    );
  }
  return key;
}

export interface GroqMessage {
  role: 'system' | 'user';
  content: string | GroqContentPart[];
}

export interface GroqContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** Build a user message mixing text with inline JPEG frames. */
export function visionMessage(text: string, jpegsBase64: string[]): GroqMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...jpegsBase64.map(
        (b64): GroqContentPart => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        })
      ),
    ],
  };
}

const TEMPERATURE = 0.3;

/**
 * Which step of a pipeline wanted writing.
 *
 * A tool can need more than one - `preview_short` writes narration, then
 * describes frames, then assigns them - and each is satisfied by a different
 * field of the `ai` parameter. Keying the hand-back on the tool alone told the
 * caller to resupply the field it had just supplied, which loops.
 */
export type GenerationStep =
  | 'narration'
  | 'demo_script'
  | 'frame_descriptions'
  | 'frame_assignment'
  | 'highlights'
  | 'batch_highlights'
  | 'post_copy'
  | 'titles'
  | 'hashtags'
  | 'hashtag_sets';

/**
 * Wrap a supplied answer in the JSON shape its call site expects.
 *
 * The `ai` parameter takes plain values - a string of narration, an array of
 * descriptions - because that is what is natural to write. The call sites
 * destructure the JSON envelope Groq would have returned, so the envelope is
 * rebuilt here rather than at eleven call sites.
 */
export function shapeAnswer(step: GenerationStep, value: unknown): unknown {
  switch (step) {
    case 'narration':
      return { script: value };
    case 'frame_descriptions':
      return { descriptions: value };
    case 'frame_assignment':
      return { assignment: value };
    case 'hashtags':
      return { tags: value };
    case 'highlights':
      // Tolerated both ways: the brief asks for the array, but a model that
      // echoes the documented {"clips": [...]} envelope is not wrong either.
      return Array.isArray(value) ? { clips: value } : value;
    default:
      // demo_script, batch_highlights, post_copy, titles and hashtag_sets are
      // already objects with the keys their call sites read.
      return value;
  }
}

/**
 * Thrown instead of calling Groq when a request originates from an MCP tool.
 *
 * It carries the prompt that was about to be sent, so the boundary can hand
 * that brief to the client model rather than inventing a second copy of the
 * instructions that would drift from the one the CLI uses.
 */
export class DelegatedGenerationError extends Error {
  readonly tool: string;
  readonly step: GenerationStep | null;
  /** The system instructions, if the call had any. */
  readonly system: string;
  /** The user-side prompt text, images stripped out. */
  readonly prompt: string;
  /** Base64 JPEGs the prompt referred to, in order. */
  readonly images: string[];

  constructor(tool: string, messages: GroqMessage[], step: GenerationStep | null = null) {
    super(
      `Generation for "${tool}"${step ? ` (${step})` : ''} belongs to the calling model, ` +
        'not Groq. The tool should return this brief and accept the result as a parameter.'
    );
    this.name = 'DelegatedGenerationError';
    this.tool = tool;
    this.step = step;
    this.system = textOf(messages.filter((m) => m.role === 'system'));
    this.prompt = textOf(messages.filter((m) => m.role !== 'system'));
    this.images = messages.flatMap((m) =>
      typeof m.content === 'string'
        ? []
        : m.content
            .filter((p) => p.type === 'image_url' && p.image_url)
            .map((p) => (p.image_url?.url ?? '').replace(/^data:image\/jpeg;base64,/, ''))
    );
  }
}

/** Flatten message content to plain text, dropping image parts. */
function textOf(messages: GroqMessage[]): string {
  return messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('\n')
    )
    .join('\n\n')
    .trim();
}

/**
 * Call Groq chat completions in JSON mode and parse the response object.
 *
 * Every call goes through the response cache, so the same prompt is paid for
 * once per video project rather than once per render. Iterating on a Short
 * means re-running this over identical material - draft, final, then the
 * publish material again at upload time.
 */
export async function groqChatJSON<T>(
  messages: GroqMessage[],
  model: string = DEFAULT_MODEL,
  step: GenerationStep | null = null
): Promise<T> {
  // Checked before the cache: a cached Groq answer is still a Groq answer,
  // and serving one to an MCP caller would hide the delegation entirely.
  const mcpTool = currentMcpTool();
  if (mcpTool) {
    // The caller answered this step on a previous round; use it verbatim.
    const answered = step ? suppliedAnswer(step) : undefined;
    if (answered !== undefined) return shapeAnswer(step as GenerationStep, answered) as T;

    const refusal = new DelegatedGenerationError(mcpTool, messages, step);
    // Recorded as well as thrown: callers that swallow AI failures would
    // otherwise turn this into silent degradation. See ai-context.ts.
    recordDelegation(refusal);
    throw refusal;
  }

  const content = await withResponseCache(
    cacheKey({ model, messages, temperature: TEMPERATURE }),
    TEMPERATURE <= CACHEABLE_TEMP_MAX,
    async () => {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getGroqKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: TEMPERATURE,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Groq API error ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content;
      // Thrown, not cached: an empty completion is a transient failure, and
      // storing it would poison this prompt for the whole TTL.
      if (!text) throw new Error('Groq returned an empty response.');
      return text;
    }
  );

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Groq returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
