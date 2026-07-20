/**
 * Demo - the quiet-creator pipeline: turn a SILENT screen recording into a
 * finished narrated demo without ever recording your voice.
 *
 * 1. frame sampling finds idle spans (per-pixel motion - a moving cursor
 *    counts as activity; ffmpeg's freezedetect misses small-area changes)
 * 2. keyframes from the active spans go to a vision model when the Groq
 *    account has one enabled (falls back to --about-only scripting)
 * 3. an LLM writes the narration script from what it saw
 * 4. TTS speaks it (free Edge voices, or your cloned voice)
 * 5. outputs BOTH the full 16:9 narrated demo and a 9:16 Short
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { checkFFmpeg, executeFFmpegRaw, getVideoInfo, videoEncoderArgs } from '../lib/ffmpeg.js';
import { GROQ_MODELS, groqChatJSON, visionMessage } from '../lib/groq.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { diffCentroidX, estimateCropX } from '../lib/motion.js';
import { getOutputPath } from '../lib/paths.js';
import { type TimeSegment, invertSegments } from '../lib/segments.js';
import { type CaptionStyle, caption } from './caption.js';
import { generatePostCopy } from './short.js';
import { portraitMultiSegment } from './shorts.js';
import { generateNarrationAudio } from './voiceover.js';

export interface DemoOptions {
  input: string;
  /** One line about the product/feature being shown - sharpens the script. */
  about?: string;
  output?: string;
  language?: string;
  gender?: 'female' | 'male';
  voice?: string;
  /** ~10s reference recording - narrate in a cloned voice instead. */
  cloneRef?: string;
  /** Also produce the 9:16 Short (default true). */
  short?: boolean;
  /** Burn captions into the Short. */
  captions?: boolean;
  captionStyle?: CaptionStyle;
  /** Write title/description/hashtags next to the outputs. */
  post?: boolean;
  onProgress?: (stage: string) => void;
}

/** Words-per-second budget for comfortable TTS narration. */
export const NARRATION_WPS = 2.3;
export const SHORT_MAX_SECONDS = 55;
/** A static stretch must last this long before it is cut as idle. */
export const MIN_IDLE_SECONDS = 2;

/**
 * Convert per-step static flags (flags[i] = "nothing moved between sample i
 * and i+1") into idle TimeSegments of at least minIdleSeconds.
 */
export function idleRunsToSegments(
  staticFlags: boolean[],
  interval: number,
  minIdleSeconds: number
): TimeSegment[] {
  const minSteps = Math.max(1, Math.ceil(minIdleSeconds / interval));
  const idle: TimeSegment[] = [];
  let runStart = -1;
  for (let i = 0; i <= staticFlags.length; i++) {
    if (i < staticFlags.length && staticFlags[i]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLength = i - runStart;
      if (runLength >= minSteps) {
        idle.push({ start: runStart * interval, end: i * interval });
      }
      runStart = -1;
    }
  }
  return idle;
}

/** Pick chronological spans totaling at most maxTotal seconds, longest-first preference. */
export function pickShortSpans(spans: TimeSegment[], maxTotal: number): TimeSegment[] {
  const byLength = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start));
  const chosen: TimeSegment[] = [];
  let total = 0;
  for (const span of byLength) {
    const len = span.end - span.start;
    if (total + len > maxTotal) continue;
    chosen.push(span);
    total += len;
    if (total >= maxTotal * 0.9) break;
  }
  // Cap a single giant span to the budget.
  if (chosen.length === 0 && spans.length > 0) {
    const s = spans[0];
    chosen.push({ start: s.start, end: Math.min(s.end, s.start + maxTotal) });
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/**
 * Sample frames at a fixed rate and flag the steps where nothing moved.
 * Reuses the tuned per-pixel diff from lib/motion.ts, which detects even a
 * lone cursor - exactly what screen-recording idle detection needs.
 */
async function detectIdleSpans(
  input: string,
  duration: number,
  workDir: string
): Promise<TimeSegment[]> {
  const fps = duration > 900 ? 1 : 2;
  const interval = 1 / fps;
  const framesDir = join(workDir, 'frames');
  mkdirSync(framesDir, { recursive: true });
  await executeFFmpegRaw([
    '-y',
    '-i',
    input,
    '-vf',
    `fps=${fps},scale=320:-1`,
    '-loglevel',
    'error',
    join(framesDir, 'f%05d.png'),
  ]);

  const files = readdirSync(framesDir).sort();
  const flags: boolean[] = [];
  let prev: PNG | null = null;
  for (const file of files) {
    const png = PNG.sync.read(readFileSync(join(framesDir, file)));
    if (prev && prev.width === png.width && prev.height === png.height) {
      flags.push(diffCentroidX(prev.data, png.data, png.width, png.height) === null);
    }
    prev = png;
  }

  return idleRunsToSegments(flags, interval, MIN_IDLE_SECONDS);
}

const scriptSchema = z.object({
  narration: z.string().min(20),
  short_narration: z.string().min(10),
});

/** Vision models to try, in order - Groq orgs enable different sets. */
const VISION_CANDIDATES = [GROQ_MODELS.VISION, 'groq/compound-mini'];

/**
 * Describe keyframes with the first vision model the account allows.
 * Returns null when none is available - the script falls back to --about.
 */
async function describeKeyframes(
  input: string,
  spans: TimeSegment[],
  workDir: string
): Promise<string | null> {
  const picks = [...spans]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 5)
    .sort((a, b) => a.start - b.start);

  const frames: string[] = [];
  for (let i = 0; i < picks.length; i++) {
    const t = (picks[i].start + picks[i].end) / 2;
    const jpg = join(workDir, `kf${i}.jpg`);
    await executeFFmpegRaw([
      '-y',
      '-ss',
      t.toFixed(2),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-1',
      '-q:v',
      '5',
      '-loglevel',
      'error',
      jpg,
    ]);
    frames.push(readFileSync(jpg).toString('base64'));
  }

  for (const model of VISION_CANDIDATES) {
    try {
      const { descriptions } = await groqChatJSON<{ descriptions: string[] }>(
        [
          {
            role: 'system',
            content:
              'You describe screenshots from a product screen recording, in order. Respond with ' +
              'JSON {"descriptions": ["<one concise sentence per image: what screen/action is shown>"]}',
          },
          visionMessage('Screenshots in chronological order:', frames),
        ],
        model
      );
      return descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n');
    } catch {
      // Model missing/blocked on this account - try the next candidate.
    }
  }
  return null;
}

async function writeScript(
  visualSummary: string | null,
  about: string | undefined,
  fullSeconds: number,
  shortSeconds: number
): Promise<{ narration: string; shortNarration: string }> {
  const fullWords = Math.round(fullSeconds * NARRATION_WPS * 0.85);
  const shortWords = Math.round(shortSeconds * NARRATION_WPS * 0.85);

  const context = [
    about ? `Product context: ${about}` : null,
    visualSummary
      ? `What the recording shows:\n${visualSummary}`
      : 'No visual analysis is available - write an honest, benefit-led walkthrough script ' +
        'from the product context alone, without inventing specific on-screen details.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await groqChatJSON<unknown>([
    {
      role: 'system',
      content:
        'You write voiceover scripts for silent product screen recordings. Plain human voice, ' +
        'no hype words, no emojis, benefit-first, present tense, as if the maker is casually ' +
        'showing a friend. Respond with JSON {"narration": "<script, about ' +
        `${fullWords} words, matching the pacing of the visuals>", "short_narration": ` +
        `"<standalone hook-first version, at most ${shortWords} words>"}`,
    },
    { role: 'user', content: context },
  ]);

  const parsed = scriptSchema.safeParse(raw);
  if (!parsed.success) throw new Error('AI returned an unexpected script format');
  return { narration: parsed.data.narration, shortNarration: parsed.data.short_narration };
}

/** Single-pass idle-trim + narration mux. */
async function renderFullDemo(
  input: string,
  spans: TimeSegment[],
  narrationAudio: string,
  output: string
): Promise<void> {
  const select = spans.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
  await executeFFmpegRaw([
    '-y',
    '-i',
    input,
    '-i',
    narrationAudio,
    '-filter_complex',
    `[0:v]select='${select}',setpts=N/FRAME_RATE/TB,format=yuv420p[v]`,
    '-map',
    '[v]',
    '-map',
    '1:a',
    ...(await videoEncoderArgs()),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-loglevel',
    'error',
    output,
  ]);
}

export async function demo(options: DemoOptions): Promise<string> {
  const { input, about, cloneRef, onProgress } = options;
  const makeShort = options.short !== false;
  const progress = onProgress ?? ((stage: string) => console.log(fmt.dim(`  ${stage}...`)));

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const info = await getVideoInfo(input);
  const output = options.output ?? getOutputPath(input, '_demo');
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-demo-'));

  header('AI Demo');
  console.log(`Input:    ${fmt.white(input)} (${info.duration.toFixed(1)}s)`);
  console.log(`Voice:    ${fmt.yellow(cloneRef ? 'cloned (local)' : 'Edge TTS (free)')}`);
  separator();

  try {
    // 1. Idle-span detection (per-pixel motion - the recording is silent)
    progress('detecting idle spans');
    const idle = await detectIdleSpans(input, info.duration, workDir);
    let spans = invertSegments(info.duration, idle, { padding: 0.35, minLength: 0.8 });
    if (spans.length === 0) spans = [{ start: 0, end: info.duration }];
    const trimmedDuration = spans.reduce((s, x) => s + (x.end - x.start), 0);
    console.log(
      `Keeping:  ${fmt.green(`${trimmedDuration.toFixed(1)}s`)} of ${info.duration.toFixed(1)}s ` +
        `(${spans.length} active span${spans.length === 1 ? '' : 's'})`
    );

    // 2-3. Watch keyframes when a vision model is available, then script
    progress('watching keyframes (vision AI)');
    const visualSummary = await describeKeyframes(input, spans, workDir);
    if (!visualSummary) {
      console.log(
        fmt.yellow(
          'No vision model enabled on this Groq account - scripting from --about only. ' +
            'Enable a multimodal model at console.groq.com for smarter scripts.'
        )
      );
    }
    progress('writing narration script');
    const shortBudget = Math.min(SHORT_MAX_SECONDS, trimmedDuration);
    const script = await writeScript(visualSummary, about, trimmedDuration, shortBudget);
    writeFileSync(
      `${output}.script.txt`,
      `${script.narration}\n\n--- short version ---\n${script.shortNarration}\n`
    );

    // 4. Narration audio
    progress('generating voiceover');
    const narrationAudio = join(workDir, 'narration.mp3');
    await generateNarrationAudio({
      input: script.narration,
      output: narrationAudio,
      language: options.language,
      gender: options.gender,
      voice: options.voice,
      cloneRef,
      onProgress: progress,
    });

    // 5. Full-width narrated demo (single-pass trim + mux)
    progress('rendering full demo');
    await renderFullDemo(input, spans, narrationAudio, output);

    // 6. The 9:16 Short with action-tracking crop + its own tighter narration
    if (makeShort) {
      progress('rendering 9:16 short');
      const shortSpans = pickShortSpans(spans, SHORT_MAX_SECONDS);
      const segments = [];
      for (const span of shortSpans) {
        segments.push({
          id: `clip-${segments.length + 1}`,
          startTime: span.start,
          endTime: span.end,
          cropX: Number(
            (await estimateCropX(input, span.start, span.end, info.width, info.height)).toFixed(3)
          ),
        });
      }
      const shortSilent = join(workDir, 'short-silent.mp4');
      await portraitMultiSegment({ input, output: shortSilent, segments });

      const shortNarrationAudio = join(workDir, 'short-narration.mp3');
      await generateNarrationAudio({
        input: script.shortNarration,
        output: shortNarrationAudio,
        language: options.language,
        gender: options.gender,
        voice: options.voice,
        cloneRef,
        onProgress: progress,
      });

      let shortOut = getOutputPath(input, '_demo_short');
      await executeFFmpegRaw([
        '-y',
        '-i',
        shortSilent,
        '-i',
        shortNarrationAudio,
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-loglevel',
        'error',
        shortOut,
      ]);
      writeFileSync(
        `${shortOut}.segments.json`,
        JSON.stringify({ input, resolution: 1080, segments }, null, 2)
      );

      if (options.captions) {
        progress('burning captions on the short');
        shortOut = await caption({
          input: shortOut,
          autoTranscribe: true,
          style: options.captionStyle ?? 'hormozi',
        });
      }
      console.log(`Short:    ${fmt.white(shortOut)}`);
    }

    // 7. Post copy
    if (options.post) {
      progress('writing post copy');
      try {
        const postFile = await generatePostCopy([{ text: script.narration }], output);
        console.log(fmt.dim(`Post copy: ${postFile}`));
      } catch (err) {
        console.log(fmt.yellow(`Post copy skipped: ${(err as Error).message.slice(0, 120)}`));
      }
    }

    success(`Demo: ${output}`);
    console.log(fmt.dim(`Script saved to ${output}.script.txt - edit it and re-voice with:`));
    console.log(fmt.dim(`  vidlet voiceover "${output}.script.txt" --video "${output}"`));
    return output;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
