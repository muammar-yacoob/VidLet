import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';
import { cleanVoice, ensureDeepFilter } from './cleanvoice.js';
import { compress } from './compress.js';
import { filter } from './filter.js';
import { removeSilence } from './removesilence.js';

/** Maximum duration (seconds) for auto-applying the contrast step */
const SHORT_VIDEO_THRESHOLD = 300; // 5 minutes

export interface AutoCleanupOptions {
  input: string;
  output?: string;
  /** Denoise strength 1–10 (default: 3) */
  noiseReduction?: number;
  /** Min silence to cut in seconds (default: 0.5) */
  minSilenceDuration?: number;
  /** Contrast boost amount 0–2, 1 = neutral (default: 1.15) */
  contrast?: number;
  /** Skip the contrast step entirely (default: false) */
  skipContrast?: boolean;
  /** Callback for pipeline stage updates */
  onProgress?: (stage: string) => void;
}

/**
 * Auto-cleanup pipeline: denoise → remove silence → contrast → compress
 *
 * Runs each step in order, piping the output of one into the next.
 * Intermediate files are placed in a temp directory and cleaned up afterward.
 */
export async function autoCleanup(options: AutoCleanupOptions): Promise<string> {
  const {
    input,
    output: customOutput,
    noiseReduction = 3,
    minSilenceDuration = 0.5,
    contrast = 1.15,
    skipContrast = false,
  } = options;
  const progress = options.onProgress ?? (() => {});

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  const info = await getVideoInfo(input);
  if (!info.hasAudio) {
    throw new Error('Video has no audio stream — auto cleanup requires audio.');
  }

  const output = customOutput ?? getOutputPath(input, '_cleanup');
  const isShort = info.duration <= SHORT_VIDEO_THRESHOLD;
  const applyContrast = !skipContrast && isShort && contrast !== 1;

  header('Auto Cleanup');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Duration: ${fmt.white(info.duration.toFixed(1))}s`);
  separator();
  console.log('Pipeline:');
  console.log(`  1. ${fmt.yellow('Denoise')}       (strength ${noiseReduction}/10)`);
  console.log(`  2. ${fmt.yellow('Remove silence')} (>${minSilenceDuration}s)`);
  if (applyContrast) {
    console.log(`  3. ${fmt.yellow('Contrast')}      (${contrast.toFixed(2)})`);
  } else {
    console.log(
      `  3. ${fmt.dim('Contrast')}      ${fmt.dim(skipContrast ? '(skipped)' : '(skipped — video > 5min)')}`
    );
  }
  console.log(`  4. ${fmt.yellow('Compress')}      (quick)`);
  separator();

  const tempDir = path.join(os.tmpdir(), `vidlet-cleanup-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    let current = input;
    let step = 0;

    // ── Step 1: Denoise ──
    step++;
    progress('Denoising audio...');
    console.log(fmt.dim(`[${step}/4] Denoising...`));
    await ensureDeepFilter().catch(() => {});
    current = await cleanVoice({
      input: current,
      output: path.join(tempDir, 'step1_denoise.mp4'),
      noiseReduction,
      onProgress: progress,
    });

    // ── Step 2: Remove silence ──
    step++;
    progress('Removing silence...');
    console.log(fmt.dim(`[${step}/4] Removing silence...`));
    current = await removeSilence({
      input: current,
      output: path.join(tempDir, 'step2_desilence.mp4'),
      minSilenceDuration,
    });

    // ── Step 3: Contrast (optional) ──
    step++;
    if (applyContrast) {
      progress('Applying contrast...');
      console.log(fmt.dim(`[${step}/4] Applying contrast...`));
      current = await filter({
        input: current,
        output: path.join(tempDir, 'step3_contrast.mp4'),
        contrast,
      });
    } else {
      console.log(fmt.dim(`[${step}/4] Contrast skipped`));
    }

    // ── Step 4: Compress ──
    step++;
    progress('Compressing...');
    console.log(fmt.dim(`[${step}/4] Compressing...`));
    current = await compress({
      input: current,
      output,
      preset: 'veryfast',
    });

    progress('Done!');
    separator();
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
