/**
 * Deciding what the Short SAYS and what it SHOWS as text.
 *
 * Both are settled before a single frame is encoded, which is what lets a
 * draft and a final render carry identical narration and identical
 * captions: they run this same stage and differ only in encode settings.
 *
 * The two are one phase rather than two because caption timing is derived
 * from the narration, not measured from it. Whisper is never run over our
 * own TTS: the words and each line's duration are already known, and
 * transcribing synthesised speech both cost a pass per render and misheard
 * the script.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SrtEntry } from '@spark-apps/video-kit';
import { abortBeforeExpensiveWork } from '../lib/ai-context.js';
import {
  sourceTimeToOutput,
  splitSentences,
  startsFromAssignment,
  timeWordsInLine,
  windowsFromSpeeds,
} from '../lib/autoshort-plan.js';
import { getMediaDuration } from '../lib/ffmpeg.js';
import { TTS_WPS } from './autoshort-constants.js';
import { type PlacedTake, synthesizeNarration } from './autoshort-narration.js';
import type { PreparedClip } from './autoshort-stages.js';
import { cutBoundaries, rephraseScript } from './autoshort-stages.js';
import type { AutoShortOptions } from './autoshort-types.js';
import { generateShortsAss } from './caption.js';
import { assignLinesToFrames, describeTimeline } from './narration-align.js';

export interface VoiceStageContext {
  rawScript: string;
  options: AutoShortOptions;
  clips: PreparedClip[];
  speed: number;
  perClipSpeed: number[];
  introSeconds: number;
  outputDuration: number;
  leadIn: number;
  tailPad: number;
  mode: 'auto' | 'tts' | 'keep';
  voiced: boolean;
  wantCaptions: boolean;
  workDir: string;
  referenceCanvas: { width: number; height: number };
  progress: (stage: string) => void;
  time: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export interface VoiceStageResult {
  script: string;
  /** A TTS narration was wanted (and therefore produced). */
  wantTts: boolean;
  ttsPath?: string;
  narrationTakes: PlacedTake[];
  narrationSeconds: number;
  alignedStartsUsed: boolean;
  keepSourceAudio: boolean;
  assPath?: string;
  captionEntries: SrtEntry[];
}

export async function resolveVoiceAndCaptions(ctx: VoiceStageContext): Promise<VoiceStageResult> {
  const {
    rawScript,
    options,
    clips,
    speed,
    perClipSpeed,
    introSeconds,
    outputDuration,
    leadIn,
    tailPad,
    mode,
    voiced,
    wantCaptions,
    workDir,
    referenceCanvas,
    progress,
    time,
  } = ctx;

  // ---- narration resolved BEFORE a frame is touched ----
  let script: string = rawScript;
  if (rawScript && !options.scriptIsFinal) {
    progress('rewriting narration');
    const better = await time('rewrite', () => rephraseScript(rawScript, outputDuration));
    if (better) script = better;
  }

  const wantTts = script !== '' && mode !== 'keep' && (mode === 'tts' || !voiced);
  const keepSourceAudio = voiced && !wantTts && mode !== 'tts';

  let ttsPath: string | undefined;
  let narrationTakes: PlacedTake[] = [];
  let narrationSeconds = 0;
  let alignedStartsUsed = false;
  if (wantTts) {
    progress('generating narration');
    // Look at the footage and decide where each line belongs, BEFORE
    // anything is spoken or rendered. Falls back to proportional
    // placement when there is no Groq key or the models are unavailable.
    const usableEnd = Math.max(introSeconds + 1, outputDuration - tailPad);
    let alignedStarts: number[] | null = null;
    if (options.alignToContent !== false) {
      alignedStarts = await time('align', async () => {
        const frames = await describeTimeline({
          clips,
          speed,
          introSeconds,
          outputDuration: usableEnd,
        });
        if (frames.length === 0) return null;
        const lines = splitSentences(script);
        const assignment = await assignLinesToFrames(lines, frames);
        if (!assignment) return null;
        // Durations are not known until the audio exists, so estimate
        // from words here; the exact values only shift starts slightly
        // and the no-overlap pass fixes the rest.
        const estimated = lines.map((l) => ({
          duration: l.split(/\s+/).filter(Boolean).length / TTS_WPS,
        }));
        return startsFromAssignment(
          estimated,
          assignment,
          frames.map((f) => f.outputTime),
          leadIn,
          usableEnd
        );
      });
    }

    // Everything the run needs written has been asked for by now: the script,
    // the frame descriptions and the assignment between them. Under MCP that
    // means the briefs are collected, and the caller has to answer them before
    // any of this is worth doing - synthesising speech for an unwritten script
    // and rendering around it costs minutes for output that gets discarded.
    abortBeforeExpensiveWork();

    const spoken = await time('tts', () =>
      synthesizeNarration(
        script,
        workDir,
        leadIn,
        usableEnd,
        cutBoundaries(clips, speed, introSeconds),
        windowsFromSpeeds(
          clips.map((c) => c.kept),
          perClipSpeed,
          introSeconds
        ),
        alignedStarts,
        options
      )
    );
    alignedStartsUsed = alignedStarts !== null;
    ttsPath = spoken.path;
    narrationTakes = spoken.takes;
    narrationSeconds = await getMediaDuration(ttsPath);
  }

  // ---- caption timings come from the narration audio itself ----
  let assPath: string | undefined;
  // Kept outside the caption closure so the emitted project can carry the
  // same lines as subtitle entries rather than re-deriving them.
  let captionEntries: SrtEntry[] = [];
  if (wantCaptions && !ttsPath && keepSourceAudio) {
    // A recorded voice was kept, so caption THAT. The transcript already
    // exists from retake de-duplication; without this the Short simply
    // had no captions whenever the maker used their own voice.
    progress('timing captions');
    assPath = await time('captions', async () => {
      const entries: SrtEntry[] = [];
      captionEntries = entries;
      clips.forEach((clip, ci) => {
        for (const seg of clip.transcript ?? []) {
          const start = sourceTimeToOutput(clips, speed, introSeconds, ci, seg.start);
          const end = sourceTimeToOutput(clips, speed, introSeconds, ci, seg.end);
          // A segment straddling a cut has no single place to live.
          if (start === null || end === null || end <= start) continue;
          entries.push({
            index: entries.length + 1,
            startTime: start,
            endTime: end,
            text: seg.text.trim(),
            words: (seg.words ?? [])
              .map((w) => {
                const ws = sourceTimeToOutput(clips, speed, introSeconds, ci, w.start);
                const we = sourceTimeToOutput(clips, speed, introSeconds, ci, w.end);
                return ws !== null && we !== null && we > ws
                  ? { word: w.word, start: ws, end: we }
                  : null;
              })
              .filter((w): w is NonNullable<typeof w> => w !== null),
          });
        }
      });
      if (entries.length === 0) return undefined;
      const ass = generateShortsAss({
        entries: entries.sort((a, b) => a.startTime - b.startTime),
        videoWidth: referenceCanvas.width,
        videoHeight: referenceCanvas.height,
        fontSize: 48,
        fontName: 'Arial Black',
        position: 'bottom',
        highlightColor: '&H00FFFF&',
        maxChars: 28,
      });
      const p = join(workDir, 'captions.ass');
      writeFileSync(p, ass, 'utf8');
      return p;
    });
  } else if (wantCaptions && script && ttsPath) {
    progress('timing captions');
    assPath = await time('captions', async () => {
      // NO transcription here. The narration is our own TTS, so the exact
      // words and each line's measured duration are already known;
      // running whisper over synthesised speech cost a pass per render
      // and mis-heard the script ("Been working" came back as "I've
      // been"). Real recorded voice is the only case that needs it.
      captionEntries = narrationTakes.map((take, i) => {
        const words = timeWordsInLine(take.text, take.start, take.duration);
        return {
          index: i + 1,
          startTime: take.start,
          endTime: take.start + take.duration,
          text: take.text,
          words,
        };
      });
      const ass = generateShortsAss({
        entries: captionEntries,
        videoWidth: referenceCanvas.width,
        videoHeight: referenceCanvas.height,
        fontSize: 48,
        fontName: 'Arial Black',
        position: 'bottom',
        highlightColor: '&H00FFFF&',
        maxChars: 28,
      });
      const p = join(workDir, 'captions.ass');
      writeFileSync(p, ass, 'utf8');
      return p;
    });
  }

  return {
    script,
    wantTts,
    ttsPath,
    narrationTakes,
    narrationSeconds,
    alignedStartsUsed,
    keepSourceAudio,
    assPath,
    captionEntries,
  };
}
