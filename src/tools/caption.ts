/**
 * Caption Tool - Add styled captions to video
 * Supports auto-transcription via whisper.cpp and multiple style presets.
 * Uses ASS subtitle format for word-by-word highlighting.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { logToFile } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';
import type { TranscriptSegment } from '../lib/whisper.js';

export type CaptionStyle = 'classic' | 'hormozi' | 'karaoke' | 'minimal';
export type CaptionPosition = 'bottom' | 'center' | 'top';

export interface CaptionOptions {
  input: string;
  output?: string;
  // Source: provide SRT content OR set autoTranscribe to use whisper
  srtContent?: string;
  autoTranscribe?: boolean;
  whisperModel?: 'tiny.en' | 'base.en' | 'small.en';
  // Style
  style?: CaptionStyle;
  highlightColor?: string; // User-friendly name: 'yellow', 'cyan', 'red', 'green', 'white'
  fontSize?: number;
  fontName?: string;
  position?: CaptionPosition;
  // Progress callback (used by GUI)
  onProgress?: (stage: string) => void;
}

interface SrtEntry {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

// ============ COLOR MAPPING ============

// ASS uses BGR hex: &HBBGGRR& (with optional alpha prefix &HAABBGGRR&)
const COLOR_MAP: Record<string, string> = {
  yellow: '&H00FFFF&',
  cyan: '&HFFFF00&',
  red: '&H0000FF&',
  green: '&H00FF00&',
  white: '&HFFFFFF&',
  orange: '&H0080FF&',
  pink: '&HFF00FF&',
};

function colorNameToAss(name: string): string {
  return COLOR_MAP[name.toLowerCase()] ?? COLOR_MAP.yellow;
}

// ============ SRT PARSING ============

/**
 * Parse time string "00:00:00,000" to seconds
 */
function parseSrtTime(timeStr: string): number {
  const [time, ms] = timeStr.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + Number.parseInt(ms) / 1000;
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

    const index = Number.parseInt(lines[0]);
    if (isNaN(index)) continue;

    const timeParts = lines[1].split(' --> ');
    if (timeParts.length !== 2) continue;

    const startTime = parseSrtTime(timeParts[0].trim());
    const endTime = parseSrtTime(timeParts[1].trim());
    const text = lines
      .slice(2)
      .join(' ')
      .replace(/<[^>]+>/g, ''); // Strip HTML tags

    entries.push({ index, startTime, endTime, text });
  }

  return entries;
}

/**
 * Convert whisper transcript segments to SrtEntry format
 */
function segmentsToEntries(segments: TranscriptSegment[]): SrtEntry[] {
  return segments.map((seg, i) => ({
    index: i + 1,
    startTime: seg.start,
    endTime: seg.end,
    text: seg.text,
    words: seg.words,
  }));
}

// ============ ASS GENERATION ============

interface AssContext {
  entries: SrtEntry[];
  videoWidth: number;
  videoHeight: number;
  fontSize: number;
  fontName: string;
  position: CaptionPosition;
  highlightColor: string; // ASS BGR format
}

/**
 * Build ASS header with styles appropriate for the given style preset
 */
function buildAssHeader(ctx: AssContext, style: CaptionStyle, extraStyles = ''): string {
  const { videoWidth, videoHeight, fontSize, fontName, highlightColor } = ctx;

  let marginV = 50;
  let alignment = 2; // Bottom center
  if (ctx.position === 'center') {
    alignment = 5;
    marginV = 0;
  } else if (ctx.position === 'top') {
    alignment = 8;
    marginV = 50;
  }

  // Minimal uses smaller font and different alignment
  const actualFontSize = style === 'minimal' ? Math.round(fontSize * 0.6) : fontSize;
  const actualAlignment =
    style === 'minimal'
      ? ctx.position === 'top'
        ? 7
        : ctx.position === 'center'
          ? 4
          : 1
      : alignment;

  return `[Script Info]
Title: VidLet Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${actualFontSize},&H00FFFFFF,${highlightColor},&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,${actualAlignment},40,40,${marginV},1
Style: Highlight,${fontName},${actualFontSize},${highlightColor},${highlightColor},&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,${actualAlignment},40,40,${marginV},1
${extraStyles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Classic style: White bold text with black outline, no word-by-word effects.
 * Clean, readable, standard subtitle look.
 */
function generateClassicAss(ctx: AssContext): string {
  const header = buildAssHeader(ctx, 'classic');
  const lines: string[] = [];

  for (const entry of ctx.entries) {
    const start = toAssTime(entry.startTime);
    const end = toAssTime(entry.endTime);
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${entry.text}`);
  }

  return header + lines.join('\n');
}

/**
 * Hormozi style: Word-by-word highlight with color pop.
 * Shows full sentence with current word in highlight color.
 * Base layer = all white, overlay layer = highlighted word per its time window.
 */
function generateHormoziAss(ctx: AssContext): string {
  const header = buildAssHeader(ctx, 'hormozi');
  const lines: string[] = [];

  for (const entry of ctx.entries) {
    const start = toAssTime(entry.startTime);
    const end = toAssTime(entry.endTime);
    const words = entry.words ?? distributeWords(entry.text, entry.startTime, entry.endTime);

    if (words.length === 0) continue;

    // Layer 0: Full text in white for the entire segment duration
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${entry.text}`);

    // Layer 1: Per-word highlight overlays
    for (const w of words) {
      const wStart = toAssTime(w.start);
      const wEnd = toAssTime(w.end);
      // Rebuild full text with only this word highlighted
      const highlightedText = words
        .map((other) =>
          other.word === w.word && other.start === w.start
            ? `{\\1c${ctx.highlightColor}\\b1}${other.word}{\\1c&H00FFFFFF&\\b0}`
            : other.word
        )
        .join(' ');
      lines.push(`Dialogue: 1,${wStart},${wEnd},Default,,0,0,0,,${highlightedText}`);
    }
  }

  return header + lines.join('\n');
}

/**
 * Karaoke style: Smooth fill effect using ASS \kf tags.
 * Words progressively fill with the highlight color.
 */
function generateKaraokeAss(ctx: AssContext): string {
  const header = buildAssHeader(ctx, 'karaoke');
  const lines: string[] = [];

  for (const entry of ctx.entries) {
    const start = toAssTime(entry.startTime);
    const end = toAssTime(entry.endTime);
    const words = entry.words ?? distributeWords(entry.text, entry.startTime, entry.endTime);

    if (words.length === 0) continue;

    // Build karaoke text with \kf tags (duration in centiseconds)
    let karaokeText = '';
    for (const w of words) {
      const durCs = Math.round((w.end - w.start) * 100);
      karaokeText += `{\\kf${durCs}}${w.word} `;
    }

    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${karaokeText.trim()}`);
  }

  return header + lines.join('\n');
}

/**
 * Minimal style: Small, unobtrusive text with semi-transparent background box.
 * Bottom-left aligned, thin outline.
 */
function generateMinimalAss(ctx: AssContext): string {
  const bgStyle = `Style: MinimalBg,${ctx.fontName},${Math.round(ctx.fontSize * 0.6)},&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0000000,0,0,0,0,100,100,0,0,3,0,0,1,20,20,30,1\n`;
  const header = buildAssHeader(ctx, 'minimal', bgStyle);
  const lines: string[] = [];

  for (const entry of ctx.entries) {
    const start = toAssTime(entry.startTime);
    const end = toAssTime(entry.endTime);
    // Use border style 3 (opaque box) via the MinimalBg style for background effect
    lines.push(`Dialogue: 0,${start},${end},MinimalBg,,0,0,0,,${entry.text}`);
  }

  return header + lines.join('\n');
}

/**
 * Distribute words evenly across a time range when word-level timestamps are unavailable
 */
function distributeWords(
  text: string,
  start: number,
  end: number
): Array<{ word: string; start: number; end: number }> {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const duration = end - start;
  const wordDur = duration / words.length;

  return words.map((word, i) => ({
    word,
    start: start + i * wordDur,
    end: start + (i + 1) * wordDur,
  }));
}

// ============ STYLE DISPATCH ============

const STYLE_GENERATORS: Record<CaptionStyle, (ctx: AssContext) => string> = {
  classic: generateClassicAss,
  hormozi: generateHormoziAss,
  karaoke: generateKaraokeAss,
  minimal: generateMinimalAss,
};

// ============ DEFAULT SRT ============

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

// ============ MAIN ENTRY ============

/**
 * Add captions to video with styled subtitles
 */
export async function caption(opts: CaptionOptions): Promise<string> {
  const {
    input,
    output: customOutput,
    srtContent,
    autoTranscribe = false,
    whisperModel = 'base.en',
    style = 'hormozi',
    highlightColor = 'yellow',
    fontSize = 48,
    fontName = 'Arial Black',
    position = 'bottom',
    onProgress,
  } = opts;

  const progress = onProgress ?? (() => {});

  logToFile(`Caption: Processing ${input} (style=${style}, color=${highlightColor})`);

  // Get video info for resolution
  const videoInfo = await getVideoInfo(input);

  // Resolve subtitle entries
  let entries: SrtEntry[];

  if (autoTranscribe) {
    progress('Starting transcription...');
    const { transcribe } = await import('../lib/whisper.js');
    const result = await transcribe(input, {
      model: whisperModel,
      onProgress: progress,
    });
    entries = segmentsToEntries(result.segments);
    logToFile(`Caption: Transcribed ${entries.length} segments`);
  } else if (srtContent) {
    entries = parseSrt(srtContent);
  } else {
    throw new Error('No subtitle source: provide srtContent or set autoTranscribe');
  }

  if (entries.length === 0) {
    throw new Error('No valid subtitle entries found');
  }

  logToFile(`Caption: ${entries.length} subtitle entries, generating ${style} ASS`);

  // Build ASS context
  const ctx: AssContext = {
    entries,
    videoWidth: videoInfo.width,
    videoHeight: videoInfo.height,
    fontSize,
    fontName,
    position,
    highlightColor: colorNameToAss(highlightColor),
  };

  // Generate ASS content using the selected style
  const generator = STYLE_GENERATORS[style];
  const assContent = generator(ctx);

  // Write ASS to temp file
  const tempAss = path.join(os.tmpdir(), `vidlet_caption_${Date.now()}.ass`);
  fs.writeFileSync(tempAss, assContent, 'utf-8');
  logToFile(`Caption: Created ASS file at ${tempAss}`);

  // Generate output path
  const output = customOutput ?? getOutputPath(input, '_captioned');

  // Escape special characters in path for FFmpeg filter
  const escapedAss = tempAss.replace(/\\/g, '/').replace(/:/g, '\\:');

  progress('Burning captions...');
  await executeFFmpeg({
    input,
    output,
    args: ['-vf', `ass='${escapedAss}'`, '-c:a', 'copy', '-preset', 'fast'],
  });

  // Clean up temp file
  try {
    fs.unlinkSync(tempAss);
  } catch {
    // Ignore cleanup errors
  }

  progress('Done!');
  logToFile(`Caption: Output saved to ${output}`);
  return output;
}
