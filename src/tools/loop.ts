import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';
import { findLoopPoints } from './loop-detect.js';

export type { EndMatch, LoopPair, LoopStartPoint } from './loop-detect.js';
export {
  findAllLoopPoints,
  findBestLoopStart,
  findLoopPoints,
  findMatchesFromEnd,
} from './loop-detect.js';

export interface LoopOptions {
  input: string;
  output?: string;
  /** Start time in seconds */
  start?: number;
  /** End time in seconds */
  end?: number;
}

const CROSSFADE = 0.5;

/**
 * Create a seamless looping video
 */
export async function loop(options: LoopOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const output = customOutput ?? getOutputPath(input, '_loop');
  const info = await getVideoInfo(input);

  header('Loop Creator');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Duration: ${fmt.white(info.duration.toFixed(1))}s`);

  let startTime: number;
  let endTime: number;

  if (options.start !== undefined && options.end !== undefined) {
    startTime = options.start;
    endTime = options.end;

    if (startTime >= endTime) {
      throw new Error('Start time must be less than end time');
    }
    if (endTime > info.duration) {
      throw new Error(`End time ${endTime}s exceeds video duration ${info.duration.toFixed(1)}s`);
    }

    console.log(`Loop:     ${fmt.yellow(`${startTime}s`)} → ${fmt.yellow(`${endTime}s`)} (manual)`);
  } else {
    separator();
    console.log(fmt.dim('Finding similar frames...'));

    const loopPoint = await findLoopPoints(input, info.duration);

    if (!loopPoint) {
      throw new Error('No similar frames found. Try specifying -s and -e manually.');
    }

    startTime = loopPoint.start;
    endTime = loopPoint.end;

    console.log(fmt.cyan(`Found: ${startTime.toFixed(2)}s → ${endTime.toFixed(2)}s`));
  }

  const duration = endTime - startTime;

  if (duration < CROSSFADE * 2) {
    throw new Error(`Loop duration (${duration.toFixed(1)}s) too short for crossfade`);
  }

  separator();
  console.log(fmt.dim('Creating seamless loop...'));

  const args = [
    '-ss',
    startTime.toString(),
    '-t',
    duration.toString(),
    '-filter_complex',
    `[0:v]split=2[v1][v2];[v1]trim=0:${CROSSFADE},setpts=PTS-STARTPTS[start];[v2]trim=${duration - CROSSFADE}:${duration},setpts=PTS-STARTPTS[end];[end][start]blend=all_expr='A*(1-T/${CROSSFADE})+B*(T/${CROSSFADE})'[blended];[0:v]trim=${CROSSFADE}:${duration - CROSSFADE},setpts=PTS-STARTPTS[middle];[blended][middle]concat=n=2:v=1:a=0[outv]`,
    '-map',
    '[outv]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-an',
  ];

  await executeFFmpeg({ input, output, args });

  success(`Output: ${output}`);

  return output;
}
