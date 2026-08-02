/**
 * The tool registry: metadata, CLI entry point and optional GUI for every tool.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VideoInfo } from '../lib/gui-server.js';
import { extractAudio } from '../tools/audio.js';
import { autoCleanup } from '../tools/autocleanup.js';
import { caption } from '../tools/caption.js';
import { cleanVoice } from '../tools/cleanvoice.js';
import { compress } from '../tools/compress.js';
import { jumpcut } from '../tools/jumpcut.js';
import { loop } from '../tools/loop.js';
import { mkv2mp4 } from '../tools/mkv2mp4.js';
import { optimize } from '../tools/optimize.js';
import { removeSilence } from '../tools/removesilence.js';
import { portrait } from '../tools/shorts.js';
import { shrink } from '../tools/shrink.js';
import { speedup } from '../tools/speedup.js';
import { thumb } from '../tools/thumb.js';
import { togif } from '../tools/togif.js';
import { trim, trimAccurate } from '../tools/trim.js';
import { type GuiOptions, guiRunner } from './gui-runner.js';

/** Tool metadata — drives the CLI listing and the Windows context menu. */
export interface ToolConfig {
  id: string;
  name: string;
  icon: string;
  extensions: string[];
  description: string;
}

/** A tool with its CLI entry point and, where it has one, its GUI. */
export interface Tool {
  config: ToolConfig;
  run: (input: string, options: GuiOptions) => Promise<string>;
  runGUI?: (input: string) => Promise<void>;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

/**
 * Hand options straight to a tool.
 *
 * Callers have already narrowed them: CLI commands build a named object in
 * `src/cli/commands/`, and GUI pages post the fields their form declares. The
 * input path always wins over anything of that name in the options.
 */
function forward<O extends { input: string }>(
  tool: (options: O) => Promise<string>
): (input: string, options: GuiOptions) => Promise<string> {
  return (input, options) => tool({ ...options, input } as unknown as O);
}

/** Trim uses a different implementation when frame accuracy is requested. */
function runTrim(input: string, o: GuiOptions): Promise<string> {
  const impl = o.accurate ? trimAccurate : trim;
  return impl({
    input,
    output: o.output as string | undefined,
    start: o.start as number,
    end: o.end as number,
  });
}

/** Optimize accepts non-video input, so it reports file size only. */
function statOnly(input: string): Promise<VideoInfo> {
  const stats = fs.statSync(input);
  return Promise.resolve({
    filePath: input,
    fileName: path.basename(input),
    width: 0,
    height: 0,
    duration: 0,
    fps: 0,
    bitrate: 0,
    fileSize: stats.size,
    hasAudio: false,
  });
}

const isGif = (input: string) => path.extname(input).toLowerCase() === '.gif';

export const tools: Tool[] = [
  {
    config: {
      id: 'compress',
      name: 'Compress',
      icon: 'compress.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Compress video using H.264 encoding',
    },
    run: forward(compress),
    runGUI: guiRunner({
      htmlFile: 'compress.html',
      title: 'Compress Video',
      settings: 'compress',
      start: 'Starting compression...',
      done: 'Compression complete!',
      run: forward(compress),
    }),
  },
  {
    config: {
      id: 'togif',
      name: 'To GIF',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Convert video to optimized GIF',
    },
    run: forward(togif),
    runGUI: guiRunner({
      htmlFile: 'togif.html',
      title: 'Convert to GIF',
      settings: 'togif',
      start: 'Creating optimized palette...',
      done: 'GIF created!',
      run: forward(togif),
    }),
  },
  {
    config: {
      id: 'mkv2mp4',
      name: 'MKV to MP4',
      icon: 'mkv2mp4.ico',
      extensions: ['.mkv'],
      description: 'Convert MKV to MP4 format',
    },
    run: forward(mkv2mp4),
    runGUI: guiRunner({
      htmlFile: 'mkv2mp4.html',
      title: 'MKV to MP4',
      settings: 'mkv2mp4',
      start: 'Converting...',
      done: 'Conversion complete!',
      run: forward(mkv2mp4),
    }),
  },
  {
    config: {
      id: 'shrink',
      name: 'Shrink',
      icon: 'shrink.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Speed up video to target duration',
    },
    run: forward(shrink),
    runGUI: guiRunner({
      htmlFile: 'shrink.html',
      title: 'Shrink Video',
      settings: 'shrink',
      start: 'Shrinking video...',
      done: 'Video shrunk!',
      run: forward(shrink),
    }),
  },
  {
    config: {
      id: 'thumb',
      name: 'Thumbnail',
      icon: 'thumb.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Set video thumbnail from image',
    },
    run: forward(thumb),
    runGUI: guiRunner({
      htmlFile: 'thumb.html',
      title: 'Set Thumbnail',
      extraDefaults: () => ({ imagePath: '' }),
      start: 'Embedding thumbnail...',
      done: 'Thumbnail set!',
      run: (input, o) => {
        if (!o.imagePath) throw new Error('No image path provided');
        return thumb({ input, image: o.imagePath as string });
      },
    }),
  },
  {
    config: {
      id: 'loop',
      name: 'Loop',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Create seamless video loop',
    },
    run: forward(loop),
    runGUI: guiRunner({
      htmlFile: 'loop.html',
      title: 'Create Loop',
      settings: 'loop',
      start: 'Finding loop points...',
      done: 'Loop created!',
      run: forward(loop),
    }),
  },
  {
    config: {
      id: 'trim',
      name: 'Trim',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Trim video to specific time range',
    },
    run: runTrim,
    runGUI: guiRunner({
      htmlFile: 'trim.html',
      title: 'Trim Video',
      extraDefaults: (_input, videoInfo) => ({
        start: 0,
        end: videoInfo.duration,
        accurate: false,
      }),
      start: (o) => (o.accurate ? 'Trimming with re-encoding...' : 'Trimming video...'),
      done: 'Video trimmed!',
      run: runTrim,
    }),
  },
  {
    config: {
      id: 'portrait',
      name: 'Portrait',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Convert landscape video to 9:16 portrait',
    },
    run: (input, o) =>
      portrait({ ...o, input, mode: (o.mode as 'crop' | 'blur' | 'fit') || 'crop' }),
  },
  {
    config: {
      id: 'extractaudio',
      name: 'Extract Audio',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Extract audio track from video',
    },
    run: forward(extractAudio),
  },
  {
    config: {
      id: 'optimize',
      name: 'Optimize',
      icon: 'tv.ico',
      extensions: ['.json', '.gif'],
      description: 'Optimize Lottie JSON and GIF files',
    },
    run: forward(optimize),
    runGUI: guiRunner({
      htmlFile: 'optimize.html',
      title: (input) => (isGif(input) ? 'Optimize GIF' : 'Optimize JSON'),
      probe: statOnly,
      extraDefaults: (input) => ({ isGif: isGif(input) }),
      start: (o, input) => {
        if (isGif(input)) return 'Optimizing GIF...';
        return o.dotlottie ? 'Creating .lottie...' : 'Optimizing JSON...';
      },
      done: (_o, input) => (isGif(input) ? 'GIF optimization complete!' : 'Optimization complete!'),
      run: forward(optimize),
    }),
  },
  {
    config: {
      id: 'cleanvoice',
      name: 'Clean Voice',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Clean and enhance voice audio',
    },
    run: forward(cleanVoice),
  },
  {
    config: {
      id: 'removesilence',
      name: 'Remove Silence',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Remove silent segments from video',
    },
    run: forward(removeSilence),
  },
  {
    config: {
      id: 'autocleanup',
      name: 'Auto Cleanup',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Denoise, remove silence, contrast, and compress',
    },
    run: forward(autoCleanup),
  },
  {
    config: {
      id: 'caption',
      name: 'Auto Captions',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Auto-transcribe and burn styled captions',
    },
    run: forward(caption),
  },
  {
    config: {
      id: 'jumpcut',
      name: 'Jump Cut',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Auto-edit: cut silence + punch-in zoom',
    },
    run: forward(jumpcut),
  },
  {
    config: {
      id: 'speedup',
      name: 'Speedup',
      icon: 'tv.ico',
      extensions: VIDEO_EXTENSIONS,
      description: 'Speed up tempo while preserving pitch',
    },
    run: forward(speedup),
    runGUI: guiRunner({
      htmlFile: 'speedup.html',
      title: 'Speedup Video',
      settings: 'speedup',
      start: 'Speeding up video...',
      done: 'Speedup complete!',
      run: forward(speedup),
    }),
  },
];

export const toolConfigs: ToolConfig[] = tools.map((t) => t.config);
