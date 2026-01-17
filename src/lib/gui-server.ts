/**
 * GUI Server - Serves HTML interface and handles API calls for video processing
 */
import { exec, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import * as os from 'node:os';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { logToFile } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
 * Signal the loading HTA to close by creating a temp file
 */
function signalReady(): void {
	spawn(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			'New-Item -Path $env:TEMP\\vidlet-ready.tmp -ItemType File -Force | Out-Null',
		],
		{
			stdio: 'ignore',
			windowsHide: true,
		},
	);
}

/**
 * Clean up any stale signal file from previous sessions
 */
function cleanupSignalFile(): void {
	spawn(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			'Remove-Item -Path $env:TEMP\\vidlet-ready.tmp -Force -ErrorAction SilentlyContinue',
		],
		{
			stdio: 'ignore',
			windowsHide: true,
		},
	);
}

/**
 * Open URL in Edge app mode (standalone window without browser UI)
 */
function openAppWindow(url: string): void {
	// Clean up any stale signal file first
	cleanupSignalFile();

	spawn('powershell.exe', ['-WindowStyle', 'Hidden', '-Command', `Start-Process msedge -ArgumentList '--app=${url}'`], {
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	}).unref();

	// Don't signal here - let the app signal when it's ready via /api/ready
}

export interface VideoInfo {
	filePath: string;
	fileName: string;
	width: number;
	height: number;
	duration: number;
	fps: number;
	bitrate: number;
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
	onLoadVideo?: (data: { fileName: string; data: string; mimeType: string }) => Promise<{
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
		startPoints?: Array<{ id: number; time: number; matches: Array<{ end: number; score: number }> }>;
		error?: string;
	}>;
}

/**
 * Start GUI server and open Edge app window
 * Returns a promise that resolves when the window is closed
 */
export function startGuiServer(options: GuiServerOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const app = express();
		app.use(express.json({ limit: '100mb' }));

		app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
			if (err instanceof SyntaxError && 'body' in err) {
				res.status(400).json({ success: false, error: `Invalid JSON: ${err.message}` });
				return;
			}
			next(err);
		});

		let processResult: boolean | null = null;
		let server: ReturnType<typeof createServer> | null = null;

		const guiDir = join(__dirname, 'gui');
		const iconsDir = join(__dirname, 'icons');
		app.use(express.static(guiDir));
		app.use('/icons', express.static(iconsDir));

		app.get('/favicon.ico', (_req, res) => {
			res.sendFile(join(iconsDir, 'tv.ico'));
		});

		app.get('/api/info', (_req, res) => {
			res.json({
				fileName: options.videoInfo.fileName,
				filePath: options.videoInfo.filePath,
				width: options.videoInfo.width,
				height: options.videoInfo.height,
				duration: options.videoInfo.duration,
				fps: options.videoInfo.fps,
				bitrate: options.videoInfo.bitrate,
				defaults: options.defaults,
			});
		});

		// Stream video file for preview
		app.get('/api/video', (_req, res) => {
			const filePath = options.videoInfo.filePath;
			res.sendFile(filePath, (err) => {
				if (err) {
					logToFile(`Video stream error: ${err.message}`);
				}
			});
		});

		app.post('/api/preview', async (req, res) => {
			if (!options.onPreview) {
				res.json({ success: false, error: 'Preview not supported' });
				return;
			}
			try {
				const result = await options.onPreview(req.body);
				res.json(result);
			} catch (err) {
				res.json({
					success: false,
					error: (err as Error).message,
				});
			}
		});

		app.post('/api/process', async (req, res) => {
			try {
				const result = await options.onProcess(req.body);
				processResult = result.success;
				res.json(result);
			} catch (err) {
				processResult = false;
				res.json({
					success: false,
					error: (err as Error).message,
					logs: [{ type: 'error', message: (err as Error).message }],
				});
			}
		});

		app.post('/api/load', async (req, res) => {
			if (!options.onLoadVideo) {
				res.json({ success: false, error: 'Load not supported' });
				return;
			}
			try {
				const result = await options.onLoadVideo(req.body);
				if (result.success && result.filePath && result.fileName) {
					options.videoInfo.filePath = result.filePath;
					options.videoInfo.fileName = result.fileName;
					options.videoInfo.width = result.width ?? options.videoInfo.width;
					options.videoInfo.height = result.height ?? options.videoInfo.height;
					options.videoInfo.duration = result.duration ?? options.videoInfo.duration;
					options.videoInfo.fps = result.fps ?? options.videoInfo.fps;
				}
				res.json(result);
			} catch (err) {
				res.json({ success: false, error: (err as Error).message });
			}
		});

		app.post('/api/detect-loops', async (req, res) => {
			if (!options.onDetectLoops) {
				res.json({ success: false, error: 'Loop detection not supported' });
				return;
			}
			try {
				const minGap = req.body.minGap || 5;
				const result = await options.onDetectLoops(minGap);
				res.json(result);
			} catch (err) {
				res.json({ success: false, error: (err as Error).message });
			}
		});

		// Upload file (audio/image) and return temp path
		app.post('/api/upload', (req, res) => {
			try {
				const { fileName, data, type } = req.body;
				if (!fileName || !data) {
					res.json({ success: false, error: 'Missing file data' });
					return;
				}

				// Decode base64 and save to temp file
				const ext = extname(fileName) || (type === 'audio' ? '.mp3' : '.png');
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
			processResult = false;
			killFFmpegProcesses();
			res.json({ ok: true });
			shutdown();
		});

		app.post('/api/close', (_req, res) => {
			killFFmpegProcesses();
			res.json({ ok: true });
			shutdown();
		});

		app.post('/api/open-url', (req, res) => {
			const { url } = req.body;
			if (!url || typeof url !== 'string') {
				res.json({ success: false, error: 'Missing URL' });
				return;
			}
			spawn('powershell.exe', ['-WindowStyle', 'Hidden', '-Command', `Start-Process '${url}'`], {
				detached: true,
				stdio: 'ignore',
				windowsHide: true,
			}).unref();
			res.json({ success: true });
		});

		function shutdown() {
			killFFmpegProcesses();
			setTimeout(() => {
				server?.close();
				resolve(processResult ?? false);
			}, 100);
		}

		server = createServer(app);
		// Set long timeout for processing requests (30 minutes)
		server.timeout = 30 * 60 * 1000;
		server.listen(0, '127.0.0.1', () => {
			const addr = server?.address();
			if (typeof addr === 'object' && addr) {
				const port = addr.port;
				const url = `http://127.0.0.1:${port}/${options.htmlFile}`;

				openAppWindow(url);

				// 30 minute timeout for long operations like compression
				setTimeout(() => {
					if (processResult === null) {
						shutdown();
					}
				}, 30 * 60 * 1000);
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
