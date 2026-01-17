import * as path from 'node:path';
import { getToolConfig as getToolSettings } from '../lib/config.js';
import { getVideoInfo } from '../lib/ffmpeg.js';
import { startGuiServer, type VideoInfo } from '../lib/gui-server.js';
import { compress } from '../tools/compress.js';
import { loop } from '../tools/loop.js';
import { mkv2mp4 } from '../tools/mkv2mp4.js';
import { shrink } from '../tools/shrink.js';
import { thumb } from '../tools/thumb.js';
import { togif } from '../tools/togif.js';

/**
 * Tool configuration interface - defines metadata for each video tool
 */
export interface ToolConfig {
	id: string;
	name: string;
	icon: string;
	extensions: string[];
	description: string;
}

/**
 * Tool interface with run and GUI capabilities
 */
export interface Tool {
	config: ToolConfig;
	run: (input: string, options: Record<string, unknown>) => Promise<string>;
	runGUI?: (input: string) => Promise<void>;
}

/**
 * Get video info for GUI mode
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
 * Tool configurations for all video tools
 */
export const toolConfigs: ToolConfig[] = [
	{
		id: 'compress',
		name: 'Compress',
		icon: 'compress.ico',
		extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
		description: 'Compress video using H.264 encoding',
	},
	{
		id: 'togif',
		name: 'To GIF',
		icon: 'tv.ico',
		extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
		description: 'Convert video to optimized GIF',
	},
	{
		id: 'mkv2mp4',
		name: 'MKV to MP4',
		icon: 'mkv2mp4.ico',
		extensions: ['.mkv'],
		description: 'Convert MKV to MP4 format',
	},
	{
		id: 'shrink',
		name: 'Shrink',
		icon: 'shrink.ico',
		extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
		description: 'Speed up video to target duration',
	},
	{
		id: 'thumb',
		name: 'Thumbnail',
		icon: 'thumb.ico',
		extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
		description: 'Set video thumbnail from image',
	},
	{
		id: 'loop',
		name: 'Loop',
		icon: 'tv.ico',
		extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
		description: 'Create seamless video loop',
	},
];

/**
 * All tools with their run and GUI implementations
 */
export const tools: Tool[] = [
	{
		config: toolConfigs[0],
		run: async (input, options) => {
			return compress({
				input,
				output: options.output as string | undefined,
				bitrate: options.bitrate as number | undefined,
				preset: options.preset as 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			const config = await getToolSettings('compress');
			await startGuiServer({
				htmlFile: 'compress.html',
				title: 'Compress Video',
				videoInfo,
				defaults: config,
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						logs.push({ type: 'info', message: 'Starting compression...' });
						const output = await compress({
							input,
							bitrate: opts.bitrate as number,
							preset: opts.preset as 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | undefined,
						});
						logs.push({ type: 'success', message: 'Compression complete!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
	{
		config: toolConfigs[1],
		run: async (input, options) => {
			return togif({
				input,
				output: options.output as string | undefined,
				fps: options.fps as number | undefined,
				width: options.width as number | undefined,
				dither: options.dither as 'none' | 'floyd_steinberg' | 'sierra2' | 'sierra2_4a' | 'bayer' | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			const config = await getToolSettings('togif');
			await startGuiServer({
				htmlFile: 'togif.html',
				title: 'Convert to GIF',
				videoInfo,
				defaults: config,
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						logs.push({ type: 'info', message: 'Creating optimized palette...' });
						const output = await togif({
							input,
							fps: opts.fps as number,
							width: opts.width as number,
							dither: opts.dither as 'none' | 'floyd_steinberg' | 'sierra2' | 'sierra2_4a' | 'bayer' | undefined,
						});
						logs.push({ type: 'success', message: 'GIF created!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
	{
		config: toolConfigs[2],
		run: async (input, options) => {
			return mkv2mp4({
				input,
				output: options.output as string | undefined,
				copyStreams: options.copyStreams as boolean | undefined,
				crf: options.crf as number | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			const config = await getToolSettings('mkv2mp4');
			await startGuiServer({
				htmlFile: 'mkv2mp4.html',
				title: 'MKV to MP4',
				videoInfo,
				defaults: config,
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						logs.push({ type: 'info', message: 'Converting...' });
						const output = await mkv2mp4({
							input,
							copyStreams: opts.copyStreams as boolean,
							crf: opts.crf as number,
						});
						logs.push({ type: 'success', message: 'Conversion complete!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
	{
		config: toolConfigs[3],
		run: async (input, options) => {
			return shrink({
				input,
				output: options.output as string | undefined,
				targetDuration: options.targetDuration as number | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			const config = await getToolSettings('shrink');
			await startGuiServer({
				htmlFile: 'shrink.html',
				title: 'Shrink Video',
				videoInfo,
				defaults: config,
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						logs.push({ type: 'info', message: 'Shrinking video...' });
						const output = await shrink({
							input,
							targetDuration: opts.targetDuration as number,
						});
						logs.push({ type: 'success', message: 'Video shrunk!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
	{
		config: toolConfigs[4],
		run: async (input, options) => {
			return thumb({
				input,
				image: options.image as string,
				output: options.output as string | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			await startGuiServer({
				htmlFile: 'thumb.html',
				title: 'Set Thumbnail',
				videoInfo,
				defaults: { imagePath: '' },
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						const imagePath = opts.imagePath as string;
						if (!imagePath) {
							throw new Error('No image path provided');
						}
						logs.push({ type: 'info', message: 'Embedding thumbnail...' });
						const output = await thumb({
							input,
							image: imagePath,
						});
						logs.push({ type: 'success', message: 'Thumbnail set!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
	{
		config: toolConfigs[5],
		run: async (input, options) => {
			return loop({
				input,
				output: options.output as string | undefined,
				start: options.start as number | undefined,
				end: options.end as number | undefined,
			});
		},
		runGUI: async (input) => {
			const videoInfo = await getVideoInfoForGui(input);
			const config = await getToolSettings('loop');
			await startGuiServer({
				htmlFile: 'loop.html',
				title: 'Create Loop',
				videoInfo,
				defaults: config,
				onProcess: async (opts) => {
					const logs: Array<{ type: string; message: string }> = [];
					try {
						logs.push({ type: 'info', message: 'Finding loop points...' });
						const output = await loop({
							input,
							start: opts.start as number | undefined,
							end: opts.end as number | undefined,
						});
						logs.push({ type: 'success', message: 'Loop created!' });
						return { success: true, output, logs };
					} catch (err) {
						logs.push({ type: 'error', message: (err as Error).message });
						return { success: false, error: (err as Error).message, logs };
					}
				},
			});
		},
	},
];

/**
 * Get tool by ID
 */
export function getToolById(id: string): Tool | undefined {
	return tools.find((t) => t.config.id === id);
}

/**
 * Get tool config by ID
 */
export function getToolConfigById(id: string): ToolConfig | undefined {
	return toolConfigs.find((t) => t.id === id);
}

/**
 * Get tools that support a given file extension
 */
export function getToolsForExtension(ext: string): Tool[] {
	const normalizedExt = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	return tools.filter((t) => t.config.extensions.includes(normalizedExt));
}
