/**
 * Tool definitions (name/description/inputSchema) for the `.vidlet` project
 * MCP tools — split from tools-project.ts, which holds the handlers, to
 * keep both under the repo's 500-line cap.
 */
import type { ToolDefinition } from './shared.js';

const PROJECT_PATH_PROPERTY = {
  path: {
    type: 'string',
    description: 'Absolute (or CWD-relative) path to the .vidlet project file',
  },
};

export const PROJECT_TOOLS: ToolDefinition[] = [
  {
    name: 'create_project',
    description:
      'Create a .vidlet project file (the open CC0 layered-edit JSON format) from a story ' +
      'source: .srt/.vtt subtitles become timed cues, .txt/.md is treated as a script, and a ' +
      'QuickPeek-style .json plan ({url?, steps:[...]}) turns step captions into sequentially ' +
      'timed cues. Registers video/music media by relative path + sha256 and writes the project ' +
      'beside the source, never overwriting. When `voice` or `video_path` are omitted the ' +
      'project is still written and the result contains a `questions` array: relay each ' +
      'question to the user VERBATIM with its options, collect their answers, then call ' +
      'create_project again with those answers filled in.',
    inputSchema: {
      type: 'object',
      properties: {
        source_path: {
          type: 'string',
          description:
            'Path to the story source: .srt/.vtt subtitles, .txt/.md script, or a ' +
            'QuickPeek-style .json plan ({url?, steps:[{caption, duration?}, ...]}).',
        },
        video_path: {
          type: 'string',
          description: 'Optional main-track video (e.g. a screen recording).',
        },
        voice: {
          type: 'object',
          description: 'Narration choice. Omit to receive a question to relay to the user.',
          properties: {
            mode: { type: 'string', enum: ['tts', 'clone', 'none'] },
            language: { type: 'string', description: 'TTS language code, default en.' },
            gender: { type: 'string', enum: ['female', 'male'] },
            clone_ref: {
              type: 'string',
              description: 'Path to a ~10s voice sample (mode "clone").',
            },
          },
        },
        music_path: { type: 'string', description: 'Optional background-music audio file.' },
        output_path: { type: 'string', description: 'Optional explicit .vidlet output path.' },
      },
      required: ['source_path'],
    },
  },
  {
    name: 'validate_project',
    description:
      'Read-only: parse a .vidlet project against the v1 format spec and check that its media ' +
      'files exist (sha256 mismatches are warnings). Returns {valid, schema_version, errors, ' +
      'warnings, missing_media}. Writes nothing.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PATH_PROPERTY },
      required: ['path'],
    },
  },
  {
    name: 'render_project',
    description:
      'Render a .vidlet project to MP4 with native ffmpeg (NVENC when available): main-track ' +
      'cuts with background gaps, overlays, burned subtitles, and a full audio mixdown with ' +
      'narration ducking. Never overwrites input; default output is "<name>.mp4" in a VidLet/ ' +
      'subfolder beside the project, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROPERTY,
        output_path: { type: 'string', description: 'Optional explicit output path.' },
        resolution: {
          type: 'string',
          description: 'Override output resolution: "1920x1080" or "720p"-style.',
        },
        draft: {
          type: 'boolean',
          description: 'Fast preview render: x264 ultrafast, capped at 720p.',
        },
        caption_style: {
          type: 'string',
          enum: ['plain', 'shorts', 'karaoke', 'hormozi', 'classic'],
          description:
            'Force a caption style instead of the one the project records. Projects written ' +
            'by generate_short now store "shorts" (one line at a time, only the spoken word ' +
            'lit) and their per-word timing, so a re-render matches the original Short. Pass ' +
            '"shorts" explicitly for projects made before that was recorded - without it their ' +
            'captions render as plain sentence blocks. Word timings are interpolated when the ' +
            'project has none.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'open_in_editor',
    description:
      'Open a .vidlet project in the vidlet.app browser editor (the project JSON travels in the ' +
      'URL hash, never sent to a server). Small projects auto-open; larger ones return manual ' +
      'steps instead, because OS launchers cap URL length. Writes no files.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PATH_PROPERTY },
      required: ['path'],
    },
  },
  {
    name: 'add_voiceover_to_project',
    description:
      'Generate narration audio (free Edge TTS, or a locally cloned voice via clone_ref) for a ' +
      '.vidlet project and register it as a ducking voice-track clip at 0s. Text defaults to ' +
      "the project's subtitle text. Writes the mp3 plus a NEW .vidlet beside the original — " +
      'never overwrites either.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PATH_PROPERTY,
        text: {
          type: 'string',
          description:
            'Narration script (max 5000 chars). Default: the project subtitle text, joined.',
        },
        language: { type: 'string', description: 'Voice language code, default en.' },
        gender: {
          type: 'string',
          enum: ['female', 'male'],
          description: 'Voice gender, default female.',
        },
        clone_ref: {
          type: 'string',
          description:
            'Path to a ~10s reference recording — switches to the local voice-cloning engine.',
        },
        clone_engine: {
          type: 'string',
          enum: ['chatterbox', 'dots'],
          description: 'Cloning engine used with clone_ref: chatterbox (default) or dots.',
        },
        output_path: { type: 'string', description: 'Optional explicit path for the new .vidlet.' },
      },
      required: ['path'],
    },
  },
];
