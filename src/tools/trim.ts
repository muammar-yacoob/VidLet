import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface TrimOptions {
	input: string;
	output?: string;
	start: number;
	end: number;
}

/**
 * Trim video to specified start and end times
 */
export async function trim(options: TrimOptions): Promise<string> {
	const { input, output: customOutput, start, end } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
	}

	const info = await getVideoInfo(input);
	const duration = info.duration;

	// Validate times
	if (start < 0) {
		throw new Error('Start time cannot be negative');
	}
	if (end <= start) {
		throw new Error('End time must be greater than start time');
	}
	if (start >= duration) {
		throw new Error(`Start time (${start}s) exceeds video duration (${duration.toFixed(1)}s)`);
	}

	// Clamp end time to video duration
	const actualEnd = Math.min(end, duration);
	const trimDuration = actualEnd - start;

	const output = customOutput ?? getOutputPath(input, '_trimmed');

	header('Video Trim');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Duration: ${fmt.white(duration.toFixed(1))}s`);
	console.log(`Trim:     ${fmt.yellow(start.toFixed(1))}s → ${fmt.yellow(actualEnd.toFixed(1))}s`);
	console.log(`Output:   ${fmt.green(trimDuration.toFixed(1))}s`);
	separator();
	console.log(fmt.dim('Processing...'));

	// Use -ss before -i for fast seeking, then -t for duration
	// Using stream copy for speed when possible
	const args = [
		'-ss',
		start.toString(),
		'-t',
		trimDuration.toString(),
		'-c',
		'copy', // Stream copy for fast processing
		'-avoid_negative_ts',
		'make_zero', // Fix timestamp issues
	];

	await executeFFmpeg({ input, output, args });

	success(`Output: ${output}`);

	return output;
}

/**
 * Trim with re-encoding for frame-accurate cuts
 */
export async function trimAccurate(options: TrimOptions): Promise<string> {
	const { input, output: customOutput, start, end } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
	}

	const info = await getVideoInfo(input);
	const duration = info.duration;

	// Validate times
	if (start < 0) {
		throw new Error('Start time cannot be negative');
	}
	if (end <= start) {
		throw new Error('End time must be greater than start time');
	}
	if (start >= duration) {
		throw new Error(`Start time (${start}s) exceeds video duration (${duration.toFixed(1)}s)`);
	}

	const actualEnd = Math.min(end, duration);
	const trimDuration = actualEnd - start;

	const output = customOutput ?? getOutputPath(input, '_trimmed');

	header('Video Trim (Accurate)');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Duration: ${fmt.white(duration.toFixed(1))}s`);
	console.log(`Trim:     ${fmt.yellow(start.toFixed(1))}s → ${fmt.yellow(actualEnd.toFixed(1))}s`);
	console.log(`Output:   ${fmt.green(trimDuration.toFixed(1))}s`);
	separator();
	console.log(fmt.dim('Re-encoding for frame accuracy...'));

	// Re-encode for frame-accurate cuts
	const args = [
		'-ss',
		start.toString(),
		'-t',
		trimDuration.toString(),
		'-c:v',
		'libx264',
		'-preset',
		'medium',
		'-crf',
		'18', // High quality
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
