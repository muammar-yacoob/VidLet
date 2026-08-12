/**
 * Inspecting the footage: what canvas it deserves, which stretches are
 * idle, how it is exposed, and whether anyone is actually speaking.
 *
 * Everything here is READ-ONLY with respect to the edit - it answers
 * questions about the source, and the pipeline decides what to do with the
 * answers. Split out of autoshort.ts, which had grown past the point where
 * the analysis and the render could be read independently.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realSpeechWords } from '../lib/autoshort-plan.js';
import { executeFFmpegAnalysis, executeFFmpegRaw, getVideoInfo } from '../lib/ffmpeg.js';
import { type LumaStats, parseLumaStats } from '../lib/grade.js';
import type { TimeSegment } from '../lib/segments.js';
import { transcribe } from '../lib/whisper.js';

export const SHORT_W = 1080;
export const SHORT_H = 1920;
/**
 * Smaller 9:16 canvas, used when the source has nowhere near enough pixels
 * to justify the full one. A 320x360 screen capture upscaled to 1080x1920
 * is 3.4x of invented detail; 720x1280 is still 2.25x and costs 45% less
 * to filter and encode (measured: 5.55s vs 3.03s on the same chain).
 */
export const SMALL_W = 720;
export const SMALL_H = 1280;
/** Draft canvas: a quarter of the small one's area, still 9:16. */
export const DRAFT_W = 360;
export const DRAFT_H = 640;
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
const _TTS_WPS = 2.9;
/**
 * Fraction of the runtime narration should cover. Raised from 0.85, which
 * left long stretches of a Short silent and forced later sections to be
 * summarised in a line. Still short of 1 so the lines can breathe and the
 * end has a beat after the last word.
 */
const _NARRATION_COVERAGE = 0.92;
/**
 * Silence before the first word. Fixed rather than tunable-by-accident: a
 * Short has about a second to earn attention, and a longer pause at the top
 * reads as a stall.
 */
const _DEFAULT_LEAD_IN = 0.7;
/** Default picture kept after the last word, for the music to breathe out. */
const _DEFAULT_TAIL_PAD = 1.8;
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
