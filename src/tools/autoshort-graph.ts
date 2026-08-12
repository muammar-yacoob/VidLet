/**
 * The whole auto-edit expressed as ONE ffmpeg filtergraph.
 *
 * One graph, one encode. Earlier versions ran four passes (trim, grade,
 * speed, caption) and took eight minutes; folding them into a single
 * filter_complex took the same job to under thirty seconds. The ordering
 * inside is load bearing: speed is applied BEFORE scaling and blurring, so
 * the expensive filters run on the frames that survive rather than on all
 * of them, and the CTA overlay composites AFTER captions so captions can
 * never draw over it.
 */
import { MASTER_CHAIN } from '@spark-apps/video-kit';
import { videoEncoderArgs } from '../lib/ffmpeg.js';
import { averageStats, type LumaStats, matchGrade } from '../lib/grade.js';
import type { TimeSegment } from '../lib/segments.js';
import { SHORT_H, SHORT_W } from './autoshort-analysis.js';
import { buildSpeedupAudioFilters } from './speedup.js';
import { buildSelectExpr, escapeFilterPath } from './timelapse.js';

/**
 * The whole edit as one filtergraph: per-clip trim and grade, framed to a
 * common canvas, concatenated, sped up, captions burned, narration over a
 * ducked bed.
 */
export function buildRenderGraph(opts: {
  /** `spans: null` means "use the whole clip, at natural speed" (an intro). */
  clips: Array<{ spans: TimeSegment[] | null; luma: LumaStats | null }>;
  speed: number;
  contrast: number;
  keepSourceAudio: boolean;
  assPath?: string;
  ttsIndex?: number;
  musicIndex?: number;
  musicVolume: number;
  outputDuration: number;
  canvas?: { width: number; height: number };
  fill?: 'pad' | 'crop';
  /** Per-clip playback rate; falls back to `speed` for every clip. */
  clipSpeeds?: number[];
  /** Rasterised CTA pill: which input carries it, and how tall it is. */
  cta?: { index: number; height: number };
}): string {
  const { clips, speed, contrast, keepSourceAudio, assPath, ttsIndex, musicIndex } = opts;
  const { width: outW, height: outH } = opts.canvas ?? { width: SHORT_W, height: SHORT_H };
  const chains: string[] = [];

  const measured = clips.flatMap((c) => (c.luma ? [c.luma] : []));
  const target = measured.length > 0 ? averageStats(measured) : null;

  clips.forEach((clip, i) => {
    const grade =
      target && clip.luma ? matchGrade(clip.luma, target, contrast) : { contrast, brightness: 0 };
    // Trim, grade and frame in one go. Every clip lands on the same canvas
    // because concat demands identical width/height/SAR.
    // Speed is applied HERE, before the scale/blur, not after the concat.
    // The kept footage is several times longer than the finished Short, so
    // scaling it to 1080x1920 first means blurring thousands of frames that
    // are about to be dropped - the single biggest cost in the render.
    // An intro (spans === null) plays whole and at natural speed; footage
    // is trimmed to its kept spans and swept up to the timelapse rate.
    const rate = opts.clipSpeeds?.[i] ?? speed;
    const head = clip.spans
      ? `select='${buildSelectExpr(clip.spans)}',setpts=N/FRAME_RATE/TB,setpts=PTS/${rate},fps=30`
      : 'fps=30,setpts=PTS-STARTPTS';
    chains.push(
      `[${i}:v]${head},` +
        `eq=contrast=${grade.contrast}:brightness=${grade.brightness},split=2[bg${i}][fg${i}]`
    );
    chains.push(
      `[bg${i}]scale=${Math.round(outW / 4)}:${Math.round(outH / 4)}:force_original_aspect_ratio=increase,` +
        `crop=${Math.round(outW / 4)}:${Math.round(outH / 4)},gblur=sigma=8,scale=${outW}:${outH},` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:thickness=fill[bgb${i}]`
    );
    chains.push(
      opts.fill === 'crop'
        ? // Zoom until the canvas is covered, then trim the overflow. The
          // blurred backdrop still exists underneath but is never seen.
          `[fg${i}]scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=lanczos,` +
            `crop=${outW}:${outH}[fgs${i}]`
        : `[fg${i}]scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos[fgs${i}]`
    );
    chains.push(`[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1[n${i}]`);
    if (keepSourceAudio && clip.spans) {
      chains.push(`[${i}:a]aselect='${buildSelectExpr(clip.spans)}',asetpts=N/SR/TB[na${i}]`);
    }
  });

  const vIn = clips.map((_, i) => `[n${i}]`).join('');
  chains.push(`${vIn}concat=n=${clips.length}:v=1:a=0[cv]`);
  const captions = assPath ? `,ass='${escapeFilterPath(assPath)}'` : '';
  if (opts.cta) {
    // Captions first, then the pill on top: a caption must never draw over
    // the call to action.
    chains.push(`[cv]${captions ? captions.slice(1) : 'null'},format=yuv420p[capped]`);
    // Sits below the safe-area margin, centred, for the whole runtime.
    const y = Math.round(outH * 0.045);
    chains.push(`[capped][${opts.cta.index}:v]overlay=(W-w)/2:${y}:format=auto[v]`);
  } else {
    chains.push(`[cv]${captions ? captions.slice(1) : 'null'},format=yuv420p[v]`);
  }

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
    chains.push(`${voiceLabel}atrim=0:${opts.outputDuration.toFixed(3)}[premix]`);
    chains.push('[premix]anull[mixed]');
  }
  // YouTube, Instagram and TikTok all normalise playback to roughly
  // -14 LUFS. Arriving at that level means the platform leaves the audio
  // alone instead of pulling it up or down. Skipped entirely when the
  // Short is silent, since there would be no [a] to normalise.
  const hasAudioChain = musicIndex !== undefined || voiceLabel !== null;
  if (hasAudioChain) {
    const last = chains[chains.length - 1];
    if (last.endsWith('[a]')) {
      chains[chains.length - 1] = `${last.slice(0, -3)}[mixed]`;
    }
    // loudnorm alone is not enough: in single-pass mode it cannot see the
    // whole file's peaks in advance, so it estimates gain from a running
    // measurement and overshoots on sharp transients - exactly what TTS
    // consonants produce. Measured on a real render: TP=-1.5 was requested
    // and the output peaked at +0.9 dBTP, past digital clipping. alimiter
    // afterward is a hard, lookahead-based ceiling that catches whatever
    // loudnorm's estimate missed, at -1 dBTP (YouTube's own ceiling).
    chains.push(`[mixed]${MASTER_CHAIN}[a]`);
  }

  return chains.join(';');
}

/**
 * Encoder for the final pass. Real GPU encoders are worth it; integrated
 * VAAPI is not, because the expensive part of this graph is the CPU-side
 * blur and scale, and hwupload only adds a transfer.
 */
export async function fastEncoderArgs(): Promise<string[]> {
  const gpu = await videoEncoderArgs();
  if (gpu.includes('h264_nvenc')) return gpu;
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
}
