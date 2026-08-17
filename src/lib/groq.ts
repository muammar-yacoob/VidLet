/**
 * Groq client - minimal fetch wrapper for JSON-mode chat completions.
 * Bring-your-own key (free tier at https://console.groq.com/keys), same
 * requirement model as QuickPeek. No SDK dependency.
 */

import { CACHEABLE_TEMP_MAX, cacheKey, withResponseCache } from './ai-cache.js';

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
 * Call Groq chat completions in JSON mode and parse the response object.
 *
 * Every call goes through the response cache, so the same prompt is paid for
 * once per video project rather than once per render. Iterating on a Short
 * means re-running this over identical material - draft, final, then the
 * publish material again at upload time.
 */
export async function groqChatJSON<T>(
  messages: GroqMessage[],
  model: string = DEFAULT_MODEL
): Promise<T> {
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
