/**
 * Frame sampling and comparison.
 *
 * Loop detection works by decoding a video down to small square thumbnails and
 * diffing them, so every detector needs the same three things: a scratch
 * directory, a downscaled frame dump, and a similarity score.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * Run `fn` against a fresh temp directory, removing it afterwards even on throw.
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export interface FrameExtractOptions {
  input: string;
  /** Directory to write `frame_%04d.png` into. */
  dir: string;
  /** Sampling rate — lower is faster and coarser. */
  fps: number;
  /** Thumbnails are square; this is the side length in pixels. */
  size: number;
  /** Seek this many seconds in before decoding. */
  start?: number;
  /** Decode only this many seconds. */
  duration?: number;
  /**
   * Prefix for the error thrown when ffmpeg fails. Omit to carry on with
   * whatever frames landed — callers that treat "no frames" as a valid answer
   * do not need the distinction.
   */
  failure?: string;
}

/**
 * Extract downscaled frames and return their paths in timestamp order.
 */
export async function extractFrames(options: FrameExtractOptions): Promise<string[]> {
  const { input, dir, fps, size, start, duration, failure } = options;

  const args = ['-y'];
  if (start !== undefined) args.push('-ss', start.toString());
  args.push('-i', input);
  if (duration !== undefined) args.push('-t', duration.toString());
  args.push(
    '-vf',
    `fps=${fps},scale=${size}:${size}`,
    '-f',
    'image2',
    path.join(dir, 'frame_%04d.png'),
    '-hide_banner',
    '-loglevel',
    'error'
  );

  const result = await execa('ffmpeg', args, { reject: false, all: true });
  if (failure && result.exitCode !== 0) {
    throw new Error(`${failure}: ${result.all || result.stderr}`);
  }

  const files = await fs.readdir(dir);
  return files
    .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Extract a single downscaled frame at `at` seconds.
 */
export async function extractFrame(options: {
  input: string;
  output: string;
  at: number;
  size: number;
  failure: string;
}): Promise<DecodedFrame> {
  const { input, output, at, size, failure } = options;

  const result = await execa(
    'ffmpeg',
    [
      '-y',
      '-ss',
      at.toString(),
      '-i',
      input,
      '-vframes',
      '1',
      '-vf',
      `scale=${size}:${size}`,
      output,
      '-hide_banner',
      '-loglevel',
      'error',
    ],
    { reject: false, all: true }
  );
  if (result.exitCode !== 0) {
    throw new Error(`${failure}: ${result.all || result.stderr}`);
  }

  return decodeFrame(await fs.readFile(output));
}

/**
 * A frame decoded once, ready to be compared many times.
 *
 * `null` means the PNG could not be decoded; comparisons against it score 0,
 * matching the behaviour of a failed decode. Kept in place rather than dropped
 * so a frame's array index still maps to its timestamp.
 */
export type DecodedFrame = { width: number; height: number; data: Buffer } | null;

/** Decode a PNG buffer, or null if it isn't readable. */
export function decodeFrame(png: Buffer): DecodedFrame {
  try {
    const { width, height, data } = PNG.sync.read(png);
    return { width, height, data };
  } catch {
    return null;
  }
}

/**
 * Read and decode frame files, in the order given.
 *
 * Detection compares every frame against many others, so decoding here rather
 * than inside the comparison turns O(n²) PNG decodes into O(n).
 */
export function readFrames(paths: string[]): Promise<DecodedFrame[]> {
  return Promise.all(paths.map(async (p) => decodeFrame(await fs.readFile(p))));
}

/**
 * Compare two decoded frames and return similarity score (0-1)
 */
export function compareFrames(frame1: DecodedFrame, frame2: DecodedFrame): number {
  if (!frame1 || !frame2) return 0;
  if (frame1.width !== frame2.width || frame1.height !== frame2.height) {
    return 0;
  }

  const { width, height } = frame1;
  const totalPixels = width * height;
  const diff = pixelmatch(frame1.data, frame2.data, null, width, height, { threshold: 0.1 });

  return 1 - diff / totalPixels;
}
