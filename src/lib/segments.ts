/**
 * Shared time-segment utilities used by the cut/silence-based tools
 * (removesilence, jumpcut, slice, cleanvoice).
 */
// The pure span maths lives in the kit so trimming, jump-cutting and
// timelapse selection agree across every Spark tool. Imported as well as
// re-exported, because `export ... from` does not bind the name locally
// and detectSilence below builds TimeSegments of its own.
import type { TimeSegment } from '@spark-apps/video-kit';
import { executeFFmpegAnalysis } from './ffmpeg.js';

export {
  type InvertOptions,
  invertSegments,
  mergeOverlappingSegments,
  type TimeSegment,
} from '@spark-apps/video-kit';

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
