import * as fs from 'node:fs/promises';
import { checkFFmpeg, executeFFmpegMultiInput, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface ThumbOptions {
  input: string;
  image: string;
  output?: string;
}

/**
 * Embed a thumbnail image into a video file
 */
export async function thumb(options: ThumbOptions): Promise<string> {
  const { input, image, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  // Validate image exists
  try {
    await fs.access(image);
  } catch {
    throw new Error(`Image file not found: ${image}`);
  }

  const output = customOutput ?? getOutputPath(input, '_thumb');
  const info = await getVideoInfo(input);

  header('Embed Thumbnail');
  console.log(`Video: ${fmt.white(input)}`);
  console.log(`Image: ${fmt.white(image)}`);
  console.log(`Size:  ${fmt.white(`${info.width}x${info.height}`)}`);
  separator();
  console.log(fmt.dim('Embedding thumbnail...'));

  // Embed image as attached picture (thumbnail)
  await executeFFmpegMultiInput([input, image], output, [
    '-map',
    '0',
    '-map',
    '1',
    '-c',
    'copy',
    '-disposition:v:1',
    'attached_pic',
    '-loglevel',
    'warning',
  ]);

  success(`Output: ${output}`);

  return output;
}
