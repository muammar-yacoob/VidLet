/**
 * Lightweight toast server for optimize progress window.
 * Serves the toast HTML + lottie-web and exposes API for progress/animation data.
 */
import { exec } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const guiDir = join(__dirname, 'gui');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

interface ToastState {
  progress: { current: number; total: number; fileName: string } | null;
  animationJson: string | null;
  doneMessage: string | null;
}

let state: ToastState = { progress: null, animationJson: null, doneMessage: null };

function serve(req: IncomingMessage, res: ServerResponse) {
  const url = req.url?.split('?')[0] || '/';

  // API endpoints
  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(state));
    return;
  }

  // Static files
  const filePath = url === '/' ? join(guiDir, 'optimize-toast.html') : join(guiDir, url.slice(1));
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

let serverInstance: ReturnType<typeof createServer> | null = null;

/**
 * Start the toast server and open Edge in app mode.
 * Returns controls to update progress and animation.
 */
export function startToast(): {
  updateProgress: (current: number, total: number, fileName: string) => void;
  showAnimation: (jsonString: string) => void;
  done: (message: string) => Promise<void>;
  close: () => void;
} {
  state = { progress: null, animationJson: null, doneMessage: null };

  const server = createServer(serve);
  serverInstance = server;

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') return;
    const port = addr.port;
    const url = `http://127.0.0.1:${port}`;

    // Open Edge in app mode with unique profile to ensure a new window
    const edgePath = '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const tmpProfile = `/tmp/vidlet-edge-${port}`;
    exec(`"${edgePath}" --app="${url}" --window-size=420,155 --user-data-dir="${tmpProfile}" --no-first-run --disable-extensions`, () => {});
  });

  return {
    updateProgress(current, total, fileName) {
      state.progress = { current, total, fileName };
    },
    showAnimation(jsonString) {
      state.animationJson = jsonString;
    },
    done(message) {
      state.doneMessage = message;
      // Keep process alive for Edge to load, show result, and fade out
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          try { server.close(); } catch {}
          resolve();
        }, 10000);
      });
    },
    close() {
      try { server.close(); } catch {}
    },
  };
}
