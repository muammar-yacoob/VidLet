/**
 * Pure planning logic for the AutoShort pipeline - input classification,
 * pause/retake maths and caption timing. No ffmpeg, no filesystem: split
 * from tools/autoshort.ts for the 500-line cap and so every decision here
 * is unit-testable without rendering anything.
 */
import type { TimeSegment } from './segments.js';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.gif']);
const SUBTITLE_EXTS = new Set(['.srt', '.vtt']);
const TEXT_EXTS = new Set(['.txt', '.md']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

export interface ClassifiedInputs {
  videos: string[];
  subtitlePath?: string;
  narrationPath?: string;
  musicPath?: string;
  ignored: string[];
}

/** Sort a mixed attachment list into roles by extension. Order is preserved. */
export function classifyInputs(paths: string[]): ClassifiedInputs {
  const out: ClassifiedInputs = { videos: [], ignored: [] };
  for (const p of paths) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    if (VIDEO_EXTS.has(ext)) out.videos.push(p);
    else if (SUBTITLE_EXTS.has(ext)) out.subtitlePath ??= p;
    else if (TEXT_EXTS.has(ext)) out.narrationPath ??= p;
    else if (AUDIO_EXTS.has(ext)) out.musicPath ??= p;
    else out.ignored.push(p);
  }
  return out;
}

/** Strip .srt/.vtt down to its spoken text. */
export function subtitleToText(content: string): string {
  return content
    .replace(/^WEBVTT.*$/m, '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !/^\d+$/.test(t) && !t.includes('-->');
    })
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Speed multiplier that lands the kept footage inside the ceiling. */
export function speedFor(keptSeconds: number, maxSeconds: number): number {
  if (keptSeconds <= maxSeconds) return 1;
  return Math.min(60, keptSeconds / maxSeconds);
}

const tokenSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

function overlapSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits += 1;
  return hits / Math.min(a.size, b.size);
}

export interface SpokenSpan extends TimeSegment {
  text: string;
}

/**
 * Collapse retakes: spans whose transcripts substantially overlap are the
 * same step recorded more than once - keep the longest unique take. Spans
 * with too little text to judge always survive.
 */
export function dedupeRetakes(spans: SpokenSpan[], threshold = 0.55): SpokenSpan[] {
  const kept: SpokenSpan[] = [];
  for (const span of spans) {
    const tokens = tokenSet(span.text);
    const twin =
      tokens.size >= 4
        ? kept.findIndex((k) => overlapSimilarity(tokens, tokenSet(k.text)) >= threshold)
        : -1;
    if (twin === -1) {
      kept.push(span);
    } else if (span.end - span.start > kept[twin].end - kept[twin].start) {
      kept[twin] = span;
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Attach transcript text to each kept span by timestamp overlap. */
export function spansWithText(
  spans: TimeSegment[],
  transcript: Array<{ start: number; end: number; text: string }>
): SpokenSpan[] {
  return spans.map((s) => ({
    ...s,
    text: transcript
      .filter((seg) => seg.start < s.end && seg.end > s.start)
      .map((seg) => seg.text)
      .join(' ')
      .trim(),
  }));
}

/** Proportional SRT: split the script across the runtime by sentence length. */
export function scriptToSrt(script: string, durationSeconds: number): string {
  const sentences = script.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()) ?? [script];
  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
  const stamp = (t: number): string => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  let t = 0;
  return sentences
    .map((sentence, i) => {
      const len = (sentence.length / totalChars) * durationSeconds;
      const entry = `${i + 1}\n${stamp(t)} --> ${stamp(Math.min(t + len, durationSeconds))}\n${sentence}\n`;
      t += len;
      return entry;
    })
    .join('\n');
}

/**
 * Words that remain once whisper's non-speech markers ([BLANK_AUDIO],
 * [Music], (soft piano)...) are stripped. Constant background hum passes a
 * volume check but transcribes to nothing - THIS is the honest voice test.
 */
export function realSpeechWords(text: string): number {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

/**
 * A filesystem-safe, human-readable slug for the finished video.
 * "Rigging a low-poly duck in Blender!" -> "rigging-a-low-poly-duck-in-blender"
 * Timestamped source names tell you nothing about the content; this does.
 */
export function slugifyTitle(title: string, maxChars = 48): string {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  const parts: string[] = [];
  let width = 0;
  for (const word of words) {
    const added = parts.length === 0 ? word.length : width + 1 + word.length;
    if (parts.length > 0 && added > maxChars) break;
    parts.push(word);
    width = added;
  }
  // A filename must stay bounded even when the first word alone blows the
  // budget, so the join is truncated rather than trusted.
  if (parts.length === 0) return words[0]?.slice(0, maxChars) ?? 'short';
  return parts.join('-').slice(0, maxChars).replace(/-+$/, '');
}

/** First sentence of a script, as a fallback title when no AI title exists. */
export function titleFromScript(script: string): string {
  const first = script.match(/[^.!?]+/)?.[0]?.trim() ?? script.trim();
  return first || 'short';
}

/** One spoken sentence, placed on the output timeline. */
export interface NarrationBeat {
  text: string;
  /** Seconds into the output where this line starts. */
  start: number;
  /** Measured duration of the synthesised audio. */
  duration: number;
}

/** Split a script into speakable sentences, keeping their punctuation. */
export function splitSentences(script: string): string[] {
  return (script.match(/[^.!?]+[.!?]*/g) ?? [script])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Place each spoken line on the output timeline, snapping to cuts.
 *
 * A single continuous voice track over a heavily-cut timelapse sounds
 * detached from the picture: the words keep going while the footage jumps
 * somewhere else. Starting each line ON a cut ties the two together, and
 * the gaps between lines fall where the video changes anyway.
 *
 * `boundaries` are the output-time positions where kept spans meet. A line
 * is snapped to the nearest boundary at or after the earliest point it
 * could start, but never so far that the narration overruns the video, and
 * never before the previous line has finished.
 */
export function planNarrationBeats(
  sentences: Array<{ text: string; duration: number }>,
  boundaries: number[],
  outputDuration: number,
  leadIn: number,
  gap = 0.18
): NarrationBeat[] {
  const beats: NarrationBeat[] = [];
  const sorted = [...boundaries].sort((a, b) => a - b);
  const totalSpeech = sentences.reduce((n, s) => n + s.duration, 0);

  // Spread whatever time is left over evenly between lines, then let each
  // line drift forward to the next cut if one is close enough to be worth
  // snapping to.
  const slack = Math.max(0, outputDuration - leadIn - totalSpeech);
  const perGap = sentences.length > 1 ? slack / (sentences.length - 1) : 0;

  let cursor = leadIn;
  for (let i = 0; i < sentences.length; i++) {
    const { text, duration } = sentences[i];
    const idealStart = cursor;
    // Only snap forward, and only within the slack this line was allotted;
    // snapping further would push the tail of the script off the end.
    const reach = idealStart + Math.min(perGap, 1.5);
    const snapped = sorted.find((b) => b >= idealStart && b <= reach);
    let start = snapped ?? idealStart;
    const prev = beats[beats.length - 1];
    const prevEnd = prev ? prev.start + prev.duration : 0;
    if (prev) start = Math.max(start, prevEnd + gap);
    // Never let a line run past the picture. Clamping AFTER the gap is what
    // keeps a tight script inside the video: the breathing space collapses
    // first, and only then does the line move.
    start = Math.min(start, Math.max(0, outputDuration - duration));
    // Collapsing the gap must never turn into an overlap.
    if (prev) start = Math.max(start, prevEnd);
    beats.push({ text, start, duration });
    cursor = start + duration + perGap;
  }
  return beats;
}

/** A word with its position on the output timeline. */
export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Time the words of a spoken line without transcribing it.
 *
 * For TTS we already know the exact text and have measured the audio, so
 * running speech recognition over our own synthesised speech is pure waste:
 * it costs a whisper pass per render AND it gets words wrong, turning a
 * script that opened "Been working on..." into a caption reading "I've
 * been...". Each line is short and independently anchored to its own
 * measured duration, so proportional distribution cannot drift.
 *
 * Longer words take longer to say, and punctuation buys a beat of silence,
 * which is what the extra weight encodes.
 */
export function timeWordsInLine(text: string, start: number, duration: number): TimedWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Trailing punctuation is a pause, not a syllable.
  const weightOf = (w: string): number => {
    const bare = w.replace(/[^\p{L}\p{N}']/gu, '');
    const pause = /[,;:]$/.test(w) ? 1.5 : /[.!?]$/.test(w) ? 2.5 : 0;
    return Math.max(1, bare.length) + pause;
  };

  const weights = words.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);

  const timed: TimedWord[] = [];
  let cursor = start;
  for (let i = 0; i < words.length; i++) {
    const span = (weights[i] / total) * duration;
    timed.push({ word: words[i], start: cursor, end: cursor + span });
    cursor += span;
  }
  // Absorb rounding into the last word so the line ends exactly on time.
  if (timed.length > 0) timed[timed.length - 1].end = start + duration;
  return timed;
}
