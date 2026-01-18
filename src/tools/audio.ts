import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface AudioOptions {
	input: string;
	audio: string;
	output?: string;
	volume?: number; // 0-1, audio track volume
	mix?: boolean; // Mix with original audio or replace
}

/**
 * Add background audio to video
 */
export async function addAudio(options: AudioOptions): Promise<string> {
	const { input, audio, output: customOutput, volume = 0.5, mix = true } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg.');
	}

	const info = await getVideoInfo(input);
	const output = customOutput ?? getOutputPath(input, '_audio');

	header('Add Audio');
	console.log(`Video:    ${fmt.white(input)}`);
	console.log(`Audio:    ${fmt.white(audio)}`);
	console.log(`Volume:   ${fmt.yellow((volume * 100).toFixed(0) + '%')}`);
	console.log(`Mode:     ${fmt.yellow(mix ? 'Mix with original' : 'Replace audio')}`);
	separator();
	console.log(fmt.dim('Processing...'));

	let filterComplex: string;
	let maps: string[];

	if (mix && info.hasAudio) {
		// Mix original audio with new audio
		filterComplex = `[0:a]volume=1[a0];[1:a]volume=${volume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`;
		maps = ['-map', '0:v', '-map', '[a]'];
	} else {
		// Replace audio or no original audio
		filterComplex = `[1:a]volume=${volume}[a]`;
		maps = ['-map', '0:v', '-map', '[a]'];
	}

	const args = [
		'-i',
		audio,
		'-filter_complex',
		filterComplex,
		...maps,
		'-c:v',
		'copy',
		'-c:a',
		'aac',
		'-b:a',
		'192k',
		'-shortest',
		'-movflags',
		'+faststart',
	];

	await executeFFmpeg({ input, output, args });

	success(`Output: ${output}`);

	return output;
}
