/**
 * Edge TTS - Free Microsoft Edge neural voices via msedge-tts.
 * No API key, no cost. Ported from vidlet-web's portable edge-tts package.
 */

/** Female (default) voice per language. */
export const LANGUAGE_VOICES: Record<string, string> = {
  en: 'en-US-AvaMultilingualNeural',
  ar: 'ar-LB-LaylaNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-VivienneMultilingualNeural',
  de: 'de-DE-SeraphinaMultilingualNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  zh: 'zh-CN-XiaoxiaoMultilingualNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  hi: 'hi-IN-SwaraNeural',
  tr: 'tr-TR-EmelNeural',
  nl: 'nl-NL-ColetteNeural',
};

/** Male voice alternatives per language. */
const LANGUAGE_VOICES_MALE: Record<string, string> = {
  en: 'en-US-AndrewMultilingualNeural',
  ar: 'ar-LB-RamiNeural',
  es: 'es-ES-AlvaroNeural',
  fr: 'fr-FR-RemyMultilingualNeural',
  de: 'de-DE-FlorianMultilingualNeural',
  it: 'it-IT-DiegoNeural',
  pt: 'pt-BR-AntonioNeural',
  ru: 'ru-RU-DmitryNeural',
  zh: 'zh-CN-YunxiMultilingualNeural',
  ja: 'ja-JP-KeitaNeural',
  ko: 'ko-KR-InJoonNeural',
  hi: 'hi-IN-MadhurNeural',
  tr: 'tr-TR-AhmetNeural',
  nl: 'nl-NL-MaartenNeural',
};

export const DEFAULT_VOICE = LANGUAGE_VOICES.en as string;

/**
 * Resolve the TTS voice for a given language and gender.
 * Falls back to English female when unknown.
 */
export function resolveVoice(lang?: string, gender?: 'female' | 'male'): string {
  if (!lang && !gender) return DEFAULT_VOICE;
  const key = (lang ?? 'en').trim().toLowerCase().slice(0, 2);
  const voices = gender === 'male' ? LANGUAGE_VOICES_MALE : LANGUAGE_VOICES;
  return voices[key] ?? LANGUAGE_VOICES[key] ?? DEFAULT_VOICE;
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
