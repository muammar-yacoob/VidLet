import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkFFmpeg, executeFFmpeg, executeFFmpegMultiInput, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success, logToFile } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface ThumbOptions {
  input: string;
  image?: string;
  timestamp?: number; // Extract frame from video at this time
  output?: string;
}

/**
 * Extract a single frame from video at specified timestamp
 */
export async function extractFrame(videoPath: string, timestamp: number): Promise<string> {
  const jpegPath = path.join(os.tmpdir(), `vidlet_frame_${Date.now()}.jpg`);

  await executeFFmpeg({
    input: videoPath,
    output: jpegPath,
    args: [
      '-ss', timestamp.toString(),
      '-frames:v', '1',
      '-q:v', '2',
    ],
  });

  return jpegPath;
}

/**
 * Convert any image to JPEG for MP4 compatibility
 * WebP and other formats aren't supported as attached pictures in MP4
 * Always convert to ensure compatibility (file content may not match extension)
 */
async function convertToJpeg(imagePath: string): Promise<string> {
  const jpegPath = path.join(os.tmpdir(), `vidlet_thumb_${Date.now()}.jpg`);
  logToFile(`Converting image to JPEG: ${imagePath} -> ${jpegPath}`);

  // Use execa directly for more control over the conversion
  const { execa } = await import('execa');
  const result = await execa('ffmpeg', [
    '-y',
    '-i', imagePath,
    '-c:v', 'mjpeg',           // Explicit JPEG codec
    '-q:v', '2',               // High quality
    jpegPath
  ], { reject: false });

  logToFile(`JPEG conversion exit code: ${result.exitCode}`);
  if (result.exitCode !== 0) {
    logToFile(`JPEG conversion error: ${result.stderr}`);
    throw new Error(`Failed to convert image to JPEG: ${result.stderr || 'Unknown error'}`);
  }

  // Verify conversion succeeded
  try {
    await fs.access(jpegPath);
    logToFile(`JPEG file created successfully: ${jpegPath}`);
  } catch {
    throw new Error(`JPEG file not created: ${imagePath}`);
  }

  return jpegPath;
}

/**
 * Embed a thumbnail image into a video file
 */
export async function thumb(options: ThumbOptions): Promise<string> {
  const { input, image, timestamp, output: customOutput } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  // Need either image or timestamp
  if (!image && timestamp === undefined) {
    throw new Error('Either image path or timestamp is required');
  }

  let imagePath = image;

  // Extract frame from video if timestamp provided
  if (timestamp !== undefined) {
    imagePath = await extractFrame(input, timestamp);
  } else if (image) {
    // Validate image exists
    try {
      await fs.access(image);
    } catch {
      throw new Error(`Image file not found: ${image}`);
    }
  }

  const output = customOutput ?? getOutputPath(input, '_thumb');
  const info = await getVideoInfo(input);

  header('Embed Thumbnail');
  console.log(`Video: ${fmt.white(input)}`);
  if (timestamp !== undefined) {
    console.log(`Frame: ${fmt.white(`${timestamp.toFixed(2)}s`)}`);
  } else {
    console.log(`Image: ${fmt.white(imagePath!)}`);
  }
  console.log(`Size:  ${fmt.white(`${info.width}x${info.height}`)}`);
  separator();
  console.log(fmt.dim('Embedding thumbnail...'));

  // Convert image to JPEG for MP4 compatibility
  const jpegImage = await convertToJpeg(imagePath!);
  logToFile(`Using thumbnail image: ${jpegImage}`);

  // Embed image as attached picture (thumbnail)
  // Map only video stream 0 and audio (skip existing attached pics which may be incompatible)
  // Re-encode thumbnail as mjpeg to ensure MP4 compatibility regardless of source format
  await executeFFmpegMultiInput([input, jpegImage], output, [
    '-map', '0:v:0',    // Main video stream only
    '-map', '0:a?',     // Audio if present
    '-map', '1:v:0',    // Thumbnail image (explicit first video stream)
    '-c:v:0', 'copy',   // Copy main video codec
    '-c:a', 'copy',     // Copy audio codec
    '-c:v:1', 'mjpeg',  // Re-encode thumbnail as JPEG for MP4 compatibility
    '-q:v:1', '2',      // High quality for thumbnail
    '-disposition:v:1', 'attached_pic',
  ]);

  // Cleanup temp files
  if (jpegImage !== imagePath) {
    await fs.unlink(jpegImage).catch(() => {});
  }
  if (timestamp !== undefined && imagePath) {
    await fs.unlink(imagePath).catch(() => {});
  }

  success(`Output: ${output}`);

  return output;
}
