import { checkFFmpeg, executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { changeExtension, getOutputPath } from '../lib/paths.js';

export interface ExtractAudioOptions {
	input: string;
	output?: string;
	format?: 'mp3' | 'aac' | 'wav' | 'flac' | 'ogg';
	bitrate?: number; // in kbps (e.g., 128, 192, 320)
}

/**
 * Extract audio from video
 */
export async function extractAudio(options: ExtractAudioOptions): Promise<string> {
	const { input, output: customOutput, format = 'mp3', bitrate = 192 } = options;

	if (!(await checkFFmpeg())) {
		throw new Error('FFmpeg not found. Please install ffmpeg.');
	}

	const info = await getVideoInfo(input);

	if (!info.hasAudio) {
		throw new Error('Video has no audio stream to extract.');
	}

	// Determine output extension based on format
	const output = customOutput ?? changeExtension(input, `.${format}`);

	header('Extract Audio');
	console.log(`Input:    ${fmt.white(input)}`);
	console.log(`Format:   ${fmt.yellow(format.toUpperCase())}`);
	console.log(`Bitrate:  ${fmt.yellow(bitrate + 'k')}`);
	separator();
	console.log(fmt.dim('Extracting audio...'));

	// Build codec and args based on format
	let codecArgs: string[];
	switch (format) {
		case 'mp3':
			codecArgs = ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
			break;
		case 'aac':
			codecArgs = ['-c:a', 'aac', '-b:a', `${bitrate}k`];
			break;
		case 'wav':
			codecArgs = ['-c:a', 'pcm_s16le']; // WAV doesn't use bitrate
			break;
		case 'flac':
			codecArgs = ['-c:a', 'flac']; // FLAC is lossless
			break;
		case 'ogg':
			codecArgs = ['-c:a', 'libvorbis', '-b:a', `${bitrate}k`];
			break;
		default:
			codecArgs = ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
	}

	const args = ['-vn', ...codecArgs];

	await executeFFmpeg({ input, output, args });

	success(`Output: ${output}`);

	return output;
}

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
