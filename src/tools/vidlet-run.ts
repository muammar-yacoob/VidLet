/**
 * Tool dispatch for the unified VidLet window.
 *
 * Each entry says what to log, what to run, and what to say when it lands;
 * `runTool` owns the surrounding logging, status reset and error handling so
 * no tool has to repeat it.
 */
import { logToFile } from '../lib/logger.js';
import { setProcessStatus } from '../lib/process-status.js';
import { addAudio, extractAudio } from './audio.js';
import { autoCleanup } from './autocleanup.js';
import { caption } from './caption.js';
import { cleanVoice, ensureDeepFilter } from './cleanvoice.js';
import { compress } from './compress.js';
import { demo } from './demo.js';
import { filter } from './filter.js';
import { jumpcut } from './jumpcut.js';
import { mkv2mp4 } from './mkv2mp4.js';
import { type OverlayLayer, overlay } from './overlay.js';
import { removeSilence } from './removesilence.js';
import { short } from './short.js';
import { type PortraitSegment, portrait, portraitMultiSegment } from './shorts.js';
import { shrink } from './shrink.js';
import { thumb } from './thumb.js';
import { togif } from './togif.js';
import { trim, trimAccurate } from './trim.js';
import { resolveCloneEngine, voiceover } from './voiceover.js';

/** Tool-specific options interface */
export interface ToolOptions {
  tool: string;
  inputPath?: string; // Custom input path (used for chained workflows)
  // Compress options
  bitrate?: number;
  preset?: string;
  codec?: 'h264' | 'hevc';
  // ToGIF options
  fps?: number;
  width?: number;
  dither?: string;
  // MKV2MP4 options
  copyStreams?: boolean;
  crf?: number;
  // Shrink options
  targetDuration?: number;
  // Thumb options
  imagePath?: string;
  thumbTimestamp?: number;
  // Trim options
  trimStart?: number;
  trimEnd?: number;
  accurate?: boolean;
  // Portrait options
  mode?: 'crop' | 'blur';
  cropX?: number;
  resolution?: number;
  segments?: PortraitSegment[];
  transition?: 'none' | 'fade' | 'dissolve';
  transitionDuration?: number;
  // Audio options
  audioPath?: string;
  audioVolume?: number;
  audioMix?: boolean;
  // Extract audio options
  audioFormat?: 'mp3' | 'aac' | 'wav' | 'flac';
  audioBitrate?: number;
  // Clean voice options
  noiseReduction?: number;
  targetLoudness?: number;
  noiseSampleStart?: number;
  noiseSampleEnd?: number;
  // Filter options
  filterBrightness?: number;
  filterContrast?: number;
  filterSaturation?: number;
  filterGrayscale?: boolean;
  filterSepia?: boolean;
  filterBlur?: number;
  filterSharpen?: boolean;
  filterVignette?: boolean;
  // Caption options
  srtContent?: string;
  captionFontSize?: number;
  captionPosition?: 'bottom' | 'center' | 'top';
  captionStyle?: 'classic' | 'hormozi' | 'karaoke' | 'minimal';
  captionColor?: string;
  captionAutoTranscribe?: boolean;
  captionWhisperModel?: 'tiny.en' | 'base.en' | 'small.en';
  // Jump cut options
  jumpcutPace?: 'tight' | 'normal' | 'loose';
  jumpcutZoom?: number;
  // Remove silence options
  minSilenceDuration?: number;
  silenceThreshold?: number;
  // Auto cleanup options
  skipContrast?: boolean;
  cleanupContrast?: number;
  // AI Short options
  maxDuration?: number;
  captions?: boolean;
  // Voiceover options
  text?: string;
  language?: string;
  gender?: 'female' | 'male';
  cloneRef?: string;
  cloneEngine?: string;
  // Demo options
  about?: string;
  makeShort?: boolean;
  // Overlay options
  overlayLayers?: OverlayLayer[];
}

/** Process result */
export interface ProcessResult {
  success: boolean;
  output?: string;
  error?: string;
  logs: Array<{ type: string; message: string }>;
}

/** A message that is either fixed or chosen from the submitted options. */
type Message = string | ((o: ToolOptions) => string);

interface ToolStep {
  /** Logged before the work starts. */
  start: Message;
  /** Logged once it succeeds. */
  done: Message;
  /** Do the work; resolves to the output path. */
  run: (input: string, o: ToolOptions) => Promise<string>;
}

/** Long-running tools stream their stage to the window's status line. */
const onProgress = (stage: string) => setProcessStatus(stage);

const TOOL_STEPS: Record<string, ToolStep> = {
  compress: {
    start: 'Starting compression...',
    done: 'Compression complete!',
    run: (input, o) =>
      compress({
        input,
        bitrate: o.bitrate,
        preset: o.preset as Parameters<typeof compress>[0]['preset'],
        codec: o.codec,
      }),
  },

  togif: {
    start: 'Creating optimized GIF...',
    done: 'GIF created!',
    run: (input, o) =>
      togif({
        input,
        fps: o.fps,
        width: o.width,
        dither: o.dither as Parameters<typeof togif>[0]['dither'],
      }),
  },

  mkv2mp4: {
    start: 'Converting MKV to MP4...',
    done: 'Conversion complete!',
    run: (input, o) => mkv2mp4({ input, copyStreams: o.copyStreams, crf: o.crf }),
  },

  shrink: {
    start: 'Shrinking video...',
    done: 'Video shrunk!',
    run: (input, o) => shrink({ input, targetDuration: o.targetDuration }),
  },

  thumb: {
    start: 'Embedding thumbnail...',
    done: 'Thumbnail set!',
    run: (input, o) => {
      if (!o.imagePath && o.thumbTimestamp === undefined) {
        throw new Error('No image or frame timestamp provided for thumbnail');
      }
      return thumb({ input, image: o.imagePath, timestamp: o.thumbTimestamp });
    },
  },

  trim: {
    start: (o) => (o.accurate ? 'Trimming with re-encoding...' : 'Trimming video...'),
    done: 'Video trimmed!',
    run: (input, o) => {
      if (o.trimStart === undefined || o.trimEnd === undefined) {
        throw new Error('Start and end times are required for trimming');
      }
      const impl = o.accurate ? trimAccurate : trim;
      return impl({ input, start: o.trimStart, end: o.trimEnd });
    },
  },

  portrait: {
    start: 'Creating portrait version...',
    done: 'Portrait created!',
    run: (input, o) => {
      // Multi-segment needs the stitching path; a single crop does not
      if (o.segments && o.segments.length > 1) {
        return portraitMultiSegment({
          input,
          segments: o.segments,
          resolution: o.resolution || 1080,
          transition: o.transition || 'none',
          transitionDuration: o.transitionDuration || 0.3,
        });
      }
      return portrait({
        input,
        mode: o.mode || 'crop',
        cropX: o.segments?.[0]?.cropX ?? o.cropX ?? 0.5,
        resolution: o.resolution || 1080,
      });
    },
  },

  audio: {
    start: 'Adding audio...',
    done: 'Audio added!',
    run: (input, o) => {
      if (!o.audioPath) {
        throw new Error('No audio file provided');
      }
      return addAudio({
        input,
        audio: o.audioPath,
        volume: o.audioVolume ?? 0.5,
        mix: o.audioMix ?? true,
      });
    },
  },

  filter: {
    start: 'Applying filters...',
    done: 'Filters applied!',
    run: (input, o) =>
      filter({
        input,
        brightness: o.filterBrightness,
        contrast: o.filterContrast,
        saturation: o.filterSaturation,
        grayscale: o.filterGrayscale,
        sepia: o.filterSepia,
        blur: o.filterBlur,
        sharpen: o.filterSharpen,
        vignette: o.filterVignette,
      }),
  },

  caption: {
    start: (o) =>
      o.captionAutoTranscribe ? 'Transcribing and adding captions...' : 'Adding captions...',
    done: 'Captions added!',
    run: (input, o) => {
      if (!o.srtContent && !o.captionAutoTranscribe) {
        throw new Error('No subtitle source: provide SRT content or enable auto-transcribe');
      }
      return caption({
        input,
        srtContent: o.srtContent,
        autoTranscribe: o.captionAutoTranscribe,
        whisperModel: o.captionWhisperModel,
        style: o.captionStyle,
        highlightColor: o.captionColor,
        fontSize: o.captionFontSize,
        position: o.captionPosition,
        onProgress,
      });
    },
  },

  jumpcut: {
    start: 'Creating jump cuts...',
    done: 'Jump cuts complete!',
    run: (input, o) => jumpcut({ input, pace: o.jumpcutPace, zoom: o.jumpcutZoom, onProgress }),
  },

  short: {
    start: 'Creating AI Short...',
    done: 'AI Short ready! Crops/times editable in the .segments.json beside it.',
    run: (input, o) =>
      short({ input, maxDuration: o.maxDuration, captions: o.captions, onProgress }),
  },

  demo: {
    start: 'Creating AI demo (trim + narrate + short)...',
    done: 'Demo ready! Script saved beside it - edit + re-voice any time.',
    run: (input, o) =>
      demo({
        input,
        about: o.about,
        gender: o.gender,
        cloneRef: o.cloneRef,
        short: o.makeShort,
        captions: o.captions,
        onProgress,
      }),
  },

  voiceover: {
    start: 'Generating voiceover...',
    done: 'Voiceover mixed in!',
    run: (input, o) => {
      if (!o.text?.trim()) throw new Error('Narration script is empty');
      return voiceover({
        input: o.text,
        video: input,
        language: o.language,
        gender: o.gender,
        cloneRef: o.cloneRef,
        cloneEngine: resolveCloneEngine(o.cloneEngine),
        onProgress,
      });
    },
  },

  cleanvoice: {
    start: 'Cleaning voice audio...',
    done: 'Voice cleaned!',
    run: async (input, o) => {
      await ensureDeepFilter().catch(() => {});
      return cleanVoice({
        input,
        noiseReduction: o.noiseReduction,
        targetLoudness: o.targetLoudness,
        noiseSampleStart: o.noiseSampleStart,
        noiseSampleEnd: o.noiseSampleEnd,
        onProgress,
      });
    },
  },

  extractaudio: {
    start: 'Extracting audio...',
    done: 'Audio extracted!',
    run: (input, o) =>
      extractAudio({ input, format: o.audioFormat ?? 'mp3', bitrate: o.audioBitrate ?? 192 }),
  },

  removesilence: {
    start: 'Removing silent segments...',
    done: 'Silence removed!',
    run: (input, o) =>
      removeSilence({
        input,
        minSilenceDuration: o.minSilenceDuration,
        silenceThreshold: o.silenceThreshold,
      }),
  },

  autocleanup: {
    start: 'Running auto cleanup pipeline...',
    done: 'Auto cleanup complete!',
    run: (input, o) =>
      autoCleanup({
        input,
        noiseReduction: o.noiseReduction,
        minSilenceDuration: o.minSilenceDuration,
        contrast: o.cleanupContrast,
        skipContrast: o.skipContrast,
        onProgress,
      }),
  },

  overlay: {
    start: (o) => `Applying ${o.overlayLayers?.length ?? 0} overlay(s)...`,
    done: 'Overlays applied!',
    run: (input, o) => {
      if (!o.overlayLayers?.length) {
        throw new Error('No overlay layers provided');
      }
      return overlay({ input, layers: o.overlayLayers });
    },
  },
};

function render(message: Message, o: ToolOptions): string {
  return typeof message === 'function' ? message(o) : message;
}

/**
 * Run the selected tool with options
 */
export async function runTool(input: string, opts: ToolOptions): Promise<ProcessResult> {
  const logs: Array<{ type: string; message: string }> = [];
  const toolId = opts.tool;

  // Use custom input path if provided (for chained workflows)
  const actualInput = opts.inputPath || input;

  logToFile(`VidLet: Running tool ${toolId} on ${actualInput}`);
  logToFile(`VidLet: Options: ${JSON.stringify(opts)}`);

  try {
    const step = TOOL_STEPS[toolId];
    if (!step) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    logs.push({ type: 'info', message: render(step.start, opts) });
    const output = await step.run(actualInput, opts);
    logs.push({ type: 'success', message: render(step.done, opts) });

    logToFile(`VidLet: Tool ${toolId} completed successfully. Output: ${output}`);
    return { success: true, output, logs };
  } catch (err) {
    const errorMsg = (err as Error).message;
    logToFile(`VidLet: Tool ${toolId} failed: ${errorMsg}`);
    logs.push({ type: 'error', message: errorMsg });
    return { success: false, error: errorMsg, logs };
  } finally {
    // Clear whatever stage the tool last reported
    setProcessStatus('');
  }
}
