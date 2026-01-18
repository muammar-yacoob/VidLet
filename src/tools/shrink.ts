import { type ShrinkConfig, getToolConfig } from '../lib/config.js';
import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success, warn } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface ShrinkOptions extends Partial<ShrinkConfig> {
  input: string;
  output?: string;
}

/**
 * Speed up video to fit within target duration (useful for YouTube Shorts)
 */
export async function shrink(options: ShrinkOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const config = await getToolConfig('shrink');
  const targetDuration = options.targetDuration ?? config.targetDuration;

  const output = customOutput ?? getOutputPath(input, '_shrunk');
  const info = await getVideoInfo(input);
  const currentDuration = info.duration;

  if (currentDuration <= targetDuration) {
    warn(`Video is already shorter than ${targetDuration}s, no shrinking needed.`);
    return input;
  }

  const speedFactor = currentDuration / targetDuration;

  header('Video Shrink');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(
    `Duration: ${fmt.white(currentDuration.toFixed(1))}s → ${fmt.green(targetDuration.toFixed(1))}s`
  );
  console.log(`Speed:    ${fmt.yellow(speedFactor.toFixed(2))}x`);
  separator();
  console.log(fmt.dim('Processing...'));

  const videoFilter = `setpts=PTS/${speedFactor}`;
  const audioFilters = buildAtempoFilters(speedFactor);

  const args = [
    '-filter_complex',
    `[0:v]${videoFilter}[v];[0:a]${audioFilters}[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
  ];

  await executeFFmpeg({ input, output, args });

  success(`Output: ${output}`);

  return output;
}

/**
 * Build atempo filter chain for speed factors outside 0.5-2.0 range
 */
function buildAtempoFilters(speedFactor: number): string {
  if (speedFactor <= 2.0 && speedFactor >= 0.5) {
    return `atempo=${speedFactor}`;
  }

  const filters: string[] = [];
  let remaining = speedFactor;

  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  if (remaining !== 1.0) {
    filters.push(`atempo=${remaining}`);
  }

  return filters.join(',');
}
