import * as fs from 'node:fs/promises';
import { type ExecaError, execa } from 'execa';
import { logToFile } from './logger.js';

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
  bitrate: number; // in kbps
  hasAudio: boolean;
  sampleRate: number;
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

  // Parse frame rate - use avg_frame_rate (actual fps) instead of r_frame_rate (timebase)
  let fps = 30;
  const fpsString = videoStream.avg_frame_rate || videoStream.r_frame_rate;
  if (fpsString) {
    const [num, den] = fpsString.split('/').map(Number);
    fps = den ? num / den : num;
  }

  // Get bitrate in kbps (from format or video stream)
  const formatBitrate = Number.parseInt(data.format?.bit_rate || '0', 10);
  const streamBitrate = Number.parseInt(videoStream.bit_rate || '0', 10);
  const bitrate = Math.round((streamBitrate || formatBitrate) / 1000);

  // Check for audio stream
  const audioStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
  const hasAudio = !!audioStream;
  const sampleRate = hasAudio ? Number.parseInt(audioStream.sample_rate || '0', 10) : 0;

  return {
    duration: Number.parseFloat(data.format?.duration || '0'),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: Math.round(fps * 100) / 100,
    codec: videoStream.codec_name || 'unknown',
    bitrate,
    hasAudio,
    sampleRate,
  };
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(inputPath: string): Promise<number> {
  const info = await getVideoInfo(inputPath);
  return info.duration;
}

/** Run FFmpeg with standard error handling and logging */
async function runFFmpeg(args: string[], label: string) {
  logToFile(`FFmpeg ${label}: ffmpeg ${args.join(' ')}`);
  try {
    const result = await execa('ffmpeg', args, {
      reject: false,
      timeout: 30 * 60 * 1000,
    });
    logToFile(`FFmpeg completed with exit code: ${result.exitCode}`);
    if (result.exitCode !== 0) {
      const errorMsg = result.stderr?.trim() || `Exit code ${result.exitCode}`;
      logToFile(`FFmpeg error: ${errorMsg}`);
      const err = new Error(`FFmpeg failed: ${errorMsg}`);
      (err as any).isFFmpegError = true;
      throw err;
    }
    return result;
  } catch (error) {
    if ((error as any).isFFmpegError) throw error;
    const execaError = error as ExecaError;
    logToFile(`FFmpeg exception: ${execaError.message}`);
    throw new Error(`FFmpeg failed: ${execaError.message}`);
  }
}

/**
 * Execute an ffmpeg command
 */
export async function executeFFmpeg(options: FFmpegOptions): Promise<void> {
  const { input, output, args = [], overwrite = true } = options;

  try {
    await fs.access(input);
  } catch {
    throw new Error(`Input file not found: ${input}`);
  }

  const ffmpegArgs = [
    '-nostdin',
    ...(overwrite ? ['-y'] : ['-n']),
    '-i',
    input,
    ...args,
    '-loglevel',
    'error',
    output,
  ];

  await runFFmpeg(ffmpegArgs, 'command');
  logToFile(`FFmpeg success: Output at ${output}`);
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

  const ffmpegArgs = [
    '-nostdin',
    ...(overwrite ? ['-y'] : ['-n']),
    ...inputArgs,
    ...args,
    '-loglevel',
    'error',
    output,
  ];

  await runFFmpeg(ffmpegArgs, 'multi-input');
  logToFile(`FFmpeg success: Output at ${output}`);
}

/**
 * Execute ffmpeg with raw arguments (no automatic input/output handling)
 */
export async function executeFFmpegRaw(args: string[]): Promise<void> {
  await runFFmpeg(['-nostdin', '-loglevel', 'error', ...args], 'raw');
}

/**
 * Run an FFmpeg analysis pass (output to null) and return stderr.
 * Used for filters like silencedetect and loudnorm that output results to stderr.
 */
export async function executeFFmpegAnalysis(input: string, args: string[]): Promise<string> {
  try {
    await fs.access(input);
  } catch {
    throw new Error(`Input file not found: ${input}`);
  }

  const ffmpegArgs = ['-nostdin', '-y', '-i', input, ...args, '-f', 'null', '-'];
  const result = await runFFmpeg(ffmpegArgs, 'analysis');
  return result.stderr || '';
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

/**
 * Build HEVC/H.265 encoding args (better compression, ~30-50% smaller)
 */
export function buildHEVCArgs(options: {
  bitrate?: number;
  preset?: string;
  crf?: number;
  audioBitrate?: number;
}): string[] {
  const { bitrate, preset = 'medium', crf, audioBitrate = 128 } = options;

  const args = ['-c:v', 'libx265', '-preset', preset, '-tag:v', 'hvc1'];

  if (bitrate) {
    args.push('-b:v', `${bitrate}k`);
  } else if (crf !== undefined) {
    args.push('-crf', crf.toString());
  }

  args.push('-c:a', 'aac', '-b:a', `${audioBitrate}k`, '-movflags', '+faststart');

  return args;
}
