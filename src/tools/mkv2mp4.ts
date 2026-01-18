import { type Mkv2Mp4Config, getToolConfig } from '../lib/config.js';
import { buildH264Args, checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { changeExtension } from '../lib/paths.js';

export interface Mkv2Mp4Options extends Partial<Mkv2Mp4Config> {
  input: string;
  output?: string;
}

/**
 * Convert MKV to MP4 (remux or re-encode)
 */
export async function mkv2mp4(options: Mkv2Mp4Options): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const config = await getToolConfig('mkv2mp4');
  const copyStreams = options.copyStreams ?? config.copyStreams;
  const crf = options.crf ?? config.crf;

  const output = customOutput ?? changeExtension(input, '.mp4');
  const info = await getVideoInfo(input);

  header('MKV to MP4 Converter');
  console.log(`Input:  ${fmt.white(input)}`);
  console.log(`Output: ${fmt.white(output)}`);
  console.log(`Size:   ${fmt.white(`${info.width}x${info.height}`)}`);
  console.log(`Mode:   ${fmt.yellow(copyStreams ? 'Stream Copy (fast)' : `Re-encode (CRF ${crf})`)}`);
  separator();
  console.log(fmt.dim('Converting...'));

  let args: string[];

  if (copyStreams) {
    args = ['-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart'];
  } else {
    args = buildH264Args({ crf });
  }

  await executeFFmpeg({ input, output, args });

  success(`Output: ${output}`);

  return output;
}
