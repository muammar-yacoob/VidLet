/**
 * Shared time-segment utilities used by the cut/silence-based tools
 * (removesilence, jumpcut, slice, cleanvoice).
 */
import { executeFFmpegAnalysis } from './ffmpeg.js';

export interface TimeSegment {
  start: number;
  end: number;
}

export interface DetectSilenceOptions {
  /** Minimum silence duration to register, in seconds. */
  minDuration: number;
  /** Silence threshold in dB (e.g. -30). */
  thresholdDb: number;
  /**
   * Total video duration. When provided, a trailing silence (the video ends
   * mid-silence) is closed at this time instead of being dropped.
   */
  videoDuration?: number;
  /** Limit analysis to the first N seconds (ffmpeg -t), for speed. */
  analyzeDuration?: number;
}

/**
 * Detect silent segments in a media file's audio track via ffmpeg silencedetect.
 */
export async function detectSilence(
  input: string,
  options: DetectSilenceOptions
): Promise<TimeSegment[]> {
  const { minDuration, thresholdDb, videoDuration, analyzeDuration } = options;

  const args: string[] = [];
  if (analyzeDuration !== undefined) {
    args.push('-t', String(analyzeDuration));
  }
  args.push('-af', `silencedetect=n=${thresholdDb}dB:d=${minDuration}`);

  const stderr = await executeFFmpegAnalysis(input, args);

  const segments: TimeSegment[] = [];
  let pendingStart: number | null = null;

  for (const match of stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const time = Number.parseFloat(match[2]);
    if (match[1] === 'start') {
      pendingStart = time;
    } else {
      segments.push({ start: pendingStart ?? 0, end: time });
      pendingStart = null;
    }
  }

  // If the file ends during silence, close the pending segment at the end.
  if (
    pendingStart !== null &&
    videoDuration !== undefined &&
    videoDuration - pendingStart >= minDuration
  ) {
    segments.push({ start: pendingStart, end: videoDuration });
  }

  return segments;
}

/**
 * Sort segments by start time and merge any that overlap or touch.
 */
export function mergeOverlappingSegments(segments: TimeSegment[]): TimeSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  const merged: TimeSegment[] = [];
  for (const seg of sorted) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

export interface InvertOptions {
  /** Seconds of padding to keep around each retained segment (default 0). */
  padding?: number;
  /** A retained segment is dropped unless its length exceeds this (default 0). */
  minLength?: number;
}

/**
 * Given a set of cut/silent segments, return the complementary segments to KEEP.
 * Overlapping cuts are merged first. With padding > 0 the kept segments are
 * widened (clamped to [0, duration]) to leave breathing room around speech.
 */
export function invertSegments(
  duration: number,
  cuts: TimeSegment[],
  options: InvertOptions = {}
): TimeSegment[] {
  const { padding = 0, minLength = 0 } = options;
  const merged = mergeOverlappingSegments(cuts);

  const kept: TimeSegment[] = [];
  let pos = 0;
  for (const cut of merged) {
    const start = Math.max(0, pos - padding);
    const end = Math.min(duration, cut.start + padding);
    if (end > start + minLength) {
      kept.push({ start, end });
    }
    pos = cut.end;
  }
  if (pos < duration) {
    kept.push({ start: Math.max(0, pos - padding), end: duration });
  }
  return kept;
}
