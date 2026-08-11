/**
 * AutoShort - "generate a video short from these files", end to end.
 *
 * Analysis first, then ONE ffmpeg pass. Earlier versions encoded four times
 * (trim each clip, stitch, burn captions, mux music); every stage after the
 * first ran at 1080x1920 through a gaussian blur, which is where the
 * wall-clock went. Everything now resolves before rendering - spans, grade,
 * narration audio, caption timings - so the single graph is the only time a
 * frame is touched.
 *
 * Pipeline:
 *  1. classify inputs (videos, .srt/.vtt, narration .txt/.md, music)
 *  2. per clip, ONE analysis pass yields both idle spans and luma stats
 *  3. drop retakes on voiced clips (whisper transcript similarity)
 *  4. speed = whatever lands the kept footage under the ceiling
 *  5. narration: Groq rewrite -> TTS -> whisper the TTS for caption timing
 *  6. single render: select + grade + pad + concat + speed + captions,
 *     with narration over a ducked music bed
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyInputs,
  dedupeRetakes,
  realSpeechWords,
  spansWithText,
  speedFor,
  subtitleToText,
} from '../lib/autoshort-plan.js';
import {
  executeFFmpegAnalysis,
  executeFFmpegRaw,
  executeFFmpegWithProgress,
  getMediaDuration,
  getVideoInfo,
  videoEncoderArgs,
} from '../lib/ffmpeg.js';
import { type LumaStats, averageStats, matchGrade, parseLumaStats } from '../lib/grade.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { type ResolvedTrack, resolveMusicChoice } from '../lib/music.js';
import { type TimeSegment, detectSilence, invertSegments } from '../lib/segments.js';
import { transcribe } from '../lib/whisper.js';
import { type SrtEntry, generateShortsAss, segmentsToEntries } from './caption.js';
import { cleanVoice } from './cleanvoice.js';
import { buildSpeedupAudioFilters } from './speedup.js';
import { buildSelectExpr, escapeFilterPath } from './timelapse.js';
import { generateNarrationAudio } from './voiceover.js';

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

export interface AutoShortOptions {
  inputs: string[];
  /** Narration text. Used verbatim when `scriptIsFinal`, else rewritten. */
  narration?: string;
  /** Skip the AI rewrite - this text was already approved by a human. */
  scriptIsFinal?: boolean;
  music?: string;
  /** Bed level, 0-1. Default 0.08 - it sits under the voice, not beside it. */
  musicVolume?: number;
  maxDuration?: number;
  captions?: boolean;
  /** Contrast boost on top of per-clip matching. Default 1.25. */
  contrast?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  /** Silence before the first word, so it does not open mid-syllable. */
  leadIn?: number;
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
  narrationSeconds: number;
  captionsBurned: boolean;
  music: ResolvedTrack | null;
  /** Wall-clock per stage, so a slow render can be attributed. */
  stageSeconds: Record<string, number>;
}

const SHORT_W = 1080;
const SHORT_H = 1920;
/**
 * The background copy is blurred at a quarter resolution and scaled back up.
 * gblur cost scales with area, and a sigma-32 blur at full size is visually
 * indistinguishable from sigma-8 at quarter size once it is upscaled.
 */
const BLUR_W = 270;
const BLUR_H = 480;
/** Words per second Edge neural TTS actually delivers (~175 wpm). */
const TTS_WPS = 2.9;
/** Fraction of the runtime narration should cover. Not 100%: it needs air. */
const NARRATION_COVERAGE = 0.85;
/** Default silence before the first word. */
const DEFAULT_LEAD_IN = 1;
/**
 * Mean absolute inter-frame luma difference below which a sampled step is
 * "nothing happened". ffmpeg computes this natively as signalstats YDIF,
 * replacing a pass that decoded every sampled frame to PNG and diffed it in
 * JavaScript.
 */
const IDLE_YDIF = 0.45;
/** Analysis sampling rate, frames per second. */
const ANALYSIS_FPS = 2;

export interface ClipAnalysis {
  idle: TimeSegment[];
  luma: LumaStats | null;
}

/** Runs of low inter-frame difference, as idle time segments. */
export function ydifToIdleSpans(
  ydif: number[],
  interval: number,
  minIdleSeconds: number
): TimeSegment[] {
  const minSteps = Math.max(1, Math.ceil(minIdleSeconds / interval));
  const spans: TimeSegment[] = [];
  let runStart = -1;
  for (let i = 0; i <= ydif.length; i++) {
    if (i < ydif.length && ydif[i] < IDLE_YDIF) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      if (i - runStart >= minSteps) {
        spans.push({ start: runStart * interval, end: i * interval });
      }
      runStart = -1;
    }
  }
  return spans;
}

/**
 * Sample the clip once and derive both signals from the same decode.
 * signalstats reports YDIF (inter-frame motion) alongside YAVG/YLOW/YHIGH,
 * so idle detection and contrast measurement share a pass.
 */
export async function analyzeClip(input: string, minIdleSeconds = 2): Promise<ClipAnalysis> {
  const log = await executeFFmpegAnalysis(input, [
    '-vf',
    `fps=${ANALYSIS_FPS},scale=320:-1,signalstats,metadata=print`,
  ]);
  const ydif = [...log.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].map((m) =>
    Number.parseFloat(m[1])
  );
  return {
    idle: ydifToIdleSpans(ydif, 1 / ANALYSIS_FPS, minIdleSeconds),
    luma: parseLumaStats(log),
  };
}

/** Luma profile of a clip, for cross-clip contrast matching. */
export async function measureLuma(input: string): Promise<LumaStats | null> {
  return (await analyzeClip(input)).luma;
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
 * desktop hum passes the volume check but transcribes to [BLANK_AUDIO], so
 * whisper a ~60s slice from the middle and count real words.
 */
export async function sniffSpeech(input: string): Promise<boolean> {
  const info = await getVideoInfo(input);
  const sliceLen = Math.min(60, info.duration);
  const start = Math.max(0, info.duration / 2 - sliceLen / 2);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-sniff-'));
  try {
    // Audio-only slice: whisper never needs the pixels.
    const slice = join(workDir, 'slice.m4a');
    await executeFFmpegRaw([
      '-y',
      '-ss',
      start.toFixed(2),
      '-i',
      input,
      '-t',
      sliceLen.toFixed(2),
      '-vn',
      '-c:a',
      'aac',
      slice,
    ]);
    const result = await transcribe(slice, { model: 'base.en' });
    const words = realSpeechWords(result.segments.map((s) => s.text).join(' '));
    return words / (sliceLen / 60) >= 8;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Rewrite narration in a modern, cheerful creator voice, sized to the
 * runtime. Exported so the MCP layer can put the draft in front of a human
 * BEFORE anything renders.
 */
export async function rephraseScript(raw: string, outputSeconds: number): Promise<string | null> {
  if (!process.env.GROQ_API_KEY?.trim()) return null;
  const { groqChatJSON } = await import('../lib/groq.js');
  const targetWords = Math.max(12, Math.round(outputSeconds * TTS_WPS * NARRATION_COVERAGE));
  try {
    const result = await groqChatJSON<{ script: string }>([
      {
        role: 'system',
        content: `You write voiceover for YouTube Shorts that people actually finish. Rewrite the draft in a warm, upbeat, modern creator voice - how a friendly YouTuber talks to camera. Hook the viewer in the first three words. Short punchy sentences of four to ten words. Mirror the draft's own voice and person: if the draft says "I", stay in first person and keep it personal; if it addresses the viewer, stay in second person. Present tense, contractions. If the draft opens with a specific line, keep that opening intact. Sound genuinely delighted by the thing rather than salesy. Vary the rhythm so it never drones. End on a satisfying payoff line, not a call to action. Never use: "dive in", "unleash", "game-changer", "in this video", "let's explore", "journey", "buckle up". No emojis, no hashtags, no stage directions, no headings, and never an em dash or any dash used as punctuation, because TTS reads it as an odd pause. Use commas or full stops. This is read aloud, so plain spoken words only. Length matters: write ${targetWords} words, and never fewer than ${Math.round(targetWords * 0.9)}, because this is read aloud over a ${Math.round(outputSeconds)} second video and has to carry most of it. Respond with JSON {"script": "<${targetWords} words of spoken narration>"}`,
      },
      { role: 'user', content: raw },
    ]);
    return result.script?.trim() || null;
  } catch {
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

interface PreparedClip {
  source: string;
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
async function prepareClip(
  input: string,
  index: number,
  keepVoice: boolean,
  workDir: string,
  progress: (stage: string) => void
): Promise<PreparedClip> {
  let voiced = false;
  if (await detectVoicedAudio(input)) {
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
    source = await cleanVoice({
      input,
      output: join(workDir, `clean-${index}.mp4`),
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
  if (voiced && keepVoice) {
    try {
      progress(`transcribing clip ${index + 1} for retakes`);
      const transcript = await transcribe(source, { model: 'base.en' });
      const unique = dedupeRetakes(spansWithText(spans, transcript.segments));
      retakesDropped = spans.length - unique.length;
      spans = unique;
    } catch {
      // whisper unavailable - keep every span rather than dying
    }
  }

  return {
    source,
    spans,
    luma: analysis.luma,
    kept: spans.reduce((n, s) => n + (s.end - s.start), 0),
    retakesDropped,
    voiced,
  };
}

/**
 * The whole edit as one filtergraph: per-clip trim and grade, framed to a
 * common canvas, concatenated, sped up, captions burned, narration over a
 * ducked bed.
 */
export function buildRenderGraph(opts: {
  clips: Array<{ spans: TimeSegment[]; luma: LumaStats | null }>;
  speed: number;
  contrast: number;
  keepSourceAudio: boolean;
  assPath?: string;
  ttsIndex?: number;
  musicIndex?: number;
  musicVolume: number;
  outputDuration: number;
}): string {
  const { clips, speed, contrast, keepSourceAudio, assPath, ttsIndex, musicIndex } = opts;
  const chains: string[] = [];

  const measured = clips.flatMap((c) => (c.luma ? [c.luma] : []));
  const target = measured.length > 0 ? averageStats(measured) : null;

  clips.forEach((clip, i) => {
    const grade =
      target && clip.luma ? matchGrade(clip.luma, target, contrast) : { contrast, brightness: 0 };
    const select = buildSelectExpr(clip.spans);
    // Trim, grade and frame in one go. Every clip lands on the same canvas
    // because concat demands identical width/height/SAR.
    // Speed is applied HERE, before the scale/blur, not after the concat.
    // The kept footage is several times longer than the finished Short, so
    // scaling it to 1080x1920 first means blurring thousands of frames that
    // are about to be dropped - the single biggest cost in the render.
    chains.push(
      `[${i}:v]select='${select}',setpts=N/FRAME_RATE/TB,setpts=PTS/${speed},fps=30,` +
        `eq=contrast=${grade.contrast}:brightness=${grade.brightness},split=2[bg${i}][fg${i}]`
    );
    chains.push(
      `[bg${i}]scale=${BLUR_W}:${BLUR_H}:force_original_aspect_ratio=increase,` +
        `crop=${BLUR_W}:${BLUR_H},gblur=sigma=8,scale=${SHORT_W}:${SHORT_H},` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:thickness=fill[bgb${i}]`
    );
    chains.push(
      `[fg${i}]scale=${SHORT_W}:${SHORT_H}:force_original_aspect_ratio=decrease:flags=lanczos[fgs${i}]`
    );
    chains.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1[n${i}]`);
    if (keepSourceAudio) {
      chains.push(`[${i}:a]aselect='${select}',asetpts=N/SR/TB[na${i}]`);
    }
  });

  const vIn = clips.map((_, i) => `[n${i}]`).join('');
  chains.push(`${vIn}concat=n=${clips.length}:v=1:a=0[cv]`);
  const captions = assPath ? `,ass='${escapeFilterPath(assPath)}'` : '';
  chains.push(`[cv]${captions ? captions.slice(1) : 'null'},format=yuv420p[v]`);

  // ---- audio ----
  let voiceLabel: string | null = null;
  if (ttsIndex !== undefined) {
    chains.push(`[${ttsIndex}:a]aresample=48000,aformat=channel_layouts=stereo,apad[voice]`);
    voiceLabel = '[voice]';
  } else if (keepSourceAudio) {
    const aIn = clips.map((_, i) => `[na${i}]`).join('');
    // Video speed happens per clip; the source audio still needs the same
    // factor applied here, pitch-preserved.
    chains.push(
      `${aIn}concat=n=${clips.length}:v=0:a=1,${buildSpeedupAudioFilters(speed, 1, 48000)},aresample=48000[srcaud]`
    );
    voiceLabel = '[srcaud]';
  }

  if (musicIndex !== undefined) {
    const fadeStart = Math.max(0, opts.outputDuration - 2);
    chains.push(
      `[${musicIndex}:a]aresample=48000,aformat=channel_layouts=stereo,` +
        `atrim=0:${opts.outputDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `volume=${opts.musicVolume},afade=t=in:st=0:d=1.5,` +
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=2[bed]`
    );
    if (voiceLabel) {
      // Duck the bed under the voice rather than relying on level alone:
      // present between lines, out of the way underneath them.
      chains.push(`${voiceLabel}asplit=2[vmix][vkey]`);
      chains.push(
        '[bed][vkey]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=350[duckedbed]'
      );
      chains.push('[duckedbed][vmix]amix=inputs=2:duration=first:normalize=0[a]');
    } else {
      chains.push('[bed]anull[a]');
    }
  } else if (voiceLabel) {
    chains.push(`${voiceLabel}atrim=0:${opts.outputDuration.toFixed(3)}[a]`);
  }

  return chains.join(';');
}

export async function autoShort(options: AutoShortOptions): Promise<AutoShortResult> {
  const { inputs, output } = options;
  const maxDuration = Math.min(59, options.maxDuration ?? 57);
  const wantCaptions = options.captions !== false;
  const contrast = options.contrast ?? 1.25;
  const musicVolume = options.musicVolume ?? 0.08;
  const leadIn = options.leadIn ?? DEFAULT_LEAD_IN;
  const mode = options.voiceover ?? 'auto';
  const progress = options.onProgress ?? ((s: string) => console.log(fmt.dim(`  ${s}...`)));

  const files = classifyInputs(inputs);
  if (files.videos.length === 0) throw new Error('No video files among the inputs.');
  if (!output) throw new Error('`output` is required.');

  const track = resolveMusicChoice(files.musicPath ?? options.music);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-autoshort-'));
  const stageSeconds: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      stageSeconds[name] = Number(((Date.now() - t0) / 1000).toFixed(1));
    }
  };

  header('AutoShort');
  console.log(`Videos:   ${fmt.white(String(files.videos.length))}`);
  console.log(`Target:   ${fmt.yellow(`<=${maxDuration}s`)}`);
  separator();

  try {
    const rawScript = resolveScriptSource(files, options.narration);
    // Settled up front: it decides whether denoising is worth doing at all.
    const keepVoice = mode !== 'tts';

    const clips = await time('analyse', async () => {
      const prepared: PreparedClip[] = [];
      for (let i = 0; i < files.videos.length; i++) {
        prepared.push(await prepareClip(files.videos[i], i, keepVoice, workDir, progress));
      }
      return prepared;
    });

    const voiced = clips.some((c) => c.voiced);
    const keptDuration = clips.reduce((n, c) => n + c.kept, 0);
    const sourceDuration = (
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).duration))
    ).reduce((a, b) => a + b, 0);
    const speed = speedFor(keptDuration, maxDuration);
    const outputDuration = keptDuration / speed;
    console.log(
      `Kept:     ${fmt.white(keptDuration.toFixed(1))}s of ${sourceDuration.toFixed(1)}s → ${fmt.green(outputDuration.toFixed(1))}s at ${fmt.yellow(`${speed.toFixed(1)}x`)}`
    );

    // ---- narration resolved BEFORE a frame is touched ----
    let script = rawScript;
    if (rawScript && !options.scriptIsFinal) {
      progress('rewriting narration');
      const better = await time('rewrite', () => rephraseScript(rawScript, outputDuration));
      if (better) script = better;
    }

    const wantTts = script !== '' && mode !== 'keep' && (mode === 'tts' || !voiced);
    const keepSourceAudio = voiced && !wantTts && mode !== 'tts';

    let ttsPath: string | undefined;
    let narrationSeconds = 0;
    if (wantTts) {
      progress('generating narration');
      ttsPath = await time('tts', async () => {
        const raw = await generateNarrationAudio({
          input: script,
          output: join(workDir, 'narration-raw.mp3'),
          language: options.language,
          gender: options.gender,
        });
        // Lead-in silence so the Short does not open mid-syllable, and the
        // first caption has a beat to land in.
        const padded = join(workDir, 'narration.m4a');
        const ms = Math.round(leadIn * 1000);
        await executeFFmpegRaw([
          '-y',
          '-i',
          raw,
          '-af',
          `adelay=${ms}|${ms}`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          padded,
        ]);
        return padded;
      });
      narrationSeconds = await getMediaDuration(ttsPath);
    }

    // ---- caption timings come from the narration audio itself ----
    let assPath: string | undefined;
    if (wantCaptions && script && ttsPath) {
      progress('timing captions');
      assPath = await time('captions', async () => {
        // Whisper the small audio file, not the finished video: identical
        // timings for a fraction of the decode.
        const t = await transcribe(ttsPath as string, { model: 'base.en' });
        const entries: SrtEntry[] = segmentsToEntries(t.segments);
        const ass = generateShortsAss({
          entries,
          videoWidth: SHORT_W,
          videoHeight: SHORT_H,
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

    // ---- one render ----
    progress('rendering');
    await time('render', async () => {
      const extraInputs: string[] = [];
      for (const clip of clips.slice(1)) extraInputs.push('-i', clip.source);
      let ttsIndex: number | undefined;
      let musicIndex: number | undefined;
      if (ttsPath) {
        ttsIndex = clips.length;
        extraInputs.push('-i', ttsPath);
      }
      if (track) {
        musicIndex = ttsPath ? clips.length + 1 : clips.length;
        extraInputs.push('-stream_loop', '-1', '-i', track.path);
      }

      const graph = buildRenderGraph({
        clips,
        speed,
        contrast,
        keepSourceAudio,
        assPath,
        ttsIndex,
        musicIndex,
        musicVolume,
        outputDuration,
      });
      const graphPath = join(workDir, 'graph.txt');
      writeFileSync(graphPath, graph, 'utf8');

      const hasAudio = ttsPath !== undefined || track !== null || keepSourceAudio;
      await executeFFmpegWithProgress({
        input: clips[0].source,
        output,
        expectedDuration: outputDuration,
        args: [
          ...extraInputs,
          '-filter_complex_script',
          graphPath,
          '-map',
          '[v]',
          ...(hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
          '-t',
          outputDuration.toFixed(3),
          // NVENC when the box has it; the blur-and-scale to 1080x1920 is
          // the only heavy step left, so this is where the time is.
          ...(await videoEncoderArgs()),
          '-movflags',
          '+faststart',
        ],
      });
    });

    success(`Output: ${output}`);
    return {
      output,
      sourceDuration,
      keptDuration,
      outputDuration,
      speed,
      videos: files.videos.length,
      spansKept: clips.reduce((n, c) => n + c.spans.length, 0),
      retakesDropped: clips.reduce((n, c) => n + c.retakesDropped, 0),
      voiced,
      narration: wantTts ? 'tts' : keepSourceAudio ? 'original-voice' : 'none',
      narrationSeconds: Number(narrationSeconds.toFixed(1)),
      captionsBurned: assPath !== undefined,
      music: track,
      stageSeconds,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
