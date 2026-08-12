import { resolveVoice as kitResolveVoice, MULTILINGUAL_VOICES } from '@spark-apps/video-kit';

/**
 * Edge TTS - Free Microsoft Edge neural voices via msedge-tts.
 * No API key, no cost. Ported from vidlet-web's portable edge-tts package.
 */

// Voice tables and resolution live in the kit; the two social-video
// generators must narrate in the same voice as each other.
export const LANGUAGE_VOICES = MULTILINGUAL_VOICES;
export const DEFAULT_VOICE = MULTILINGUAL_VOICES.en as string;

/**
 * Resolve the TTS voice for a language and gender.
 *
 * Positional gender is kept as VidLet's own signature: it is what every
 * call site and the CLI flag already use, and the kit's options object
 * would be churn for no gain.
 */
export function resolveVoice(lang?: string, gender?: 'female' | 'male'): string {
  return kitResolveVoice(lang, { gender });
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

/**
 * Synthesize text to an MP3 buffer using Edge neural voices.
 * Retries on WebSocket drops (the Edge endpoint occasionally hangs up).
 */
export async function synthesizeToBuffer(
  text: string,
  voice: string = DEFAULT_VOICE
): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text);

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        audioStream.on('data', (c: Buffer) => chunks.push(c));
        audioStream.on('end', () => resolve());
        audioStream.on('error', reject);
      });
      return Buffer.concat(chunks);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Edge TTS failed after ${MAX_RETRIES + 1} attempts: ${msg}`);
}

/** Synthesize text straight to an MP3 file. */
export async function synthesizeSpeech(
  text: string,
  outputPath: string,
  voice: string = DEFAULT_VOICE
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const audio = await synthesizeToBuffer(text, voice);
  await writeFile(outputPath, audio);
}
