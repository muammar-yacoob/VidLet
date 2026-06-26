import * as fs from 'node:fs/promises';
import { type ExecaError, execa } from 'execa';
import { logToFile } from './logger.js';

/** Maximum time a single ffmpeg invocation may run before being killed. */
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

/** Error thrown when an ffmpeg invocation fails. */
export class FFmpegError extends Error {
  readonly isFFmpegError = true;
  constructor(message: string) {
    super(message);
    this.name = 'FFmpegError';
  }
}

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

let nvencChecked = false;
let nvencAvailable = false;

/**
 * Check if NVENC GPU encoding is available
 */
export async function checkNvenc(): Promise<boolean> {
  if (nvencChecked) return nvencAvailable;
  try {
    const { stdout } = await execa('ffmpeg', ['-hide_banner', '-encoders']);
    nvencAvailable = stdout.includes('h264_nvenc');
    nvencChecked = true;
    return nvencAvailable;
  } catch {
    nvencChecked = true;
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

/** Throw an FFmpegError if the ffmpeg result exited with a non-zero code. */
function assertFFmpegOk(result: { exitCode?: number; stderr?: unknown }): void {
  logToFile(`FFmpeg completed with exit code: ${result.exitCode}`);
  if (result.exitCode !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const errorMsg = stderr || `Exit code ${result.exitCode}`;
    logToFile(`FFmpeg error: ${errorMsg}`);
    throw new FFmpegError(`FFmpeg failed: ${errorMsg}`);
  }
}

/** Run FFmpeg with standard error handling and logging */
async function runFFmpeg(args: string[], label: string) {
  logToFile(`FFmpeg ${label}: ffmpeg ${args.join(' ')}`);
  // reject:false means execa only throws on spawn failure (e.g. ffmpeg missing),
  // not on a non-zero exit code - that is handled by assertFFmpegOk.
  const result = await execa('ffmpeg', args, {
    reject: false,
    timeout: FFMPEG_TIMEOUT_MS,
  }).catch((error: ExecaError) => {
    logToFile(`FFmpeg exception: ${error.message}`);
    throw new FFmpegError(`FFmpeg failed: ${error.message}`);
  });
  assertFFmpegOk(result);
  return result;
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
 * Execute an ffmpeg command with a progress bar.
 * expectedDuration is the output video duration in seconds.
 */
export async function executeFFmpegWithProgress(
  options: FFmpegOptions & { expectedDuration: number }
): Promise<void> {
  const { input, output, args = [], overwrite = true, expectedDuration } = options;

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
    '-progress',
    'pipe:1',
    '-loglevel',
    'error',
    output,
  ];

  logToFile(`FFmpeg progress: ffmpeg ${ffmpegArgs.join(' ')}`);

  const proc = execa('ffmpeg', ffmpegArgs, {
    reject: false,
    timeout: FFMPEG_TIMEOUT_MS,
  });

  let speed = '';
  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('out_time_us=')) {
        const us = Number.parseInt(line.split('=')[1], 10);
        if (us > 0 && expectedDuration > 0) {
          const pct = Math.min(100, (us / 1_000_000 / expectedDuration) * 100);
          renderProgressBar(pct, speed);
        }
      } else if (line.startsWith('speed=')) {
        speed = line.split('=')[1].trim();
      }
    }
  });

  const result = await proc;

  // Clear progress line
  process.stdout.write('\r\x1b[K');

  assertFFmpegOk(result);
  logToFile(`FFmpeg success: Output at ${output}`);
}

function renderProgressBar(pct: number, speed: string): void {
  const width = 30;
  const filled = Math.round((pct / 100) * width);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  const speedStr = speed && speed !== 'N/A' ? ` | ${speed}` : '';
  process.stdout.write(`\r  [${bar}] ${pct.toFixed(0).padStart(3)}%${speedStr}`);
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
 * Build the content of an ffmpeg concat-demuxer list file from segment paths,
 * escaping single quotes so arbitrary paths are handled safely.
 */
export function buildConcatFileContent(files: string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
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
