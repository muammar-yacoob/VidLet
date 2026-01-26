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

export interface PortraitMultiSegmentOptions {
	input: string;
	output?: string;
	segments: PortraitSegment[];
	resolution?: number;
}

/**
 * Convert landscape video to portrait with multiple segments having different crop positions
 */
export async function portraitMultiSegment(options: PortraitMultiSegmentOptions): Promise<string> {
	const { input, output: customOutput, segments, resolution = 1080 } = options;

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

	header('Create Portrait (Multi-Segment)');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Size:     ${fmt.white(`${info.width}x${info.height}`)}`);
	console.log(`Output:   ${fmt.yellow(`${outWidth}x${outHeight}`)} (9:16)`);
	console.log(`Segments: ${fmt.yellow(String(segments.length))}`);
	separator();
	console.log(fmt.dim('Processing segments...'));

	// Create temp directory for segments
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidlet-portrait-'));
	const segmentFiles: string[] = [];

	try {
		// Process each segment
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const duration = seg.endTime - seg.startTime;
			const segmentFile = path.join(tempDir, `segment_${i}.mp4`);
			segmentFiles.push(segmentFile);

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

		// Create concat file
		const concatFile = path.join(tempDir, 'concat.txt');
		const concatContent = segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
		fs.writeFileSync(concatFile, concatContent);

		console.log(fmt.dim('Concatenating segments...'));

		// Concatenate segments
		const concatArgs = ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-movflags', '+faststart', '-y', output];

		await executeFFmpegRaw(concatArgs);

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
