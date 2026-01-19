/**
 * Caption Tool - Add karaoke-style captions to video
 * Uses ASS subtitle format for word-by-word highlighting
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { logToFile } from '../lib/logger.js';

export interface CaptionOptions {
	input: string;
	srtContent: string;
	fontSize?: number;
	fontName?: string;
	position?: 'bottom' | 'center' | 'top';
}

interface SrtEntry {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
}

/**
 * Parse time string "00:00:00,000" to seconds
 */
function parseSrtTime(timeStr: string): number {
	const [time, ms] = timeStr.split(',');
	const [hours, minutes, seconds] = time.split(':').map(Number);
	return hours * 3600 + minutes * 60 + seconds + parseInt(ms) / 1000;
}

/**
 * Format seconds to ASS time format "H:MM:SS.cc"
 */
function toAssTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const cs = Math.floor((seconds % 1) * 100);
	return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

/**
 * Parse SRT content into structured entries
 */
function parseSrt(content: string): SrtEntry[] {
	const entries: SrtEntry[] = [];
	const blocks = content.trim().split(/\n\n+/);

	for (const block of blocks) {
		const lines = block.split('\n').map((l) => l.trim());
		if (lines.length < 3) continue;

		const index = parseInt(lines[0]);
		if (isNaN(index)) continue;

		const timeParts = lines[1].split(' --> ');
		if (timeParts.length !== 2) continue;

		const startTime = parseSrtTime(timeParts[0].trim());
		const endTime = parseSrtTime(timeParts[1].trim());
		const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, ''); // Strip HTML tags

		entries.push({ index, startTime, endTime, text });
	}

	return entries;
}

/**
 * Generate ASS subtitle content with karaoke styling
 */
function generateAssContent(
	entries: SrtEntry[],
	videoWidth: number,
	videoHeight: number,
	fontSize: number,
	fontName: string,
	position: string,
): string {
	// Calculate vertical position based on setting
	let marginV = 50;
	let alignment = 2; // Bottom center
	if (position === 'center') {
		alignment = 5; // Middle center
		marginV = 0;
	} else if (position === 'top') {
		alignment = 8; // Top center
		marginV = 50;
	}

	// ASS header with modern karaoke style
	// Primary: White, Secondary: Yellow (for highlights), Outline: Dark gray, Shadow: Black
	const header = `[Script Info]
Title: VidLet Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},&H00FFFFFF,&H0000FFFF,&H00404040,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,${alignment},40,40,${marginV},1
Style: Highlight,${fontName},${fontSize},&H0000FFFF,&H0000FFFF,&H00404040,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

	const dialogueLines: string[] = [];

	for (const entry of entries) {
		const start = toAssTime(entry.startTime);
		const end = toAssTime(entry.endTime);
		const words = entry.text.split(/\s+/).filter((w) => w.length > 0);

		if (words.length === 0) continue;

		// Calculate duration per word for karaoke effect
		const duration = entry.endTime - entry.startTime;
		const wordDuration = (duration / words.length) * 100; // In centiseconds

		// Build karaoke text with \k tags
		// Format: {\k<duration>}word - duration is in centiseconds
		let karaokeText = '';
		for (let i = 0; i < words.length; i++) {
			const kDur = Math.round(wordDuration);
			// Use \kf for fill effect (smooth highlight)
			karaokeText += `{\\kf${kDur}}${words[i]} `;
		}

		dialogueLines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${karaokeText.trim()}`);
	}

	return header + dialogueLines.join('\n');
}

/**
 * Default test subtitle content
 */
export const DEFAULT_SRT = `1
00:00:00,500 --> 00:00:03,000
This is a sample caption

2
00:00:03,500 --> 00:00:06,500
With karaoke style highlighting

3
00:00:07,000 --> 00:00:10,000
Words light up as they play
`;

/**
 * Add captions to video with karaoke styling
 */
export async function caption(opts: CaptionOptions): Promise<string> {
	const { input, srtContent, fontSize = 48, fontName = 'Arial Black', position = 'bottom' } = opts;

	logToFile(`Caption: Processing ${input}`);

	// Get video info for resolution
	const videoInfo = await getVideoInfo(input);

	// Parse SRT content
	const entries = parseSrt(srtContent);
	if (entries.length === 0) {
		throw new Error('No valid subtitle entries found');
	}

	logToFile(`Caption: Parsed ${entries.length} subtitle entries`);

	// Generate ASS content
	const assContent = generateAssContent(entries, videoInfo.width, videoInfo.height, fontSize, fontName, position);

	// Write ASS to temp file
	const tempAss = path.join(os.tmpdir(), `vidlet_caption_${Date.now()}.ass`);
	fs.writeFileSync(tempAss, assContent, 'utf-8');
	logToFile(`Caption: Created ASS file at ${tempAss}`);

	// Generate output path
	const ext = path.extname(input);
	const base = path.basename(input, ext);
	const dir = path.dirname(input);
	const output = path.join(dir, `${base}_captioned${ext}`);

	// Build FFmpeg command to burn subtitles
	// Escape special characters in path for FFmpeg filter
	const escapedAss = tempAss.replace(/\\/g, '/').replace(/:/g, '\\:');

	await executeFFmpeg({
		input,
		output,
		args: [
			'-vf',
			`ass='${escapedAss}'`,
			'-c:a',
			'copy',
			'-preset',
			'fast',
		],
	});

	// Clean up temp file
	try {
		fs.unlinkSync(tempAss);
	} catch {
		// Ignore cleanup errors
	}

	logToFile(`Caption: Output saved to ${output}`);
	return output;
}
