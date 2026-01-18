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
import { findAllLoopPoints, findMatchesFromEnd } from './loop.js';
import { mkv2mp4 } from './mkv2mp4.js';
import { shrink } from './shrink.js';
import { thumb } from './thumb.js';
import { togif } from './togif.js';
import { trim, trimAccurate } from './trim.js';
import { portrait } from './shorts.js';
import { addAudio } from './audio.js';

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
	codec?: 'h264' | 'hevc';
	// ToGIF options
	fps?: number;
	width?: number;
	dither?: string;
	// MKV2MP4 options
	copyStreams?: boolean;
	crf?: number;
	// Shrink options
	targetDuration?: number;
	// Thumb options
	imagePath?: string;
	// Trim options
	trimStart?: number;
	trimEnd?: number;
	accurate?: boolean;
	// Portrait options
	mode?: 'crop' | 'blur';
	cropX?: number;
	resolution?: number;
	// Audio options
	audioPath?: string;
	audioVolume?: number;
	audioMix?: boolean;
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
					codec: opts.codec,
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

			case 'portrait': {
				logs.push({ type: 'info', message: 'Creating portrait version...' });
				output = await portrait({
					input: actualInput,
					mode: opts.mode || 'crop',
					cropX: opts.cropX ?? 0.5,
					resolution: opts.resolution || 1080,
				});
				logs.push({ type: 'success', message: 'Portrait created!' });
				break;
			}

			case 'audio': {
				if (!opts.audioPath) {
					throw new Error('No audio file provided');
				}
				logs.push({ type: 'info', message: 'Adding audio...' });
				output = await addAudio({
					input: actualInput,
					audio: opts.audioPath,
					volume: opts.audioVolume ?? 0.5,
					mix: opts.audioMix ?? true,
				});
				logs.push({ type: 'success', message: 'Audio added!' });
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
		bitrate: info.bitrate ?? 0,
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
		onDetectLoops: async (minGap: number) => {
			try {
				logToFile(`VidLet: Detecting loop points with minGap=${minGap}s`);
				const startPoints = await findAllLoopPoints(input, videoInfo.duration, minGap);
				logToFile(`VidLet: Found ${startPoints.length} start points`);
				return { success: true, startPoints };
			} catch (err) {
				logToFile(`VidLet: Loop detection failed: ${(err as Error).message}`);
				return { success: false, error: (err as Error).message };
			}
		},
		onFindMatches: async (referenceTime: number, minGap: number) => {
			try {
				logToFile(`VidLet: Finding matches from end, ref=${referenceTime}s, minGap=${minGap}s`);
				const matches = await findMatchesFromEnd(input, videoInfo.duration, referenceTime, minGap);
				logToFile(`VidLet: Found ${matches.length} matches from end`);
				return { success: true, matches };
			} catch (err) {
				logToFile(`VidLet: Match finding failed: ${(err as Error).message}`);
				return { success: false, error: (err as Error).message };
			}
		},
	});
}
