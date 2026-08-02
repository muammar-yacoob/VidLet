import * as fs from 'node:fs/promises';
/**
 * Loop-point detection: find pairs of near-identical frames that a video can
 * be cut between so it plays back seamlessly.
 */
import * as path from 'node:path';
import {
  compareFrames,
  decodeFrame,
  extractFrame,
  extractFrames,
  readFrames,
  withTempDir,
} from '../lib/frames.js';
import { logToFile } from '../lib/logger.js';

/** Frames must score at least this to count as a seam. */
export const SIMILARITY_THRESHOLD = 0.95;

/** Shortest loop worth making, in seconds. */
const MIN_LOOP_LENGTH = 1;

/** How far into the video the automatic search looks. */
const SEARCH_DURATION = 10;

/** Detection samples coarsely — full frame rate buys nothing and costs a lot. */
const SAMPLE_FPS = 4;
const SAMPLE_SIZE = 48;

export interface LoopPair {
  id: number;
  start: number;
  end: number;
  score: number;
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
 * Match result from end-of-video search
 */
export interface EndMatch {
  time: number;
  score: number;
}

/**
 * Find two similar frames at least 1 second apart
 */
export async function findLoopPoints(
  inputPath: string,
  duration: number
): Promise<{ start: number; end: number } | null> {
  const searchDuration = Math.min(SEARCH_DURATION, duration);
  const fps = 10;

  logToFile(`Loop: Finding loop points in ${inputPath}, search duration: ${searchDuration}s`);

  return withTempDir('vidlet_loop_', async (dir) => {
    const framePaths = await extractFrames({
      input: inputPath,
      dir,
      fps,
      size: 64,
      duration: searchDuration,
      failure: 'Frame extraction failed',
    });

    logToFile(`Loop: Extracted ${framePaths.length} frames`);

    if (framePaths.length < fps * MIN_LOOP_LENGTH) {
      logToFile(
        `Loop: Not enough frames (need ${fps * MIN_LOOP_LENGTH}, got ${framePaths.length})`
      );
      return null;
    }

    const frames = await readFrames(framePaths);
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

    logToFile(
      `Loop: Best similarity score: ${bestScore.toFixed(4)}, threshold: ${SIMILARITY_THRESHOLD}`
    );

    if (bestScore === 0) {
      logToFile('Loop: No similar frames found above threshold');
      return null;
    }

    const points = { start: bestStart / fps, end: bestEnd / fps };
    logToFile(`Loop: Found loop points: ${points.start.toFixed(2)}s -> ${points.end.toFixed(2)}s`);
    return points;
  });
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

  logToFile(
    `Loop: Finding loop points in ${inputPath}, duration: ${searchDuration}s, minGap: ${minGap}s`
  );

  return withTempDir('vidlet_loop_all_', async (dir) => {
    const framePaths = await extractFrames({
      input: inputPath,
      dir,
      fps: SAMPLE_FPS,
      size: SAMPLE_SIZE,
      duration: searchDuration,
      failure: 'Frame extraction failed',
    });

    logToFile(`Loop: Extracted ${framePaths.length} frames`);

    if (framePaths.length < SAMPLE_FPS * minGap) {
      return [];
    }

    const frames = await readFrames(framePaths);
    const minFrameGap = Math.floor(minGap * SAMPLE_FPS);

    // Keep the 10 earliest start frames that have matches, best 5 matches each
    const startPoints: LoopStartPoint[] = [];

    for (let i = 0; i < frames.length - minFrameGap; i++) {
      if (startPoints.length >= 10) break;

      const matches: Array<{ end: number; score: number }> = [];
      for (let j = i + minFrameGap; j < frames.length; j++) {
        const score = compareFrames(frames[i], frames[j]);
        if (score >= threshold) {
          matches.push({ end: j / SAMPLE_FPS, score });
        }
      }

      if (matches.length > 0) {
        matches.sort((a, b) => b.score - a.score);
        startPoints.push({
          id: startPoints.length,
          time: i / SAMPLE_FPS,
          matches: matches.slice(0, 5),
        });
      }
    }

    logToFile(`Loop: Found ${startPoints.length} start points with matches`);
    return startPoints;
  });
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
  threshold = 0.9
): Promise<EndMatch[]> {
  // Search forward from reference time + minGap to end of video
  const searchStart = referenceTime + minGap;
  const searchDuration = duration - searchStart;

  if (searchDuration < 1) {
    return [];
  }

  logToFile(
    `Match: Finding matches forward from ${referenceTime}s, searching ${searchStart}s to ${duration}s`
  );

  return withTempDir('vidlet_match_', async (dir) => {
    const refFrame = await extractFrame({
      input: inputPath,
      output: path.join(dir, 'ref.png'),
      at: referenceTime,
      size: SAMPLE_SIZE,
      failure: 'Reference frame extraction failed',
    });

    const framePaths = await extractFrames({
      input: inputPath,
      dir,
      fps: SAMPLE_FPS,
      size: SAMPLE_SIZE,
      start: searchStart,
      duration: searchDuration,
      failure: 'Forward frames extraction failed',
    });

    logToFile(`Match: Extracted ${framePaths.length} frames to search`);

    // Each frame is compared once, so decode them one at a time rather than
    // holding the whole search window in memory
    const matches: EndMatch[] = [];
    for (let i = 0; i < framePaths.length; i++) {
      const score = compareFrames(refFrame, decodeFrame(await fs.readFile(framePaths[i])));
      if (score >= threshold) {
        matches.push({ time: searchStart + i / SAMPLE_FPS, score });
      }
    }

    // Sort by time (earliest first), then by score for same-time frames
    matches.sort((a, b) => a.time - b.time || b.score - a.score);

    // Keep top 5 unique time points (avoid clustering)
    const uniqueMatches: EndMatch[] = [];
    for (const match of matches) {
      const tooClose = uniqueMatches.some((m) => Math.abs(m.time - match.time) < 0.5);
      if (!tooClose) {
        uniqueMatches.push(match);
        if (uniqueMatches.length >= 5) break;
      }
    }

    logToFile(`Match: Found ${uniqueMatches.length} matches above threshold ${threshold}`);
    return uniqueMatches;
  });
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
  threshold = 0.9
): Promise<{ startTime: number; endTime: number; score: number } | null> {
  const searchStart = Math.min(searchRange, duration - minGap);
  if (searchStart < 0.5) {
    return null;
  }

  // Compare the opening against the last 20 seconds
  const endSearchDuration = Math.min(20, duration - searchRange - minGap);
  if (endSearchDuration < 2) {
    return null;
  }
  const endStartTime = duration - endSearchDuration;

  logToFile(`BestStart: Searching in first ${searchStart}s of ${inputPath}`);

  return withTempDir('vidlet_beststart_', async (dir) => {
    const startDir = path.join(dir, 'start');
    const endDir = path.join(dir, 'end');
    await fs.mkdir(startDir);
    await fs.mkdir(endDir);

    const startPaths = await extractFrames({
      input: inputPath,
      dir: startDir,
      fps: SAMPLE_FPS,
      size: SAMPLE_SIZE,
      duration: searchStart,
    });
    if (startPaths.length === 0) {
      return null;
    }

    const endPaths = await extractFrames({
      input: inputPath,
      dir: endDir,
      fps: SAMPLE_FPS,
      size: SAMPLE_SIZE,
      start: endStartTime,
      duration: endSearchDuration,
    });
    if (endPaths.length === 0) {
      return null;
    }

    const startFrames = await readFrames(startPaths);
    const endFrames = await readFrames(endPaths);

    // For each start frame, find the best matching end frame
    let bestMatch: { startTime: number; endTime: number; score: number } | null = null;

    for (let si = 0; si < startFrames.length; si++) {
      const startTime = si / SAMPLE_FPS;

      for (let ei = 0; ei < endFrames.length; ei++) {
        const endTime = endStartTime + ei / SAMPLE_FPS;
        if (endTime - startTime < minGap) continue;

        const score = compareFrames(startFrames[si], endFrames[ei]);
        if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { startTime, endTime, score };
        }
      }
    }

    if (bestMatch) {
      logToFile(
        `BestStart: Found best match at ${bestMatch.startTime.toFixed(2)}s -> ${bestMatch.endTime.toFixed(2)}s (${(bestMatch.score * 100).toFixed(0)}%)`
      );
    } else {
      logToFile(`BestStart: No matches found above threshold ${threshold}`);
    }

    return bestMatch;
  });
}
