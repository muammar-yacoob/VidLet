/**
 * Video Filter Tool - Apply visual filters to video
 */
import { checkFFmpeg, executeFFmpeg } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface FilterOptions {
  input: string;
  brightness?: number; // -1 to 1 (0 = normal)
  contrast?: number;   // 0 to 2 (1 = normal)
  saturation?: number; // 0 to 2 (1 = normal)
  grayscale?: boolean;
  sepia?: boolean;
  blur?: number;       // 0 to 10 (0 = none)
  sharpen?: boolean;
  vignette?: boolean;
  output?: string;
}

/**
 * Build FFmpeg filter string from options
 */
function buildFilterString(opts: FilterOptions): string {
  const filters: string[] = [];

  // Brightness, contrast, saturation using eq filter
  const eqParts: string[] = [];
  if (opts.brightness !== undefined && opts.brightness !== 0) {
    // FFmpeg eq brightness: -1 to 1, we map our -1 to 1 directly
    eqParts.push(`brightness=${opts.brightness.toFixed(2)}`);
  }
  if (opts.contrast !== undefined && opts.contrast !== 1) {
    // FFmpeg eq contrast: 0 to 2
    eqParts.push(`contrast=${opts.contrast.toFixed(2)}`);
  }
  if (opts.saturation !== undefined && opts.saturation !== 1) {
    // FFmpeg eq saturation: 0 to 3
    eqParts.push(`saturation=${opts.saturation.toFixed(2)}`);
  }
  if (eqParts.length > 0) {
    filters.push(`eq=${eqParts.join(':')}`);
  }

  // Grayscale
  if (opts.grayscale) {
    filters.push('colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3');
  }

  // Sepia
  if (opts.sepia) {
    filters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
  }

  // Blur (using boxblur for performance)
  if (opts.blur && opts.blur > 0) {
    const radius = Math.round(opts.blur * 2);
    filters.push(`boxblur=${radius}:${radius}`);
  }

  // Sharpen using unsharp mask
  if (opts.sharpen) {
    filters.push('unsharp=5:5:1.0:5:5:0.0');
  }

  // Vignette
  if (opts.vignette) {
    filters.push('vignette=PI/4');
  }

  return filters.join(',');
}

/**
 * Apply filters to video
 */
export async function filter(options: FilterOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const filterStr = buildFilterString(options);
  if (!filterStr) {
    throw new Error('No filters selected');
  }

  const output = customOutput ?? getOutputPath(input, '_filtered');

  header('Apply Filters');
  console.log(`Input:  ${fmt.white(input)}`);
  console.log(`Filter: ${fmt.white(filterStr)}`);
  separator();
  console.log(fmt.dim('Applying filters...'));

  await executeFFmpeg({
    input,
    output,
    args: [
      '-vf', filterStr,
      '-c:a', 'copy', // Copy audio without re-encoding
    ],
  });

  success(`Output: ${output}`);
  return output;
}
