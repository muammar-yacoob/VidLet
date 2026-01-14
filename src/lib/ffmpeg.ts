import * as fs from 'node:fs/promises';
import { type ExecaError, execa } from 'execa';

export interface FFmpegOptions {
  input: string;
  output: string;
  args?: string[];
  overwrite?: boolean;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

/**
 * Check if ffmpeg is available
 */
export async function checkFFmpeg(): Promise<boolean> {
  try {
    await execa('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get video information using ffprobe
 */
export async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');

  if (!videoStream) {
    throw new Error('No video stream found');
  }

  // Parse frame rate (can be "30/1" or "29.97")
  let fps = 30;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    fps = den ? num / den : num;
  }

  return {
    duration: Number.parseFloat(data.format?.duration || '0'),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: Math.round(fps * 100) / 100,
    codec: videoStream.codec_name || 'unknown',
  };
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(inputPath: string): Promise<number> {
  const info = await getVideoInfo(inputPath);
  return info.duration;
}

/**
 * Execute an ffmpeg command
 */
export async function executeFFmpeg(options: FFmpegOptions): Promise<void> {
  const { input, output, args = [], overwrite = true } = options;

  // Validate input file exists
  try {
    await fs.access(input);
  } catch {
    throw new Error(`Input file not found: ${input}`);
  }

  const ffmpegArgs = [
    ...(overwrite ? ['-y'] : ['-n']),
    '-i',
    input,
    ...args,
    '-loglevel',
    'warning',
    output,
  ];

  try {
    await execa('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
  } catch (error) {
    const execaError = error as ExecaError;
    throw new Error(`FFmpeg failed: ${execaError.message}`);
  }
}

/**
 * Execute ffmpeg with multiple inputs
 */
export async function executeFFmpegMultiInput(
  inputs: string[],
  output: string,
  args: string[],
  overwrite = true
): Promise<void> {
  const inputArgs = inputs.flatMap((i) => ['-i', i]);

  const ffmpegArgs = [...(overwrite ? ['-y'] : ['-n']), ...inputArgs, ...args, output];

  try {
    await execa('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
  } catch (error) {
    const execaError = error as ExecaError;
    throw new Error(`FFmpeg failed: ${execaError.message}`);
  }
}

/**
 * Extract frames from video
 */
export async function extractFrames(
  inputPath: string,
  outputPattern: string,
  options: {
    fps?: number;
    duration?: number;
    scale?: { width: number; height: number };
  } = {}
): Promise<void> {
  const { fps = 30, duration, scale } = options;

  const args: string[] = [];

  if (duration) {
    args.push('-t', duration.toString());
  }

  const filters: string[] = [`fps=${fps}`];
  if (scale) {
    filters.push(`scale=${scale.width}:${scale.height}`);
  }

  args.push('-vf', filters.join(','), '-f', 'image2');

  await executeFFmpeg({
    input: inputPath,
    output: outputPattern,
    args,
  });
}

/**
 * Build common H.264 encoding args
 */
export function buildH264Args(options: {
  bitrate?: number;
  preset?: string;
  crf?: number;
  audioBitrate?: number;
}): string[] {
  const { bitrate, preset = 'medium', crf, audioBitrate = 128 } = options;

  const args = ['-c:v', 'libx264', '-preset', preset];

  if (bitrate) {
    args.push('-b:v', `${bitrate}k`);
  } else if (crf !== undefined) {
    args.push('-crf', crf.toString());
  }

  args.push('-c:a', 'aac', '-b:a', `${audioBitrate}k`, '-movflags', '+faststart');

  return args;
}
