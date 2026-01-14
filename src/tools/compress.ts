import { type CompressConfig, getToolConfig } from '../lib/config.js';
import { buildH264Args, checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface CompressOptions extends Partial<CompressConfig> {
  input: string;
  output?: string;
}

/**
 * Compress a video file using H.264 encoding
 */
export async function compress(options: CompressOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const config = await getToolConfig('compress');
  const bitrate = options.bitrate ?? config.bitrate;
  const preset = options.preset ?? config.preset;

  const output = customOutput ?? getOutputPath(input, '_compressed');
  const info = await getVideoInfo(input);

  header('Video Compression');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Duration: ${fmt.white(info.duration.toFixed(1))}s`);
  console.log(`Size:     ${fmt.white(`${info.width}x${info.height}`)}`);
  console.log(`Bitrate:  ${fmt.yellow(bitrate.toString())}k`);
  console.log(`Preset:   ${fmt.yellow(preset)}`);
  separator();
  console.log(fmt.dim('Compressing...'));

  const args = buildH264Args({ bitrate, preset });

  await executeFFmpeg({ input, output, args });

  success(`Output: ${output}`);

  return output;
}
