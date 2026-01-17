import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface ShortsOptions {
	input: string;
	output?: string;
	mode: 'crop' | 'blur';
	cropX?: number; // 0-1, horizontal crop position (0=left, 0.5=center, 1=right)
	resolution?: number; // Output width (height calculated for 9:16)
}

/**
 * Convert landscape (16:9) video to portrait (9:16) for shorts
 */
export async function shorts(options: ShortsOptions): Promise<string> {
	const { input, output: customOutput, mode = 'crop', cropX = 0.5, resolution = 1080 } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
	}

	const info = await getVideoInfo(input);

	// Calculate output dimensions (9:16 aspect ratio)
	const outWidth = resolution;
	const outHeight = Math.round((resolution * 16) / 9);

	const output = customOutput ?? getOutputPath(input, '_shorts');

	const cropPos = cropX < 0.33 ? 'left' : cropX > 0.66 ? 'right' : 'center';

	header('Create Shorts');
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
