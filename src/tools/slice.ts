import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface SliceRegion {
	start: number;
	end: number;
}

export interface SliceOptions {
	input: string;
	output?: string;
	/** Regions to REMOVE from the video */
	cuts: SliceRegion[];
}

/**
 * Calculate segments to KEEP after removing cut regions
 */
function calculateKeepSegments(duration: number, cuts: SliceRegion[]): SliceRegion[] {
	if (cuts.length === 0) return [{ start: 0, end: duration }];

	// Sort cuts by start time
	const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);

	// Merge overlapping cuts
	const mergedCuts: SliceRegion[] = [];
	for (const cut of sortedCuts) {
		if (mergedCuts.length === 0) {
			mergedCuts.push({ ...cut });
		} else {
			const last = mergedCuts[mergedCuts.length - 1];
			if (cut.start <= last.end) {
				last.end = Math.max(last.end, cut.end);
			} else {
				mergedCuts.push({ ...cut });
			}
		}
	}

	// Calculate keep segments (inverse of cuts)
	const keepSegments: SliceRegion[] = [];
	let currentStart = 0;

	for (const cut of mergedCuts) {
		if (cut.start > currentStart) {
			keepSegments.push({ start: currentStart, end: cut.start });
		}
		currentStart = cut.end;
	}

	if (currentStart < duration) {
		keepSegments.push({ start: currentStart, end: duration });
	}

	return keepSegments;
}

/**
 * Slice video by removing specified regions and stitching remaining parts
 */
export async function slice(options: SliceOptions): Promise<string> {
	const { input, output: customOutput, cuts } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg.');
	}

	if (cuts.length === 0) {
		throw new Error('No cut regions specified');
	}

	const info = await getVideoInfo(input);
	const keepSegments = calculateKeepSegments(info.duration, cuts);

	if (keepSegments.length === 0) {
		throw new Error('Cannot remove entire video');
	}

	const output = customOutput ?? getOutputPath(input, '_sliced');
	const tempDir = path.join(os.tmpdir(), `vidlet-slice-${Date.now()}`);

	header('Slice Video');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Duration: ${fmt.white(info.duration.toFixed(1) + 's')}`);
	console.log(`Cuts:     ${fmt.yellow(cuts.length + ' region(s)')}`);
	console.log(`Keeping:  ${fmt.yellow(keepSegments.length + ' segment(s)')}`);
	separator();

	try {
		// Create temp directory
		fs.mkdirSync(tempDir, { recursive: true });

		// Extract each segment
		const segmentFiles: string[] = [];
		for (let i = 0; i < keepSegments.length; i++) {
			const seg = keepSegments[i];
			const segFile = path.join(tempDir, `seg_${i.toString().padStart(3, '0')}.mp4`);
			segmentFiles.push(segFile);

			console.log(fmt.dim(`Extracting segment ${i + 1}/${keepSegments.length}...`));

			const duration = seg.end - seg.start;
			await executeFFmpeg({
				input,
				output: segFile,
				args: ['-ss', seg.start.toString(), '-t', duration.toString(), '-c', 'copy', '-avoid_negative_ts', '1'],
			});
		}

		// Create concat file
		const concatFile = path.join(tempDir, 'concat.txt');
		const concatContent = segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
		fs.writeFileSync(concatFile, concatContent);

		// Concatenate segments
		console.log(fmt.dim('Stitching segments...'));
		await executeFFmpeg({
			input: concatFile,
			output,
			args: ['-f', 'concat', '-safe', '0', '-c', 'copy', '-movflags', '+faststart'],
		});

		success(`Output: ${output}`);
		return output;
	} finally {
		// Cleanup temp files
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}
