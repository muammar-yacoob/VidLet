/**
 * Local development server
 * Simulates Vercel serverless functions locally without requiring Vercel CLI
 */
import express, { Request, Response } from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { execa } from 'execa';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// Multer config for file uploads
const upload = multer({
  dest: '/tmp',
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));

// Helper: Get video info
async function getVideoInfo(filePath: string) {
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

// API Routes
app.post('/api/upload', upload.single('video'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const videoId = randomUUID();
    const ext = req.file.originalname.split('.').pop();
    const finalPath = `/tmp/${videoId}.${ext}`;

    // Rename uploaded file
    await writeFile(finalPath, await readFile(req.file.path));

    // Get video metadata
    const info = await getVideoInfo(finalPath);

    res.json({
      success: true,
      videoId,
      fileName: req.file.originalname,
      info,
    });

  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/api/info', async (req: Request, res: Response) => {
  try {
    const { v: videoId } = req.query;

    if (!videoId || typeof videoId !== 'string') {
      return res.status(400).json({ error: 'Missing video ID' });
    }

    // Find video file in /tmp
    const possibleExts = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
    let filePath = '';
    let fileName = '';

    for (const ext of possibleExts) {
      const testPath = `/tmp/${videoId}.${ext}`;
      try {
        await readFile(testPath);
        filePath = testPath;
        fileName = `video.${ext}`;
        break;
      } catch {}
    }

    if (!filePath) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const info = await getVideoInfo(filePath);

    res.json({
      fileName,
      filePath,
      ...info,
      defaults: {
        hotkeyPreset: 'premiere',
        frameSkip: 3,
      },
    });

  } catch (err: any) {
    console.error('Info error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/video', async (req: Request, res: Response) => {
  const { v: videoId } = req.query;

  console.log('📹 Video request - ID:', videoId);

  if (!videoId || typeof videoId !== 'string') {
    console.error('❌ Missing video ID in request');
    return res.status(400).json({ error: 'Missing video ID' });
  }

  // Find video file
  const possibleExts = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
  for (const ext of possibleExts) {
    const filePath = `/tmp/${videoId}.${ext}`;
    console.log('🔍 Checking:', filePath);
    try {
      await readFile(filePath);
      console.log('✅ Found video:', filePath);
      return res.sendFile(filePath);
    } catch (err) {
      // Continue to next extension
    }
  }

  console.error('❌ Video not found for ID:', videoId);
  res.status(404).json({ error: 'Video not found' });
});

app.post('/api/process', async (req: Request, res: Response) => {
  try {
    const { v: videoId } = req.query;
    const options = req.body;

    if (!videoId || typeof videoId !== 'string') {
      return res.status(400).json({ error: 'Missing video ID' });
    }

    // Find input file
    const possibleExts = ['mp4', 'mov', 'mkv', 'avi', 'webm'];
    let inputPath = '';
    let inputExt = 'mp4';

    for (const ext of possibleExts) {
      const testPath = `/tmp/${videoId}.${ext}`;
      try {
        await readFile(testPath);
        inputPath = testPath;
        inputExt = ext;
        break;
      } catch {}
    }

    if (!inputPath) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const outputPath = `/tmp/${videoId}_output.mp4`;

    // Example: Compress tool
    if (options.tool === 'compress') {
      const bitrate = options.bitrate || '2000k';
      const preset = options.preset || 'medium';

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

      const outputBuffer = await readFile(outputPath);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="compressed.mp4"');
      res.send(outputBuffer);

    } else {
      res.status(400).json({
        success: false,
        error: `Tool '${options.tool}' not implemented yet`,
      });
    }

  } catch (err: any) {
    console.error('Process error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Additional API endpoints (stubs for now)
app.post('/api/find-best-start', async (req: Request, res: Response) => {
  // TODO: Implement loop detection
  res.json({ success: false, error: 'Loop detection not yet implemented in web version' });
});

app.post('/api/find-matches', async (req: Request, res: Response) => {
  // TODO: Implement frame matching
  res.json({ success: false, error: 'Frame matching not yet implemented in web version' });
});

app.post('/api/detect-loops', async (req: Request, res: Response) => {
  // TODO: Implement loop detection
  res.json({ success: false, error: 'Loop detection not yet implemented in web version' });
});

app.post('/api/progress', async (req: Request, res: Response) => {
  // Just log progress, no action needed
  const { percent } = req.body;
  if (typeof percent === 'number') {
    console.log(`Caching progress: ${percent}%`);
  }
  res.json({ ok: true });
});

app.post('/api/preview', async (req: Request, res: Response) => {
  // TODO: Implement preview generation
  res.json({ success: false, error: 'Preview generation not yet implemented' });
});

app.get('/favicon.ico', (req: Request, res: Response) => {
  res.status(204).end();
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🎬 VidLet Web - Development Server');
  console.log('===================================');
  console.log('');
  console.log(`✓ Server running at http://localhost:${PORT}`);
  console.log(`✓ Upload page:      http://localhost:${PORT}`);
  console.log(`✓ Main app:         http://localhost:${PORT}/vidlet.html?v=TEST_ID`);
  console.log('');
  console.log('💡 Note: This simulates Vercel serverless functions locally');
  console.log('   For full Vercel environment, use: bun run dev:vercel');
  console.log('');
});
