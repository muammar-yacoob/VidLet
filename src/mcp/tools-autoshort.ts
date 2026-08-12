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
import { MUSIC_MOODS } from '../lib/music.js';
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
  fileResult,
  fileUrl,
  jsonContent,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  type ToolHandler,
  withSilencedStdout,
  writeThumbnail,
} from './shared.js';

export { AUTOSHORT_TOOLS } from './tools-autoshort-schema.js';

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

async function handlePreviewShort(args: {
  paths?: string[];
  narration?: string;
  final_script?: string;
  intro?: string;
  max_duration?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  language?: string;
  gender?: 'female' | 'male';
  output_path?: string;
}) {
  const { paths } = args;
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('`paths` is required - the attached files, videos first.');
  }
  const resolved = paths.map((p) => resolveInputPath(p));
  const files = classifyInputs(resolved);
  if (files.videos.length === 0) {
    throw new Error(`No video files among the inputs: ${resolved.join(', ')}`);
  }

  return withSilencedStdout(async () => {
    const script = args.final_script ?? resolveScriptSource(files, args.narration);
    const slug = slugifyTitle(titleFromScript(script) || 'preview');
    const desired = args.output_path
      ? resolve(args.output_path)
      : join(dirname(files.videos[0]), 'VidLet', `${slug}-preview.mp4`);
    const output = safeOutputPath(files.videos[0], desired);

    const startedAt = Date.now();
    return runWriteTool(output, async () => {
      const result = await autoShort({
        inputs: resolved,
        narration: script,
        scriptIsFinal: args.final_script !== undefined,
        // A draft with a bed sounds finished and invites approval of things
        // the draft cannot show; silence keeps the focus on the edit.
        music: 'none',
        maxDuration: args.max_duration,
        voiceover: args.voiceover,
        intro: args.intro ? resolveInputPath(args.intro) : undefined,
        language: args.language,
        gender: args.gender,
        draft: true,
        output,
      });
      const thumbnail = result.rendered ? await writeThumbnail(result.output) : null;
      return fileResult(
        result.output,
        {
          ...result,
          elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
          thumbnail,
          thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
          projectUrl: result.project ? fileUrl(result.project) : null,
          next_steps: [
            'Show the user this draft url and ask whether the timing, narration and captions ' +
              'are right. On approval, call generate_short with the SAME paths and script - the ' +
              'analysis and the narration audio are cached, so the real render reuses this ' +
              "draft's exact voice and only pays for the encode.",
          ],
        },
        result.project ? [result.project] : []
      );
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
  intro?: string;
  align_to_content?: boolean;
  cta_url?: string;
  cta_tagline?: string;
  fill?: 'pad' | 'crop';
  render?: boolean;
  mask_sensitive?: boolean;
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
      // Render the samples HERE rather than telling the client to go and
      // call preview_music: a question about which bed to use is not
      // answerable without hearing them, and relying on the caller to know
      // that meant the user was asked to pick music blind.
      const previewDir = join(dirname(files.videos[0]), 'VidLet', 'previews');
      let samples: Awaited<ReturnType<typeof previewMusic>> = [];
      try {
        samples = await previewMusic({ outputDir: previewDir, seconds: 10 });
      } catch {
        samples = []; // previews are a convenience, not a blocker
      }
      const byMood = new Map(samples.map((p) => [p.mood, p]));
      questions.push({
        id: 'music',
        ask:
          'Which background bed do you want under this Short? Play each preview and pick ' +
          'one, or ask for silence.',
        options: [
          ...MUSIC_MOODS.filter((m) => byMood.has(m)).map((m) => {
            const p = byMood.get(m);
            return `${m} (${p?.title}) - listen: ${p ? fileUrl(p.path) : ''} - then re-call with music: "${m}"`;
          }),
          'My own file - re-call with music: "<path to audio>"',
          'No music - re-call with music: "none"',
        ],
        previews: samples.map((p) => ({
          mood: p.mood,
          title: p.title,
          artist: p.artist,
          license: p.license,
          url: fileUrl(p.path),
        })),
        maps_to: 'music',
        hint: 'Play every preview url for the user before they choose. Do not pick for them.',
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

    const startedAt = Date.now();
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
        intro: args.intro ? resolveInputPath(args.intro) : undefined,
        alignToContent: args.align_to_content,
        cta: args.cta_url ? { url: args.cta_url, tagline: args.cta_tagline } : undefined,
        fill: args.fill,
        render: args.render,
        maskSensitive: args.mask_sensitive,
        language: args.language,
        gender: args.gender,
        output,
      });
      const thumbnail = result.rendered ? await writeThumbnail(result.output) : null;
      return fileResult(
        result.output,
        {
          ...result,
          elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
          thumbnail,
          thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
          projectUrl: result.project ? fileUrl(result.project) : null,
          music: result.music
            ? {
                title: result.music.title,
                artist: result.music.artist,
                license: result.music.license,
                source: result.music.source,
              }
            : null,
          next_steps: [
            'Show the user the video `name`, its `url`, `elapsedSeconds`, and the ' +
              '`thumbnailUrl` as a preview. Mention `projectUrl`: the same edit as a .vidlet ' +
              'project they can open with open_in_editor to tweak cuts, narration timing or ' +
              'captions, then re-render with render_project.',
          ],
        },
        result.project ? [result.project] : []
      );
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
        const thumbnail = await writeThumbnail(output);
        return fileResult(output, {
          ...result,
          masked: true,
          thumbnail,
          thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
        });
      });
    }

    const desired = output_path ? resolve(output_path) : getOutputPath(input, '_masked');
    const output = safeOutputPath(input, desired);
    return runWriteTool(output, async () => {
      const result = await maskSensitive({ input, output, regions: supplied, blockiness });
      const thumbnail = await writeThumbnail(output);
      return fileResult(output, {
        ...result,
        masked: true,
        thumbnail,
        thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
      });
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
      const startedAt = Date.now();
      const result = await addMusic({ input, output, music, volume, duck });
      const thumbnail = await writeThumbnail(result.output);
      return fileResult(result.output, {
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        thumbnail,
        thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
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
  preview_short: handlePreviewShort,
  add_music: handleAddMusic,
  mask_sensitive: handleMaskSensitive,
  generate_short: handleGenerateShort,
};
