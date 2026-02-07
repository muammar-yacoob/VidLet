/**
 * Overlay Tool - Stack images/GIFs/videos on video with positioning, timing, and fade effects
 * Uses FFmpeg filter_complex for multi-layer compositing
 * Supports: PNG, JPEG, WebP (static), GIF (animated), MP4/WebM (video)
 */
import * as path from 'node:path';
import { executeFFmpegRaw, getVideoInfo } from '../lib/ffmpeg.js';
import { logToFile } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const ANIMATED_EXTENSIONS = ['.gif', ...VIDEO_EXTENSIONS];
const STATIC_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'];

export interface OverlayLayer {
	imagePath: string; // server path to overlay file (PNG, GIF, MP4, etc.)
	x: number; // 0-1 normalized horizontal position
	y: number; // 0-1 normalized vertical position
	scale: number; // scale multiplier (1 = original size relative to video)
	startTime: number;
	endTime: number;
	fadeIn: boolean;
	fadeOut: boolean;
}

export interface OverlayOptions {
	input: string;
	layers: OverlayLayer[];
}

const FADE_DURATION = 0.5; // seconds for fade in/out

/**
 * Apply PNG overlays to video using filter_complex
 */
export async function overlay(opts: OverlayOptions): Promise<string> {
	const { input, layers } = opts;

	if (!layers || layers.length === 0) {
		throw new Error('No overlay layers provided');
	}

	if (layers.length > 5) {
		throw new Error('Maximum 5 overlay layers allowed');
	}

	logToFile(`Overlay: Processing ${input} with ${layers.length} layer(s)`);

	const videoInfo = await getVideoInfo(input);
	const duration = videoInfo.duration;

	// Build input args with per-input options
	// Static images need -loop 1 so FFmpeg generates a continuous frame stream
	const inputArgs: string[] = ['-i', input];

	for (const layer of layers) {
		const ext = path.extname(layer.imagePath).toLowerCase();
		const isStatic = STATIC_IMAGE_EXTENSIONS.includes(ext);
		if (isStatic) {
			inputArgs.push('-loop', '1', '-i', layer.imagePath);
		} else {
			inputArgs.push('-i', layer.imagePath);
		}
	}

	// Build filter_complex chain
	const filterParts: string[] = [];
	let lastLabel = '0:v';

	for (let i = 0; i < layers.length; i++) {
		const layer = layers[i];
		const inputIdx = i + 1;
		const imgLabel = `img${i}`;
		const outLabel = i < layers.length - 1 ? `base${i}` : '';

		const layerExt = path.extname(layer.imagePath).toLowerCase();
		const isAnimated = ANIMATED_EXTENSIONS.includes(layerExt);

		// Clamp timing
		const start = Math.max(0, Math.min(layer.startTime, duration));
		const end = Math.max(start + 0.1, Math.min(layer.endTime, duration));
		const layerDuration = end - start;

		// Build per-overlay filter chain
		const imgFilters: string[] = ['format=rgba'];

		// Apply scale if not 1.0 (scale relative to main video width)
		const layerScale = layer.scale ?? 1;
		if (layerScale !== 1) {
			imgFilters.push(`scale=iw*${layerScale}:ih*${layerScale}`);
		}

		// Only apply fade to animated overlays (GIF/video)
		// Static images with -loop 1 have timing issues with fade filters
		if (isAnimated) {
			if (layer.fadeIn) {
				imgFilters.push(`fade=in:st=0:d=${Math.min(FADE_DURATION, layerDuration / 2)}:alpha=1`);
			}
			if (layer.fadeOut) {
				const fadeOutStart = Math.max(0, layerDuration - Math.min(FADE_DURATION, layerDuration / 2));
				imgFilters.push(`fade=out:st=${fadeOutStart}:d=${Math.min(FADE_DURATION, layerDuration / 2)}:alpha=1`);
			}
		}

		filterParts.push(`[${inputIdx}:v]${imgFilters.join(',')}[${imgLabel}]`);

		// Position expression using normalized coordinates
		// x,y represent the center of the overlay
		const posX = `${layer.x}*main_w-overlay_w/2`;
		const posY = `${layer.y}*main_h-overlay_h/2`;
		const enable = `between(t,${start},${end})`;

		// For animated overlays (GIF/video), use eof_action=pass so the base
		// video continues after the overlay ends
		const overlayOpts = isAnimated
			? `${posX}:${posY}:enable='${enable}':eof_action=pass`
			: `${posX}:${posY}:enable='${enable}'`;

		if (outLabel) {
			filterParts.push(`[${lastLabel}][${imgLabel}]overlay=${overlayOpts}[${outLabel}]`);
			lastLabel = outLabel;
		} else {
			filterParts.push(`[${lastLabel}][${imgLabel}]overlay=${overlayOpts}`);
		}
	}

	const filterComplex = filterParts.join(';\n');
	logToFile(`Overlay: filter_complex =\n${filterComplex}`);

	// Generate output path
	const output = getOutputPath(input, '_overlay');

	// Use executeFFmpegRaw to control per-input options
	const ffmpegArgs = [
		'-y',
		...inputArgs,
		'-filter_complex',
		filterComplex,
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'23',
		'-c:a',
		'copy',
		'-shortest',
		output,
	];

	await executeFFmpegRaw(ffmpegArgs);

	logToFile(`Overlay: Output saved to ${output}`);
	return output;
}
