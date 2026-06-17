import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkFFmpeg, executeFFmpeg, executeFFmpegAnalysis, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface RemoveSilenceOptions {
  input: string;
  output?: string;
  /** Minimum silence duration to cut, in seconds (default: 0.5) */
  minSilenceDuration?: number;
  /** Silence detection threshold in dB (default: -30) */
  silenceThreshold?: number;
}

interface SilenceSegment {
  start: number;
  end: number;
}

/**
 * Detect silent segments in a video's audio track.
 * Pass `duration` so trailing silence (video ends mid-silence) is captured.
 */
async function detectSilence(
  input: string,
  minDuration: number,
  thresholdDb: number,
  videoDuration: number
): Promise<SilenceSegment[]> {
  const stderr = await executeFFmpegAnalysis(input, [
    '-af',
    `silencedetect=n=${thresholdDb}dB:d=${minDuration}`,
  ]);

  const segments: SilenceSegment[] = [];
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

  // If video ends during silence, close the pending segment at the video's end
  if (pendingStart !== null && videoDuration - pendingStart >= minDuration) {
    segments.push({ start: pendingStart, end: videoDuration });
  }

  return segments;
}

/**
 * Calculate segments to KEEP after removing silent regions
 */
function calculateKeepSegments(duration: number, cuts: SilenceSegment[]): SilenceSegment[] {
  if (cuts.length === 0) return [{ start: 0, end: duration }];

  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);

  // Merge overlapping cuts
  const merged: SilenceSegment[] = [];
  for (const cut of sortedCuts) {
    if (merged.length === 0) {
      merged.push({ ...cut });
    } else {
      const last = merged[merged.length - 1];
      if (cut.start <= last.end) {
        last.end = Math.max(last.end, cut.end);
      } else {
        merged.push({ ...cut });
      }
    }
  }

  // Invert: keep everything that isn't a cut
  const keep: SilenceSegment[] = [];
  let pos = 0;
  for (const cut of merged) {
    if (cut.start > pos) {
      keep.push({ start: pos, end: cut.start });
    }
    pos = cut.end;
  }
  if (pos < duration) {
    keep.push({ start: pos, end: duration });
  }

  return keep;
}

/**
 * Remove silent segments from a video
 */
export async function removeSilence(options: RemoveSilenceOptions): Promise<string> {
  const { input, output: customOutput, minSilenceDuration = 0.5, silenceThreshold = -30 } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  const info = await getVideoInfo(input);
  if (!info.hasAudio) {
    throw new Error('Video has no audio stream for silence detection.');
  }

  const output = customOutput ?? getOutputPath(input, '_desilenced');

  header('Remove Silence');
  console.log(`Input:      ${fmt.white(input)}`);
  console.log(`Duration:   ${fmt.white(info.duration.toFixed(1))}s`);
  console.log(`Min silent: ${fmt.yellow(`${minSilenceDuration}s`)}`);
  console.log(`Threshold:  ${fmt.yellow(`${silenceThreshold}dB`)}`);
  separator();

  // Step 1: Detect silence
  console.log(fmt.dim('Detecting silence...'));
  const silentSegments = await detectSilence(
    input,
    minSilenceDuration,
    silenceThreshold,
    info.duration
  );

  if (silentSegments.length === 0) {
    console.log(fmt.yellow('No silence detected — copying input as-is.'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(input, output);
    success(`Output: ${output}`);
    return output;
  }

  const totalSilence = silentSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  console.log(
    `Found ${fmt.yellow(silentSegments.length.toString())} silent segment(s) ` +
      `(${fmt.yellow(totalSilence.toFixed(1))}s total)`
  );

  // Step 2: Calculate keep segments
  const keepSegments = calculateKeepSegments(info.duration, silentSegments);
  if (keepSegments.length === 0) {
    throw new Error('Removing all silence would leave no content.');
  }

  // Step 3: Extract each keep segment and concatenate
  const tempDir = path.join(os.tmpdir(), `vidlet-silence-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const segmentFiles: string[] = [];

    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const segFile = path.join(tempDir, `seg_${i.toString().padStart(3, '0')}.mp4`);
      segmentFiles.push(segFile);

      console.log(fmt.dim(`Extracting segment ${i + 1}/${keepSegments.length}...`));

      const duration = seg.end - seg.start;
      await executeFFmpeg({
        input,
        output: segFile,
        args: [
          '-ss',
          seg.start.toString(),
          '-t',
          duration.toString(),
          '-c',
          'copy',
          '-avoid_negative_ts',
          '1',
        ],
      });
    }

    // Step 4: Concatenate
    const concatFile = path.join(tempDir, 'concat.txt');
    const concatContent = segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);

    console.log(fmt.dim('Stitching segments...'));
    await executeFFmpeg({
      input: concatFile,
      output,
      args: ['-f', 'concat', '-safe', '0', '-c', 'copy', '-movflags', '+faststart'],
    });

    const kept = info.duration - totalSilence;
    console.log(
      `Result: ${fmt.green(kept.toFixed(1))}s (removed ${totalSilence.toFixed(1)}s of silence)`
    );
    success(`Output: ${output}`);
    return output;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}
