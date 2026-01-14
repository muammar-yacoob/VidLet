import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ToGifConfig, getToolConfig } from '../lib/config.js';
import { checkFFmpeg, executeFFmpeg, executeFFmpegMultiInput } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { changeExtension } from '../lib/paths.js';

export interface ToGifOptions extends Partial<ToGifConfig> {
  input: string;
  output?: string;
}

/**
 * Convert video to optimized GIF with palette generation
 */
export async function togif(options: ToGifOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const config = await getToolConfig('togif');
  const fps = options.fps ?? config.fps;
  const width = options.width ?? config.width;
  const dither = options.dither ?? config.dither;
  const statsMode = options.statsMode ?? config.statsMode;

  const output = customOutput ?? changeExtension(input, '.gif');
  const palettePath = path.join(os.tmpdir(), `vidlet_palette_${Date.now()}.png`);

  header('MP4 to GIF Converter');
  console.log(`Input:  ${fmt.white(input)}`);
  console.log(`Output: ${fmt.white(output)}`);
  console.log(`FPS:    ${fmt.yellow(fps.toString())}`);
  console.log(`Width:  ${fmt.yellow(width.toString())}px`);
  console.log(`Dither: ${fmt.yellow(dither)}`);
  separator();

  try {
    console.log(fmt.dim('Creating optimized palette...'));

    await executeFFmpeg({
      input,
      output: palettePath,
      args: [
        '-vf',
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=${statsMode}`,
      ],
    });

    console.log(fmt.dim('Converting to GIF...'));

    await executeFFmpegMultiInput([input, palettePath], output, [
      '-lavfi',
      `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=${dither}`,
    ]);

    success(`Output: ${output}`);

    return output;
  } finally {
    try {
      await fs.unlink(palettePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
