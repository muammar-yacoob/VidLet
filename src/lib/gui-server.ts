/**
 * GUI Server - Serves HTML interface and handles API calls for video processing
 */
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import * as os from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { type GuiServerOptions, registerApiRoutes, type VideoInfo } from './gui-api.js';
import { cleanupSignalFiles, signalLoadingComplete } from './loading-window.js';
import { logToFile } from './logger.js';

export type { GuiServerOptions, VideoInfo };

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Long operations like compression get half an hour before the window gives up. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Kill any running FFmpeg processes (Windows compatible)
 */
function killFFmpegProcesses(): void {
  // Use taskkill on Windows, pkill on Unix
  const isWindows = os.platform() === 'win32';
  const cmd = isWindows ? 'taskkill /F /IM ffmpeg.exe /T' : 'pkill -f ffmpeg';
  exec(cmd, (err) => {
    if (!err) {
      logToFile('Killed FFmpeg processes on shutdown');
    }
  });
}

/**
 * Get video info formatted for GUI consumption
 */
export async function getVideoInfoForGui(filePath: string): Promise<VideoInfo> {
  const { getVideoInfo } = await import('./ffmpeg.js');
  const stats = fs.statSync(filePath);
  const info = await getVideoInfo(filePath);
  return {
    filePath,
    fileName: basename(filePath),
    width: info.width,
    height: info.height,
    duration: info.duration,
    fps: info.fps ?? 30,
    bitrate: info.bitrate ?? 0,
    fileSize: stats.size,
    hasAudio: info.hasAudio,
  };
}

/**
 * Start GUI server and open Edge app window
 * Returns a promise that resolves when the window is closed
 */
export function startGuiServer(options: GuiServerOptions): Promise<boolean> {
  // Clean up any stale signal file immediately (before HTA can detect it)
  cleanupSignalFiles();

  return new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: '100mb' }));

    app.use(
      (err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err instanceof SyntaxError && 'body' in err) {
          res.status(400).json({ success: false, error: `Invalid JSON: ${err.message}` });
          return;
        }
        next(err);
      }
    );

    let processResult: boolean | null = null;
    let server: ReturnType<typeof createServer> | null = null;

    // Disable caching for all responses
    app.use((_req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      next();
    });

    const guiDir = join(__dirname, 'gui');
    const iconsDir = join(__dirname, 'icons');
    app.use(express.static(guiDir));
    app.use('/icons', express.static(iconsDir));

    app.get('/favicon.ico', (_req, res) => {
      res.sendFile(join(iconsDir, 'tv.ico'));
    });

    function shutdown() {
      killFFmpegProcesses();
      setTimeout(() => {
        server?.close();
        resolve(processResult ?? false);
      }, 100);
    }

    registerApiRoutes(app, options, {
      setResult: (success) => {
        processResult = success;
      },
      shutdown,
    });

    server = createServer(app);
    // Set long timeout for processing requests
    server.timeout = IDLE_TIMEOUT_MS;
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        const url = `http://127.0.0.1:${port}/${options.htmlFile}`;

        logToFile(`Server ready at ${url}`);

        // Signal HTA to close and open Edge
        signalLoadingComplete(url);
        logToFile('Signaled HTA to open Edge');

        setTimeout(() => {
          if (processResult === null) {
            shutdown();
          }
        }, IDLE_TIMEOUT_MS);
      }
    });

    server.on('error', (err) => {
      console.error('GUI server error:', err.message);
      resolve(false);
    });

    // Cleanup FFmpeg on process signals
    const cleanup = () => {
      killFFmpegProcesses();
      shutdown();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', killFFmpegProcesses);
  });
}
