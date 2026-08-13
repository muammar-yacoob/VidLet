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

export { buildRenderGraph } from './autoshort-graph.js';
export type { AutoShortOptions, AutoShortResult } from './autoshort-types.js';

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  classifyInputs,
  speedFor,
  speedPerSection,
  splitScriptSections,
  splitSentences,
} from '../lib/autoshort-plan.js';
import { executeFFmpegWithProgress, getMediaDuration, getVideoInfo } from '../lib/ffmpeg.js';
import type { LumaStats } from '../lib/grade.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { resolveMusicChoice } from '../lib/music.js';
import { planKey, readPlan, writePlan } from '../lib/plan-cache.js';
import type { TimeSegment } from '../lib/segments.js';
import { buildRenderGraph, fastEncoderArgs } from './autoshort-graph.js';
import type { AutoShortOptions, AutoShortResult } from './autoshort-types.js';
import { resolveVoiceAndCaptions } from './autoshort-voice.js';
import { renderCtaPng } from './cta-overlay.js';
import { emitVidletProject, projectPathFor } from './emit-project.js';
import { maskSensitive as runMask } from './mask.js';

export {
  type ClassifiedInputs,
  classifyInputs,
  dedupeRetakes,
  fitBeatsToRuntime,
  planNarrationBeats,
  type SpokenSpan,
  scriptToSrt,
  spansWithText,
  speedFor,
  speedPerSection,
  splitScriptSections,
  splitSentences,
  subtitleToText,
  timeWordsInLine,
  toSpokenForm,
  windowsFromSpeeds,
} from '../lib/autoshort-plan.js';

import { chooseCanvas, DRAFT_H, DRAFT_W } from './autoshort-analysis.js';

export {
  analyzeClip,
  type ClipAnalysis,
  chooseCanvas,
  detectVoicedAudio,
  measureLuma,
  sniffSpeech,
  ydifToIdleSpans,
} from './autoshort-analysis.js';
export type { PlacedTake } from './autoshort-narration.js';

import { DEFAULT_LEAD_IN, DEFAULT_TAIL_PAD, TTS_WPS } from './autoshort-constants.js';
import { type PreparedClip, prepareClip, resolveScriptSource } from './autoshort-stages.js';

export {
  clipWindows,
  cutBoundaries,
  planShort,
  rephraseScript,
  resolveScriptSource,
} from './autoshort-stages.js';

export async function autoShort(options: AutoShortOptions): Promise<AutoShortResult> {
  const { inputs, output } = options;
  const maxDuration = Math.min(59, options.maxDuration ?? 57);
  const wantCaptions = options.captions !== false;
  const contrast = options.contrast ?? 1.12;
  const musicVolume = options.musicVolume ?? 0.08;
  const leadIn = options.leadIn ?? DEFAULT_LEAD_IN;
  const tailPad = options.tailPad ?? DEFAULT_TAIL_PAD;
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

    // Analysis depends only on the footage and the settings that change
    // what is KEPT - not on music, titles or canvas - so iterating on a
    // Short re-derives an identical answer every time unless it is cached.
    const useCache = options.cache !== false;
    const cacheKey = planKey(files.videos, { keepVoice, maxDuration });
    const cached = useCache ? readPlan(cacheKey) : null;

    let cacheHit = false;
    let clips: PreparedClip[];
    if (cached) {
      cacheHit = true;
      progress('reusing cached analysis');
      stageSeconds.analyse = 0;
      clips = cached.clips.map((c) => ({ ...c, transcript: null }));
    } else {
      // Clips are independent, so they analyse concurrently. ffmpeg and
      // whisper are each single-clip-bound; on any multi-core box this is
      // close to free.
      clips = await time('analyse', () =>
        Promise.all(
          files.videos.map((video, i) =>
            prepareClip(video, i, keepVoice, useCache ? cacheKey : null, workDir, progress)
          )
        )
      );
      if (useCache) {
        writePlan(
          cacheKey,
          clips.map((c) => ({
            source: c.source,
            spans: c.spans,
            luma: c.luma,
            kept: c.kept,
            retakesDropped: c.retakesDropped,
            voiced: c.voiced,
          }))
        );
      }
    }

    const voiced = clips.some((c) => c.voiced);
    const keptDuration = clips.reduce((n, c) => n + c.kept, 0);
    const sourceDuration = (
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).duration))
    ).reduce((a, b) => a + b, 0);
    // A draft is for judging the edit, not the picture, so it renders on a
    // quarter-area canvas. Everything upstream (spans, speed, narration,
    // caption timing) is identical to the real render.
    // The canvas a real render would use. Captions are always laid out
    // against THIS, even in a draft: font size drives how many characters
    // fit a line, so authoring at the draft's smaller canvas broke the
    // lines differently and the draft stopped being representative. libass
    // scales the result to whatever the video actually is.
    const referenceCanvas = chooseCanvas(
      await Promise.all(files.videos.map(async (v) => (await getVideoInfo(v)).height))
    );
    const canvas = options.draft ? { width: DRAFT_W, height: DRAFT_H } : referenceCanvas;
    // The intro is spent from the same budget, so the timelapse is sped to
    // fit whatever is left rather than overrunning the ceiling.
    const introSeconds = options.intro ? await getMediaDuration(options.intro) : 0;
    // With declared `---` sections, each clip's share of the runtime is set
    // by how much narration it carries, not by how much footage survived.
    // One global speed made output time proportional to source length, so
    // seven rigging lines were pinned to a clip that had only earned 13
    // seconds and the narration sprawled over the wrong footage.
    const declaredSections = splitScriptSections(rawScript);
    const available = Math.max(1, maxDuration - introSeconds);
    const perClipSpeed =
      declaredSections.length > 1 && declaredSections.length === clips.length
        ? speedPerSection(
            clips.map((c) => c.kept),
            declaredSections.map(
              (d) => splitSentences(d).reduce((n, l) => n + l.split(/\s+/).length, 0) / TTS_WPS
            ),
            available
          )
        : clips.map(() => speedFor(keptDuration, available));
    // The graph still takes one number; per-clip speeds only differ when
    // sections were declared, and the first is representative otherwise.
    const speed = perClipSpeed[0];
    const outputDuration =
      introSeconds + clips.reduce((n, c, i) => n + c.kept / perClipSpeed[i], 0);
    console.log(
      `Kept:     ${fmt.white(keptDuration.toFixed(1))}s of ${sourceDuration.toFixed(1)}s → ${fmt.green(outputDuration.toFixed(1))}s at ${fmt.yellow(`${speed.toFixed(1)}x`)}`
    );

    // ---- what it says, and what it shows as text ----
    // Both settled before a frame is encoded, so a draft and a final
    // render carry identical narration and identical captions.
    const voice = await resolveVoiceAndCaptions({
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
    });
    const {
      wantTts,
      ttsPath,
      narrationSeconds,
      alignedStartsUsed,
      keepSourceAudio,
      assPath,
      captionEntries,
    } = voice;

    // ---- one render ----
    const wantRender = options.render !== false;
    if (wantRender) progress('rendering');
    await time('render', async () => {
      if (!wantRender) return;
      // An intro leads the input list so it concatenates first.
      const graphClips: Array<{ spans: TimeSegment[] | null; luma: LumaStats | null }> =
        options.intro
          ? [{ spans: null, luma: null }, ...clips.map((c) => ({ spans: c.spans, luma: c.luma }))]
          : clips.map((c) => ({ spans: c.spans, luma: c.luma }));
      const sources = options.intro
        ? [options.intro, ...clips.map((c) => c.source)]
        : clips.map((c) => c.source);
      const extraInputs: string[] = [];
      for (const src of sources.slice(1)) extraInputs.push('-i', src);
      let ttsIndex: number | undefined;
      let musicIndex: number | undefined;
      if (ttsPath) {
        ttsIndex = sources.length;
        extraInputs.push('-i', ttsPath);
      }
      if (track) {
        musicIndex = ttsPath ? sources.length + 1 : sources.length;
        extraInputs.push('-stream_loop', '-1', '-i', track.path);
      }

      // The pill is rasterised before the graph so its real size can place
      // it; a guessed size would drift as the tagline changes.
      let ctaOverlay: { path: string; width: number; height: number } | null = null;
      if (options.cta?.url) {
        ctaOverlay = await renderCtaPng(options.cta, canvas.width, workDir);
        extraInputs.push('-i', ctaOverlay.path);
      }

      const graph = buildRenderGraph({
        clips: graphClips,
        speed,
        clipSpeeds: options.intro ? [1, ...perClipSpeed] : perClipSpeed,
        contrast,
        keepSourceAudio,
        assPath,
        ttsIndex,
        musicIndex,
        musicVolume,
        outputDuration,
        canvas,
        fill: options.fill,
        cta: ctaOverlay
          ? {
              index: sources.length + (ttsPath ? 1 : 0) + (track ? 1 : 0),
              height: ctaOverlay.height,
            }
          : undefined,
      });
      const graphPath = join(workDir, 'graph.txt');
      writeFileSync(graphPath, graph, 'utf8');

      const hasAudio = ttsPath !== undefined || track !== null || keepSourceAudio;
      await executeFFmpegWithProgress({
        input: sources[0],
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
          // The graph is filter-bound, not encoder-bound: VAAPI on an
          // integrated Radeon measured SLOWER than this once hwupload was
          // paid for, and libx264 medium/crf18 cost 20% more than
          // veryfast/crf20 for no visible gain at phone size.
          ...(options.draft
            ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30']
            : await fastEncoderArgs()),
          '-movflags',
          '+faststart',
        ],
      });
    });

    // ---- the edit, as data ----
    let projectPath: string | null = null;
    if (options.emitProject !== false) {
      projectPath = await time('project', async () => {
        const path = projectPathFor(output);
        // The narration is synthesised into a temp dir that is torn down at
        // the end of this call, so a project pointing there would reference
        // media that no longer exists and could never be re-rendered. Keep
        // a copy beside the project instead.
        let narrationBeside: string | null = null;
        if (ttsPath) {
          narrationBeside = `${output.replace(/\.[^.]+$/, '')}-narration.m4a`;
          copyFileSync(ttsPath, narrationBeside);
        }
        await emitVidletProject({
          output: path,
          title: basename(output).replace(/\.[^.]+$/, ''),
          width: canvas.width,
          height: canvas.height,
          fps: 30,
          clips: clips.map((c) => ({ source: c.source, spans: c.spans })),
          speed,
          clipSpeeds: perClipSpeed,
          intro: options.intro,
          introSeconds,
          narration: narrationBeside ? { path: narrationBeside, start: 0 } : null,
          music: track ? { path: track.path, volume: musicVolume } : null,
          subtitles: captionEntries.map((e) => ({
            start: e.startTime,
            end: e.endTime,
            text: e.text,
            // The measured per-word timing behind the burned karaoke. Dropping
            // it here is what made a re-render come back as plain blocks.
            words: e.words,
          })),
        });
        return path;
      });
    }

    let masking: AutoShortResult['masking'] = {
      scanned: false,
      regionsMasked: 0,
      note: 'Sensitive-data scan disabled by the caller.',
    };
    // A draft is never published, so scanning it for card numbers is time
    // spent on a file that gets deleted.
    if (options.maskSensitive !== false && !options.draft && wantRender) {
      progress('scanning for sensitive info');
      masking = await time('mask', async () => {
        const scan = await runMask({ input: output, output: '', dryRun: true, sampleFps: 0.5 });
        if (!scan.ocrAvailable) {
          return { scanned: false, regionsMasked: 0, note: scan.note };
        }
        if (scan.regions.length === 0) {
          return { scanned: true, regionsMasked: 0, note: 'Nothing sensitive found.' };
        }
        // Detection is a guess: OCR reads a window title or a file path as an
        // address often enough that covering it unasked ruins more edits than
        // it protects. Report and let the caller decide, unless they already
        // have.
        if (!options.maskApply) {
          return {
            scanned: true,
            regionsMasked: 0,
            pending: scan.regions,
            note:
              `Found ${scan.regions.length} region(s) that look sensitive, and covered ` +
              'nothing. Confirm before masking - detection on a screen recording has ' +
              'false positives.',
          };
        }
        // Mask into a temp file, then replace the output in place so the
        // caller only ever sees one finished video at the promised path.
        const masked = join(workDir, 'masked.mp4');
        await runMask({ input: output, output: masked, regions: scan.regions });
        copyFileSync(masked, output);
        return { scanned: true, regionsMasked: scan.regions.length };
      });
    }

    success(`Output: ${output}`);
    return {
      output,
      masking,
      sourceDuration,
      keptDuration,
      outputDuration,
      speed,
      videos: files.videos.length,
      resolution: `${canvas.width}x${canvas.height}`,
      draft: options.draft === true,
      cachedAnalysis: cacheHit,
      project: projectPath,
      rendered: wantRender,
      introSeconds: Number(introSeconds.toFixed(2)),
      spansKept: clips.reduce((n, c) => n + c.spans.length, 0),
      retakesDropped: clips.reduce((n, c) => n + c.retakesDropped, 0),
      voiced,
      narration: wantTts ? 'tts' : keepSourceAudio ? 'original-voice' : 'none',
      contentAligned: alignedStartsUsed,
      narrationSeconds: Number(narrationSeconds.toFixed(1)),
      captionsBurned: assPath !== undefined,
      music: track,
      stageSeconds,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
