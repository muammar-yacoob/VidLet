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
import { type TimeSegment, invertSegments } from '../lib/segments.js';

export type SliceRegion = TimeSegment;

export interface SliceOptions {
  input: string;
  output?: string;
  /** Regions to REMOVE from the video */
  cuts: SliceRegion[];
}

/**
 * Slice video by removing specified regions and stitching remaining parts
 */
export async function slice(options: SliceOptions): Promise<string> {
  const { input, output: customOutput, cuts } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  if (cuts.length === 0) {
    throw new Error('No cut regions specified');
  }

  const info = await getVideoInfo(input);
  const keepSegments = invertSegments(info.duration, cuts);

  if (keepSegments.length === 0) {
    throw new Error('Cannot remove entire video');
  }

  const output = customOutput ?? getOutputPath(input, '_sliced');
  const tempDir = path.join(os.tmpdir(), `vidlet-slice-${Date.now()}`);

  header('Slice Video');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Duration: ${fmt.white(`${info.duration.toFixed(1)}s`)}`);
  console.log(`Cuts:     ${fmt.yellow(`${cuts.length} region(s)`)}`);
  console.log(`Keeping:  ${fmt.yellow(`${keepSegments.length} segment(s)`)}`);
  separator();

  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Extract each segment
    const segmentFiles: string[] = [];
    for (let i = 0; i < keepSegments.length; i++) {
      const seg = keepSegments[i];
      const segFile = path.join(tempDir, `seg_${i.toString().padStart(3, '0')}.mp4`);
      segmentFiles.push(segFile);

      console.log(fmt.dim(`Extracting segment ${i + 1}/${keepSegments.length}...`));

      const segDuration = seg.end - seg.start;
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

    // Create concat file
    const concatFile = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatFile, buildConcatFileContent(segmentFiles));

    // Concatenate segments
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

    success(`Output: ${output}`);
    return output;
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
