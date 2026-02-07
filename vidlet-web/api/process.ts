/**
 * Process Video API - SAME logic as desktop, different output
 * Executes FFmpeg command and returns processed video as download
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { execa } from 'execa';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';

interface ProcessOptions {
  tool: string;
  bitrate?: string;
  preset?: string;
  width?: number;
  fps?: number;
  // ... other tool-specific options
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { v: videoId } = req.query;
  const options: ProcessOptions = req.body;

  if (!videoId || typeof videoId !== 'string') {
    return res.status(400).json({ error: 'Missing video ID' });
  }

  const tmpDir = '/tmp';
  const inputPath = join(tmpDir, `${videoId}.mp4`); // Simplified - detect actual extension
  const outputPath = join(tmpDir, `${videoId}_output.mp4`);

  const logs: Array<{ type: string; message: string }> = [];

  try {
    // Example: Compress tool (SAME logic as desktop version!)
    if (options.tool === 'compress') {
      const bitrate = options.bitrate || '2000k';
      const preset = options.preset || 'medium';

      logs.push({ type: 'info', message: `Compressing with bitrate ${bitrate}...` });

      await execa('ffmpeg', [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-b:v', bitrate,
        '-preset', preset,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ]);

      logs.push({ type: 'success', message: 'Compression complete!' });

      // DESKTOP: Save to VidLet/ folder
      // WEB: Return as download
      const outputBuffer = await readFile(outputPath);

      // Cleanup
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="compressed.mp4"');
      res.send(outputBuffer);

    } else {
      res.status(400).json({
        success: false,
        error: `Tool '${options.tool}' not implemented yet`,
        logs,
      });
    }

  } catch (err: any) {
    logs.push({ type: 'error', message: err.message });

    res.status(500).json({
      success: false,
      error: err.message,
      logs,
    });
  }
}
