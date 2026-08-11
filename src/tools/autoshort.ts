/**
 * AutoShort - "generate a video short from these files", end to end.
 *
 * Analysis first, then ONE ffmpeg pass. Earlier versions encoded four times
 * (trim each clip, stitch, burn captions, mux music); every stage after the
 * first ran at 1080x1920 through a gaussian blur, which is where the
 * wall-clock went. Everything now resolves before rendering - spans, grade,
 * narration audio, caption timings - so the single graph is the only time a
 * frame is touched.
 *
 * Pipeline:
 *  1. classify inputs (videos, .srt/.vtt, narration .txt/.md, music)
 *  2. per clip, ONE analysis pass yields both idle spans and luma stats
 *  3. drop retakes on voiced clips (whisper transcript similarity)
 *  4. speed = whatever lands the kept footage under the ceiling
 *  5. narration: Groq rewrite -> TTS -> whisper the TTS for caption timing
 *  6. single render: select + grade + pad + concat + speed + captions,
 *     with narration over a ducked music bed
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyInputs,
  dedupeRetakes,
  planNarrationBeats,
  realSpeechWords,
  spansWithText,
  speedFor,
  splitScriptSections,
  splitSentences,
  subtitleToText,
  timeWordsInLine,
} from '../lib/autoshort-plan.js';
import {
  executeFFmpegAnalysis,
  executeFFmpegRaw,
  executeFFmpegWithProgress,
  getMediaDuration,
  getVideoInfo,
  videoEncoderArgs,
} from '../lib/ffmpeg.js';
import { type LumaStats, averageStats, matchGrade, parseLumaStats } from '../lib/grade.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { type ResolvedTrack, resolveMusicChoice } from '../lib/music.js';
import { type TimeSegment, detectSilence, invertSegments } from '../lib/segments.js';
import { type TranscriptSegment, transcribe } from '../lib/whisper.js';
import { type SrtEntry, generateShortsAss } from './caption.js';
import { cleanVoice } from './cleanvoice.js';
import { maskSensitive as runMask } from './mask.js';
import { buildSpeedupAudioFilters } from './speedup.js';
import { buildSelectExpr, escapeFilterPath } from './timelapse.js';
import { generateNarrationAudio } from './voiceover.js';

export {
  type ClassifiedInputs,
  type SpokenSpan,
  classifyInputs,
  dedupeRetakes,
  scriptToSrt,
  planNarrationBeats,
  spansWithText,
  speedFor,
  splitScriptSections,
  splitSentences,
  subtitleToText,
  timeWordsInLine,
} from '../lib/autoshort-plan.js';
import {
  type SectionWindow,
  allocateLinesToSections,
  sourceTimeToOutput,
  startsFromAssignment,
} from '../lib/autoshort-plan.js';
import { assignLinesToFrames, describeTimeline } from './narration-align.js';

export interface AutoShortOptions {
  inputs: string[];
  /** Narration text. Used verbatim when `scriptIsFinal`, else rewritten. */
  narration?: string;
  /** Skip the AI rewrite - this text was already approved by a human. */
  scriptIsFinal?: boolean;
  music?: string;
  /** Bed level, 0-1. Default 0.08 - it sits under the voice, not beside it. */
  musicVolume?: number;
  maxDuration?: number;
  captions?: boolean;
  /** Contrast boost on top of per-clip matching. Default 1.25. */
  contrast?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  /** Silence before the first word, so it does not open mid-syllable. */
  leadIn?: number;
  /**
   * Seconds of picture kept after the last word. Ending on the final
   * syllable feels like the file was truncated; a short tail lets the music
   * fade and the last frame land.
   */
  tailPad?: number;
  /**
   * A clip to open with, played at NATURAL speed. Intros are branding, not
   * footage: sweeping a 6s logo animation into an 18x timelapse would leave
   * a third of a second of nothing anyone can read.
   */
  intro?: string;
  /**
   * Place each narration line by LOOKING at the footage (Groq vision) so
   * the words describe what is on screen, rather than spacing lines
   * arithmetically. Default true; degrades silently to proportional
   * placement without a key.
   */
  alignToContent?: boolean;
  /**
   * Scan the FINISHED Short for on-screen card numbers, emails, keys and
   * addresses and pixelate them. Default true. Deliberately run on the
   * output rather than the sources: only the frames that survived the cut
   * can leak anything, and there are a few dozen of them instead of tens of
   * thousands.
   */
  maskSensitive?: boolean;
  output?: string;
  language?: string;
  gender?: 'female' | 'male';
  onProgress?: (stage: string) => void;
}

export interface AutoShortResult {
  output: string;
  sourceDuration: number;
  keptDuration: number;
  outputDuration: number;
  speed: number;
  videos: number;
  spansKept: number;
  retakesDropped: number;
  voiced: boolean;
  narration: 'tts' | 'original-voice' | 'none';
  narrationSeconds: number;
  captionsBurned: boolean;
  /** Output canvas, chosen from how much detail the sources actually have. */
  resolution: string;
  /** Seconds of un-sped intro at the head, 0 when there is none. */
  introSeconds: number;
  /** Whether narration was placed by looking at the footage. */
  contentAligned: boolean;
  /** What the sensitive-data scan did, and why, so it is never silent. */
  masking: { scanned: boolean; regionsMasked: number; note?: string };
  music: ResolvedTrack | null;
  /** Wall-clock per stage, so a slow render can be attributed. */
  stageSeconds: Record<string, number>;
}

const SHORT_W = 1080;
const SHORT_H = 1920;
/**
 * Smaller 9:16 canvas, used when the source has nowhere near enough pixels
 * to justify the full one. A 320x360 screen capture upscaled to 1080x1920
 * is 3.4x of invented detail; 720x1280 is still 2.25x and costs 45% less
 * to filter and encode (measured: 5.55s vs 3.03s on the same chain).
 */
const SMALL_W = 720;
const SMALL_H = 1280;
/** Below this source height, the full canvas buys nothing but render time. */
const SMALL_CANVAS_MAX_SOURCE_H = 540;

/** Output canvas: full size unless every source is far too small to use it. */
export function chooseCanvas(sourceHeights: number[]): { width: number; height: number } {
  const tallest = Math.max(0, ...sourceHeights);
  return tallest > SMALL_CANVAS_MAX_SOURCE_H
    ? { width: SHORT_W, height: SHORT_H }
    : { width: SMALL_W, height: SMALL_H };
}
/**
 * The background copy is blurred at a quarter of the output resolution and
 * scaled back up. gblur cost scales with area, and a sigma-32 blur at full
 * size is indistinguishable from sigma-8 at quarter size once upscaled.
 */
/** Words per second Edge neural TTS actually delivers (~175 wpm). */
const TTS_WPS = 2.9;
/** Fraction of the runtime narration should cover. Not 100%: it needs air. */
const NARRATION_COVERAGE = 0.85;
/** Default silence before the first word. */
const DEFAULT_LEAD_IN = 1;
/** Default picture kept after the last word, for the music to breathe out. */
const DEFAULT_TAIL_PAD = 1.8;
/**
 * Mean absolute inter-frame luma difference below which a sampled step is
 * "nothing happened". ffmpeg computes this natively as signalstats YDIF,
 * replacing a pass that decoded every sampled frame to PNG and diffed it in
 * JavaScript.
 */
const IDLE_YDIF = 0.45;
/** Analysis sampling rate, frames per second. */
const ANALYSIS_FPS = 2;

export interface ClipAnalysis {
  idle: TimeSegment[];
  luma: LumaStats | null;
}

/** Runs of low inter-frame difference, as idle time segments. */
export function ydifToIdleSpans(
  ydif: number[],
  interval: number,
  minIdleSeconds: number
): TimeSegment[] {
  const minSteps = Math.max(1, Math.ceil(minIdleSeconds / interval));
  const spans: TimeSegment[] = [];
  let runStart = -1;
  for (let i = 0; i <= ydif.length; i++) {
    if (i < ydif.length && ydif[i] < IDLE_YDIF) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      if (i - runStart >= minSteps) {
        spans.push({ start: runStart * interval, end: i * interval });
      }
      runStart = -1;
    }
  }
  return spans;
}

/**
 * Sample the clip once and derive both signals from the same decode.
 * signalstats reports YDIF (inter-frame motion) alongside YAVG/YLOW/YHIGH,
 * so idle detection and contrast measurement share a pass.
 */
export async function analyzeClip(input: string, minIdleSeconds = 2): Promise<ClipAnalysis> {
  const log = await executeFFmpegAnalysis(input, [
    '-vf',
    `fps=${ANALYSIS_FPS},scale=320:-1,signalstats,metadata=print`,
  ]);
  const ydif = [...log.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].map((m) =>
    Number.parseFloat(m[1])
  );
  return {
    idle: ydifToIdleSpans(ydif, 1 / ANALYSIS_FPS, minIdleSeconds),
    luma: parseLumaStats(log),
  };
}

/** Luma profile of a clip, for cross-clip contrast matching. */
export async function measureLuma(input: string): Promise<LumaStats | null> {
  return (await analyzeClip(input)).luma;
}

/** True when the file has an audio stream with actual signal in it. */
export async function detectVoicedAudio(input: string): Promise<boolean> {
  if (!(await getVideoInfo(input)).hasAudio) return false;
  const stderr = await executeFFmpegAnalysis(input, ['-af', 'volumedetect']);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return max !== null && Number.parseFloat(max[1]) > -30;
}

/**
 * True when the audio contains actual SPEECH, not just signal. A constant
 * desktop hum passes the volume check but transcribes to [BLANK_AUDIO], so
 * whisper a ~60s slice from the middle and count real words.
 */
export async function sniffSpeech(input: string): Promise<boolean> {
  const info = await getVideoInfo(input);
  const sliceLen = Math.min(60, info.duration);
  const start = Math.max(0, info.duration / 2 - sliceLen / 2);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-sniff-'));
  try {
    // Audio-only slice: whisper never needs the pixels.
    const slice = join(workDir, 'slice.m4a');
    await executeFFmpegRaw([
      '-y',
      '-ss',
      start.toFixed(2),
      '-i',
      input,
      '-t',
      sliceLen.toFixed(2),
      '-vn',
      '-c:a',
      'aac',
      slice,
    ]);
    const result = await transcribe(slice, { model: 'base.en' });
    const words = realSpeechWords(result.segments.map((s) => s.text).join(' '));
    return words / (sliceLen / 60) >= 8;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Rewrite narration in a modern, cheerful creator voice, sized to the
 * runtime. Exported so the MCP layer can put the draft in front of a human
 * BEFORE anything renders.
 */
export async function rephraseScript(raw: string, outputSeconds: number): Promise<string | null> {
  if (!process.env.GROQ_API_KEY?.trim()) return null;
  const { groqChatJSON } = await import('../lib/groq.js');
  const targetWords = Math.max(12, Math.round(outputSeconds * TTS_WPS * NARRATION_COVERAGE));
  try {
    const result = await groqChatJSON<{ script: string }>([
      {
        role: 'system',
        content: `You write voiceover for YouTube Shorts that people actually finish. Rewrite the draft in a warm, upbeat, modern creator voice - how a friendly YouTuber talks to camera. Hook the viewer in the first three words. Short punchy sentences of four to ten words. Mirror the draft's own voice and person: if the draft says "I", stay in first person and keep it personal; if it addresses the viewer, stay in second person. Present tense, contractions. If the draft opens with a specific line, keep that opening intact. Sound genuinely delighted by the thing rather than salesy. Vary the rhythm so it never drones. End on a satisfying payoff line, not a call to action. Never use: "dive in", "unleash", "game-changer", "in this video", "let's explore", "journey", "buckle up". No emojis, no hashtags, no stage directions, no headings, and never an em dash or any dash used as punctuation, because TTS reads it as an odd pause. Use commas or full stops. This is read aloud, so plain spoken words only. Length matters: write ${targetWords} words, and never fewer than ${Math.round(targetWords * 0.9)}, because this is read aloud over a ${Math.round(outputSeconds)} second video and has to carry most of it. Respond with JSON {"script": "<${targetWords} words of spoken narration>"}`,
      },
      { role: 'user', content: raw },
    ]);
    return result.script?.trim() || null;
  } catch {
    return null; // model trouble - the raw script still works
  }
}

/** Narration text from whichever source the caller supplied. */
export function resolveScriptSource(
  files: ReturnType<typeof classifyInputs>,
  narration?: string
): string {
  if (narration?.trim()) return narration.trim();
  if (files.narrationPath) return readFileSync(files.narrationPath, 'utf8').trim();
  if (files.subtitlePath) return subtitleToText(readFileSync(files.subtitlePath, 'utf8'));
  return '';
}

/**
 * Everything the MCP layer needs to ask its questions without rendering:
 * how long the Short will be, and whether the footage already has a voice.
 */
export async function planShort(
  inputs: string[],
  maxDuration = 57
): Promise<{ outputDuration: number; voiced: boolean; videos: number }> {
  const files = classifyInputs(inputs);
  if (files.videos.length === 0) throw new Error('No video files among the inputs.');
  let kept = 0;
  let voiced = false;
  for (const video of files.videos) {
    const info = await getVideoInfo(video);
    const analysis = await analyzeClip(video);
    const spans = invertSegments(info.duration, analysis.idle, { padding: 0.35, minLength: 0.8 });
    kept += (spans.length > 0 ? spans : [{ start: 0, end: info.duration }]).reduce(
      (n, s) => n + (s.end - s.start),
      0
    );
    if (!voiced && (await detectVoicedAudio(video))) {
      try {
        voiced = await sniffSpeech(video);
      } catch {
        voiced = true;
      }
    }
  }
  const speed = speedFor(kept, Math.min(59, maxDuration));
  return { outputDuration: kept / speed, voiced, videos: files.videos.length };
}

/**
 * Speak the script as separate lines and lay them on the timeline so they
 * land on cuts.
 *
 * Synthesising the whole script as one take produced a voice that ran
 * continuously while the footage jumped somewhere else: nothing lined up,
 * because nothing was ever asked to. Each sentence is now its own take,
 * placed by planNarrationBeats, with real silence between lines.
 */
export interface PlacedTake {
  path: string;
  text: string;
  start: number;
  duration: number;
}

async function synthesizeNarration(
  script: string,
  workDir: string,
  leadIn: number,
  outputDuration: number,
  boundaries: number[],
  sections: SectionWindow[],
  /** Vision-derived start time per line, when alignment succeeded. */
  alignedStarts: number[] | null,
  options: Pick<AutoShortOptions, 'language' | 'gender'>
): Promise<{ path: string; takes: PlacedTake[] }> {
  // An explicit `---` marker per clip beats any inference: the person who
  // recorded it knows which lines describe which footage.
  const declared = splitScriptSections(script);
  const useDeclared = declared.length > 1 && declared.length === sections.length;
  const sentences = splitSentences(script.replace(/^\s*-{3,}\s*$/gm, ' '));

  // Lines are independent takes, so they synthesise concurrently.
  const takes = await Promise.all(
    sentences.map(async (text, i) => {
      const path = await generateNarrationAudio({
        input: text,
        output: join(workDir, `line-${i}.mp3`),
        language: options.language,
        gender: options.gender,
      });
      return { text, path, duration: await getMediaDuration(path) };
    })
  );

  // When VidLet has looked at the footage, those placements win outright:
  // they are the only ones that know what is on screen.
  if (alignedStarts && alignedStarts.length === takes.length) {
    const beats = takes.map((t, i) => ({
      text: t.text,
      start: alignedStarts[i],
      duration: t.duration,
    }));
    return renderNarrationMix(beats, takes, workDir);
  }

  // `outputDuration` here is already the runtime MINUS the end tail, so the
  // sections have to be clamped to it. Leaving them at the full runtime is
  // what let the closing line run to the final frame despite the padding.
  const usable = sections.map((w) => ({
    start: Math.min(w.start, outputDuration),
    end: Math.min(w.end, outputDuration),
  }));
  // Lines are allocated to the clip they describe, then placed inside that
  // clip's own window, so "then we rig it" cannot start while the modelling
  // footage is still on screen.
  // Declared sections map straight onto clips; otherwise fall back to
  // splitting by how long each clip runs.
  const groups = useDeclared
    ? (() => {
        const counts = declared.map((d) => splitSentences(d).length);
        const out: (typeof takes)[] = [];
        let at = 0;
        for (const n of counts) {
          out.push(takes.slice(at, at + n));
          at += n;
        }
        return out;
      })()
    : allocateLinesToSections(takes, usable);
  const beats: ReturnType<typeof planNarrationBeats> = [];
  groups.forEach((group, i) => {
    if (group.length === 0) return;
    const win = usable[i] ?? { start: leadIn, end: outputDuration };
    const placed = planNarrationBeats(
      group,
      boundaries.filter((b) => b >= win.start && b < win.end),
      win.end,
      Math.max(win.start, i === 0 ? leadIn : win.start)
    );
    beats.push(...placed);
  });
  return renderNarrationMix(beats, takes, workDir);
}

/** Lay each spoken take at its start time and mix them into one track. */
async function renderNarrationMix(
  beats: Array<{ text: string; start: number; duration: number }>,
  takes: Array<{ path: string }>,
  workDir: string
): Promise<{ path: string; takes: PlacedTake[] }> {
  const output = join(workDir, 'narration.m4a');

  // One line needs no mixing, just its offset.
  const inputs = takes.flatMap((t) => ['-i', t.path]);
  const delays = beats.map((b, i) => {
    const ms = Math.round(b.start * 1000);
    return `[${i}:a]adelay=${ms}|${ms}[d${i}]`;
  });
  const mix =
    beats.length === 1
      ? '[d0]anull[a]'
      : `${beats.map((_, i) => `[d${i}]`).join('')}amix=inputs=${beats.length}:duration=longest:normalize=0[a]`;

  await executeFFmpegRaw([
    '-y',
    ...inputs,
    '-filter_complex',
    `${delays.join(';')};${mix}`,
    '-map',
    '[a]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    output,
  ]);
  return {
    path: output,
    takes: beats.map((b, i) => ({
      path: takes[i].path,
      text: b.text,
      start: b.start,
      duration: b.duration,
    })),
  };
}

/** Output-time window each clip occupies, after any intro. */
export function clipWindows(
  clips: Array<{ kept: number }>,
  speed: number,
  offset: number
): SectionWindow[] {
  const out: SectionWindow[] = [];
  let elapsed = offset;
  for (const clip of clips) {
    const end = elapsed + clip.kept / speed;
    out.push({ start: elapsed, end });
    elapsed = end;
  }
  return out;
}

/**
 * Output-time positions where one kept span meets the next. These are the
 * moments the picture cuts, and so the moments a line of narration should
 * be allowed to start on.
 */
export function cutBoundaries(
  clips: Array<{ spans: TimeSegment[] }>,
  speed: number,
  offset = 0
): number[] {
  const out: number[] = [offset];
  let elapsed = 0;
  for (const clip of clips) {
    for (const span of clip.spans) {
      out.push(offset + elapsed / speed);
      elapsed += span.end - span.start;
    }
  }
  return out;
}

interface PreparedClip {
  source: string;
  /**
   * Transcript of the ORIGINAL voice, when there was one. Already paid for
   * by retake de-duplication, so captioning a recorded voice costs nothing
   * extra rather than a second pass.
   */
  transcript: TranscriptSegment[] | null;
  spans: TimeSegment[];
  luma: LumaStats | null;
  kept: number;
  retakesDropped: number;
  voiced: boolean;
}

/**
 * Decide what to keep from one clip. Nothing is encoded here - the spans go
 * straight into the single render pass as a select expression.
 */
async function prepareClip(
  input: string,
  index: number,
  keepVoice: boolean,
  workDir: string,
  progress: (stage: string) => void
): Promise<PreparedClip> {
  let voiced = false;
  // With voiceover: 'tts' the source audio is discarded whatever it holds,
  // so asking whether it contains speech buys nothing and costs a whisper
  // pass per clip. Speech recognition only earns its keep on audio we are
  // actually going to use.
  if (keepVoice && (await detectVoicedAudio(input))) {
    progress(`listening for speech in clip ${index + 1}`);
    try {
      voiced = await sniffSpeech(input);
    } catch {
      voiced = true; // whisper unavailable - trust the volume signal
    }
  }

  // Denoising only earns its cost when the voice survives into the output.
  // Under a TTS narration the source audio is discarded anyway.
  let source = input;
  if (voiced && keepVoice) {
    progress(`denoising clip ${index + 1}`);
    source = await cleanVoice({
      input,
      output: join(workDir, `clean-${index}.mp4`),
      onProgress: () => {},
    });
  }

  const info = await getVideoInfo(source);
  progress(`analysing clip ${index + 1}`);
  const analysis = await analyzeClip(source);

  let spans: TimeSegment[];
  if (voiced) {
    // The ORIGINAL file deliberately: cleanVoice loudnorms to -14 LUFS,
    // which lifts quiet passages past silencedetect's threshold.
    const silences = await detectSilence(input, {
      minDuration: 1.2,
      thresholdDb: -32,
      videoDuration: info.duration,
    });
    spans = invertSegments(info.duration, silences, { padding: 0.25, minLength: 0.6 });
  } else {
    spans = invertSegments(info.duration, analysis.idle, { padding: 0.35, minLength: 0.8 });
  }
  if (spans.length === 0) spans = [{ start: 0, end: info.duration }];

  let retakesDropped = 0;
  let transcript: TranscriptSegment[] | null = null;
  if (voiced && keepVoice) {
    try {
      progress(`transcribing clip ${index + 1} for retakes`);
      const result = await transcribe(source, { model: 'base.en' });
      transcript = result.segments;
      const unique = dedupeRetakes(spansWithText(spans, result.segments));
      retakesDropped = spans.length - unique.length;
      spans = unique;
    } catch {
      // whisper unavailable - keep every span rather than dying
    }
  }

  return {
    source,
    transcript,
    spans,
    luma: analysis.luma,
    kept: spans.reduce((n, s) => n + (s.end - s.start), 0),
    retakesDropped,
    voiced,
  };
}

/**
 * The whole edit as one filtergraph: per-clip trim and grade, framed to a
 * common canvas, concatenated, sped up, captions burned, narration over a
 * ducked bed.
 */
export function buildRenderGraph(opts: {
  /** `spans: null` means "use the whole clip, at natural speed" (an intro). */
  clips: Array<{ spans: TimeSegment[] | null; luma: LumaStats | null }>;
  speed: number;
  contrast: number;
  keepSourceAudio: boolean;
  assPath?: string;
  ttsIndex?: number;
  musicIndex?: number;
  musicVolume: number;
  outputDuration: number;
  canvas?: { width: number; height: number };
}): string {
  const { clips, speed, contrast, keepSourceAudio, assPath, ttsIndex, musicIndex } = opts;
  const { width: outW, height: outH } = opts.canvas ?? { width: SHORT_W, height: SHORT_H };
  const chains: string[] = [];

  const measured = clips.flatMap((c) => (c.luma ? [c.luma] : []));
  const target = measured.length > 0 ? averageStats(measured) : null;

  clips.forEach((clip, i) => {
    const grade =
      target && clip.luma ? matchGrade(clip.luma, target, contrast) : { contrast, brightness: 0 };
    // Trim, grade and frame in one go. Every clip lands on the same canvas
    // because concat demands identical width/height/SAR.
    // Speed is applied HERE, before the scale/blur, not after the concat.
    // The kept footage is several times longer than the finished Short, so
    // scaling it to 1080x1920 first means blurring thousands of frames that
    // are about to be dropped - the single biggest cost in the render.
    // An intro (spans === null) plays whole and at natural speed; footage
    // is trimmed to its kept spans and swept up to the timelapse rate.
    const head = clip.spans
      ? `select='${buildSelectExpr(clip.spans)}',setpts=N/FRAME_RATE/TB,setpts=PTS/${speed},fps=30`
      : 'fps=30,setpts=PTS-STARTPTS';
    chains.push(
      `[${i}:v]${head},` +
        `eq=contrast=${grade.contrast}:brightness=${grade.brightness},split=2[bg${i}][fg${i}]`
    );
    chains.push(
      `[bg${i}]scale=${Math.round(outW / 4)}:${Math.round(outH / 4)}:force_original_aspect_ratio=increase,` +
        `crop=${Math.round(outW / 4)}:${Math.round(outH / 4)},gblur=sigma=8,scale=${outW}:${outH},` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:thickness=fill[bgb${i}]`
    );
    chains.push(
      `[fg${i}]scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos[fgs${i}]`
    );
    chains.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1[n${i}]`);
    if (keepSourceAudio && clip.spans) {
      chains.push(`[${i}:a]aselect='${buildSelectExpr(clip.spans)}',asetpts=N/SR/TB[na${i}]`);
    }
  });

  const vIn = clips.map((_, i) => `[n${i}]`).join('');
  chains.push(`${vIn}concat=n=${clips.length}:v=1:a=0[cv]`);
  const captions = assPath ? `,ass='${escapeFilterPath(assPath)}'` : '';
  chains.push(`[cv]${captions ? captions.slice(1) : 'null'},format=yuv420p[v]`);

  // ---- audio ----
  let voiceLabel: string | null = null;
  if (ttsIndex !== undefined) {
    chains.push(`[${ttsIndex}:a]aresample=48000,aformat=channel_layouts=stereo,apad[voice]`);
    voiceLabel = '[voice]';
  } else if (keepSourceAudio) {
    const aIn = clips.map((_, i) => `[na${i}]`).join('');
    // Video speed happens per clip; the source audio still needs the same
    // factor applied here, pitch-preserved.
    chains.push(
      `${aIn}concat=n=${clips.length}:v=0:a=1,${buildSpeedupAudioFilters(speed, 1, 48000)},aresample=48000[srcaud]`
    );
    voiceLabel = '[srcaud]';
  }

  if (musicIndex !== undefined) {
    const fadeStart = Math.max(0, opts.outputDuration - 2);
    chains.push(
      `[${musicIndex}:a]aresample=48000,aformat=channel_layouts=stereo,` +
        `atrim=0:${opts.outputDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `volume=${opts.musicVolume},afade=t=in:st=0:d=1.5,` +
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=2[bed]`
    );
    if (voiceLabel) {
      // Duck the bed under the voice rather than relying on level alone:
      // present between lines, out of the way underneath them.
      chains.push(`${voiceLabel}asplit=2[vmix][vkey]`);
      chains.push(
        '[bed][vkey]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=350[duckedbed]'
      );
      chains.push('[duckedbed][vmix]amix=inputs=2:duration=first:normalize=0[a]');
    } else {
      chains.push('[bed]anull[a]');
    }
  } else if (voiceLabel) {
    chains.push(`${voiceLabel}atrim=0:${opts.outputDuration.toFixed(3)}[premix]`);
    chains.push('[premix]anull[mixed]');
  }
  // YouTube, Instagram and TikTok all normalise playback to roughly
  // -14 LUFS. Arriving at that level means the platform leaves the audio
  // alone instead of pulling it up or down. Skipped entirely when the
  // Short is silent, since there would be no [a] to normalise.
  const hasAudioChain = musicIndex !== undefined || voiceLabel !== null;
  if (hasAudioChain) {
    const last = chains[chains.length - 1];
    if (last.endsWith('[a]')) {
      chains[chains.length - 1] = `${last.slice(0, -3)}[mixed]`;
    }
    // loudnorm alone is not enough: in single-pass mode it cannot see the
    // whole file's peaks in advance, so it estimates gain from a running
    // measurement and overshoots on sharp transients - exactly what TTS
    // consonants produce. Measured on a real render: TP=-1.5 was requested
    // and the output peaked at +0.9 dBTP, past digital clipping. alimiter
    // afterward is a hard, lookahead-based ceiling that catches whatever
    // loudnorm's estimate missed, at -1 dBTP (YouTube's own ceiling).
    chains.push('[mixed]loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.891:level=disabled[a]');
  }

  return chains.join(';');
}

/**
 * Encoder for the final pass. Real GPU encoders are worth it; integrated
 * VAAPI is not, because the expensive part of this graph is the CPU-side
 * blur and scale, and hwupload only adds a transfer.
 */
async function fastEncoderArgs(): Promise<string[]> {
  const gpu = await videoEncoderArgs();
  if (gpu.includes('h264_nvenc')) return gpu;
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
}

export async function autoShort(options: AutoShortOptions): Promise<AutoShortResult> {
  const { inputs, output } = options;
  const maxDuration = Math.min(59, options.maxDuration ?? 57);
  const wantCaptions = options.captions !== false;
  const contrast = options.contrast ?? 1.25;
  const musicVolume = options.musicVolume ?? 0.08;
  const leadIn = options.leadIn ?? DEFAULT_LEAD_IN;
  const tailPad = options.tailPad ?? DEFAULT_TAIL_PAD;
  const mode = options.voiceover ?? 'auto';
  const progress = options.onProgress ?? ((s: string) => console.log(fmt.dim(`  ${s}...`)));

  const files = classifyInputs(inputs);
  if (files.videos.length === 0) throw new Error('No video files among the inputs.');
  if (!output) throw new Error('`output` is required.');

  const track = resolveMusicChoice(files.musicPath ?? options.music);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-autoshort-'));
  const stageSeconds: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      stageSeconds[name] = Number(((Date.now() - t0) / 1000).toFixed(1));
    }
  };

  header('AutoShort');
  console.log(`Videos:   ${fmt.white(String(files.videos.length))}`);
  console.log(`Target:   ${fmt.yellow(`<=${maxDuration}s`)}`);
  separator();

  try {
    const rawScript = resolveScriptSource(files, options.narration);
    // Settled up front: it decides whether denoising is worth doing at all.
    const keepVoice = mode !== 'tts';

    // Clips are independent, so they analyse concurrently. ffmpeg and
    // whisper are each single-clip-bound; on any multi-core box this is
    // close to free.
    const clipsPromise = time('analyse', () =>
      Promise.all(
        files.videos.map((video, i) => prepareClip(video, i, keepVoice, workDir, progress))
      )
    );

    const clips = await clipsPromise;

    const voiced = clips.some((c) => c.voiced);
    const keptDuration = clips.reduce((n, c) => n + c.kept, 0);
    const sourceDuration = (
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).duration))
    ).reduce((a, b) => a + b, 0);
    const canvas = chooseCanvas(
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).height))
    );
    // The intro is spent from the same budget, so the timelapse is sped to
    // fit whatever is left rather than overrunning the ceiling.
    const introSeconds = options.intro ? await getMediaDuration(options.intro) : 0;
    const speed = speedFor(keptDuration, Math.max(1, maxDuration - introSeconds));
    const outputDuration = introSeconds + keptDuration / speed;
    console.log(
      `Kept:     ${fmt.white(keptDuration.toFixed(1))}s of ${sourceDuration.toFixed(1)}s → ${fmt.green(outputDuration.toFixed(1))}s at ${fmt.yellow(`${speed.toFixed(1)}x`)}`
    );

    // ---- narration resolved BEFORE a frame is touched ----
    let script = rawScript;
    if (rawScript && !options.scriptIsFinal) {
      progress('rewriting narration');
      const better = await time('rewrite', () => rephraseScript(rawScript, outputDuration));
      if (better) script = better;
    }

    const wantTts = script !== '' && mode !== 'keep' && (mode === 'tts' || !voiced);
    const keepSourceAudio = voiced && !wantTts && mode !== 'tts';

    let ttsPath: string | undefined;
    let narrationTakes: PlacedTake[] = [];
    let narrationSeconds = 0;
    let alignedStartsUsed = false;
    if (wantTts) {
      progress('generating narration');
      // Look at the footage and decide where each line belongs, BEFORE
      // anything is spoken or rendered. Falls back to proportional
      // placement when there is no Groq key or the models are unavailable.
      const usableEnd = Math.max(introSeconds + 1, outputDuration - tailPad);
      let alignedStarts: number[] | null = null;
      if (options.alignToContent !== false) {
        alignedStarts = await time('align', async () => {
          const frames = await describeTimeline({
            clips,
            speed,
            introSeconds,
            outputDuration: usableEnd,
          });
          if (frames.length === 0) return null;
          const lines = splitSentences(script);
          const assignment = await assignLinesToFrames(lines, frames);
          if (!assignment) return null;
          // Durations are not known until the audio exists, so estimate
          // from words here; the exact values only shift starts slightly
          // and the no-overlap pass fixes the rest.
          const estimated = lines.map((l) => ({
            duration: l.split(/\s+/).filter(Boolean).length / TTS_WPS,
          }));
          return startsFromAssignment(
            estimated,
            assignment,
            frames.map((f) => f.outputTime),
            leadIn + introSeconds,
            usableEnd
          );
        });
      }

      const spoken = await time('tts', () =>
        synthesizeNarration(
          script,
          workDir,
          leadIn + introSeconds,
          usableEnd,
          cutBoundaries(clips, speed, introSeconds),
          clipWindows(clips, speed, introSeconds),
          alignedStarts,
          options
        )
      );
      alignedStartsUsed = alignedStarts !== null;
      ttsPath = spoken.path;
      narrationTakes = spoken.takes;
      narrationSeconds = await getMediaDuration(ttsPath);
    }

    // ---- caption timings come from the narration audio itself ----
    let assPath: string | undefined;
    if (wantCaptions && !ttsPath && keepSourceAudio) {
      // A recorded voice was kept, so caption THAT. The transcript already
      // exists from retake de-duplication; without this the Short simply
      // had no captions whenever the maker used their own voice.
      progress('timing captions');
      assPath = await time('captions', async () => {
        const entries: SrtEntry[] = [];
        clips.forEach((clip, ci) => {
          for (const seg of clip.transcript ?? []) {
            const start = sourceTimeToOutput(clips, speed, introSeconds, ci, seg.start);
            const end = sourceTimeToOutput(clips, speed, introSeconds, ci, seg.end);
            // A segment straddling a cut has no single place to live.
            if (start === null || end === null || end <= start) continue;
            entries.push({
              index: entries.length + 1,
              startTime: start,
              endTime: end,
              text: seg.text.trim(),
              words: (seg.words ?? [])
                .map((w) => {
                  const ws = sourceTimeToOutput(clips, speed, introSeconds, ci, w.start);
                  const we = sourceTimeToOutput(clips, speed, introSeconds, ci, w.end);
                  return ws !== null && we !== null && we > ws
                    ? { word: w.word, start: ws, end: we }
                    : null;
                })
                .filter((w): w is NonNullable<typeof w> => w !== null),
            });
          }
        });
        if (entries.length === 0) return undefined;
        const ass = generateShortsAss({
          entries: entries.sort((a, b) => a.startTime - b.startTime),
          videoWidth: canvas.width,
          videoHeight: canvas.height,
          fontSize: 48,
          fontName: 'Arial Black',
          position: 'bottom',
          highlightColor: '&H00FFFF&',
          maxChars: 28,
        });
        const p = join(workDir, 'captions.ass');
        writeFileSync(p, ass, 'utf8');
        return p;
      });
    } else if (wantCaptions && script && ttsPath) {
      progress('timing captions');
      assPath = await time('captions', async () => {
        // NO transcription here. The narration is our own TTS, so the exact
        // words and each line's measured duration are already known;
        // running whisper over synthesised speech cost a pass per render
        // and mis-heard the script ("Been working" came back as "I've
        // been"). Real recorded voice is the only case that needs it.
        const entries: SrtEntry[] = narrationTakes.map((take, i) => {
          const words = timeWordsInLine(take.text, take.start, take.duration);
          return {
            index: i + 1,
            startTime: take.start,
            endTime: take.start + take.duration,
            text: take.text,
            words,
          };
        });
        const ass = generateShortsAss({
          entries,
          videoWidth: canvas.width,
          videoHeight: canvas.height,
          fontSize: 48,
          fontName: 'Arial Black',
          position: 'bottom',
          highlightColor: '&H00FFFF&',
          maxChars: 28,
        });
        const p = join(workDir, 'captions.ass');
        writeFileSync(p, ass, 'utf8');
        return p;
      });
    }

    // ---- one render ----
    progress('rendering');
    await time('render', async () => {
      // An intro leads the input list so it concatenates first.
      const graphClips: Array<{ spans: TimeSegment[] | null; luma: LumaStats | null }> =
        options.intro
          ? [{ spans: null, luma: null }, ...clips.map((c) => ({ spans: c.spans, luma: c.luma }))]
          : clips.map((c) => ({ spans: c.spans, luma: c.luma }));
      const sources = options.intro
        ? [options.intro, ...clips.map((c) => c.source)]
        : clips.map((c) => c.source);
      const extraInputs: string[] = [];
      for (const src of sources.slice(1)) extraInputs.push('-i', src);
      let ttsIndex: number | undefined;
      let musicIndex: number | undefined;
      if (ttsPath) {
        ttsIndex = sources.length;
        extraInputs.push('-i', ttsPath);
      }
      if (track) {
        musicIndex = ttsPath ? sources.length + 1 : sources.length;
        extraInputs.push('-stream_loop', '-1', '-i', track.path);
      }

      const graph = buildRenderGraph({
        clips: graphClips,
        speed,
        contrast,
        keepSourceAudio,
        assPath,
        ttsIndex,
        musicIndex,
        musicVolume,
        outputDuration,
        canvas,
      });
      const graphPath = join(workDir, 'graph.txt');
      writeFileSync(graphPath, graph, 'utf8');

      const hasAudio = ttsPath !== undefined || track !== null || keepSourceAudio;
      await executeFFmpegWithProgress({
        input: sources[0],
        output,
        expectedDuration: outputDuration,
        args: [
          ...extraInputs,
          '-filter_complex_script',
          graphPath,
          '-map',
          '[v]',
          ...(hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
          '-t',
          outputDuration.toFixed(3),
          // The graph is filter-bound, not encoder-bound: VAAPI on an
          // integrated Radeon measured SLOWER than this once hwupload was
          // paid for, and libx264 medium/crf18 cost 20% more than
          // veryfast/crf20 for no visible gain at phone size.
          ...(await fastEncoderArgs()),
          '-movflags',
          '+faststart',
        ],
      });
    });

    let masking: AutoShortResult['masking'] = {
      scanned: false,
      regionsMasked: 0,
      note: 'Sensitive-data scan disabled by the caller.',
    };
    if (options.maskSensitive !== false) {
      progress('scanning for sensitive info');
      masking = await time('mask', async () => {
        const scan = await runMask({ input: output, output: '', dryRun: true, sampleFps: 0.5 });
        if (!scan.ocrAvailable) {
          return { scanned: false, regionsMasked: 0, note: scan.note };
        }
        if (scan.regions.length === 0) {
          return { scanned: true, regionsMasked: 0, note: 'Nothing sensitive found.' };
        }
        // Mask into a temp file, then replace the output in place so the
        // caller only ever sees one finished video at the promised path.
        const masked = join(workDir, 'masked.mp4');
        await runMask({ input: output, output: masked, regions: scan.regions });
        copyFileSync(masked, output);
        return { scanned: true, regionsMasked: scan.regions.length };
      });
    }

    success(`Output: ${output}`);
    return {
      output,
      masking,
      sourceDuration,
      keptDuration,
      outputDuration,
      speed,
      videos: files.videos.length,
      resolution: `${canvas.width}x${canvas.height}`,
      introSeconds: Number(introSeconds.toFixed(2)),
      spansKept: clips.reduce((n, c) => n + c.spans.length, 0),
      retakesDropped: clips.reduce((n, c) => n + c.retakesDropped, 0),
      voiced,
      narration: wantTts ? 'tts' : keepSourceAudio ? 'original-voice' : 'none',
      contentAligned: alignedStartsUsed,
      narrationSeconds: Number(narrationSeconds.toFixed(1)),
      captionsBurned: assPath !== undefined,
      music: track,
      stageSeconds,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
