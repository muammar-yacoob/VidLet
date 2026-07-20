#!/usr/bin/env node

// VidLet MCP server — local video-processing tools over stdio.
//
// Wraps the real tool functions from dist/mcp-lib.js (built from
// src/mcp-lib.ts) directly, no shelling out to the `vidlet` CLI binary.
// These are local file-processing tools the user explicitly invokes: no
// auth needed. Deliberately NO delete/move tools — outputs are always new
// files, never overwrites, never touches the input.

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  caption,
  changeExtension,
  checkFFmpeg,
  compress,
  extractAudio,
  getOutputPath,
  getVideoInfo,
  jumpcut,
  short,
  togif,
  trim,
  voiceover,
} from './dist/mcp-lib.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const PATH_PROPERTY = {
  path: { type: 'string', description: 'Absolute (or CWD-relative) path to the video file' },
};

const TOOLS = [
  {
    name: 'list_capabilities',
    description:
      'List every tool this server offers with a one-line description. Cheap discovery, no file I/O.',
    inputSchema: { type: 'object', properties: {} },
  },
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
      'beside the source, numbered (-1, -2, ...) if that already exists.',
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
          description: 'Silence threshold in dB (more negative = more sensitive). Default -30 (normal pace).',
        },
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
        width: { type: 'number', description: 'Output width in px (height auto-scaled), default 480.' },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_voiceover',
    description:
      'Generate narration audio from a script. Default engine is free Edge neural TTS (no API ' +
      'key). Pass clone_ref (a ~10s voice recording) to clone that voice locally with Chatterbox ' +
      '(MIT) — first use installs several GB. Optionally mixes the narration over video_path, ' +
      'auto-ducking its original audio. Never overwrites existing files.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The narration script (max 5000 chars).' },
        language: {
          type: 'string',
          description: 'Voice language code (en, es, fr, de, it, pt, ja, ko, zh, ar, hi, ru, tr, nl). Default en.',
        },
        gender: { type: 'string', enum: ['female', 'male'], description: 'Voice gender, default female.' },
        clone_ref: {
          type: 'string',
          description: 'Path to a ~10s reference recording — switches to the local voice-cloning engine.',
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
        max_duration: { type: 'number', description: 'Target length in seconds (default 57, max 60).' },
        captions: { type: 'boolean', description: 'Burn hormozi-style captions into the short.' },
        from_segments: {
          type: 'string',
          description: 'Path to an edited .segments.json to re-render from (skips transcription + AI).',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
];

// Tool functions imported from dist/mcp-lib.js print progress straight to
// stdout (console.log / process.stdout.write). Over stdio transport, stdout
// is the MCP protocol channel — any stray print corrupts the JSON-RPC
// stream. Redirect all writes to stderr for the duration of the call, then
// restore.
//
// This mutates the shared process.stdout.write property, which is racy
// against concurrent requests (e.g. a slow tool call overlapping the
// initialize response) — see protocolStdout below for how the transport
// itself stays immune to that.
async function withSilencedStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  process.stdout.write = (chunk, encoding, cb) => process.stderr.write(chunk, encoding, cb);
  console.log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
}

// Captured once, before anything ever patches process.stdout.write.
const REAL_STDOUT_WRITE = process.stdout.write.bind(process.stdout);

// The transport's send() calls `this._stdout.write(...)`, resolving `.write`
// dynamically off whatever object we hand it — the SAME property
// withSilencedStdout mutates. Requests are handled concurrently (e.g. a
// `generate_captions` call can still be running when the `initialize`
// response is sent), so if the transport shared process.stdout directly, a
// call silenced mid-flight would also swallow or misdirect unrelated
// protocol responses. This proxy always uses the pristine write captured
// above, while delegating everything else to the real stream.
const protocolStdout = new Proxy(process.stdout, {
  get(target, prop, receiver) {
    if (prop === 'write') return REAL_STDOUT_WRITE;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/** Validate and resolve a tool's `path` argument to an absolute file. */
function resolveInputPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('`path` is required');
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);
  if (!statSync(abs).isFile()) throw new Error(`Path is not a file: ${abs}`);
  return abs;
}

/**
 * Claim a free path, appending -1, -2, ... before the extension as needed.
 * Uses an atomic exclusive-create (`wx`) rather than existsSync-then-write:
 * two concurrent tool calls targeting the same default name would otherwise
 * both pass an existsSync check before either finished writing, and collide
 * (observed while testing this server — two overlapping trim_video calls
 * both computed the same "unclaimed" name). The reserved placeholder is
 * overwritten by ffmpeg (this codebase's executeFFmpeg defaults to `-y`).
 */
function reserveUniqueOutputPath(desiredPath) {
  const dir = dirname(desiredPath);
  const ext = extname(desiredPath);
  const base = basename(desiredPath, ext);
  let candidate = desiredPath;
  let i = 0;
  for (;;) {
    try {
      writeFileSync(candidate, '', { flag: 'wx' });
      return candidate;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      i += 1;
      candidate = join(dir, `${base}-${i}${ext}`);
    }
  }
}

/** Remove a reserved placeholder if a tool call failed before writing real output. */
function releaseIfEmpty(path) {
  try {
    if (existsSync(path) && statSync(path).size === 0) unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Resolve a tool's output path: never the input file, never an existing
 * file. `desired` is the tool's own default-naming convention (VidLet/
 * subfolder + suffix, or `output_path` if the caller supplied one).
 */
function safeOutputPath(inputAbs, desired) {
  const resolvedDesired = resolve(desired);
  if (resolvedDesired === inputAbs) {
    throw new Error('Refusing to overwrite the input file; choose a different output_path.');
  }
  return reserveUniqueOutputPath(resolvedDesired);
}

/** Run a write-tool body; releases the reserved placeholder if it throws before writing real output. */
async function runWriteTool(output, fn) {
  try {
    return await fn();
  } catch (e) {
    releaseIfEmpty(output);
    throw e;
  }
}

function jsonContent(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorContent(e) {
  return { content: [{ type: 'text', text: `Error: ${e?.message ?? e}` }], isError: true };
}

async function handleListCapabilities() {
  return jsonContent({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    note: 'No delete/move tools by design — outputs are always new files.',
  });
}

async function handleProbeVideo({ path }) {
  const input = resolveInputPath(path);
  return withSilencedStdout(async () => {
    const info = await getVideoInfo(input);
    const sizeBytes = statSync(input).size;
    return jsonContent({ path: input, sizeBytes, ...info });
  });
}

async function handleGenerateCaptions({ path, language, output_path }) {
  const input = resolveInputPath(path);
  if (language && language !== 'en') {
    throw new Error(
      `Unsupported language "${language}" — bundled whisper.cpp models are English-only ` +
        '(tiny.en/base.en/small.en). Only "en" is supported.',
    );
  }
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_captioned');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      if (!(await checkFFmpeg())) throw new Error('FFmpeg not found. Install with: sudo apt install ffmpeg');
      const result = await caption({ input, output, autoTranscribe: true, whisperModel: 'base.en' });
      return jsonContent({ output: result });
    }),
  );
}

async function handleAutoJumpCut({ path, output_path, silence_threshold }) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_jumpcut');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await jumpcut({ input, output, silenceThreshold: silence_threshold });
      return jsonContent({ output: result });
    }),
  );
}

async function handleTrimVideo({ path, start, end, output_path }) {
  const input = resolveInputPath(path);
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error('`start` and `end` (seconds) are required');
  }
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_trimmed');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await trim({ input, output, start, end });
      return jsonContent({ output: result });
    }),
  );
}

async function handleCompressVideo({ path, bitrate, preset, output_path }) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_compressed');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await compress({ input, output, bitrate, preset });
      return jsonContent({ output: result });
    }),
  );
}

async function handleExtractAudio({ path, format, output_path }) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : changeExtension(input, `.${format ?? 'mp3'}`);
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await extractAudio({ input, output, format });
      return jsonContent({ output: result });
    }),
  );
}

async function handleGenerateVoiceover({ text, language, gender, clone_ref, video_path, output_path }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('`text` is required');
  const cloneRef = clone_ref ? resolveInputPath(clone_ref) : undefined;
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
        const result = await voiceover({ input: text, output, language, gender, cloneRef, video, videoOutput });
        return jsonContent({ output: result, narration_audio: output });
      } catch (e) {
        if (videoOutput) releaseIfEmpty(videoOutput);
        throw e;
      }
    }),
  );
}

async function handleCreateShort({ path, max_duration, captions, from_segments, output_path }) {
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
        fromSegments: from_segments,
      });
      return jsonContent({ output: result, segments_sidecar: `${output}.segments.json` });
    }),
  );
}

async function handleConvertToGif({ path, fps, width, output_path }) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : changeExtension(input, '.gif');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await togif({ input, output, fps, width });
      return jsonContent({ output: result });
    }),
  );
}

const TOOL_HANDLERS = {
  list_capabilities: handleListCapabilities,
  probe_video: handleProbeVideo,
  generate_captions: handleGenerateCaptions,
  auto_jump_cut: handleAutoJumpCut,
  trim_video: handleTrimVideo,
  compress_video: handleCompressVideo,
  extract_audio: handleExtractAudio,
  convert_to_gif: handleConvertToGif,
  generate_voiceover: handleGenerateVoiceover,
  create_short: handleCreateShort,
};

const server = new Server({ name: 'vidlet', version: pkg.version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return errorContent(new Error(`Unknown tool: ${name}`));
  try {
    return await handler(args ?? {});
  } catch (e) {
    // Never crash the server on a tool failure — surface it as a tool error instead.
    return errorContent(e);
  }
});

async function main() {
  const transport = new StdioServerTransport(process.stdin, protocolStdout);
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`vidlet-mcp failed to start: ${e?.message ?? e}`);
  process.exit(1);
});
