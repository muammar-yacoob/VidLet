/**
 * Voiceover - Generate narration audio from a script.
 *
 * Engines:
 *  - edge (default): free Microsoft Edge neural voices, no API key, instant.
 *  - clone: local zero-shot voice cloning (Chatterbox, MIT) from a ~10s
 *    reference recording. First use installs the engine (several GB).
 *
 * Optionally mixes the narration over an existing video, auto-ducking the
 * original audio while the voice speaks.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { synthesizeClone } from '../lib/chatterbox.js';
import { resolveVoice, synthesizeSpeech } from '../lib/edge-tts.js';
import { checkFFmpeg, executeFFmpegRaw, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface VoiceoverOptions {
  /** Script text, or a path to a .txt/.md file containing it. */
  input: string;
  /** Output audio path (.mp3/.wav). Derived from input when omitted. */
  output?: string;
  /** Language code for Edge voices (en, es, fr, ...). Default en. */
  language?: string;
  gender?: 'female' | 'male';
  /** Exact Edge voice name, overrides language/gender. */
  voice?: string;
  /** Reference recording (~10s) — switches to the local cloning engine. */
  cloneRef?: string;
  /** Mix the narration over this video (auto-ducks its audio). */
  video?: string;
  /** Output path for the mixed video. Derived from the video when omitted. */
  videoOutput?: string;
  /** Loudness-normalize narration to -16 LUFS (default true). */
  normalize?: boolean;
  onProgress?: (stage: string) => void;
}

export const MAX_SCRIPT_LENGTH = 5000;

/** Read the script from a file when input points at one, else treat as literal text. */
export function resolveScriptText(input: string): string {
  const looksLikeFile = /\.(txt|md)$/i.test(input.trim());
  const text =
    looksLikeFile && existsSync(resolve(input)) ? readFileSync(resolve(input), 'utf8') : input;
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Script is empty.');
  if (trimmed.length > MAX_SCRIPT_LENGTH) {
    throw new Error(`Script too long (${trimmed.length} chars, max ${MAX_SCRIPT_LENGTH}).`);
  }
  return trimmed;
}

/** First free path: base.mp3, base-1.mp3, base-2.mp3 ... (house rule: never overwrite). */
export function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = join(dirname(path), basename(path, ext));
  for (let i = 1; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Filter graph mixing narration over original audio with sidechain ducking:
 * the original track compresses whenever the voice speaks. The narration is
 * silence-padded (apad) so the graph runs for the FULL video length — without
 * it, sidechaincompress hits EOF when the narration ends and truncates the
 * whole output to the narration duration.
 */
export function buildDuckFilter(): string {
  return [
    '[1:a]apad[p]',
    '[p]asplit=2[nc][ns]',
    '[0:a][ns]sidechaincompress=threshold=0.05:ratio=10:attack=20:release=400[duck]',
    '[duck][nc]amix=inputs=2:duration=first:normalize=0[out]',
  ].join(';');
}

function defaultAudioOutput(input: string): string {
  const looksLikeFile = /\.(txt|md)$/i.test(input.trim()) && existsSync(resolve(input));
  if (looksLikeFile) {
    const p = resolve(input);
    return join(dirname(p), `${basename(p, extname(p))}.mp3`);
  }
  return join(process.cwd(), 'voiceover.mp3');
}

/** Generate the narration audio file (no console output). Returns its path. */
export async function generateNarrationAudio(options: VoiceoverOptions): Promise<string> {
  return generateNarration(options);
}

async function generateNarration(options: VoiceoverOptions): Promise<string> {
  const { cloneRef, onProgress } = options;
  const progress = onProgress ?? (() => {});
  const text = resolveScriptText(options.input);
  // Explicit output = caller's intent (MCP pre-reserves it); default = never overwrite.
  const output = options.output
    ? resolve(options.output)
    : uniquePath(resolve(defaultAudioOutput(options.input)));

  if (cloneRef) {
    const wavOut = output.endsWith('.wav') ? output : `${output}.tmp.wav`;
    await synthesizeClone({
      text,
      referenceAudio: resolve(cloneRef),
      output: wavOut,
      onProgress: progress,
    });
    if (wavOut !== output) {
      progress('encoding mp3');
      await executeFFmpegRaw(['-y', '-i', wavOut, '-b:a', '128k', '-loglevel', 'error', output]);
      unlinkSync(wavOut);
    }
  } else {
    progress('synthesizing (Edge TTS)');
    const voice = options.voice ?? resolveVoice(options.language, options.gender);
    await synthesizeSpeech(text, output, voice);
  }

  if (options.normalize !== false) {
    progress('normalizing loudness');
    const norm = `${output}.norm${extname(output)}`;
    await executeFFmpegRaw([
      '-y',
      '-i',
      output,
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-b:a',
      '128k',
      '-loglevel',
      'error',
      norm,
    ]);
    await executeFFmpegRaw(['-y', '-i', norm, '-codec', 'copy', '-loglevel', 'error', output]);
    unlinkSync(norm);
  }

  return output;
}

/** Mix a narration file over a video, ducking the original audio. Returns output path. */
async function mixIntoVideo(
  video: string,
  narration: string,
  videoOutput?: string
): Promise<string> {
  const videoPath = resolve(video);
  const info = await getVideoInfo(videoPath);
  const output = videoOutput ? resolve(videoOutput) : getOutputPath(videoPath, '_voiceover');

  const args = ['-y', '-i', videoPath, '-i', narration];
  if (info.hasAudio) {
    args.push('-filter_complex', buildDuckFilter(), '-map', '0:v', '-map', '[out]');
  } else {
    // apad + -shortest: silence after the narration for the rest of the video.
    args.push('-filter_complex', '[1:a]apad[out]', '-map', '0:v', '-map', '[out]');
  }
  args.push('-c:v', 'copy', '-c:a', 'aac', '-shortest', '-loglevel', 'error', output);

  await executeFFmpegRaw(args);
  return output;
}

export async function voiceover(options: VoiceoverOptions): Promise<string> {
  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const engine = options.cloneRef ? 'Chatterbox (voice clone, local)' : 'Edge TTS (free)';
  header('Voiceover');
  console.log(`Engine:   ${fmt.yellow(engine)}`);
  if (options.cloneRef) console.log(`Voice:    ${fmt.white(options.cloneRef)}`);
  else
    console.log(
      `Voice:    ${fmt.white(options.voice ?? resolveVoice(options.language, options.gender))}`
    );
  separator();

  const progress = options.onProgress ?? ((stage: string) => console.log(fmt.dim(`  ${stage}...`)));
  const narration = await generateNarration({ ...options, onProgress: progress });

  let result = narration;
  if (options.video) {
    progress('mixing into video');
    result = await mixIntoVideo(options.video, narration, options.videoOutput);
  }

  success(`Done: ${result}`);
  return result;
}
