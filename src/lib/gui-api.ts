import { spawn } from 'node:child_process';
/**
 * API surface for the GUI server: the callback contract a tool supplies, and
 * the Express routes that expose it to the pages in `dist/gui/`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import { basename, extname, join } from 'node:path';
import type express from 'express';
import { loadToolsConfig, saveToolsConfig } from './config.js';
import { logToFile } from './logger.js';
import { getProcessStatus } from './process-status.js';

export interface VideoInfo {
  filePath: string;
  fileName: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  bitrate: number;
  fileSize: number;
  hasAudio: boolean;
}

/** Shape every optional callback replies with. */
interface Reply {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface GuiServerOptions {
  htmlFile: string;
  title: string;
  videoInfo: VideoInfo;
  defaults: Record<string, unknown>;
  onPreview?: (options: Record<string, unknown>) => Promise<{
    success: boolean;
    imageData?: string;
    width?: number;
    height?: number;
    error?: string;
  }>;
  onProcess: (options: Record<string, unknown>) => Promise<{
    success: boolean;
    output?: string;
    error?: string;
    logs: Array<{ type: string; message: string }>;
  }>;
  onLoadVideo?: (data: { filePath: string }) => Promise<{
    success: boolean;
    filePath?: string;
    fileName?: string;
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    error?: string;
  }>;
  onDetectLoops?: (minGap: number) => Promise<{
    success: boolean;
    startPoints?: Array<{
      id: number;
      time: number;
      matches: Array<{ end: number; score: number }>;
    }>;
    error?: string;
  }>;
  onFindMatches?: (
    referenceTime: number,
    minGap: number
  ) => Promise<{
    success: boolean;
    matches?: Array<{ time: number; score: number }>;
    error?: string;
  }>;
  onFindBestStart?: (
    searchRange: number,
    minGap: number
  ) => Promise<{
    success: boolean;
    startTime?: number;
    endTime?: number;
    score?: number;
    error?: string;
  }>;
  onAnalyzeAudio?: () => Promise<{
    success: boolean;
    voiceStart?: number;
    currentLoudness?: number;
    suggestedNoiseReduction?: number;
    error?: string;
  }>;
  onTranscribe?: () => Promise<{
    success: boolean;
    srtContent?: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
      words: Array<{ word: string; start: number; end: number }>;
    }>;
    error?: string;
  }>;
}

/** Lifecycle hooks the server owns and the routes need to reach. */
export interface ServerControls {
  /** Record whether processing succeeded, for the value startGuiServer resolves to. */
  setResult: (success: boolean) => void;
  /** Close the window and tear the server down. */
  shutdown: () => void;
}

type Body = Record<string, unknown>;

/**
 * Wire a POST route to a callback the tool may not implement.
 *
 * A missing callback answers "not supported" and a throw becomes
 * `{ success: false, error }` — the pages treat every reply as JSON, so
 * failures must not surface as a 500.
 */
function optionalRoute(
  app: express.Express,
  path: string,
  unsupported: string,
  handler: ((body: Body) => Promise<Reply>) | undefined,
  onSuccess?: (result: Reply) => void
): void {
  app.post(path, async (req, res) => {
    if (!handler) {
      res.json({ success: false, error: unsupported });
      return;
    }
    try {
      const result = await handler(req.body ?? {});
      onSuccess?.(result);
      res.json(result);
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });
}

/**
 * Register every `/api/*` route on the server.
 */
export function registerApiRoutes(
  app: express.Express,
  options: GuiServerOptions,
  controls: ServerControls
): void {
  const { onPreview, onLoadVideo, onDetectLoops, onFindMatches, onFindBestStart } = options;
  const { onAnalyzeAudio, onTranscribe } = options;
  const { videoInfo } = options;

  app.get('/api/info', (_req, res) => {
    res.json({
      ...videoInfo,
      defaults: options.defaults,
      sparkAiKey:
        process.env.SPARK_AI_API_KEY ||
        process.env.NEXT_PUBLIC_SPARK_AI_API_KEY ||
        (options.defaults as Record<string, unknown>)?.sparkAiKey ||
        '',
    });
  });

  // Stream video file for preview
  app.get('/api/video', (_req, res) => {
    res.sendFile(videoInfo.filePath, (err) => {
      if (err) {
        logToFile(`Video stream error: ${err.message}`);
      }
    });
  });

  app.get('/api/process-status', (_req, res) => {
    res.json({ status: getProcessStatus() });
  });

  optionalRoute(app, '/api/preview', 'Preview not supported', onPreview);

  app.post('/api/process', async (req, res) => {
    try {
      const result = await options.onProcess(req.body);
      controls.setResult(result.success);
      res.json(result);
    } catch (err) {
      controls.setResult(false);
      res.json({
        success: false,
        error: (err as Error).message,
        logs: [{ type: 'error', message: (err as Error).message }],
      });
    }
  });

  optionalRoute(
    app,
    '/api/load',
    'Load not supported',
    onLoadVideo && ((b) => onLoadVideo(b as { filePath: string })),
    (result) => {
      if (!result.success || !result.filePath || !result.fileName) return;
      videoInfo.filePath = result.filePath as string;
      videoInfo.fileName = result.fileName as string;
      videoInfo.width = (result.width as number) ?? videoInfo.width;
      videoInfo.height = (result.height as number) ?? videoInfo.height;
      videoInfo.duration = (result.duration as number) ?? videoInfo.duration;
      videoInfo.fps = (result.fps as number) ?? videoInfo.fps;
    }
  );

  optionalRoute(
    app,
    '/api/detect-loops',
    'Loop detection not supported',
    onDetectLoops && ((b) => onDetectLoops((b.minGap as number) || 5))
  );

  // Find frames from end of video matching a reference time
  optionalRoute(
    app,
    '/api/find-matches',
    'Match finding not supported',
    onFindMatches &&
      ((b) => onFindMatches((b.referenceTime as number) ?? 0, (b.minGap as number) ?? 3))
  );

  // Find best loop starting point in a time range
  optionalRoute(
    app,
    '/api/find-best-start',
    'Best start finding not supported',
    onFindBestStart &&
      ((b) => onFindBestStart((b.searchRange as number) ?? 5, (b.minGap as number) ?? 3))
  );

  optionalRoute(app, '/api/analyze-audio', 'Audio analysis not supported', onAnalyzeAudio);

  optionalRoute(app, '/api/transcribe', 'Transcription not supported', onTranscribe);

  // Upload file (audio/image) and return temp path
  app.post('/api/upload', (req, res) => {
    try {
      const { fileName, data, type } = req.body;
      if (!fileName || !data) {
        res.json({ success: false, error: 'Missing file data' });
        return;
      }

      // Sanitize filename to prevent path traversal
      const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = extname(safeName) || (type === 'audio' ? '.mp3' : '.png');
      const tempPath = join(os.tmpdir(), `vidlet_${type}_${Date.now()}${ext}`);
      const buffer = Buffer.from(data.split(',').pop() || data, 'base64');
      fs.writeFileSync(tempPath, buffer);

      logToFile(`Uploaded ${type} file: ${tempPath}`);
      res.json({ success: true, path: tempPath });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/cancel', (_req, res) => {
    controls.setResult(false);
    res.json({ ok: true });
    controls.shutdown();
  });

  app.post('/api/close', (_req, res) => {
    res.json({ ok: true });
    controls.shutdown();
  });

  app.post('/api/open-url', (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.json({ success: false, error: 'Missing URL' });
      return;
    }
    // Validate URL scheme to prevent command injection via PowerShell
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.json({ success: false, error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.json({ success: false, error: 'Only HTTP/HTTPS URLs are allowed' });
      return;
    }
    // Use Start-Process with -ArgumentList to avoid string interpolation injection
    spawn('powershell.exe', ['-WindowStyle', 'Hidden', '-Command', 'Start-Process', parsed.href], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    res.json({ success: true });
  });

  // Update caching progress (logged for debugging)
  app.post('/api/progress', (req, res) => {
    const { percent } = req.body;
    if (typeof percent === 'number') {
      logToFile(`Caching progress: ${percent}%`);
    }
    res.json({ ok: true });
  });

  // Save app settings
  app.post('/api/save-settings', async (req, res) => {
    try {
      const { hotkeyPreset, frameSkip } = req.body;
      const config = await loadToolsConfig();
      let changed = false;

      if (hotkeyPreset && typeof hotkeyPreset === 'string') {
        (options.defaults as Record<string, unknown>).hotkeyPreset = hotkeyPreset;
        config.app = {
          ...config.app,
          hotkeyPreset: hotkeyPreset as
            | 'premiere'
            | 'resolve'
            | 'capcut'
            | 'shotcut'
            | 'descript'
            | 'camtasia',
        };
        changed = true;
      }

      if (typeof frameSkip === 'number' && frameSkip >= 2 && frameSkip <= 6) {
        (options.defaults as Record<string, unknown>).frameSkip = frameSkip;
        config.app = { ...config.app, frameSkip };
        changed = true;
      }

      if (changed) {
        await saveToolsConfig(config);
        logToFile(
          `Settings saved: hotkeyPreset=${config.app.hotkeyPreset}, frameSkip=${config.app.frameSkip}`
        );
      }
      res.json({ success: true });
    } catch (err) {
      logToFile(`Failed to save settings: ${(err as Error).message}`);
      res.json({ success: false, error: (err as Error).message });
    }
  });
}
