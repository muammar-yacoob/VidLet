/**
 * Video Info API - SAME logic as desktop version
 * Returns metadata for uploaded video
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';

interface VideoInfo {
  fileName: string;
  filePath: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  bitrate: number;
  defaults: Record<string, unknown>;
}

async function getVideoInfo(filePath: string): Promise<Partial<VideoInfo>> {
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

  return {
    duration: parseFloat(data.format?.duration || '0'),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: Math.round(fps * 100) / 100,
    bitrate,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { v: videoId } = req.query;

    if (!videoId || typeof videoId !== 'string') {
      return res.status(400).json({ error: 'Missing video ID' });
    }

    // Find video file in /tmp
    const tmpDir = '/tmp';
    const possibleExts = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
    let filePath = '';
    let fileName = '';

    for (const ext of possibleExts) {
      const testPath = join(tmpDir, `${videoId}.${ext}`);
      if (existsSync(testPath)) {
        filePath = testPath;
        fileName = `video.${ext}`;
        break;
      }
    }

    if (!filePath) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get metadata (SAME logic as desktop!)
    const info = await getVideoInfo(filePath);

    res.json({
      fileName,
      filePath,
      width: info.width,
      height: info.height,
      duration: info.duration,
      fps: info.fps,
      bitrate: info.bitrate,
      defaults: {
        // Default settings (could be user-specific in production)
        hotkeyPreset: 'premiere',
        frameSkip: 3,
      },
    });

  } catch (err: any) {
    console.error('Info error:', err);
    res.status(500).json({ error: err.message });
  }
}
