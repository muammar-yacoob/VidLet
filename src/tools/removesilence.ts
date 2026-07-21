import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildConcatFileContent,
  checkFFmpeg,
  executeFFmpegRaw,
  getVideoInfo,
} from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';
import { detectSilence, invertSegments } from '../lib/segments.js';

export interface RemoveSilenceOptions {
  input: string;
  output?: string;
  /** Minimum silence duration to cut, in seconds (default: 0.5) */
  minSilenceDuration?: number;
  /** Silence detection threshold in dB (default: -30) */
  silenceThreshold?: number;
  /**
   * Seconds of breathing room kept either side of every cut, so speech is
   * never clipped mid-word (default: 0.15).
   */
  padding?: number;
}

/**
 * Remove silent segments from a video
 */
export async function removeSilence(options: RemoveSilenceOptions): Promise<string> {
  const {
    input,
    output: customOutput,
    minSilenceDuration = 0.5,
    silenceThreshold = -30,
    padding = 0.15,
  } = options;

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
  const silentSegments = await detectSilence(input, {
    minDuration: minSilenceDuration,
    thresholdDb: silenceThreshold,
    videoDuration: info.duration,
  });

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

  // Step 2: Calculate keep segments, widened by the padding so cuts land in
  // the dead air rather than on the first/last syllable.
  const keepSegments = invertSegments(info.duration, silentSegments, { padding });
  if (keepSegments.length === 0) {
    throw new Error('Removing all silence would leave no content.');
  }

  const keptDuration = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  console.log(
    `Keeping ${fmt.yellow(keptDuration.toFixed(1))}s of ${fmt.white(info.duration.toFixed(1))}s ` +
      `across ${fmt.yellow(keepSegments.length.toString())} segment(s)`
  );

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

      const segDuration = seg.end - seg.start;
      // -ss before -i: fast seek with timestamps starting at 0
      await executeFFmpegRaw([
        '-y',
        '-ss',
        seg.start.toString(),
        '-i',
        input,
        '-t',
        segDuration.toString(),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        segFile,
      ]);
    }

    // Step 4: Concatenate
    const concatFile = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatFile, buildConcatFileContent(segmentFiles));

    console.log(fmt.dim('Stitching segments...'));
    await executeFFmpegRaw([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      output,
    ]);

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
