import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface LoopOptions {
  input: string;
  output?: string;
  /** Start time in seconds */
  start?: number;
  /** End time in seconds */
  end?: number;
}

const CROSSFADE = 0.5;
const MIN_LOOP_LENGTH = 1;
const SEARCH_DURATION = 10;
const SIMILARITY_THRESHOLD = 0.95;

/**
 * Compare two PNG buffers and return similarity score (0-1)
 */
function compareFrames(frame1: Buffer, frame2: Buffer): number {
  try {
    const png1 = PNG.sync.read(frame1);
    const png2 = PNG.sync.read(frame2);

    if (png1.width !== png2.width || png1.height !== png2.height) {
      return 0;
    }

    const { width, height } = png1;
    const totalPixels = width * height;
    const diff = pixelmatch(png1.data, png2.data, null, width, height, { threshold: 0.1 });

    return 1 - diff / totalPixels;
  } catch {
    return 0;
  }
}

/**
 * Find two similar frames at least 1 second apart
 */
async function findLoopPoints(
  inputPath: string,
  duration: number
): Promise<{ start: number; end: number } | null> {
  const searchDuration = Math.min(SEARCH_DURATION, duration);
  const fps = 10;
  const frameSize = 64;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidlet_loop_'));

  try {
    await execa('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-t',
      searchDuration.toString(),
      '-vf',
      `fps=${fps},scale=${frameSize}:${frameSize}`,
      '-f',
      'image2',
      path.join(tempDir, 'frame_%04d.png'),
      '-hide_banner',
      '-loglevel',
      'error',
    ]);

    const files = await fs.readdir(tempDir);
    const framePaths = files
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tempDir, f));

    if (framePaths.length < fps * MIN_LOOP_LENGTH) return null;

    const frames: Buffer[] = await Promise.all(framePaths.map((fp) => fs.readFile(fp)));
    const minFrameGap = Math.floor(MIN_LOOP_LENGTH * fps);

    let bestScore = 0;
    let bestStart = 0;
    let bestEnd = 0;

    for (let i = 0; i < frames.length - minFrameGap; i++) {
      for (let j = i + minFrameGap; j < frames.length; j++) {
        const score = compareFrames(frames[i], frames[j]);
        if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
          bestScore = score;
          bestStart = i;
          bestEnd = j;
        }
      }
    }

    if (bestScore === 0) return null;

    return {
      start: bestStart / fps,
      end: bestEnd / fps,
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

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
