/**
 * Studio MCP tools: teleprompter recording setup, TTS/clone voiceover,
 * AI Shorts and AI demos. Schemas and handlers moved from mcp.js; the only
 * behavior change is the per-platform URL-length guard on setup_recording
 * (a 20k-char script base64s past cmd.exe's 8191-char limit on Windows/WSL,
 * which used to fail silently).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveMusicChoice } from '../lib/music.js';
import { changeExtension, getOutputPath } from '../lib/paths.js';
import { demo } from '../tools/demo.js';
import { short } from '../tools/short.js';
import { timelapse } from '../tools/timelapse.js';
import { resolveCloneEngine, voiceover } from '../tools/voiceover.js';
import {
  editorBaseUrl,
  fileResult,
  fileUrl,
  jsonContent,
  maxSafeUrlLength,
  openInBrowser,
  PATH_PROPERTY,
  releaseIfEmpty,
  reserveUniqueOutputPath,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  type ToolDefinition,
  type ToolHandler,
  withSilencedStdout,
} from './shared.js';

export const STUDIO_TOOLS: ToolDefinition[] = [
  {
    name: 'setup_recording',
    description:
      'Set up a screen-recording session on vidlet.app: opens the browser with the given script ' +
      'preloaded into the teleprompter (an always-on-top floating window, excluded from the ' +
      'capture). The user then clicks "Open prompter" and "Record screen" — browser security ' +
      'requires those two clicks. Writes no files.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'The narration script / transcript text (max 20000 chars).',
        },
        script_path: {
          type: 'string',
          description: 'Path to a script file (.txt/.md/.srt/.vtt) — alternative to `script`.',
        },
      },
    },
  },
  {
    name: 'generate_voiceover',
    description:
      'Generate narration audio from a script. Default engine is free Edge neural TTS (no API ' +
      'key). Pass clone_ref (a ~10s voice recording) to clone that voice locally — with ' +
      'Chatterbox (MIT, default) or dots.tts (Apache-2.0, best quality, NVIDIA GPU) via ' +
      'clone_engine — first use installs several GB. Optionally mixes the narration over ' +
      'video_path, auto-ducking its original audio. Never overwrites existing files.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The narration script (max 5000 chars).' },
        language: {
          type: 'string',
          description:
            'Voice language code (en, es, fr, de, it, pt, ja, ko, zh, ar, hi, ru, tr, nl). Default en.',
        },
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
          description:
            'Cloning engine used with clone_ref: chatterbox (CPU/GPU, default) or dots (best quality, NVIDIA GPU).',
        },
        video_path: {
          type: 'string',
          description: 'Optional video to mix the narration over (original audio auto-ducked).',
        },
        output_path: { type: 'string', description: 'Optional explicit output path (.mp3/.wav).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'create_short',
    description:
      'Turn a full landscape video into a 9:16 YouTube Short: whisper.cpp transcribes locally, ' +
      'Groq AI picks the most engaging moments (requires GROQ_API_KEY in the server env), and ' +
      'the crop follows the on-screen action/cursor via motion tracking. Writes a ' +
      '"<output>.segments.json" sidecar for manual crop/time tweaks. Never overwrites input.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        max_duration: {
          type: 'number',
          description: 'Target length in seconds (default 57, max 60).',
        },
        captions: { type: 'boolean', description: 'Burn hormozi-style captions into the short.' },
        generate_post: {
          type: 'boolean',
          description: 'Also write viral title/description/hashtags to "<output>.post.txt".',
        },
        count: {
          type: 'number',
          description: 'Cut N distinct shorts (1-5); outputs are named -1-scoreNN etc, best first.',
        },
        from_segments: {
          type: 'string',
          description:
            'Path to an edited .segments.json to re-render from (skips transcription + AI).',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_timelapse_short',
    description:
      'Turn a long screen recording into a fast 9:16 Short: static stretches are cut (per-pixel ' +
      'motion, so a moving cursor still counts as activity), what is left is sped up, the frame ' +
      'is padded to 1080x1920 over a blurred copy of itself, and a progress bar + real ' +
      'source-time readout are burned on. Original audio is dropped (at these speeds it is ' +
      'noise) and replaced with a bundled CC0 music bed. Every setting has a working default: ' +
      'calling this with just `path` produces a finished, scored Short. Never overwrites input; default output is ' +
      '"<name>_timelapse.mp4" in a VidLet/ subfolder, numbered if that already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        speed: {
          type: 'number',
          description: 'Playback multiplier applied after idle cutting, 0.25-60. Default 15.',
        },
        music: {
          type: 'string',
          description:
            'A bundled CC0 mood ("upbeat", "calm", "tense", "playful"), a path to your own ' +
            'audio file, or "none" for silence. Beds are looped and faded to fit. Defaults to a ' +
            'bundled upbeat track — omit it and the Short comes out scored.',
        },
        music_volume: { type: 'number', description: 'Music level 0-1. Default 0.35.' },
        cut_idle: {
          type: 'boolean',
          description: 'Drop static stretches before speeding up. Default true.',
        },
        overlay: {
          type: 'boolean',
          description: 'Burn the progress bar + source-time readout. Default true.',
        },
        portrait: {
          type: 'boolean',
          description: 'Frame 9:16 for Shorts. Default true; false keeps the source aspect.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_demo',
    description:
      'The quiet-creator pipeline for SILENT screen recordings: trims idle spans (motion-based), ' +
      'a vision model watches keyframes, an LLM writes the narration, TTS speaks it (or a cloned ' +
      'voice via clone_ref), and it outputs the full narrated 16:9 demo plus a 9:16 Short. ' +
      'Requires GROQ_API_KEY in the server env. Never overwrites existing files.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PATH_PROPERTY,
        about: { type: 'string', description: 'One line about the product/feature being shown.' },
        language: { type: 'string', description: 'Narration language code, default en.' },
        gender: {
          type: 'string',
          enum: ['female', 'male'],
          description: 'Voice gender, default female.',
        },
        clone_ref: {
          type: 'string',
          description: 'Path to a ~10s voice reference for cloned narration.',
        },
        make_short: { type: 'boolean', description: 'Also produce the 9:16 Short (default true).' },
        captions: { type: 'boolean', description: 'Burn captions into the Short.' },
        generate_post: { type: 'boolean', description: 'Also write post copy sidecar.' },
        output_path: {
          type: 'string',
          description: 'Optional explicit output path for the full demo.',
        },
      },
      required: ['path'],
    },
  },
];

async function handleSetupRecording({
  script,
  script_path,
}: {
  script?: string;
  script_path?: string;
}) {
  let text = script;
  if (!text?.trim() && script_path) text = readFileSync(resolveInputPath(script_path), 'utf8');
  if (!text?.trim()) throw new Error('Provide `script` text or a `script_path` file.');
  if (text.length > 20000) throw new Error('Script too long (max 20000 chars) — trim it down.');

  const base = editorBaseUrl();
  // /app is the editor (/ is the landing page). Hash fragment is never sent
  // to the server; the site loads it into the teleprompter and strips it.
  const url = `${base}/app#prompter=${Buffer.from(text, 'utf8').toString('base64url')}`;
  const opened = url.length <= maxSafeUrlLength();
  if (opened) openInBrowser(url);
  return jsonContent({
    url, // full link, in case the browser could not be opened automatically
    opened,
    script_chars: text.length,
    next_steps: opened
      ? [
          'The teleprompter panel is open with the script loaded.',
          'Click "Open prompter" to float it (always-on-top, excluded from capture).',
          'Click "Record screen" and pick the window to record.',
        ]
      : [
          'The script is too long to auto-open a browser on this platform (URL exceeds the launcher limit).',
          `Open ${base}/app manually and paste the script into the teleprompter panel.`,
          'Then click "Open prompter" and "Record screen".',
        ],
  });
}

async function handleGenerateVoiceover({
  text,
  language,
  gender,
  clone_ref,
  clone_engine,
  video_path,
  output_path,
}: {
  text?: string;
  language?: string;
  gender?: 'female' | 'male';
  clone_ref?: string;
  clone_engine?: string;
  video_path?: string;
  output_path?: string;
}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('`text` is required');
  const cloneRef = clone_ref ? resolveInputPath(clone_ref) : undefined;
  const cloneEngine = resolveCloneEngine(clone_engine ?? undefined);
  const video = video_path ? resolveInputPath(video_path) : undefined;

  // Narration audio: beside the video (VidLet/ subfolder) when mixing, else CWD.
  const desiredAudio = output_path
    ? resolve(output_path)
    : video
      ? changeExtension(video, '.mp3')
      : resolve('voiceover.mp3');
  const output = reserveUniqueOutputPath(desiredAudio);
  const videoOutput = video ? safeOutputPath(video, getOutputPath(video, '_voiceover')) : undefined;

  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      try {
        const result = await voiceover({
          input: text,
          output,
          language,
          gender,
          cloneRef,
          cloneEngine,
          video,
          videoOutput,
        });
        return fileResult(result, { narration_audio: output });
      } catch (e) {
        if (videoOutput) releaseIfEmpty(videoOutput);
        throw e;
      }
    })
  );
}

async function handleCreateShort({
  path,
  max_duration,
  captions,
  generate_post,
  count,
  from_segments,
  output_path,
}: {
  path?: string;
  max_duration?: number;
  captions?: boolean;
  generate_post?: boolean;
  count?: number;
  from_segments?: string;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_short');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await short({
        input,
        output,
        maxDuration: max_duration ? Math.min(60, max_duration) : undefined,
        captions,
        post: generate_post,
        count,
        fromSegments: from_segments,
      });
      return fileResult(result, {
        segments_sidecar: `${output}.segments.json`,
        ...(generate_post ? { post_copy: `${output}.post.txt` } : {}),
      });
    })
  );
}

async function handleCreateTimelapseShort({
  path,
  speed,
  music,
  music_volume,
  cut_idle,
  overlay,
  portrait,
  output_path,
}: {
  path?: string;
  speed?: number;
  music?: string;
  music_volume?: number;
  cut_idle?: boolean;
  overlay?: boolean;
  portrait?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  // Resolved before the output path is reserved: a bad mood name should not
  // leave an empty placeholder file behind.
  const track = resolveMusicChoice(music);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_timelapse');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await timelapse({
        input,
        output,
        speed,
        music: track?.path,
        musicVolume: music_volume,
        cutIdle: cut_idle,
        overlay,
        portrait,
      });
      return jsonContent({
        ...result,
        url: fileUrl(result.output),
        music: track
          ? {
              title: track.title,
              artist: track.artist,
              license: track.license,
              source: track.source,
            }
          : null,
      });
    })
  );
}

async function handleCreateDemo({
  path,
  about,
  language,
  gender,
  clone_ref,
  make_short,
  captions,
  generate_post,
  output_path,
}: {
  path?: string;
  about?: string;
  language?: string;
  gender?: 'female' | 'male';
  clone_ref?: string;
  make_short?: boolean;
  captions?: boolean;
  generate_post?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const cloneRef = clone_ref ? resolveInputPath(clone_ref) : undefined;
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_demo');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await demo({
        input,
        about,
        output,
        language,
        gender,
        cloneRef,
        short: make_short,
        captions,
        post: generate_post,
      });
      return jsonContent({
        output: result,
        script: `${output}.script.txt`,
        ...(generate_post ? { post_copy: `${output}.post.txt` } : {}),
      });
    })
  );
}

export const STUDIO_HANDLERS: Record<string, ToolHandler> = {
  setup_recording: handleSetupRecording,
  generate_voiceover: handleGenerateVoiceover,
  create_short: handleCreateShort,
  create_timelapse_short: handleCreateTimelapseShort,
  create_demo: handleCreateDemo,
};
