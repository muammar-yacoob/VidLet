import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkFFmpeg, executeFFmpeg, getVideoInfo, executeFFmpegRaw } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface PortraitSegment {
	id: string;
	startTime: number;
	endTime: number;
	cropX: number; // 0-1, horizontal crop position
}

export interface PortraitOptions {
	input: string;
	output?: string;
	mode: 'crop' | 'blur';
	cropX?: number; // 0-1, horizontal crop position (0=left, 0.5=center, 1=right)
	resolution?: number; // Output width (height calculated for 9:16)
}

/**
 * Convert landscape (16:9) video to portrait (9:16)
 */
export async function portrait(options: PortraitOptions): Promise<string> {
	const { input, output: customOutput, mode = 'crop', cropX = 0.5, resolution = 1080 } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
	}

	const info = await getVideoInfo(input);

	// Calculate output dimensions (9:16 aspect ratio)
	const outWidth = resolution;
	const outHeight = Math.round((resolution * 16) / 9);

	const output = customOutput ?? getOutputPath(input, '_portrait');

	const cropPos = cropX < 0.33 ? 'left' : cropX > 0.66 ? 'right' : 'center';

	header('Create Portrait');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Size:     ${fmt.white(`${info.width}x${info.height}`)}`);
	console.log(`Output:   ${fmt.yellow(`${outWidth}x${outHeight}`)} (9:16)`);
	console.log(`Mode:     ${fmt.yellow(mode === 'blur' ? 'Blur Background' : `Crop (${cropPos})`)}`);
	separator();
	console.log(fmt.dim('Processing...'));

	let filterComplex: string;

	if (mode === 'blur') {
		// Blur background mode:
		// 1. Scale and blur the video to fill 9:16
		// 2. Overlay the original video centered
		const blurScale = `scale=${outWidth}:${outHeight}:force_original_aspect_ratio=increase,crop=${outWidth}:${outHeight},boxblur=20:5`;
		const overlayScale = `scale=-1:${outHeight * 0.6}:force_original_aspect_ratio=decrease`;

		filterComplex = `[0:v]${blurScale}[bg];[0:v]${overlayScale}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p`;
	} else {
		// Crop mode: Extract 9:16 portion from the video
		// cropX is 0-1, convert to FFmpeg expression
		// After scaling, the crop x position is: cropX * (scaled_width - output_width)
		const cropExpr = `${cropX}*(in_w-out_w)`;

		// Scale to target height first, then crop width
		filterComplex = `scale=-1:${outHeight},crop=${outWidth}:${outHeight}:${cropExpr}:0,format=yuv420p`;
	}

	const args = [
		'-vf',
		filterComplex,
		'-c:v',
		'libx264',
		'-preset',
		'medium',
		'-crf',
		'18',
		'-c:a',
		'aac',
		'-b:a',
		'192k',
		'-movflags',
		'+faststart',
	];

	await executeFFmpeg({ input, output, args });

	success(`Output: ${output}`);

	return output;
}

export type TransitionType = 'none' | 'fade' | 'dissolve';

export interface PortraitMultiSegmentOptions {
	input: string;
	output?: string;
	segments: PortraitSegment[];
	resolution?: number;
	transition?: TransitionType;
	transitionDuration?: number; // in seconds, default 0.3
}

/**
 * Convert landscape video to portrait with multiple segments having different crop positions
 */
export async function portraitMultiSegment(options: PortraitMultiSegmentOptions): Promise<string> {
	const { input, output: customOutput, segments, resolution = 1080, transition = 'none', transitionDuration = 0.3 } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
	}

	if (!segments || segments.length === 0) {
		throw new Error('No segments provided');
	}

	// If only one segment, use the simpler portrait function
	if (segments.length === 1) {
		return portrait({
			input,
			output: customOutput,
			mode: 'crop',
			cropX: segments[0].cropX,
			resolution,
		});
	}

	const info = await getVideoInfo(input);

	// Calculate output dimensions (9:16 aspect ratio)
	const outWidth = resolution;
	const outHeight = Math.round((resolution * 16) / 9);

	const output = customOutput ?? getOutputPath(input, '_portrait');

	const useTransitions = transition !== 'none' && segments.length > 1;
	const td = transitionDuration;

	header('Create Portrait (Multi-Segment)');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Size:     ${fmt.white(`${info.width}x${info.height}`)}`);
	console.log(`Output:   ${fmt.yellow(`${outWidth}x${outHeight}`)} (9:16)`);
	console.log(`Segments: ${fmt.yellow(String(segments.length))}`);
	if (useTransitions) {
		console.log(`Transition: ${fmt.yellow(transition)} (${td}s)`);
	}
	separator();
	console.log(fmt.dim('Processing segments...'));

	// Create temp directory for segments
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidlet-portrait-'));
	const segmentFiles: string[] = [];
	const segmentDurations: number[] = [];

	try {
		// Process each segment
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const duration = seg.endTime - seg.startTime;
			const segmentFile = path.join(tempDir, `segment_${i}.mp4`);
			segmentFiles.push(segmentFile);
			segmentDurations.push(duration);

			console.log(fmt.dim(`  Segment ${i + 1}/${segments.length}: ${seg.startTime.toFixed(2)}s - ${seg.endTime.toFixed(2)}s (crop: ${(seg.cropX * 100).toFixed(0)}%)`));

			const cropExpr = `${seg.cropX}*(in_w-out_w)`;
			const filterComplex = `scale=-1:${outHeight},crop=${outWidth}:${outHeight}:${cropExpr}:0,format=yuv420p`;

			const args = [
				'-ss',
				seg.startTime.toString(),
				'-t',
				duration.toString(),
				'-i',
				input,
				'-vf',
				filterComplex,
				'-c:v',
				'libx264',
				'-preset',
				'medium',
				'-crf',
				'18',
				'-c:a',
				'aac',
				'-b:a',
				'192k',
				'-movflags',
				'+faststart',
				'-y',
				segmentFile,
			];

			await executeFFmpegRaw(args);
		}

		if (useTransitions) {
			// Use xfade filter for transitions
			console.log(fmt.dim(`Applying ${transition} transitions...`));

			// Build input args
			const inputArgs: string[] = [];
			for (const f of segmentFiles) {
				inputArgs.push('-i', f);
			}

			// Build xfade filter chain for video
			// [0:v][1:v]xfade=transition=fade:duration=0.3:offset=D0-0.3[v01];
			// [v01][2:v]xfade=transition=fade:duration=0.3:offset=D0+D1-0.6[v02]; ...
			const videoFilters: string[] = [];
			const audioFilters: string[] = [];
			let cumulativeDuration = 0;
			let cumulativeTransitions = 0;

			for (let i = 0; i < segmentFiles.length - 1; i++) {
				cumulativeDuration += segmentDurations[i];
				const offset = Math.max(0, cumulativeDuration - td - cumulativeTransitions);
				cumulativeTransitions += td;

				const inputLabel = i === 0 ? `[${i}:v]` : `[v${i - 1}${i}]`;
				const outputLabel = i === segmentFiles.length - 2 ? '[outv]' : `[v${i}${i + 1}]`;

				videoFilters.push(`${inputLabel}[${i + 1}:v]xfade=transition=${transition}:duration=${td}:offset=${offset.toFixed(3)}${outputLabel}`);

				// Audio crossfade
				const audioInputLabel = i === 0 ? `[${i}:a]` : `[a${i - 1}${i}]`;
				const audioOutputLabel = i === segmentFiles.length - 2 ? '[outa]' : `[a${i}${i + 1}]`;
				audioFilters.push(`${audioInputLabel}[${i + 1}:a]acrossfade=d=${td}${audioOutputLabel}`);
			}

			const filterComplex = [...videoFilters, ...audioFilters].join(';');

			const xfadeArgs = [
				...inputArgs,
				'-filter_complex',
				filterComplex,
				'-map',
				'[outv]',
				'-map',
				'[outa]',
				'-c:v',
				'libx264',
				'-preset',
				'medium',
				'-crf',
				'18',
				'-c:a',
				'aac',
				'-b:a',
				'192k',
				'-movflags',
				'+faststart',
				'-y',
				output,
			];

			await executeFFmpegRaw(xfadeArgs);
		} else {
			// No transitions - use concat demuxer (faster, no re-encoding)
			const concatFile = path.join(tempDir, 'concat.txt');
			const concatContent = segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
			fs.writeFileSync(concatFile, concatContent);

			console.log(fmt.dim('Concatenating segments...'));

			const concatArgs = ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-movflags', '+faststart', '-y', output];

			await executeFFmpegRaw(concatArgs);
		}

		success(`Output: ${output}`);
		return output;
	} finally {
		// Cleanup temp files
		try {
			for (const f of segmentFiles) {
				if (fs.existsSync(f)) fs.unlinkSync(f);
			}
			if (fs.existsSync(path.join(tempDir, 'concat.txt'))) {
				fs.unlinkSync(path.join(tempDir, 'concat.txt'));
			}
			fs.rmdirSync(tempDir);
		} catch {
			// Ignore cleanup errors
		}
	}
}
