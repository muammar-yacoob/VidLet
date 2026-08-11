/**
 * AutoShort - "generate a video short from these files", end to end:
 *
 * 1. classify the inputs (videos, .srt/.vtt, narration .txt/.md, music audio)
 * 2. denoise each voiced recording (cleanvoice: DeepFilter or afftdn)
 * 3. cut the obvious dead air - long silences on voiced clips, motion-idle
 *    stretches on silent ones - then drop RETAKES: whisper transcribes the
 *    kept spans and near-duplicate spans (same step re-recorded) collapse to
 *    the longest take
 * 4. stitch what survived, in the order the files were given
 * 5. speed the stitch up just enough to fit the target length (<=59s)
 * 6. grade with a contrast bump and frame 9:16 over a blurred pad
 * 7. narration: supplied text/SRT is punched up by Groq when a key is set;
 *    silent recordings get that script as a TTS voice with captions timed to
 *    it (whisper re-times the actual audio), voiced ones keep their own
 *    (pitch-preserved) voice and burn the script proportionally
 * 8. optional music bed, looped, faded, mixed under whatever voice exists
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyInputs,
  dedupeRetakes,
  realSpeechWords,
  scriptToSrt,
  spansWithText,
  speedFor,
  subtitleToText,
} from '../lib/autoshort-plan.js';
import { executeFFmpegAnalysis, executeFFmpegRaw, getVideoInfo } from '../lib/ffmpeg.js';
import { type LumaStats, averageStats, matchGrade, parseLumaStats } from '../lib/grade.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { detectIdleSpans } from '../lib/motion.js';
import { type ResolvedTrack, resolveMusicChoice } from '../lib/music.js';
import { type TimeSegment, detectSilence, invertSegments } from '../lib/segments.js';
import { transcribe } from '../lib/whisper.js';
import { caption } from './caption.js';
import { cleanVoice } from './cleanvoice.js';

import { buildSpeedupAudioFilters } from './speedup.js';
import { buildSelectExpr } from './timelapse.js';
import { generateNarrationAudio } from './voiceover.js';

export interface AutoShortOptions {
  /** Videos in story order; may include .srt/.vtt, .txt/.md and music audio. */
  inputs: string[];
  /** Inline narration text (alternative to a .txt/.md/.srt input). */
  narration?: string;
  /** Music: bundled mood, file path, "none", or "auto" (default bundled bed). */
  music?: string;
  /** Hard length ceiling in seconds. Default 57 (Shorts allow 60). */
  maxDuration?: number;
  /** Burn captions when a script exists. Default true. */
  captions?: boolean;
  /** Contrast boost applied on top of per-clip matching. Default 1.25. */
  contrast?: number;
  /**
   * Whose voice carries the Short. 'auto' keeps real speech and only falls
   * back to TTS for silent footage; 'tts' always narrates (use when the
   * source audio is not worth keeping); 'keep' never generates a voice.
   */
  voiceover?: 'auto' | 'tts' | 'keep';
  output?: string;
  language?: string;
  gender?: 'female' | 'male';
  onProgress?: (stage: string) => void;
}

export interface AutoShortResult {
  output: string;
  sourceDuration: number;
  keptDuration: number;
  outputDuration: number;
  speed: number;
  videos: number;
  spansKept: number;
  retakesDropped: number;
  voiced: boolean;
  narration: 'tts' | 'original-voice' | 'none';
  scriptRephrased: boolean;
  captionsBurned: boolean;
  music: ResolvedTrack | null;
}

// Re-exported so the MCP layer and tests reach the planning logic through
// the pipeline module they already import.
export {
  type ClassifiedInputs,
  type SpokenSpan,
  classifyInputs,
  dedupeRetakes,
  scriptToSrt,
  spansWithText,
  speedFor,
  subtitleToText,
} from '../lib/autoshort-plan.js';

/**
 * Sample luma statistics across a clip (a frame every 2s) so several
 * recordings can be graded onto a common look instead of each keeping its
 * own exposure.
 */
export async function measureLuma(input: string): Promise<LumaStats | null> {
  const log = await executeFFmpegAnalysis(input, ['-vf', 'fps=1/2,signalstats,metadata=print']);
  return parseLumaStats(log);
}

/** True when the file has an audio stream with actual signal in it. */
export async function detectVoicedAudio(input: string): Promise<boolean> {
  if (!(await getVideoInfo(input)).hasAudio) return false;
  const stderr = await executeFFmpegAnalysis(input, ['-af', 'volumedetect']);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return max !== null && Number.parseFloat(max[1]) > -30;
}

/**
 * True when the audio contains actual SPEECH, not just signal. A constant
 * desktop-audio hum passes the volume check but transcribes to
 * [BLANK_AUDIO] - so whisper a ~60s slice from the middle and count real
 * words. Threshold: 8 words/min, well under the slowest narration.
 */
export async function sniffSpeech(input: string): Promise<boolean> {
  const info = await getVideoInfo(input);
  const sliceLen = Math.min(60, info.duration);
  const start = Math.max(0, info.duration / 2 - sliceLen / 2);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-sniff-'));
  try {
    const slice = join(workDir, 'slice.mp4');
    await executeFFmpegRaw([
      '-y',
      '-ss',
      start.toFixed(2),
      '-i',
      input,
      '-t',
      sliceLen.toFixed(2),
      '-c',
      'copy',
      slice,
    ]);
    const result = await transcribe(slice, { model: 'base.en' });
    const words = realSpeechWords(result.segments.map((s) => s.text).join(' '));
    return words / (sliceLen / 60) >= 8;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** AI pass over the narration - hook-first, engaging, sized to the runtime. */
async function rephraseScript(raw: string, outputSeconds: number): Promise<string | null> {
  if (!process.env.GROQ_API_KEY?.trim()) return null;
  const { groqChatJSON } = await import('../lib/groq.js');
  const targetWords = Math.max(12, Math.round(outputSeconds * TTS_WPS * NARRATION_COVERAGE));
  try {
    const result = await groqChatJSON<{ script: string }>([
      {
        role: 'system',
        content: `You write voiceover for YouTube Shorts that people actually finish. Rewrite the draft in a warm, upbeat, modern creator voice - how a friendly YouTuber talks to camera. Hook the viewer in the first three words. Short punchy sentences of four to ten words. Second person, present tense, contractions. Sound genuinely delighted by the thing rather than salesy. Vary the rhythm so it never drones. End on a satisfying payoff line, not a call to action. Never use: "dive in", "unleash", "game-changer", "in this video", "let\'s explore", "journey", "buckle up". No emojis, no hashtags, no stage directions, no headings - this is read aloud by TTS, so plain spoken words only. Length matters: write ${targetWords} words, and never fewer than ${Math.round(targetWords * 0.9)}, because this is read aloud over a ${Math.round(outputSeconds)} second video and has to carry most of it. Respond with JSON {"script": "<${targetWords} words of spoken narration>"}`,
      },
      { role: 'user', content: raw },
    ]);
    return result.script?.trim() || null;
  } catch {
    return null; // model trouble - the raw script still works
  }
}

/**
 * Words per second Edge neural TTS actually delivers (~175 wpm). demo.ts
 * budgets 2.3 for hand-paced narration; using that here produced a script a
 * third too short, so the voice - and with it the captions - died halfway
 * through the Short.
 */
const TTS_WPS = 2.9;
/** Fraction of the runtime narration should cover. Not 100%: it needs air. */
const NARRATION_COVERAGE = 0.85;

const SHORT_W = 1080;
const SHORT_H = 1920;

interface PreparedVideo {
  cutPath: string;
  /** Luma profile of the source, for cross-clip contrast matching. */
  luma: LumaStats | null;
  kept: number;
  spans: number;
  retakesDropped: number;
  voiced: boolean;
}

/** Denoise (if voiced), find keepable spans, drop retakes, extract the cut. */
async function prepareVideo(
  input: string,
  index: number,
  workDir: string,
  progress: (stage: string) => void
): Promise<PreparedVideo> {
  // Signal alone is not voice: desktop-audio hum volumes like speech but
  // transcribes to nothing. Only real speech earns the voiced pipeline.
  let voiced = false;
  if (await detectVoicedAudio(input)) {
    progress(`listening for speech in clip ${index + 1}`);
    try {
      voiced = await sniffSpeech(input);
    } catch {
      voiced = true; // whisper unavailable - trust the volume signal
    }
  }
  let source = input;

  if (voiced) {
    progress(`denoising clip ${index + 1}`);
    source = await cleanVoice({
      input,
      output: join(workDir, `clean-${index}.mp4`),
      onProgress: () => {},
    });
  }

  const info = await getVideoInfo(source);
  progress(`cutting dead air in clip ${index + 1}`);
  let spans: TimeSegment[];
  if (voiced) {
    // The ORIGINAL file, deliberately: cleanvoice loudnorms to -14 LUFS,
    // which lifts quiet passages right past silencedetect's threshold.
    const silences = await detectSilence(input, {
      minDuration: 1.2,
      thresholdDb: -32,
      videoDuration: info.duration,
    });
    spans = invertSegments(info.duration, silences, { padding: 0.25, minLength: 0.6 });
  } else {
    const idle = await detectIdleSpans(source, info.duration, join(workDir, `idle-${index}`));
    spans = invertSegments(info.duration, idle, { padding: 0.35, minLength: 0.8 });
  }
  if (spans.length === 0) spans = [{ start: 0, end: info.duration }];

  let retakesDropped = 0;
  // transcribe() self-installs whisper.cpp on first use; failure just
  // means retakes are kept, not that the render dies.
  if (voiced) {
    try {
      progress(`transcribing clip ${index + 1} for retakes`);
      const transcript = await transcribe(source, { model: 'base.en' });
      const unique = dedupeRetakes(spansWithText(spans, transcript.segments));
      retakesDropped = spans.length - unique.length;
      spans = unique;
    } catch {
      // whisper unavailable/failed - keep all spans rather than dying
    }
  }

  const cutPath = join(workDir, `cut-${index}.mp4`);
  const select = buildSelectExpr(spans);
  // A silent clip still gets an audio track: concat needs every input to
  // carry the same streams, and a mixed batch (one voiced clip, one silent)
  // would otherwise fail at the stitch.
  const hasAudio = (await getVideoInfo(source)).hasAudio;
  const graph = hasAudio
    ? `[0:v]select='${select}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${select}',asetpts=N/SR/TB[a]`
    : `[0:v]select='${select}',setpts=N/FRAME_RATE/TB[v];anullsrc=r=48000:cl=stereo[a]`;
  await executeFFmpegRaw([
    '-y',
    '-i',
    source,
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    cutPath,
  ]);

  return {
    cutPath,
    luma: await measureLuma(cutPath).catch(() => null),
    kept: spans.reduce((n, s) => n + (s.end - s.start), 0),
    spans: spans.length,
    retakesDropped,
    voiced,
  };
}

/** Stitch cuts, apply speed + contrast, frame 9:16. Returns the video path. */
async function renderBase(
  cuts: PreparedVideo[],
  speed: number,
  contrast: number,
  voiced: boolean,
  workDir: string
): Promise<string> {
  const out = join(workDir, 'base.mp4');
  const n = cuts.length;
  const inputs = cuts.flatMap((c) => ['-i', c.cutPath]);

  // Every clip is framed to the SAME canvas before concat: the filter needs
  // identical width/height/SAR, and mixing a 320x360 capture with an
  // already-vertical 1080x1920 clip otherwise fails outright.
  const measured = cuts.flatMap((c) => (c.luma ? [c.luma] : []));
  const target = measured.length > 0 ? averageStats(measured) : null;

  const chains: string[] = [];
  for (let i = 0; i < n; i++) {
    // Per-clip grade lands each recording on the shared look; the creative
    // boost rides on top so the whole Short reads as one piece.
    const clipLuma = cuts[i].luma;
    const grade =
      target && clipLuma ? matchGrade(clipLuma, target, contrast) : { contrast, brightness: 0 };
    const eq = `eq=contrast=${grade.contrast}:brightness=${grade.brightness}`;
    chains.push(`[${i}:v]${eq},fps=30,split=2[bg${i}][fg${i}]`);
    chains.push(
      `[bg${i}]scale=${SHORT_W}:${SHORT_H}:force_original_aspect_ratio=increase,crop=${SHORT_W}:${SHORT_H},gblur=sigma=32,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:thickness=fill[bgb${i}]`
    );
    chains.push(
      `[fg${i}]scale=${SHORT_W}:${SHORT_H}:force_original_aspect_ratio=decrease:flags=lanczos[fgs${i}]`
    );
    chains.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[n${i}]`);
  }

  const vLabels = cuts.map((_, i) => `[n${i}]`).join('');
  if (voiced) {
    // prepareVideo guarantees every cut carries an audio stream (silence
    // where there was none), so concat can always take v=1:a=1.
    const aLabels = cuts.map((_, i) => `[${i}:a]`).join('');
    chains.push(`${vLabels}concat=n=${n}:v=1:a=0[cv]`);
    chains.push(`${aLabels}concat=n=${n}:v=0:a=1[ca]`);
    chains.push(`[cv]setpts=PTS/${speed},fps=30[v]`);
    chains.push(`[ca]${buildSpeedupAudioFilters(speed, 1, 48000)}[a]`);
  } else {
    chains.push(`${vLabels}concat=n=${n}:v=1:a=0[cv]`);
    chains.push(`[cv]setpts=PTS/${speed},fps=30[v]`);
  }

  await executeFFmpegRaw([
    '-y',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[v]',
    ...(voiced ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    out,
  ]);
  return out;
}

/** Mux TTS narration over a (silent) video, padding/trimming to its length. */
async function muxNarration(video: string, tts: string, workDir: string): Promise<string> {
  const out = join(workDir, 'narrated.mp4');
  await executeFFmpegRaw([
    '-y',
    '-i',
    video,
    '-i',
    tts,
    '-filter_complex',
    '[1:a]apad[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    out,
  ]);
  return out;
}

/** Mix a music bed (looped, faded) under whatever audio the video has. */
async function mixMusic(
  video: string,
  bed: string,
  durationSeconds: number,
  hasAudio: boolean,
  out: string
): Promise<void> {
  const fadeStart = Math.max(0, durationSeconds - 2);
  const bedChain =
    `[1:a]atrim=0:${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.25,` +
    `afade=t=in:st=0:d=1,afade=t=out:st=${fadeStart.toFixed(3)}:d=2[m]`;
  const graph = hasAudio
    ? `${bedChain};[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`
    : `${bedChain};[m]anull[a]`;
  await executeFFmpegRaw([
    '-y',
    '-i',
    video,
    '-stream_loop',
    '-1',
    '-i',
    bed,
    '-filter_complex',
    graph,
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    out,
  ]);
}

export async function autoShort(options: AutoShortOptions): Promise<AutoShortResult> {
  const { inputs, output } = options;
  const maxDuration = Math.min(59, options.maxDuration ?? 57);
  const wantCaptions = options.captions !== false;
  const contrast = options.contrast ?? 1.25;
  const progress = options.onProgress ?? ((s: string) => console.log(fmt.dim(`  ${s}...`)));

  const files = classifyInputs(inputs);
  if (files.videos.length === 0) throw new Error('No video files among the inputs.');
  if (!output) throw new Error('`output` is required.');

  const track = resolveMusicChoice(files.musicPath ?? options.music);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-autoshort-'));

  header('AutoShort');
  console.log(`Videos:   ${fmt.white(String(files.videos.length))}`);
  console.log(`Target:   ${fmt.yellow(`<=${maxDuration}s`)}`);
  separator();

  try {
    // Narration source: inline > .txt/.md > .srt/.vtt text.
    const { readFileSync } = await import('node:fs');
    let rawScript = options.narration?.trim() || '';
    if (!rawScript && files.narrationPath)
      rawScript = readFileSync(files.narrationPath, 'utf8').trim();
    if (!rawScript && files.subtitlePath)
      rawScript = subtitleToText(readFileSync(files.subtitlePath, 'utf8'));

    const cuts: PreparedVideo[] = [];
    for (let i = 0; i < files.videos.length; i++) {
      cuts.push(await prepareVideo(files.videos[i], i, workDir, progress));
    }
    const voiced = cuts.some((c) => c.voiced);
    const keptDuration = cuts.reduce((n, c) => n + c.kept, 0);
    const sourceDuration = (
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).duration))
    ).reduce((a, b) => a + b, 0);
    const speed = speedFor(keptDuration, maxDuration);
    const outputDuration = keptDuration / speed;

    progress(`stitching at ${speed.toFixed(1)}x`);
    let current = await renderBase(cuts, speed, contrast, voiced, workDir);

    let script = rawScript;
    let rephrased = false;
    if (rawScript) {
      progress('rephrasing narration');
      const better = await rephraseScript(rawScript, outputDuration);
      if (better) {
        script = better;
        rephrased = true;
      }
    }

    const mode = options.voiceover ?? 'auto';
    // 'tts' overrides the auto rule: the caller has judged the source audio
    // not worth keeping (prior TTS, room tone, music), so narrate over it.
    const wantTts = script !== '' && mode !== 'keep' && (mode === 'tts' || !voiced);
    let narration: AutoShortResult['narration'] = voiced ? 'original-voice' : 'none';
    if (wantTts) {
      progress('generating TTS narration');
      const tts = await generateNarrationAudio({
        input: script,
        output: join(workDir, 'narration.mp3'),
        language: options.language,
        gender: options.gender,
      });
      current = await muxNarration(current, tts, workDir);
      narration = 'tts';
    }

    let captionsBurned = false;
    if (wantCaptions && script) {
      progress('burning captions');
      const captioned = join(workDir, 'captioned.mp4');
      // 'shorts': one short line, big white, current word in yellow.
      if (narration === 'tts') {
        // Whisper re-times the actual TTS audio - captions land on the voice.
        await caption({
          input: current,
          output: captioned,
          autoTranscribe: true,
          style: 'shorts',
        });
      } else {
        await caption({
          input: current,
          output: captioned,
          srtContent: scriptToSrt(script, outputDuration),
          style: 'shorts',
        });
      }
      current = captioned;
      captionsBurned = true;
    }

    if (track) {
      progress('mixing music');
      const scored = join(workDir, 'scored.mp4');
      await mixMusic(current, track.path, outputDuration, voiced || narration === 'tts', scored);
      current = scored;
    }

    copyFileSync(current, output);
    success(`Output: ${output}`);
    return {
      output,
      sourceDuration,
      keptDuration,
      outputDuration,
      speed,
      videos: files.videos.length,
      spansKept: cuts.reduce((n, c) => n + c.spans, 0),
      retakesDropped: cuts.reduce((n, c) => n + c.retakesDropped, 0),
      voiced,
      narration,
      scriptRephrased: rephrased,
      captionsBurned,
      music: track,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
