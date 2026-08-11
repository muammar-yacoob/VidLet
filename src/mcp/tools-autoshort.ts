/**
 * The one-prompt MCP tool: "generate a video short from these files".
 *
 * Interaction contract (same shape as create_project): when a decision is
 * the human's to make, the call returns a `questions` array INSTEAD of
 * rendering. The client relays each question verbatim and calls again with
 * the answers as ordinary arguments. Nothing is encoded until every
 * question is answered, so approving a script costs seconds, not a render.
 *
 * Question rounds, in order:
 *   1. music     - with audible previews, chosen by ear not by label
 *   2. narration - a description, when the footage has no voice
 *   3. script    - the written narration, approved before it is spoken
 */
import { dirname, join, resolve } from 'node:path';
import { slugifyTitle, titleFromScript } from '../lib/autoshort-plan.js';
import { MUSIC_MOODS, listBundledMusic } from '../lib/music.js';
import { getOutputPath } from '../lib/paths.js';
import { addMusic } from '../tools/add-music.js';
import {
  autoShort,
  classifyInputs,
  planShort,
  rephraseScript,
  resolveScriptSource,
} from '../tools/autoshort.js';
import { maskSensitive } from '../tools/mask.js';
import { previewMusic } from '../tools/music-preview.js';
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
    name: 'preview_music',
    description:
      'Render short audible samples of the bundled CC0 beds, at the level a Short actually ' +
      'mixes them, so a bed can be picked by ear instead of by label. Returns a file:// url ' +
      "per mood - offer them to the user, then pass their choice as generate_short's " +
      '`music`. Writes small mp3s; touches no video.',
    inputSchema: {
      type: 'object',
      properties: {
        output_dir: {
          type: 'string',
          description: 'Where to write the samples. Defaults beside the first input video.',
        },
        seconds: { type: 'number', description: 'Sample length, default 10.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional input videos, used only to pick a sensible output_dir.',
        },
      },
    },
  },
  {
    name: 'add_music',
    description:
      'Lay a music bed onto a video that is ALREADY rendered, ducked under any speech it ' +
      'has. The video stream is copied rather than re-encoded, so this takes seconds - use ' +
      'it whenever only the music needs to change, instead of re-running generate_short and ' +
      'redoing the cut, grade, narration and captions. Never overwrites the input; writes ' +
      '"<name>_scored.mp4" beside it unless output_path says otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The finished video to score.' },
        music: {
          type: 'string',
          description:
            'A bundled CC0 mood ("upbeat", "calm", "tense", "playful") or a path to your own ' +
            'audio file. Use preview_music to choose by ear.',
        },
        volume: { type: 'number', description: 'Bed level 0-1. Default 0.08.' },
        duck: {
          type: 'boolean',
          description: 'Duck the bed under existing speech. Default true.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path', 'music'],
    },
  },
  {
    name: 'mask_sensitive',
    description:
      'Scan a video for sensitive information on screen (card numbers validated by Luhn, ' +
      'emails, phone numbers, IBANs, SSNs, API keys, street addresses, postcodes) and cover ' +
      'each with a pixel mosaic. Detection needs tesseract installed; without it the tool ' +
      'reports that clearly instead of silently masking nothing. `regions` always works ' +
      'regardless, for areas you pick yourself. Use dry_run to see what WOULD be covered ' +
      'before writing a video. Never overwrites the input.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Video to scan.' },
        sample_fps: {
          type: 'number',
          description: 'Frames per second sampled for OCR. Default 0.5, one every two seconds.',
        },
        regions: {
          type: 'array',
          description: 'Explicit boxes to cover, in SOURCE pixels. Supplying this skips detection.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
        },
        blockiness: {
          type: 'number',
          description: 'Mosaic coarseness, 0-1. Default 0.12.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Report the regions found and write nothing.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_short',
    description:
      'One call from raw files to a finished YouTube Short. Give it the attached files ' +
      '(videos in story order; optionally .srt/.vtt captions, a .txt/.md narration script, ' +
      'and/or a music audio file) and it: denoises voiced clips, cuts long pauses, drops ' +
      'duplicate retakes, stitches, speeds the result to fit under 59s, matches contrast ' +
      'across clips, frames 9:16, writes and speaks the narration, burns karaoke captions ' +
      'timed to that voice, and mixes a ducked music bed. The output is named after its ' +
      'content, not the source timestamp, and the result carries a `url` (file://) - always ' +
      "surface that url to the user. When a decision is the user's (music, a description " +
      'for silent footage, approving the narration script) it returns a `questions` array ' +
      'INSTEAD of rendering: relay each question verbatim with its options, then call again ' +
      'with the answers as arguments. Never overwrites inputs.',
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
          description:
            'What the recording shows, or the transcript. A sentence or two is enough - it ' +
            'gets rewritten into a script you will be asked to approve.',
        },
        final_script: {
          type: 'string',
          description:
            'The approved narration, spoken verbatim with no further rewriting. Pass this ' +
            'after the user approves (or edits) the draft returned by the script question.',
        },
        music: {
          type: 'string',
          description:
            'A bundled CC0 mood ("upbeat", "calm", "tense", "playful"), a path to your own ' +
            'audio file, or "none". Omit to be asked, with previews.',
        },
        music_volume: {
          type: 'number',
          description: 'Bed level 0-1. Default 0.08, and it ducks under the voice.',
        },
        max_duration: { type: 'number', description: 'Length ceiling in seconds, max 59.' },
        captions: { type: 'boolean', description: 'Burn karaoke captions. Default true.' },
        contrast: {
          type: 'number',
          description:
            'Contrast boost on top of per-clip matching. Every clip is measured and graded ' +
            'onto a shared look first. Default 1.25.',
        },
        voiceover: {
          type: 'string',
          enum: ['auto', 'tts', 'keep'],
          description:
            '"auto" (default) keeps real speech and only narrates silent footage; "tts" ' +
            'always narrates; "keep" never generates a voice.',
        },
        lead_in: {
          type: 'number',
          description: 'Silence before the first word, in seconds. Default 1.',
        },
        mask_sensitive: {
          type: 'boolean',
          description:
            'Scan the footage for on-screen card numbers, emails, phones, keys and ' +
            'addresses and pixelate them. Default true, but it needs tesseract installed; ' +
            'when missing, the result says so in `masking` rather than silently skipping.',
        },
        title: {
          type: 'string',
          description:
            'Short human title for the output filename (slugified to dashes). Defaults to ' +
            'one derived from the narration.',
        },
        language: { type: 'string', description: 'TTS language code, default en.' },
        gender: { type: 'string', enum: ['female', 'male'], description: 'TTS voice gender.' },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['paths'],
    },
  },
];

async function handlePreviewMusic({
  output_dir,
  seconds,
  paths,
}: {
  output_dir?: string;
  seconds?: number;
  paths?: string[];
}) {
  return withSilencedStdout(async () => {
    let dir = output_dir ? resolve(output_dir) : undefined;
    if (!dir && Array.isArray(paths) && paths.length > 0) {
      dir = dirname(resolveInputPath(paths[0]));
    }
    if (!dir) throw new Error('Provide `output_dir` or `paths` so the samples have a home.');

    const previews = await previewMusic({ outputDir: dir, seconds });
    if (previews.length === 0) {
      throw new Error('No bundled music is installed - pass your own file as `music` instead.');
    }
    return jsonContent({
      previews: previews.map((p) => ({ ...p, url: fileUrl(p.path) })),
      next_steps: [
        'Play each url for the user and ask which bed they want (or none), then call ' +
          'generate_short with music set to that mood name, a file path, or "none".',
      ],
    });
  });
}

async function handleGenerateShort(args: {
  paths?: string[];
  narration?: string;
  final_script?: string;
  music?: string;
  music_volume?: number;
  max_duration?: number;
  captions?: boolean;
  contrast?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  lead_in?: number;
  title?: string;
  language?: string;
  gender?: 'female' | 'male';
  output_path?: string;
}) {
  const { paths, narration, final_script, music, voiceover, output_path } = args;
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('`paths` is required - the attached files, videos first.');
  }
  const resolved = paths.map((p) => resolveInputPath(p));
  const files = classifyInputs(resolved);
  if (files.videos.length === 0) {
    throw new Error(`No video files among the inputs: ${resolved.join(', ')}`);
  }

  return withSilencedStdout(async () => {
    const questions: Array<Record<string, unknown>> = [];

    // --- 1. music ---
    if (music === undefined && !files.musicPath) {
      const moods = listBundledMusic().map((t) => t.mood);
      questions.push({
        id: 'music',
        ask: 'Which background bed do you want under this Short?',
        options: [
          ...MUSIC_MOODS.filter((m) => moods.includes(m)).map(
            (m) => `${m} - re-call with music: "${m}"`
          ),
          'My own file - re-call with music: "<path to audio>"',
          'No music - re-call with music: "none"',
        ],
        maps_to: 'music',
        hint: 'Call preview_music first so the user can hear each bed before choosing.',
      });
    }

    // The remaining questions need the runtime and whether the footage
    // already carries a voice. That is analysis only - nothing is encoded.
    const hasScriptSource = Boolean(final_script ?? resolveScriptSource(files, narration));
    const plan = await planShort(resolved, args.max_duration);

    // --- 2. a description, when there is no voice and no script ---
    if (!plan.voiced && !hasScriptSource) {
      questions.push({
        id: 'narration',
        ask:
          'No voice was detected in this footage and no transcript was attached. Describe ' +
          'what it shows in a sentence or two - that gets rewritten into the narration - ' +
          'or skip narration entirely.',
        options: [
          'Describe it - re-call with narration: "<text>"',
          'No narration - re-call with captions: false and voiceover: "keep"',
        ],
        maps_to: 'narration',
      });
    }

    // --- 3. approve the script BEFORE it is spoken and burned in ---
    if (questions.length === 0 && hasScriptSource && !final_script) {
      const raw = resolveScriptSource(files, narration);
      const wantsVoice = voiceover !== 'keep' && (voiceover === 'tts' || !plan.voiced);
      if (wantsVoice) {
        const draft = (await rephraseScript(raw, plan.outputDuration)) ?? raw;
        questions.push({
          id: 'script',
          ask: `This narration will be spoken over the ${Math.round(plan.outputDuration)}s Short and burned in as captions. Approve it, or send back an edited version.`,
          draft,
          word_count: draft.split(/\s+/).filter(Boolean).length,
          options: [
            'Approve - re-call with final_script set to the draft, unchanged',
            'Edit - re-call with final_script set to your edited text',
          ],
          maps_to: 'final_script',
        });
      }
    }

    if (questions.length > 0) {
      return jsonContent({
        questions,
        detected: {
          videos: files.videos.length,
          real_speech: plan.voiced,
          estimated_seconds: Number(plan.outputDuration.toFixed(1)),
        },
        next_steps: [
          'Relay the questions to the user VERBATIM, then call generate_short again with the ' +
            'same paths plus their answers. Nothing has been rendered yet.',
        ],
      });
    }

    // --- render ---
    const script = final_script ?? resolveScriptSource(files, narration);
    // Name the file after what is in it: a source timestamp says nothing
    // once a folder holds a dozen renders.
    const slug = slugifyTitle(args.title ?? titleFromScript(script));
    const desired = output_path
      ? resolve(output_path)
      : join(dirname(files.videos[0]), 'VidLet', `${slug}.mp4`);
    const output = safeOutputPath(files.videos[0], desired);

    return runWriteTool(output, async () => {
      const result = await autoShort({
        inputs: resolved,
        narration: script,
        scriptIsFinal: final_script !== undefined,
        music,
        musicVolume: args.music_volume,
        maxDuration: args.max_duration,
        captions: args.captions,
        contrast: args.contrast,
        voiceover,
        leadIn: args.lead_in,
        language: args.language,
        gender: args.gender,
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
        next_steps: ['Show the user the `url` so they can open the finished Short.'],
      });
    });
  });
}

async function handleMaskSensitive({
  path,
  sample_fps,
  regions,
  blockiness,
  dry_run,
  output_path,
}: {
  path?: string;
  sample_fps?: number;
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
  blockiness?: number;
  dry_run?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  return withSilencedStdout(async () => {
    const supplied = regions?.map((r) => ({ ...r, kinds: [] as never[] }));
    // Dry runs and no-op scans must not reserve an output path; they write
    // nothing, and a reserved placeholder would litter the folder.
    if (dry_run || supplied === undefined) {
      const probe = await maskSensitive({
        input,
        output: '',
        sampleFps: sample_fps,
        regions: supplied,
        blockiness,
        dryRun: true,
      });
      if (dry_run || probe.regions.length === 0) {
        return jsonContent({ ...probe, masked: false });
      }
      const desired = output_path ? resolve(output_path) : getOutputPath(input, '_masked');
      const output = safeOutputPath(input, desired);
      return runWriteTool(output, async () => {
        const result = await maskSensitive({
          input,
          output,
          regions: probe.regions,
          blockiness,
        });
        return jsonContent({ ...result, masked: true, url: fileUrl(output) });
      });
    }

    const desired = output_path ? resolve(output_path) : getOutputPath(input, '_masked');
    const output = safeOutputPath(input, desired);
    return runWriteTool(output, async () => {
      const result = await maskSensitive({ input, output, regions: supplied, blockiness });
      return jsonContent({ ...result, masked: true, url: fileUrl(output) });
    });
  });
}

async function handleAddMusic({
  path,
  music,
  volume,
  duck,
  output_path,
}: {
  path?: string;
  music?: string;
  volume?: number;
  duck?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  if (!music) throw new Error('`music` is required - a bundled mood or a path to audio.');
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_scored');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await addMusic({ input, output, music, volume, duck });
      return jsonContent({
        output: result.output,
        url: fileUrl(result.output),
        duration: result.duration,
        ducked: result.ducked,
        music: {
          title: result.track.title,
          artist: result.track.artist,
          license: result.track.license,
          source: result.track.source,
        },
        next_steps: ['Show the user the `url`.'],
      });
    })
  );
}

export const AUTOSHORT_HANDLERS: Record<string, ToolHandler> = {
  preview_music: handlePreviewMusic,
  add_music: handleAddMusic,
  mask_sensitive: handleMaskSensitive,
  generate_short: handleGenerateShort,
};
