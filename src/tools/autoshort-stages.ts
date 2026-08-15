/**
 * The stages that DECIDE the edit, before anything is encoded.
 *
 * Rewrite the script, work out which spans of each source survive, how
 * fast they play, and where the cuts land. All of it is decided up front
 * and handed to the graph builder as data, which is what makes a draft and
 * a final render describe the same edit: they share this stage and differ
 * only in encode settings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyInputs,
  dedupeRetakes,
  type SectionWindow,
  spansWithText,
  speedFor,
  subtitleToText,
} from '../lib/autoshort-plan.js';
import { getVideoInfo } from '../lib/ffmpeg.js';
import type { LumaStats } from '../lib/grade.js';
import { stableWorkPath } from '../lib/plan-cache.js';
import { detectSilence, invertSegments, type TimeSegment } from '../lib/segments.js';
import { type TranscriptSegment, transcribe } from '../lib/whisper.js';
import { analyzeClip, detectVoicedAudio, sniffSpeech } from './autoshort-analysis.js';
import { NARRATION_COVERAGE, TTS_WPS } from './autoshort-constants.js';
import { cleanVoice } from './cleanvoice.js';

export async function rephraseScript(raw: string, outputSeconds: number): Promise<string | null> {
  if (!process.env.GROQ_API_KEY?.trim()) return null;
  const { groqChatJSON, rethrowIfDelegated } = await import('../lib/groq.js');
  const targetWords = Math.max(12, Math.round(outputSeconds * TTS_WPS * NARRATION_COVERAGE));
  try {
    const result = await groqChatJSON<{ script: string }>(
      [
        {
          role: 'system',
          content: `You write voiceover for YouTube Shorts that people actually finish. Rewrite the draft in a warm, upbeat, modern creator voice - how a friendly YouTuber talks to camera. Hook the viewer in the first three words. Short punchy sentences of four to ten words. Mirror the draft's own voice and person: if the draft says "I", stay in first person and keep it personal; if it addresses the viewer, stay in second person. Present tense, contractions. If the draft opens with a specific line, keep that opening intact. Sound genuinely delighted by the thing rather than salesy. Vary the rhythm so it never drones. End on a satisfying payoff line, not a call to action. Never use: "dive in", "unleash", "game-changer", "in this video", "let's explore", "journey", "buckle up". No emojis, no hashtags, no stage directions, no headings, and never an em dash or any dash used as punctuation, because TTS reads it as an odd pause. Use commas or full stops. If you mention a URL or email, write it exactly as it is spoken - the real characters, e.g. "taxducks.com" or "hello@site.com" - never spelled out as the words "dot" or "at"; the caption burns in whatever you write, so spelling it out puts the word "dot" on screen. This is read aloud, so plain spoken words only. Length matters: write ${targetWords} words, and never fewer than ${Math.round(targetWords * 0.9)}, because this is read aloud over a ${Math.round(outputSeconds)} second video and has to carry most of it. Respond with JSON {"script": "<${targetWords} words of spoken narration>"}`,
        },
        { role: 'user', content: raw },
      ],
      undefined,
      'narration'
    );
    return result.script?.trim() || null;
  } catch (e) {
    rethrowIfDelegated(e);
    return null; // model trouble - the raw script still works
  }
}

/** Narration text from whichever source the caller supplied. */
export function resolveScriptSource(
  files: ReturnType<typeof classifyInputs>,
  narration?: string
): string {
  if (narration?.trim()) return narration.trim();
  if (files.narrationPath) return readFileSync(files.narrationPath, 'utf8').trim();
  if (files.subtitlePath) return subtitleToText(readFileSync(files.subtitlePath, 'utf8'));
  return '';
}

/**
 * Everything the MCP layer needs to ask its questions without rendering:
 * how long the Short will be, and whether the footage already has a voice.
 */
export async function planShort(
  inputs: string[],
  maxDuration = 57
): Promise<{ outputDuration: number; voiced: boolean; videos: number }> {
  const files = classifyInputs(inputs);
  if (files.videos.length === 0) throw new Error('No video files among the inputs.');
  let kept = 0;
  let voiced = false;
  for (const video of files.videos) {
    const info = await getVideoInfo(video);
    const analysis = await analyzeClip(video);
    const spans = invertSegments(info.duration, analysis.idle, { padding: 0.35, minLength: 0.8 });
    kept += (spans.length > 0 ? spans : [{ start: 0, end: info.duration }]).reduce(
      (n, s) => n + (s.end - s.start),
      0
    );
    if (!voiced && (await detectVoicedAudio(video))) {
      try {
        voiced = await sniffSpeech(video);
      } catch {
        voiced = true;
      }
    }
  }
  const speed = speedFor(kept, Math.min(59, maxDuration));
  return { outputDuration: kept / speed, voiced, videos: files.videos.length };
}

/**
 * Speak the script as separate lines and lay them on the timeline so they
 * land on cuts.
 *
 * Synthesising the whole script as one take produced a voice that ran
 * continuously while the footage jumped somewhere else: nothing lined up,
 * because nothing was ever asked to. Each sentence is now its own take,
 * placed by planNarrationBeats, with real silence between lines.
 */
export function clipWindows(
  clips: Array<{ kept: number }>,
  speed: number,
  offset: number
): SectionWindow[] {
  const out: SectionWindow[] = [];
  let elapsed = offset;
  for (const clip of clips) {
    const end = elapsed + clip.kept / speed;
    out.push({ start: elapsed, end });
    elapsed = end;
  }
  return out;
}

/**
 * Output-time positions where one kept span meets the next. These are the
 * moments the picture cuts, and so the moments a line of narration should
 * be allowed to start on.
 */
export function cutBoundaries(
  clips: Array<{ spans: TimeSegment[] }>,
  speed: number,
  offset = 0
): number[] {
  const out: number[] = [offset];
  let elapsed = 0;
  for (const clip of clips) {
    for (const span of clip.spans) {
      out.push(offset + elapsed / speed);
      elapsed += span.end - span.start;
    }
  }
  return out;
}

export interface PreparedClip {
  source: string;
  /**
   * Transcript of the ORIGINAL voice, when there was one. Already paid for
   * by retake de-duplication, so captioning a recorded voice costs nothing
   * extra rather than a second pass.
   */
  transcript: TranscriptSegment[] | null;
  spans: TimeSegment[];
  luma: LumaStats | null;
  kept: number;
  retakesDropped: number;
  voiced: boolean;
}

/**
 * Decide what to keep from one clip. Nothing is encoded here - the spans go
 * straight into the single render pass as a select expression.
 */
export async function prepareClip(
  input: string,
  index: number,
  keepVoice: boolean,
  /** Non-null when the result will be cached, so the denoised copy must persist. */
  cacheKey: string | null,
  workDir: string,
  progress: (stage: string) => void
): Promise<PreparedClip> {
  let voiced = false;
  // With voiceover: 'tts' the source audio is discarded whatever it holds,
  // so asking whether it contains speech buys nothing and costs a whisper
  // pass per clip. Speech recognition only earns its keep on audio we are
  // actually going to use.
  if (keepVoice && (await detectVoicedAudio(input))) {
    progress(`listening for speech in clip ${index + 1}`);
    try {
      voiced = await sniffSpeech(input);
    } catch {
      voiced = true; // whisper unavailable - trust the volume signal
    }
  }

  // Denoising only earns its cost when the voice survives into the output.
  // Under a TTS narration the source audio is discarded anyway.
  let source = input;
  if (voiced && keepVoice) {
    progress(`denoising clip ${index + 1}`);
    // A cached plan points at this file, so when caching it has to live
    // somewhere that survives the temp dir being torn down.
    source = await cleanVoice({
      input,
      output: cacheKey
        ? stableWorkPath(input, cacheKey, `clean-${index}`)
        : join(workDir, `clean-${index}.mp4`),
      onProgress: () => {},
    });
  }

  const info = await getVideoInfo(source);
  progress(`analysing clip ${index + 1}`);
  const analysis = await analyzeClip(source);

  let spans: TimeSegment[];
  if (voiced) {
    // The ORIGINAL file deliberately: cleanVoice loudnorms to -14 LUFS,
    // which lifts quiet passages past silencedetect's threshold.
    const silences = await detectSilence(input, {
      minDuration: 1.2,
      thresholdDb: -32,
      videoDuration: info.duration,
    });
    spans = invertSegments(info.duration, silences, { padding: 0.25, minLength: 0.6 });
  } else {
    spans = invertSegments(info.duration, analysis.idle, { padding: 0.35, minLength: 0.8 });
  }
  if (spans.length === 0) spans = [{ start: 0, end: info.duration }];

  let retakesDropped = 0;
  let transcript: TranscriptSegment[] | null = null;
  if (voiced && keepVoice) {
    try {
      progress(`transcribing clip ${index + 1} for retakes`);
      const result = await transcribe(source, { model: 'base.en' });
      transcript = result.segments;
      const unique = dedupeRetakes(spansWithText(spans, result.segments));
      retakesDropped = spans.length - unique.length;
      spans = unique;
    } catch {
      // whisper unavailable - keep every span rather than dying
    }
  }

  return {
    source,
    transcript,
    spans,
    luma: analysis.luma,
    kept: spans.reduce((n, s) => n + (s.end - s.start), 0),
    retakesDropped,
    voiced,
  };
}
