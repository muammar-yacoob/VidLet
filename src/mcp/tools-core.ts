/**
 * Core video-file MCP tools (probe, captions, jumpcut, trim, compress,
 * extract audio, gif). Schemas and handlers moved verbatim from mcp.js.
 */
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { checkFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { changeExtension, getOutputPath } from '../lib/paths.js';
import { extractAudio } from '../tools/audio.js';
import { caption, type SrtEntry } from '../tools/caption.js';
import { compress } from '../tools/compress.js';
import { emitVidletProject, projectPathFor } from '../tools/emit-project.js';
import { jumpcut } from '../tools/jumpcut.js';
import { speedup } from '../tools/speedup.js';
import { togif } from '../tools/togif.js';
import { trim } from '../tools/trim.js';
import {
  editorUrlFor,
  fileResult,
  fileUrl,
  jsonContent,
  PATH_PROPERTY,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  type ToolDefinition,
  type ToolHandler,
  withSilencedStdout,
} from './shared.js';

export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: 'probe_video',
    description:
      'Read-only: duration, resolution, fps, codec, bitrate, audio presence, file size. Writes nothing.',
    inputSchema: { type: 'object', properties: { ...PATH_PROPERTY }, required: ['path'] },
  },
  {
    name: 'generate_captions',
    description:
      'Auto-transcribe locally with whisper.cpp (English only) and burn styled captions in. ' +
      'Never overwrites input; default output is "<name>_captioned.<ext>" in a VidLet/ subfolder ' +
      'beside the source, numbered (-1, -2, ...) if that already exists. Also saves the ' +
      'transcript as a "<name>_captioned.vidlet" project: amend captions by editing it (or via ' +
      'the returned edit_url on vidlet.app) and calling render_project — no re-transcription.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        language: {
          type: 'string',
          description: 'Must be "en" or omitted — bundled whisper.cpp models are English-only.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'auto_jump_cut',
    description:
      'Auto-edit: cut silence and add alternating punch-in zoom. Never overwrites input; default ' +
      'output is "<name>_jumpcut.<ext>" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        output_path: { type: 'string', description: 'Optional explicit output path.' },
        silence_threshold: {
          type: 'number',
          description:
            'Silence threshold in dB (more negative = more sensitive). Default -30 (normal pace).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'speed_up_video',
    description:
      'Change playback speed. Audio keeps its pitch via chained atempo, so speech stays natural ' +
      'up to about 2x; past that treat the audio as texture (or mute it). Never overwrites ' +
      'input; default output is "<name>_speedup.<ext>" in a VidLet/ subfolder, numbered if that ' +
      'already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        speed: {
          type: 'number',
          description:
            'Playback multiplier, 0.25-60. Default 1.5. 15 suits screen-recording timelapse.',
        },
        pitch_shift: {
          type: 'number',
          description: 'Optional pitch nudge in percent (-5 to 5). Default -0.03.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'trim_video',
    description:
      'Cut a video to a start/end time range (fast stream copy). Never overwrites input; default ' +
      'output is "<name>_trimmed.<ext>" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        start: { type: 'number', description: 'Start time in seconds.' },
        end: { type: 'number', description: 'End time in seconds.' },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path', 'start', 'end'],
    },
  },
  {
    name: 'compress_video',
    description:
      'Re-encode with H.264 to shrink file size. Never overwrites input; default output is ' +
      '"<name>_compressed.<ext>" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        bitrate: { type: 'number', description: 'Target video bitrate in kbps.' },
        preset: {
          type: 'string',
          enum: [
            'ultrafast',
            'superfast',
            'veryfast',
            'faster',
            'fast',
            'medium',
            'slow',
            'slower',
            'veryslow',
          ],
          description: 'x264 encoding speed/quality preset.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'extract_audio',
    description:
      'Pull the audio track out to its own file. Never overwrites input; default output is ' +
      '"<name>.<format>" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        format: {
          type: 'string',
          enum: ['mp3', 'aac', 'wav', 'flac', 'ogg'],
          description: 'Output audio format, default mp3.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'convert_to_gif',
    description:
      'Convert to an optimized (palette-generated) GIF. Never overwrites input; default output is ' +
      '"<name>.gif" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        fps: { type: 'number', description: 'Frames per second, default 15.' },
        width: {
          type: 'number',
          description: 'Output width in px (height auto-scaled), default 480.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
];

async function handleProbeVideo({ path }: { path?: string }) {
  const input = resolveInputPath(path);
  return withSilencedStdout(async () => {
    const info = await getVideoInfo(input);
    const sizeBytes = statSync(input).size;
    return jsonContent({ path: input, sizeBytes, ...info });
  });
}

/**
 * The transcription is the expensive half of generate_captions. Persist it
 * as a `.vidlet` project referencing the ORIGINAL video (full length, audio
 * kept) so any caption amendment is an edit + render_project, not a second
 * whisper run. Best-effort: a finished render never fails over its sidecar.
 */
async function emitCaptionProject(
  input: string,
  output: string,
  transcript: SrtEntry[]
): Promise<string | null> {
  try {
    const info = await getVideoInfo(input);
    const project = projectPathFor(output);
    await emitVidletProject({
      output: project,
      title: basename(output).replace(/\.[^.]+$/, ''),
      width: info.width,
      height: info.height,
      fps: info.fps || 30,
      clips: [{ source: input, spans: [{ start: 0, end: info.duration }] }],
      speed: 1,
      introSeconds: 0,
      narration: null,
      music: null,
      subtitles: transcript.map((e) => ({
        start: e.startTime,
        end: e.endTime,
        text: e.text,
        words: e.words,
      })),
      keepClipAudio: true,
      generator: 'vidlet generate_captions',
      // What the burn below actually uses (caption() defaults).
      subtitleStyle: { captionStyle: 'hormozi', highlightColor: '&H00FFFF&' },
    });
    return project;
  } catch {
    return null;
  }
}

async function handleGenerateCaptions({
  path,
  language,
  output_path,
}: {
  path?: string;
  language?: string;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  if (language && language !== 'en') {
    throw new Error(
      `Unsupported language "${language}" — bundled whisper.cpp models are English-only (tiny.en/base.en/small.en). Only "en" is supported.`
    );
  }
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_captioned');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      if (!(await checkFFmpeg()))
        throw new Error('FFmpeg not found. Install with: sudo apt install ffmpeg');
      let transcript: SrtEntry[] = [];
      const result = await caption({
        input,
        output,
        autoTranscribe: true,
        whisperModel: 'base.en',
        onTranscript: (entries) => {
          transcript = entries;
        },
      });
      const project = await emitCaptionProject(input, output, transcript);
      const editUrl = project ? editorUrlFor(project) : null;
      return fileResult(
        result,
        project
          ? {
              project,
              projectUrl: fileUrl(project),
              ...(editUrl ? { edit_url: editUrl } : {}),
              next_steps: [
                'To amend the captions (wording, timing, style) do NOT re-run this tool: the ' +
                  'transcript is saved in `project`. Edit its subtitles block' +
                  (editUrl
                    ? ' — or give the user `edit_url`, which opens it in the vidlet.app editor ' +
                      'under their own signed-in account'
                    : ' (open_in_editor loads it in the vidlet.app editor)') +
                  ' — then call render_project to re-burn from the original video with no ' +
                  're-transcription.',
              ],
            }
          : {},
        project ? [project] : []
      );
    })
  );
}

async function handleAutoJumpCut({
  path,
  output_path,
  silence_threshold,
}: {
  path?: string;
  output_path?: string;
  silence_threshold?: number;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_jumpcut');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await jumpcut({ input, output, silenceThreshold: silence_threshold });
      return fileResult(result);
    })
  );
}

async function handleSpeedUpVideo({
  path,
  speed,
  pitch_shift,
  output_path,
}: {
  path?: string;
  speed?: number;
  pitch_shift?: number;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_speedup');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await speedup({ input, output, speed, pitchShift: pitch_shift });
      return fileResult(result);
    })
  );
}

async function handleTrimVideo({
  path,
  start,
  end,
  output_path,
}: {
  path?: string;
  start?: number;
  end?: number;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error('`start` and `end` (seconds) are required');
  }
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_trimmed');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await trim({ input, output, start, end });
      return fileResult(result);
    })
  );
}

async function handleCompressVideo({
  path,
  bitrate,
  preset,
  output_path,
}: {
  path?: string;
  bitrate?: number;
  preset?: import('../tools/compress.js').CompressOptions['preset'];
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_compressed');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await compress({ input, output, bitrate, preset });
      return fileResult(result);
    })
  );
}

async function handleExtractAudio({
  path,
  format,
  output_path,
}: {
  path?: string;
  format?: import('../tools/audio.js').ExtractAudioOptions['format'];
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path
    ? resolve(output_path)
    : changeExtension(input, `.${format ?? 'mp3'}`);
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await extractAudio({ input, output, format });
      return fileResult(result);
    })
  );
}

async function handleConvertToGif({
  path,
  fps,
  width,
  output_path,
}: {
  path?: string;
  fps?: number;
  width?: number;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : changeExtension(input, '.gif');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await togif({ input, output, fps, width });
      return fileResult(result);
    })
  );
}

export const CORE_HANDLERS: Record<string, ToolHandler> = {
  probe_video: handleProbeVideo,
  generate_captions: handleGenerateCaptions,
  auto_jump_cut: handleAutoJumpCut,
  speed_up_video: handleSpeedUpVideo,
  trim_video: handleTrimVideo,
  compress_video: handleCompressVideo,
  extract_audio: handleExtractAudio,
  convert_to_gif: handleConvertToGif,
};
