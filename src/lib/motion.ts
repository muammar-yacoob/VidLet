/**
 * Motion tracking - estimates WHERE the action is on the x-axis of a video
 * segment, so a 9:16 crop can follow the cursor/activity in screen
 * recordings. Pure ffmpeg + pngjs (already a dependency): sample frame
 * pairs, diff pixels, take the horizontal centroid of what changed.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { executeFFmpegRaw } from './ffmpeg.js';

/** Downscaled analysis width - enough to localize a cursor, cheap to diff. */
const ANALYSIS_WIDTH = 320;
/** Per-channel delta considered "changed" (screen noise/compression floor). */
const PIXEL_THRESHOLD = 24;
/** Below this changed-pixel fraction the scene is static - no signal. */
const MIN_CHANGED_FRACTION = 0.0005;

/**
 * Horizontal centroid (0-1) of pixels that changed between two same-size
 * RGBA buffers, or null when the scene is effectively static.
 */
export function diffCentroidX(a: Buffer, b: Buffer, width: number, height: number): number | null {
  let weightSum = 0;
  let xWeighted = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const delta =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (delta > PIXEL_THRESHOLD * 3) {
        weightSum += 1;
        xWeighted += x;
      }
    }
  }
  if (weightSum < width * height * MIN_CHANGED_FRACTION) return null;
  return xWeighted / weightSum / width;
}

/**
 * Convert an action centroid (0-1 across the source width) into the cropX
 * value (0-1) that centers a 9:16 crop window on it.
 *
 * FFmpeg crop x = cropX * (in_w - out_w); centering the window on
 * centroid*in_w solves to cropX = (centroid*in_w - out_w/2) / (in_w - out_w).
 */
export function centroidToCropX(centroid: number, inWidth: number, inHeight: number): number {
  const outWidth = (inHeight * 9) / 16;
  if (inWidth <= outWidth) return 0.5; // already portrait-ish, nothing to pan
  const cropX = (centroid * inWidth - outWidth / 2) / (inWidth - outWidth);
  return Math.min(1, Math.max(0, cropX));
}

async function extractFrame(input: string, time: number, outPng: string): Promise<void> {
  await executeFFmpegRaw([
    '-y',
    '-ss',
    time.toFixed(3),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    `scale=${ANALYSIS_WIDTH}:-1`,
    '-loglevel',
    'error',
    outPng,
  ]);
}

/**
 * Estimate the cropX (0-1) for a segment by sampling up to three frame
 * pairs and averaging the motion centroids. Falls back to 0.5 (center)
 * for static scenes.
 */
export async function estimateCropX(
  input: string,
  startTime: number,
  endTime: number,
  inWidth: number,
  inHeight: number
): Promise<number> {
  const duration = endTime - startTime;
  const pairCount = duration > 8 ? 3 : duration > 3 ? 2 : 1;
  const gap = Math.min(0.25, duration / 4);

  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-motion-'));
  const centroids: number[] = [];
  try {
    for (let p = 0; p < pairCount; p++) {
      // Sample points spread across the segment, away from the very edges.
      const t = startTime + (duration * (p + 0.5)) / pairCount - gap / 2;
      const pngA = join(workDir, `${p}a.png`);
      const pngB = join(workDir, `${p}b.png`);
      try {
        await extractFrame(input, t, pngA);
        await extractFrame(input, t + gap, pngB);
        const a = PNG.sync.read(readFileSync(pngA));
        const b = PNG.sync.read(readFileSync(pngB));
        if (a.width !== b.width || a.height !== b.height) continue;
        const centroid = diffCentroidX(a.data, b.data, a.width, a.height);
        if (centroid !== null) centroids.push(centroid);
      } catch {
        // Frame extraction can fail near stream edges - skip this pair.
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (centroids.length === 0) return 0.5;
  const mean = centroids.reduce((s, c) => s + c, 0) / centroids.length;
  return centroidToCropX(mean, inWidth, inHeight);
}
