/**
 * VidLet Main - Unified tool window with all video tools
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToolConfig } from '../lib/config.js';
import { getVideoInfo } from '../lib/ffmpeg.js';
import { startGuiServer, type VideoInfo } from '../lib/gui-server.js';
import { logToFile } from '../lib/logger.js';
import { compress } from './compress.js';
import { loop } from './loop.js';
import { mkv2mp4 } from './mkv2mp4.js';
import { shrink } from './shrink.js';
import { thumb } from './thumb.js';
import { togif } from './togif.js';
import { trim, trimAccurate } from './trim.js';
import { shorts } from './shorts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get package.json homepage URL
 */
function getHomepage(): string {
	try {
		// Try reading from dist/../package.json
		const pkgPath = path.join(__dirname, '..', '..', 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
		return pkg.homepage || 'https://vidlet.app';
	} catch {
		return 'https://vidlet.app';
	}
}

/** Tool configuration */
export const config = {
	id: 'vidlet',
	name: 'VidLet',
	icon: 'tv.ico',
	extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
	description: 'Video utility toolkit',
};

/** Tool-specific options interface */
interface ToolOptions {
	tool: string;
	inputPath?: string; // Custom input path (used for chained workflows)
	// Compress options
	bitrate?: number;
	preset?: string;
	// ToGIF options
	fps?: number;
	width?: number;
	dither?: string;
	// MKV2MP4 options
	copyStreams?: boolean;
	crf?: number;
	// Shrink options
	targetDuration?: number;
	// Loop options
	start?: number;
	end?: number;
	autoDetect?: boolean;
	// Thumb options
	imagePath?: string;
	// Trim options
	trimStart?: number;
	trimEnd?: number;
	accurate?: boolean;
	// Shorts options
	mode?: 'crop' | 'blur';
	cropX?: number;
	resolution?: number;
}

/** Process result */
interface ProcessResult {
	success: boolean;
	output?: string;
	error?: string;
	logs: Array<{ type: string; message: string }>;
}

/**
 * Run the selected tool with options
 */
async function runTool(input: string, opts: ToolOptions): Promise<ProcessResult> {
	const logs: Array<{ type: string; message: string }> = [];
	const toolId = opts.tool;

	// Use custom input path if provided (for chained workflows)
	const actualInput = opts.inputPath || input;

	logToFile(`VidLet: Running tool ${toolId} on ${actualInput}`);
	logToFile(`VidLet: Options: ${JSON.stringify(opts)}`);

	try {
		let output: string;

		switch (toolId) {
			case 'compress': {
				logs.push({ type: 'info', message: 'Starting compression...' });
				output = await compress({
					input: actualInput,
					bitrate: opts.bitrate,
					preset: opts.preset as
						| 'ultrafast'
						| 'superfast'
						| 'veryfast'
						| 'faster'
						| 'fast'
						| 'medium'
						| 'slow'
						| 'slower'
						| 'veryslow'
						| undefined,
				});
				logs.push({ type: 'success', message: 'Compression complete!' });
				break;
			}

			case 'togif': {
				logs.push({ type: 'info', message: 'Creating optimized GIF...' });
				output = await togif({
					input: actualInput,
					fps: opts.fps,
					width: opts.width,
					dither: opts.dither as 'none' | 'floyd_steinberg' | 'sierra2' | 'sierra2_4a' | 'bayer' | undefined,
				});
				logs.push({ type: 'success', message: 'GIF created!' });
				break;
			}

			case 'mkv2mp4': {
				logs.push({ type: 'info', message: 'Converting MKV to MP4...' });
				output = await mkv2mp4({
					input: actualInput,
					copyStreams: opts.copyStreams,
					crf: opts.crf,
				});
				logs.push({ type: 'success', message: 'Conversion complete!' });
				break;
			}

			case 'shrink': {
				logs.push({ type: 'info', message: 'Shrinking video...' });
				output = await shrink({
					input: actualInput,
					targetDuration: opts.targetDuration,
				});
				logs.push({ type: 'success', message: 'Video shrunk!' });
				break;
			}

			case 'loop': {
				logs.push({ type: 'info', message: 'Creating seamless loop...' });
				output = await loop({
					input: actualInput,
					start: opts.autoDetect ? undefined : opts.start,
					end: opts.autoDetect ? undefined : opts.end,
				});
				logs.push({ type: 'success', message: 'Loop created!' });
				break;
			}

			case 'thumb': {
				if (!opts.imagePath) {
					throw new Error('No image path provided for thumbnail');
				}
				logs.push({ type: 'info', message: 'Embedding thumbnail...' });
				output = await thumb({
					input: actualInput,
					image: opts.imagePath,
				});
				logs.push({ type: 'success', message: 'Thumbnail set!' });
				break;
			}

			case 'trim': {
				if (opts.trimStart === undefined || opts.trimEnd === undefined) {
					throw new Error('Start and end times are required for trimming');
				}
				const isAccurate = opts.accurate ?? false;
				logs.push({ type: 'info', message: isAccurate ? 'Trimming with re-encoding...' : 'Trimming video...' });
				if (isAccurate) {
					output = await trimAccurate({
						input: actualInput,
						start: opts.trimStart,
						end: opts.trimEnd,
					});
				} else {
					output = await trim({
						input: actualInput,
						start: opts.trimStart,
						end: opts.trimEnd,
					});
				}
				logs.push({ type: 'success', message: 'Video trimmed!' });
				break;
			}

			case 'shorts': {
				logs.push({ type: 'info', message: 'Creating shorts version...' });
				output = await shorts({
					input: actualInput,
					mode: opts.mode || 'crop',
					cropX: opts.cropX ?? 0.5,
					resolution: opts.resolution || 1080,
				});
				logs.push({ type: 'success', message: 'Shorts created!' });
				break;
			}

			default:
				throw new Error(`Unknown tool: ${toolId}`);
		}

		logToFile(`VidLet: Tool ${toolId} completed successfully. Output: ${output}`);
		return { success: true, output, logs };
	} catch (err) {
		const errorMsg = (err as Error).message;
		logToFile(`VidLet: Tool ${toolId} failed: ${errorMsg}`);
		logs.push({ type: 'error', message: errorMsg });
		return { success: false, error: errorMsg, logs };
	}
}

/**
 * Get video info for GUI
 */
async function getVideoInfoForGui(filePath: string): Promise<VideoInfo> {
	const info = await getVideoInfo(filePath);
	return {
		filePath,
		fileName: path.basename(filePath),
		width: info.width,
		height: info.height,
		duration: info.duration,
		fps: info.fps ?? 30,
	};
}

/**
 * Run unified VidLet GUI
 */
export async function runGUI(input: string): Promise<boolean> {
	logToFile(`VidLet: Opening unified GUI for ${input}`);

	const videoInfo = await getVideoInfoForGui(input);
	const ext = path.extname(input).toLowerCase();

	// Check if video is landscape (16:9 or wider, aspect ratio >= 1.7)
	const aspectRatio = videoInfo.width / videoInfo.height;
	const isLandscape = aspectRatio >= 1.7;

	// Load defaults for all tools
	const defaults = {
		compress: await getToolConfig('compress'),
		togif: await getToolConfig('togif'),
		mkv2mp4: await getToolConfig('mkv2mp4'),
		shrink: await getToolConfig('shrink'),
		loop: await getToolConfig('loop'),
		isMkv: ext === '.mkv',
		isLandscape,
		homepage: getHomepage(),
	};

	return startGuiServer({
		htmlFile: 'vidlet.html',
		title: 'VidLet',
		videoInfo,
		defaults,
		onProcess: async (opts) => {
			return runTool(input, opts as ToolOptions);
		},
	});
}
