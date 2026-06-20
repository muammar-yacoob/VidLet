import { type SpeedupConfig, getToolConfig } from '../lib/config.js';
import { checkFFmpeg, checkNvenc, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface SpeedupOptions extends Partial<SpeedupConfig> {
  input: string;
  output?: string;
}

/**
 * Speed up video tempo while preserving pitch (with optional subtle pitch shift)
 */
export async function speedup(options: SpeedupOptions): Promise<string> {
  const { input, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const config = await getToolConfig('speedup');
  const speed = options.speed ?? config.speed;
  const pitchShift = options.pitchShift ?? config.pitchShift;

  const output = customOutput ?? getOutputPath(input, '_speedup');
  const info = await getVideoInfo(input);

  const newDuration = info.duration / speed;
  const pitchFactor = 1 + pitchShift / 100;

  const useGpu = await checkNvenc();

  header('Video Speedup');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(
    `Duration: ${fmt.white(info.duration.toFixed(1))}s → ${fmt.green(newDuration.toFixed(1))}s`
  );
  console.log(`Speed:    ${fmt.yellow(speed.toFixed(2))}x`);
  console.log(`Pitch:    ${fmt.yellow(`${pitchShift > 0 ? '+' : ''}${pitchShift}%`)}`);
  console.log(`Encoder:  ${useGpu ? fmt.green('NVENC (GPU)') : fmt.dim('libx264 (CPU)')}`);
  separator();
  console.log(fmt.dim('Processing...'));

  const videoFilter = `setpts=PTS/${speed}`;
  const sampleRate = info.sampleRate || 48000;
  const audioFilters = buildSpeedupAudioFilters(speed, pitchFactor, sampleRate);

  const videoEnc = useGpu
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-spatial-aq', '1']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];

  const args = info.hasAudio
    ? [
        '-filter_complex',
        `[0:v]${videoFilter}[v];[0:a]${audioFilters}[a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        ...videoEnc,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
      ]
    : ['-vf', videoFilter, ...videoEnc, '-an'];

  await executeFFmpeg({ input, output, args });

  success(`Output: ${output}`);

  return output;
}

/**
 * Build audio filter chain: atempo for speed, asetrate+aresample for pitch shift
 */
function buildSpeedupAudioFilters(speed: number, pitchFactor: number, sampleRate: number): string {
  const filters: string[] = [];

  // atempo changes tempo without affecting pitch (range 0.5-2.0 per instance)
  let remaining = speed;
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

  // Apply subtle pitch shift via sample rate manipulation using actual sample rate
  if (pitchFactor !== 1.0) {
    const shifted = Math.round(sampleRate * pitchFactor);
    filters.push(`asetrate=${shifted}`, `aresample=${sampleRate}`);
  }

  return filters.join(',');
}
