import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, logToFile, separator, success } from '../lib/logger.js';
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

export interface LoopPair {
  id: number;
  start: number;
  end: number;
  score: number;
}

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
  logToFile(`Loop: Finding loop points in ${inputPath}, search duration: ${searchDuration}s`);
  logToFile(`Loop: Temp directory: ${tempDir}`);

  try {
    const ffmpegArgs = [
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
    ];

    logToFile(`Loop: Extracting frames with: ffmpeg ${ffmpegArgs.join(' ')}`);

    const result = await execa('ffmpeg', ffmpegArgs, { reject: false, all: true });

    if (result.exitCode !== 0) {
      logToFile(`Loop: Frame extraction failed: ${result.all || result.stderr}`);
      throw new Error(`Frame extraction failed: ${result.all || result.stderr}`);
    }

    const files = await fs.readdir(tempDir);
    const framePaths = files
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tempDir, f));

    logToFile(`Loop: Extracted ${framePaths.length} frames`);

    if (framePaths.length < fps * MIN_LOOP_LENGTH) {
      logToFile(`Loop: Not enough frames (need ${fps * MIN_LOOP_LENGTH}, got ${framePaths.length})`);
      return null;
    }

    const frames: Buffer[] = await Promise.all(framePaths.map((fp) => fs.readFile(fp)));
    const minFrameGap = Math.floor(MIN_LOOP_LENGTH * fps);

    let bestScore = 0;
    let bestStart = 0;
    let bestEnd = 0;

    logToFile(`Loop: Comparing ${frames.length} frames for similarity...`);

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

    logToFile(`Loop: Best similarity score: ${bestScore.toFixed(4)}, threshold: ${SIMILARITY_THRESHOLD}`);

    if (bestScore === 0) {
      logToFile('Loop: No similar frames found above threshold');
      return null;
    }

    const result_points = {
      start: bestStart / fps,
      end: bestEnd / fps,
    };
    logToFile(`Loop: Found loop points: ${result_points.start.toFixed(2)}s -> ${result_points.end.toFixed(2)}s`);
    return result_points;
  } catch (err) {
    logToFile(`Loop: Error in findLoopPoints: ${(err as Error).message}`);
    throw err;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Loop start point with multiple matching end points
 */
export interface LoopStartPoint {
  id: number;
  time: number;
  matches: Array<{ end: number; score: number }>;
}

/**
 * Find ALL similar frame pairs with minimum gap
 * Returns start points, each with multiple matching end points
 */
export async function findAllLoopPoints(
  inputPath: string,
  duration: number,
  minGap = 5,
  threshold = SIMILARITY_THRESHOLD
): Promise<LoopStartPoint[]> {
  const searchDuration = Math.min(30, duration);
  const fps = 4; // Lower FPS for speed (was 10)
  const frameSize = 48; // Smaller frames for speed (was 64)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidlet_loop_all_'));
  logToFile(`Loop: Finding loop points in ${inputPath}, duration: ${searchDuration}s, minGap: ${minGap}s`);

  try {
    const ffmpegArgs = [
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
    ];

    const result = await execa('ffmpeg', ffmpegArgs, { reject: false, all: true });

    if (result.exitCode !== 0) {
      throw new Error(`Frame extraction failed: ${result.all || result.stderr}`);
    }

    const files = await fs.readdir(tempDir);
    const framePaths = files
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tempDir, f));

    logToFile(`Loop: Extracted ${framePaths.length} frames`);

    if (framePaths.length < fps * minGap) {
      return [];
    }

    const frames: Buffer[] = await Promise.all(framePaths.map((fp) => fs.readFile(fp)));
    const minFrameGap = Math.floor(minGap * fps);

    // Build map of start frame -> matching end frames
    const startMatches = new Map<number, Array<{ end: number; score: number }>>();

    for (let i = 0; i < frames.length - minFrameGap; i++) {
      const matches: Array<{ end: number; score: number }> = [];

      for (let j = i + minFrameGap; j < frames.length; j++) {
        const score = compareFrames(frames[i], frames[j]);
        if (score >= threshold) {
          matches.push({ end: j / fps, score });
        }
      }

      if (matches.length > 0) {
        // Sort matches by score descending, keep top 5
        matches.sort((a, b) => b.score - a.score);
        startMatches.set(i, matches.slice(0, 5));
      }
    }

    // Convert to array, limit to 10 start points
    const startPoints: LoopStartPoint[] = [];
    const sortedStarts = Array.from(startMatches.keys()).sort((a, b) => a - b);

    for (const startFrame of sortedStarts) {
      if (startPoints.length >= 10) break;
      const matches = startMatches.get(startFrame)!;
      startPoints.push({
        id: startPoints.length,
        time: startFrame / fps,
        matches,
      });
    }

    logToFile(`Loop: Found ${startPoints.length} start points with matches`);
    return startPoints;
  } catch (err) {
    logToFile(`Loop: Error in findAllLoopPoints: ${(err as Error).message}`);
    throw err;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Match result from end-of-video search
 */
export interface EndMatch {
  time: number;
  score: number;
}

/**
 * Find frames FORWARD from a reference time that match the reference frame
 * Searches from referenceTime + minGap to end of video
 */
export async function findMatchesFromEnd(
  inputPath: string,
  duration: number,
  referenceTime = 0,
  minGap = 3,
  threshold = 0.90
): Promise<EndMatch[]> {
  const fps = 4;
  const frameSize = 48;

  // Search forward from reference time + minGap to end of video
  const searchStart = referenceTime + minGap;
  const searchDuration = duration - searchStart;

  if (searchDuration < 1) {
    return [];
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidlet_match_'));
  logToFile(`Match: Finding matches forward from ${referenceTime}s, searching ${searchStart}s to ${duration}s`);

  try {
    // Extract reference frame at the start position
    const refFramePath = path.join(tempDir, 'ref.png');
    const refArgs = [
      '-y',
      '-ss', referenceTime.toString(),
      '-i', inputPath,
      '-vframes', '1',
      '-vf', `scale=${frameSize}:${frameSize}`,
      refFramePath,
      '-hide_banner', '-loglevel', 'error',
    ];

    let result = await execa('ffmpeg', refArgs, { reject: false, all: true });
    if (result.exitCode !== 0) {
      throw new Error(`Reference frame extraction failed: ${result.all || result.stderr}`);
    }

    const refFrame = await fs.readFile(refFramePath);

    // Extract frames forward from searchStart to end of video
    const searchArgs = [
      '-y',
      '-ss', searchStart.toString(),
      '-i', inputPath,
      '-t', searchDuration.toString(),
      '-vf', `fps=${fps},scale=${frameSize}:${frameSize}`,
      '-f', 'image2',
      path.join(tempDir, 'frame_%04d.png'),
      '-hide_banner', '-loglevel', 'error',
    ];

    result = await execa('ffmpeg', searchArgs, { reject: false, all: true });
    if (result.exitCode !== 0) {
      throw new Error(`Forward frames extraction failed: ${result.all || result.stderr}`);
    }

    const files = await fs.readdir(tempDir);
    const framePaths = files
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tempDir, f));

    logToFile(`Match: Extracted ${framePaths.length} frames to search`);

    if (framePaths.length === 0) {
      return [];
    }

    // Compare reference frame against all forward frames
    const matches: EndMatch[] = [];

    for (let i = 0; i < framePaths.length; i++) {
      const frame = await fs.readFile(framePaths[i]);
      const score = compareFrames(refFrame, frame);

      if (score >= threshold) {
        const frameTime = searchStart + i / fps;
        matches.push({ time: frameTime, score });
      }
    }

    // Sort by time (earliest first), then by score for same-time frames
    matches.sort((a, b) => a.time - b.time || b.score - a.score);

    // Keep top 5 unique time points (avoid clustering)
    const uniqueMatches: EndMatch[] = [];
    for (const match of matches) {
      const tooClose = uniqueMatches.some(m => Math.abs(m.time - match.time) < 0.5);
      if (!tooClose) {
        uniqueMatches.push(match);
        if (uniqueMatches.length >= 5) break;
      }
    }

    logToFile(`Match: Found ${uniqueMatches.length} matches above threshold ${threshold}`);
    return uniqueMatches;
  } catch (err) {
    logToFile(`Match: Error in findMatchesFromEnd: ${(err as Error).message}`);
    throw err;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Find the best loop starting point within a time range
 * Returns the start time that has the best matching end point
 */
export async function findBestLoopStart(
  inputPath: string,
  duration: number,
  searchRange = 5, // Search first N seconds
  minGap = 3,
  threshold = 0.90
): Promise<{ startTime: number; endTime: number; score: number } | null> {
  const fps = 4;
  const frameSize = 48;
  const searchStart = Math.min(searchRange, duration - minGap);

  if (searchStart < 0.5) {
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidlet_beststart_'));
  logToFile(`BestStart: Searching in first ${searchStart}s of ${inputPath}`);

  try {
    // Extract frames from the start of the video (first N seconds)
    const startFramesDir = path.join(tempDir, 'start');
    await fs.mkdir(startFramesDir);

    const startArgs = [
      '-y',
      '-i', inputPath,
      '-t', searchStart.toString(),
      '-vf', `fps=${fps},scale=${frameSize}:${frameSize}`,
      '-f', 'image2',
      path.join(startFramesDir, 'frame_%04d.png'),
      '-hide_banner', '-loglevel', 'error',
    ];

    await execa('ffmpeg', startArgs, { reject: false });

    const startFiles = await fs.readdir(startFramesDir);
    const startFramePaths = startFiles
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(startFramesDir, f));

    if (startFramePaths.length === 0) {
      return null;
    }

    // Extract frames from the end of the video (last 20 seconds)
    const endSearchDuration = Math.min(20, duration - searchRange - minGap);
    if (endSearchDuration < 2) {
      return null;
    }

    const endStartTime = duration - endSearchDuration;
    const endFramesDir = path.join(tempDir, 'end');
    await fs.mkdir(endFramesDir);

    const endArgs = [
      '-y',
      '-ss', endStartTime.toString(),
      '-i', inputPath,
      '-t', endSearchDuration.toString(),
      '-vf', `fps=${fps},scale=${frameSize}:${frameSize}`,
      '-f', 'image2',
      path.join(endFramesDir, 'frame_%04d.png'),
      '-hide_banner', '-loglevel', 'error',
    ];

    await execa('ffmpeg', endArgs, { reject: false });

    const endFiles = await fs.readdir(endFramesDir);
    const endFramePaths = endFiles
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(endFramesDir, f));

    if (endFramePaths.length === 0) {
      return null;
    }

    // Load all frames
    const startFrames = await Promise.all(startFramePaths.map((fp) => fs.readFile(fp)));
    const endFrames = await Promise.all(endFramePaths.map((fp) => fs.readFile(fp)));

    // Find best match: for each start frame, find best matching end frame
    let bestMatch: { startTime: number; endTime: number; score: number } | null = null;

    for (let si = 0; si < startFrames.length; si++) {
      const startTime = si / fps;

      for (let ei = 0; ei < endFrames.length; ei++) {
        const endTime = endStartTime + ei / fps;
        const gap = endTime - startTime;

        if (gap < minGap) continue;

        const score = compareFrames(startFrames[si], endFrames[ei]);

        if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { startTime, endTime, score };
        }
      }
    }

    if (bestMatch) {
      logToFile(`BestStart: Found best match at ${bestMatch.startTime.toFixed(2)}s -> ${bestMatch.endTime.toFixed(2)}s (${(bestMatch.score * 100).toFixed(0)}%)`);
    } else {
      logToFile(`BestStart: No matches found above threshold ${threshold}`);
    }

    return bestMatch;
  } catch (err) {
    logToFile(`BestStart: Error: ${(err as Error).message}`);
    throw err;
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
