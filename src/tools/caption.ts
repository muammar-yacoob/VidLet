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

export type CaptionStyle = 'classic' | 'hormozi' | 'karaoke' | 'minimal' | 'shorts';
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
  /** 'shorts' only: characters per line before wrapping to a new cue. */
  maxChars?: number;
  highlightColor?: string; // User-friendly name: 'yellow', 'cyan', 'red', 'green', 'white'
  fontSize?: number;
  fontName?: string;
  position?: CaptionPosition;
  // Progress callback (used by GUI)
  onProgress?: (stage: string) => void;
}

export interface SrtEntry {
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
    if (Number.isNaN(index)) continue;

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
export function segmentsToEntries(segments: TranscriptSegment[]): SrtEntry[] {
  return segments.map((seg, i) => ({
    index: i + 1,
    startTime: seg.start,
    endTime: seg.end,
    text: seg.text,
    words: seg.words,
  }));
}

// ============ ASS GENERATION ============

/** Uppercase reads as the current Shorts/Reels/TikTok convention. */
export function toCaptionCase(text: string, upper: boolean): string {
  return upper ? text.toUpperCase() : text;
}

export interface AssContext {
  entries: SrtEntry[];
  videoWidth: number;
  videoHeight: number;
  fontSize: number;
  fontName: string;
  position: CaptionPosition;
  highlightColor: string; // ASS BGR format
  maxChars: number;
  /** Uppercase the burned text. Default true for the shorts style. */
  uppercase?: boolean;
}

/** Requested line budget for 'shorts'; narrowed to whatever actually fits. */
export const SHORTS_MAX_CHARS = 28;

/**
 * Average glyph advance as a fraction of font size for a heavy display face
 * (Arial Black / DejaVu Bold). Measured from rendered output rather than
 * font metrics - close enough to keep a line inside the frame.
 */
const GLYPH_WIDTH_RATIO = 0.62;
/** Caps have no descender-narrow letters, so they run wider per character. */
const UPPERCASE_WIDTH_FACTOR = 1.12;

/** Estimated on-screen pixel width of a line at this font size. */
export function estimateTextWidth(text: string, fontSize: number, uppercase = false): number {
  const ratio = GLYPH_WIDTH_RATIO * (uppercase ? UPPERCASE_WIDTH_FACTOR : 1);
  return text.length * fontSize * ratio;
}

/**
 * Uniform scale (as an ASS \\fscx/\\fscy percentage) that shrinks a line
 * just enough to fit `usableWidth`, or 100 when it already fits.
 *
 * This is the "flex to fit" half of keeping a URL or email on one line:
 * chunkWordsToLines never splits a single whitespace-delimited token, so a
 * long domain is already guaranteed to land whole on one Dialogue line -
 * but a domain wider than the frame would otherwise render clipped or push
 * past the edge. Shrinking beats wrapping: a URL split across two lines
 * reads as broken, a slightly smaller URL still reads as one thing.
 */
export function scaleToFit(
  text: string,
  fontSize: number,
  usableWidth: number,
  uppercase = false
): number {
  const width = estimateTextWidth(text, fontSize, uppercase);
  if (width <= usableWidth) return 100;
  const pct = Math.floor((usableWidth / width) * 100);
  return Math.max(40, Math.min(100, pct));
}

/**
 * Matches a bare URL or email, the way a narration script or subtitle
 * would actually contain one. Not used to gate any rendering behaviour -
 * chunkWordsToLines already treats every whitespace-delimited token as
 * atomic, URLs and ordinary words alike - it exists so a test can pin the
 * exact class of token this guarantee is about, and prove the render path
 * (uppercasing, chunking, scaling) never rewrites the '@' or '.' inside it.
 */
const URL_OR_EMAIL_RE =
  /^(?:[\w.+-]+@[\w-]+\.[\w.-]+|(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)$/i;

export function isUrlOrEmail(word: string): boolean {
  const bare = word.replace(/[.,!?;:]+$/, '');
  return /\.[a-z]{2,}/i.test(bare) && URL_OR_EMAIL_RE.test(bare);
}

/**
 * Characters that actually fit one line at this width and size. Without
 * this a nominally "28 char" line renders wider than the frame and gets
 * clipped at both edges.
 */
export function fittingMaxChars(
  videoWidth: number,
  fontSize: number,
  sideMargin: number,
  requested: number,
  uppercase = false
): number {
  const usable = Math.max(1, videoWidth - sideMargin * 2);
  const ratio = GLYPH_WIDTH_RATIO * (uppercase ? UPPERCASE_WIDTH_FACTOR : 1);
  const fits = Math.floor(usable / (fontSize * ratio));
  return Math.max(8, Math.min(requested, fits));
}

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

/**
 * whisper emits punctuation, and contraction tails like "'s", as their own
 * timed tokens - which render as a lone comma in its own highlight, or
 * "it 's". Glue both onto the previous word, extending its timing.
 */
export function mergePunctuationTokens(words: CaptionWord[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const w of words) {
    const isPunctOnly = /^[\p{P}\p{S}]+$/u.test(w.word);
    const isContractionTail = /^['\u2019]\p{L}{1,2}$/u.test(w.word);
    if ((isPunctOnly || isContractionTail) && out.length > 0) {
      const prev = out[out.length - 1];
      out[out.length - 1] = { word: prev.word + w.word, start: prev.start, end: w.end };
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * Pack words into single lines of at most maxChars, so only ONE short line
 * is ever on screen. A word longer than the budget gets its own line rather
 * than being dropped or split.
 */
export function chunkWordsToLines(words: CaptionWord[], maxChars: number): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  let width = 0;
  for (const w of words) {
    const added = current.length === 0 ? w.word.length : width + 1 + w.word.length;
    if (current.length > 0 && added > maxChars) {
      lines.push(current);
      current = [w];
      width = w.word.length;
    } else {
      current.push(w);
      width = added;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
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

/**
 * Shorts style: the modern IG/TikTok caption - one short line at a time,
 * big bold white, with only the word being spoken turned yellow.
 *
 * Built as one Dialogue event per word (whole line redrawn, current word
 * recoloured) rather than ASS \\k karaoke: \\k paints every already-sung word
 * in the highlight colour, which ends up as a wall of yellow. Per-word
 * events keep exactly one word lit.
 */
export function generateShortsAss(ctx: AssContext): string {
  const { videoHeight, highlightColor } = ctx;
  // "Arial Black" is not installed on Linux and fontconfig silently fell
  // back to Noto Sans Regular, so the weight was synthesised. DejaVu Sans
  // ships a real Bold face on every distro this runs on.
  const fontName = ctx.fontName === 'Arial Black' ? 'DejaVu Sans' : ctx.fontName;
  // Big: roughly a sixteenth of frame height is the IG/CapCut proportion.
  // height/14 fitted only ~10 characters on a 720-wide canvas, which reads
  // as one word a line. height/20 keeps it clearly a Shorts caption while
  // fitting a readable phrase.
  const fontSize = Math.max(ctx.fontSize, Math.round(videoHeight / 20));
  // Lower third, not the very bottom: at 0.16 the line sat down in the
  // letterbox bar where it reads as an afterthought.
  const marginV = Math.round(videoHeight * 0.24);
  const sideMargin = 40;
  // fontSize/12 was a heavy slab that closed up the counters at this size.
  const outline = Math.max(2, Math.round(fontSize / 22));
  const upper = ctx.uppercase !== false;
  const caseOf = (t: string): string => toCaptionCase(t, upper);
  // Caps are wider than mixed case, so the budget is measured on what will
  // actually be drawn.
  const maxChars = fittingMaxChars(ctx.videoWidth, fontSize, sideMargin, ctx.maxChars, upper);

  const header = `[Script Info]
Title: VidLet Captions
ScriptType: v4.00+
PlayResX: ${ctx.videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Shorts,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${outline},2,2,${sideMargin},${sideMargin},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (const entry of ctx.entries) {
    const raw = entry.words ?? distributeWords(entry.text, entry.startTime, entry.endTime);
    const words = mergePunctuationTokens(raw);
    if (words.length === 0) continue;

    for (const lineWords of chunkWordsToLines(words, maxChars)) {
      // A single long token - a URL or email is the common case - can be
      // atomic (chunkWordsToLines never splits one) yet still wider than
      // the frame. Scale the whole line down rather than let it wrap or
      // clip: one smaller line reads better than a URL torn in half.
      const plain = lineWords.map((w) => caseOf(w.word)).join(' ');
      const scale = scaleToFit(plain, fontSize, ctx.videoWidth - sideMargin * 2, upper);
      const scaleTag = scale < 100 ? `{\\fscx${scale}\\fscy${scale}}` : '';
      for (let i = 0; i < lineWords.length; i++) {
        const text = lineWords
          .map((w, j) =>
            j === i ? `{\\c${highlightColor}}${caseOf(w.word)}{\\c&HFFFFFF&}` : caseOf(w.word)
          )
          .join(' ');
        // Hold the last word until the line's end so the line never flickers
        // out early between cues.
        const end = i === lineWords.length - 1 ? lineWords[i].end : lineWords[i + 1].start;
        lines.push(
          `Dialogue: 0,${toAssTime(lineWords[i].start)},${toAssTime(end)},Shorts,,0,0,0,,${scaleTag}${text}`
        );
      }
    }
  }

  return header + lines.join('\n');
}

// ============ STYLE DISPATCH ============

const STYLE_GENERATORS: Record<CaptionStyle, (ctx: AssContext) => string> = {
  classic: generateClassicAss,
  hormozi: generateHormoziAss,
  karaoke: generateKaraokeAss,
  minimal: generateMinimalAss,
  shorts: generateShortsAss,
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
    maxChars = SHORTS_MAX_CHARS,
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
    maxChars,
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
