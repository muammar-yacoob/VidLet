/**
 * Jump Cut Tool - Auto-edit: remove silence + alternating punch-in zoom
 * Creates the fast-paced "MrBeast" / podcast editing style.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildConcatFileContent,
  checkFFmpeg,
  executeFFmpegRaw,
  getVideoInfo,
} from '../lib/ffmpeg.js';
import { createSpinner, fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';
import { detectSilence, invertSegments } from '../lib/segments.js';

export type JumpcutPace = 'tight' | 'normal' | 'loose';

export interface JumpcutOptions {
  input: string;
  output?: string;
  /** Pacing preset — controls silence threshold and padding */
  pace?: JumpcutPace;
  /** Punch-in zoom percentage on alternating cuts (0 = none, default 3, max 8) */
  zoom?: number;
  /** Custom silence threshold in dB (overrides pace preset) */
  silenceThreshold?: number;
  /** Custom min silence duration in seconds (overrides pace preset) */
  minSilenceDuration?: number;
  /** Padding to keep around speech segments in seconds */
  padding?: number;
  onProgress?: (stage: string) => void;
}

// Pace presets: minSilence, threshold, padding
const PACE_PRESETS: Record<
  JumpcutPace,
  { minSilence: number; threshold: number; padding: number }
> = {
  tight: { minSilence: 0.25, threshold: -28, padding: 0.03 },
  normal: { minSilence: 0.4, threshold: -30, padding: 0.08 },
  loose: { minSilence: 0.8, threshold: -35, padding: 0.15 },
};

// ============ MAIN ============

export async function jumpcut(options: JumpcutOptions): Promise<string> {
  const { input, output: customOutput, pace = 'normal', zoom: zoomPct = 3, onProgress } = options;

  const progress = onProgress ?? (() => {});

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  const info = await getVideoInfo(input);
  if (!info.hasAudio) {
    throw new Error('Video has no audio stream for silence detection.');
  }

  const preset = PACE_PRESETS[pace];
  const minSilence = options.minSilenceDuration ?? preset.minSilence;
  const threshold = options.silenceThreshold ?? preset.threshold;
  const padding = options.padding ?? preset.padding;
  const zoomFactor = Math.max(0, Math.min(8, zoomPct)) / 100; // 0.00 - 0.08

  const output = customOutput ?? getOutputPath(input, '_jumpcut');

  header('Jump Cut');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Duration: ${fmt.white(`${info.duration.toFixed(1)}s`)}`);
  console.log(`Pace:     ${fmt.yellow(pace)}`);
  console.log(`Zoom:     ${fmt.yellow(zoomFactor > 0 ? `${zoomPct}%` : 'off')}`);
  separator();

  // Step 1: Detect silence
  progress('Detecting silence...');
  const spin = createSpinner('Detecting silence...');
  const silentSegments = await detectSilence(input, {
    minDuration: minSilence,
    thresholdDb: threshold,
    videoDuration: info.duration,
  });
  spin.stop();

  if (silentSegments.length === 0) {
    console.log(fmt.yellow('No silence detected — copying input as-is.'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(input, output);
    success(`Output: ${output}`);
    return output;
  }

  const totalSilence = silentSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  console.log(
    `Found ${fmt.yellow(String(silentSegments.length))} silent gaps ` +
      `(${fmt.yellow(`${totalSilence.toFixed(1)}s`)} total)`
  );

  // Step 2: Calculate speech segments
  const speechSegments = invertSegments(info.duration, silentSegments, {
    padding,
    minLength: 0.05,
  });
  if (speechSegments.length === 0) {
    throw new Error('Removing all silence would leave no content.');
  }

  console.log(`Keeping ${fmt.green(String(speechSegments.length))} speech segments`);

  // Step 3: Extract each segment (with alternating zoom)
  const tempDir = path.join(os.tmpdir(), `vidlet-jumpcut-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const segmentFiles: string[] = [];
    const w = info.width;
    const h = info.height;

    for (let i = 0; i < speechSegments.length; i++) {
      const seg = speechSegments[i];
      const segFile = path.join(tempDir, `seg_${i.toString().padStart(4, '0')}.mp4`);
      segmentFiles.push(segFile);

      progress(`Cutting segment ${i + 1}/${speechSegments.length}...`);
      if ((i + 1) % 10 === 0 || i === speechSegments.length - 1) {
        console.log(fmt.dim(`  Segment ${i + 1}/${speechSegments.length}`));
      }

      const segDuration = seg.end - seg.start;
      const applyZoom = zoomFactor > 0 && i % 2 === 1; // Odd segments get zoom

      if (applyZoom) {
        // Crop center by zoom%, scale back to original resolution
        const cropW = Math.round(w * (1 - zoomFactor));
        const cropH = Math.round(h * (1 - zoomFactor));
        const cropX = Math.round((w - cropW) / 2);
        const cropY = Math.round((h - cropH) / 2);

        await executeFFmpegRaw([
          '-y',
          '-ss',
          seg.start.toString(),
          '-i',
          input,
          '-t',
          segDuration.toString(),
          '-vf',
          `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${w}:${h}`,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '18',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-avoid_negative_ts',
          'make_zero',
          segFile,
        ]);
      } else {
        // No zoom — stream copy for speed
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
    }

    // Step 4: Concat all segments
    // When mixing copy + re-encoded segments, we need to re-encode the concat
    // to avoid codec parameter mismatches
    progress('Stitching segments...');
    console.log(fmt.dim('Stitching segments...'));

    const concatFile = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatFile, buildConcatFileContent(segmentFiles));

    if (zoomFactor > 0) {
      // Re-encode concat to normalize codec params between copy/zoom segments
      await executeFFmpegRaw([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatFile,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        output,
      ]);
    } else {
      // No zoom used anywhere — fast concat copy
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
    }

    const kept = info.duration - totalSilence;
    progress('Done!');
    console.log(
      `Result: ${fmt.green(`${kept.toFixed(1)}s`)} (cut ${totalSilence.toFixed(1)}s silence, ${speechSegments.length} jump cuts)`
    );
    success(`Output: ${output}`);
    return output;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
