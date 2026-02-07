/**
 * File Upload API - NEW for web version
 * Handles video upload and returns video ID for session
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { execa } from 'execa';

export const config = {
  api: {
    bodyParser: false, // Handle multipart form data manually
  },
};

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  hasAudio: boolean;
}

async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const { stdout } = await execa('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');

  if (!videoStream) {
    throw new Error('No video stream found');
  }

  let fps = 30;
  const fpsString = videoStream.avg_frame_rate || videoStream.r_frame_rate;
  if (fpsString) {
    const [num, den] = fpsString.split('/').map(Number);
    fps = den ? num / den : num;
  }

  const formatBitrate = parseInt(data.format?.bit_rate || '0', 10);
  const streamBitrate = parseInt(videoStream.bit_rate || '0', 10);
  const bitrate = Math.round((streamBitrate || formatBitrate) / 1000);

  const hasAudio = data.streams?.some((s: any) => s.codec_type === 'audio') ?? false;

  return {
    duration: parseFloat(data.format?.duration || '0'),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: Math.round(fps * 100) / 100,
    codec: videoStream.codec_name || 'unknown',
    bitrate,
    hasAudio,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data
    const busboy = await import('busboy');
    const bb = busboy.default({ headers: req.headers });

    const videoId = randomUUID();
    const tmpDir = '/tmp';
    let filePath = '';
    let fileName = '';

    await new Promise<void>((resolve, reject) => {
      bb.on('file', async (fieldname, file, info) => {
        fileName = info.filename;
        const ext = fileName.split('.').pop();
        filePath = join(tmpDir, `${videoId}.${ext}`);

        const writeStream = require('fs').createWriteStream(filePath);
        file.pipe(writeStream);

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      bb.on('error', reject);
      req.pipe(bb);
    });

    // Get video metadata
    const info = await getVideoInfo(filePath);

    // Store session data (in production, use Redis/Database)
    // For now, info is embedded in response and re-fetched on demand

    res.json({
      success: true,
      videoId,
      fileName,
      info: {
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        bitrate: info.bitrate,
        hasAudio: info.hasAudio,
      },
    });

  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
