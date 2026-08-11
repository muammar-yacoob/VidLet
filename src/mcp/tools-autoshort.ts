/**
 * The one-prompt MCP tool: "generate a video short from these files".
 * Split from tools-studio.ts to respect the repo's 500-line cap.
 *
 * Interaction contract (same as create_project): when a decision needs the
 * human - music bed, or a narration transcript for a silent recording - the
 * first call returns a `questions` array instead of rendering. The client
 * relays each question verbatim, then calls again with the answers as
 * ordinary arguments. A fully-specified call renders straight through.
 */
import { resolve } from 'node:path';
import { MUSIC_MOODS, listBundledMusic } from '../lib/music.js';
import { getOutputPath } from '../lib/paths.js';
import { autoShort, classifyInputs, detectVoicedAudio, sniffSpeech } from '../tools/autoshort.js';
import {
  type ToolDefinition,
  type ToolHandler,
  fileUrl,
  jsonContent,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  withSilencedStdout,
} from './shared.js';

export const AUTOSHORT_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_short',
    description:
      'One call from raw files to a finished YouTube Short. Give it the attached files ' +
      '(videos in story order; optionally .srt/.vtt captions, a .txt/.md narration script, ' +
      'and/or a music audio file) and it: denoises voiced clips, cuts long pauses, drops ' +
      'duplicate retakes (keeps the longest take of each step), stitches, speeds the result ' +
      'to fit under 59s, grades contrast, frames 9:16, AI-rephrases the narration (Groq), ' +
      'adds a TTS voice when the recording is silent, burns captions timed to that voice, ' +
      'and mixes a music bed. When it needs a decision (music, or a transcript for a silent ' +
      'recording) it returns a `questions` array INSTEAD of rendering - relay each question ' +
      'to the user verbatim with its options, then call again with their answers as ' +
      'arguments. Never overwrites inputs; default output is "<first-video>_short.mp4" in a ' +
      'VidLet/ subfolder, numbered if that already exists. The result carries a `url` ' +
      '(file://) for the finished video - surface it to the user so they can open it.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The attached files: videos in story order, plus optional .srt/.vtt, .txt/.md ' +
            'narration and a music audio file.',
        },
        narration: {
          type: 'string',
          description: 'Inline narration/transcript text (alternative to attaching a .txt/.srt).',
        },
        music: {
          type: 'string',
          description:
            'Bundled CC0 mood ("upbeat", "calm", "tense", "playful"), a path to your own ' +
            'audio file, "auto" (default bundled bed), or "none". Omit to be asked.',
        },
        max_duration: {
          type: 'number',
          description: 'Length ceiling in seconds, max 59. Default 57.',
        },
        captions: {
          type: 'boolean',
          description: 'Burn captions when a script exists. Default true.',
        },
        contrast: {
          type: 'number',
          description:
            'Contrast boost on top of per-clip matching. Every clip is measured and graded ' +
            'onto a shared look first, so a stitch of differently-exposed recordings reads ' +
            'as one piece. Default 1.25.',
        },
        voiceover: {
          type: 'string',
          enum: ['auto', 'tts', 'keep'],
          description:
            'Whose voice carries it. "auto" (default) keeps real speech and only narrates ' +
            'silent footage; "tts" always narrates, for when the source audio is not worth ' +
            'keeping (room tone, music, a previous render); "keep" never generates a voice.',
        },
        language: { type: 'string', description: 'TTS language code, default en.' },
        gender: {
          type: 'string',
          enum: ['female', 'male'],
          description: 'TTS voice gender, default female.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['paths'],
    },
  },
];

async function handleGenerateShort({
  paths,
  narration,
  music,
  max_duration,
  captions,
  contrast,
  voiceover,
  language,
  gender,
  output_path,
}: {
  paths?: string[];
  narration?: string;
  music?: string;
  max_duration?: number;
  captions?: boolean;
  contrast?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  language?: string;
  gender?: 'female' | 'male';
  output_path?: string;
}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('`paths` is required - the attached files, videos first.');
  }
  const resolved = paths.map((p) => resolveInputPath(p));
  const files = classifyInputs(resolved);
  if (files.videos.length === 0) {
    throw new Error(`No video files among the inputs: ${resolved.join(', ')}`);
  }

  return withSilencedStdout(async () => {
    // ---- Question round: collect what only the human can decide. ----
    const questions: Array<Record<string, unknown>> = [];

    if (music === undefined && !files.musicPath) {
      const moods = new Set(listBundledMusic().map((t) => t.mood));
      questions.push({
        id: 'music',
        ask: 'Score the Short with background music?',
        options: [
          ...MUSIC_MOODS.filter((m) => moods.has(m)).map(
            (m) => `${m} (bundled CC0 bed) - re-call with music: "${m}"`
          ),
          'My own file - re-call with music: "<path to audio>"',
          'No music - re-call with music: "none"',
        ],
        maps_to: 'music',
      });
    }

    const hasScript = Boolean(narration !== undefined || files.narrationPath || files.subtitlePath);
    // Only sniff when the answer would change anything - whisper on a 60s
    // slice is cheap but not free. Hum that volumes like audio still
    // transcribes to nothing, so volume alone cannot answer "voiced?".
    let voiced = false;
    if (!hasScript && (await detectVoicedAudio(files.videos[0]))) {
      try {
        voiced = await sniffSpeech(files.videos[0]);
      } catch {
        voiced = true;
      }
    }
    if (!voiced && !hasScript) {
      questions.push({
        id: 'narration',
        ask:
          'No voice detected in the recording and no transcript/script was attached. ' +
          'Describe what the recording shows (a sentence or two is enough - AI expands it ' +
          'into the narration), or skip narration entirely.',
        options: [
          'Provide a description - re-call with narration: "<text>"',
          'No narration - re-call with narration: "" and captions: false',
        ],
        maps_to: 'narration',
      });
    }

    if (questions.length > 0) {
      return jsonContent({
        questions,
        detected: { videos: files.videos.length, real_speech: voiced, has_script: hasScript },
        next_steps: [
          'Relay the questions to the user verbatim, then call generate_short again with ' +
            'the same paths plus their answers.',
        ],
      });
    }

    // ---- Render round. ----
    const desired = output_path ? resolve(output_path) : getOutputPath(files.videos[0], '_short');
    const output = safeOutputPath(files.videos[0], desired);
    return runWriteTool(output, async () => {
      const result = await autoShort({
        inputs: resolved,
        narration,
        music,
        maxDuration: max_duration,
        captions,
        contrast,
        voiceover,
        language,
        gender,
        output,
      });
      return jsonContent({
        ...result,
        url: fileUrl(result.output),
        music: result.music
          ? {
              title: result.music.title,
              artist: result.music.artist,
              license: result.music.license,
              source: result.music.source,
            }
          : null,
      });
    });
  });
}

export const AUTOSHORT_HANDLERS: Record<string, ToolHandler> = {
  generate_short: handleGenerateShort,
};
