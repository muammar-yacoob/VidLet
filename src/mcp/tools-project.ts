/**
 * `.vidlet` project MCP tool handlers: create_project, validate_project,
 * render_project, open_in_editor, add_voiceover_to_project. The tool
 * definitions (schemas) live in tools-project-schemas.ts.
 *
 * The .vidlet format is the CC0 layered-edit JSON spec vendored at
 * docs/vidlet-format.md; parsing/rendering live in src/lib/vidlet-project.ts
 * and src/tools/render.ts (shared with the `vidlet render` CLI command).
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { getMediaDuration } from '../lib/ffmpeg.js';
import { changeExtension } from '../lib/paths.js';
import { buildProject, detectQuickPeek, sniffSource } from '../lib/project-create.js';
import {
  parseProject,
  projectDuration,
  resolveProjectMedia,
  serializeProject,
  sha256File,
  touchModified,
  type VidletProject,
} from '../lib/vidlet-project.js';
import { renderProject } from '../tools/render.js';
import {
  generateNarrationAudio,
  MAX_SCRIPT_LENGTH,
  resolveCloneEngine,
} from '../tools/voiceover.js';
import {
  editorBaseUrl,
  jsonContent,
  maxSafeUrlLength,
  openInBrowser,
  releaseIfEmpty,
  reserveUniqueOutputPath,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  type ToolHandler,
  withSilencedStdout,
} from './shared.js';

export { PROJECT_TOOLS } from './tools-project-schemas.js';

// ============ create_project ============

interface VoiceChoice {
  mode?: 'tts' | 'clone' | 'none';
  language?: string;
  gender?: string;
  clone_ref?: string;
}

function voiceNextStep(voice: VoiceChoice, projectPath: string, scriptChars: number): string[] {
  if (!voice.mode || voice.mode === 'none') return [];
  const args = [
    `path: ${projectPath}`,
    voice.mode === 'clone' && voice.clone_ref ? `clone_ref: ${voice.clone_ref}` : '',
    voice.language ? `language: ${voice.language}` : '',
    voice.gender ? `gender: ${voice.gender}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const textHint =
    scriptChars > 0 ? ' (pass the source script as `text` if the project has no subtitles)' : '';
  return [`Add narration: call add_voiceover_to_project with ${args}${textHint}.`];
}

async function handleCreateProject({
  source_path,
  video_path,
  voice,
  music_path,
  output_path,
}: {
  source_path?: string;
  video_path?: string;
  voice?: VoiceChoice;
  music_path?: string;
  output_path?: string;
}) {
  const source = resolveInputPath(source_path);
  const video = video_path ? resolveInputPath(video_path) : undefined;
  const music = music_path ? resolveInputPath(music_path) : undefined;
  const sniffed = sniffSource(source);

  const title = basename(video ?? source, extname(video ?? source));
  const desired = output_path
    ? resolve(output_path)
    : join(dirname(video ?? source), `${title}.vidlet`);
  const output = safeOutputPath(source, desired);

  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const project = await buildProject({
        source: sniffed,
        title,
        projectDir: dirname(output),
        videoPath: video,
        musicPath: music,
      });
      writeFileSync(output, serializeProject(project), 'utf8');

      const questions: Array<Record<string, unknown>> = [];
      if (!voice) {
        questions.push({
          id: 'voice',
          ask: 'Narrate with your cloned voice or a stock TTS voice?',
          options: [
            'Clone my voice (re-call with voice: {mode:"clone", clone_ref:"<path to ~10s recording>"})',
            'Stock TTS voice (re-call with voice: {mode:"tts", language?, gender?})',
            'No narration (re-call with voice: {mode:"none"})',
          ],
          maps_to: 'voice',
        });
      }
      let quickpeek: { installed: boolean; command: string | null } | undefined;
      if (!video) {
        questions.push({
          id: 'recording',
          ask: 'Do you already have a screen recording, or should one be generated?',
          options: [
            'I have a file (provide video_path)',
            'Generate with QuickPeek (run `quickpeek record <steps.json>`, then re-call with the WebM)',
            'Record now (call setup_recording with the script)',
          ],
          maps_to: 'video_path',
        });
        quickpeek = await detectQuickPeek();
      }

      const nextSteps =
        questions.length > 0
          ? [
              'Relay the questions to the user verbatim, then call create_project again with ' +
                'the answers (same source_path).',
            ]
          : [
              ...voiceNextStep(voice ?? {}, output, sniffed.script.length),
              `Render with render_project (path: ${output}).`,
              'Preview or hand-edit in the browser with open_in_editor.',
            ];

      return jsonContent({
        project: output,
        title,
        source_kind: sniffed.kind,
        subtitle_cues: project.subtitles.entries.length,
        script_chars: sniffed.script.length,
        ...(sniffed.script && sniffed.kind === 'script' ? { script: sniffed.script } : {}),
        ...(sniffed.url ? { plan_url: sniffed.url } : {}),
        duration: projectDuration(project),
        ...(questions.length > 0 ? { questions } : {}),
        ...(quickpeek ? { quickpeek } : {}),
        next_steps: nextSteps,
      });
    })
  );
}

// ============ validate_project ============

async function handleValidateProject({ path }: { path?: string }) {
  const input = resolveInputPath(path);
  const text = readFileSync(input, 'utf8');
  let schemaVersion: unknown = null;
  try {
    const raw = JSON.parse(text);
    schemaVersion = raw?.vidlet ?? null;
  } catch {
    // parseProject below reports the JSON error readably.
  }
  try {
    const project = parseProject(text);
    const { warnings, missing } = await resolveProjectMedia(project, input);
    return jsonContent({
      valid: true,
      schema_version: schemaVersion,
      errors: [],
      warnings,
      missing_media: missing,
      ...(missing.length === 0
        ? { next_steps: [`Render with render_project (path: ${input}).`] }
        : { next_steps: ['Restore or relink the missing media, then validate again.'] }),
    });
  } catch (e) {
    return jsonContent({
      valid: false,
      schema_version: schemaVersion,
      errors: String((e as Error).message).split('\n'),
      warnings: [],
      missing_media: [],
    });
  }
}

// ============ render_project ============

async function handleRenderProject({
  path,
  output_path,
  resolution,
  draft,
  caption_style,
}: {
  path?: string;
  output_path?: string;
  resolution?: string;
  draft?: boolean;
  caption_style?: string;
}) {
  const input = resolveInputPath(path);
  const desired = output_path ? resolve(output_path) : changeExtension(input, '.mp4');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const result = await renderProject({
        projectPath: input,
        output,
        resolution,
        draft,
        captionStyle: caption_style,
      });
      return jsonContent({
        output: result.output,
        duration: result.duration,
        encoder: result.encoder,
        next_steps: draft
          ? ['Draft quality — re-call render_project without draft for the final render.']
          : ['Optionally compress_video for upload, or convert_to_gif for a preview.'],
      });
    })
  );
}

// ============ open_in_editor ============

async function handleOpenInEditor({ path }: { path?: string }) {
  const input = resolveInputPath(path);
  const text = readFileSync(input, 'utf8');
  parseProject(text); // refuse to ship an invalid/newer-version project to the editor

  const base = editorBaseUrl();
  // The site consumes #project= exactly like #prompter= — hash fragments
  // never reach the server; the editor decodes and strips them.
  const url = `${base}/app#project=${Buffer.from(text, 'utf8').toString('base64url')}`;
  if (url.length <= maxSafeUrlLength()) {
    openInBrowser(url);
    return jsonContent({
      opened: true,
      url,
      next_steps: [
        'The browser editor opens with the project loaded.',
        'Media is referenced by name — relink files in the editor if prompted.',
      ],
    });
  }
  return jsonContent({
    opened: false,
    url: null,
    project_chars: text.length,
    next_steps: [`Open ${base}/app`, `Click Open project and pick ${input}`],
  });
}

// ============ add_voiceover_to_project ============

function freeId(prefix: string, taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const candidate = `${prefix}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function handleAddVoiceoverToProject({
  path,
  text,
  language,
  gender,
  clone_ref,
  clone_engine,
  output_path,
}: {
  path?: string;
  text?: string;
  language?: string;
  gender?: 'female' | 'male';
  clone_ref?: string;
  clone_engine?: string;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  const project: VidletProject = parseProject(readFileSync(input, 'utf8'));
  const script =
    text?.trim() ||
    project.subtitles.entries
      .map((e) => e.text)
      .join(' ')
      .trim();
  if (!script) {
    throw new Error('No narration text: the project has no subtitles — pass `text` explicitly.');
  }
  if (script.length > MAX_SCRIPT_LENGTH) {
    throw new Error(`Narration too long (${script.length} chars, max ${MAX_SCRIPT_LENGTH}).`);
  }
  const cloneRef = clone_ref ? resolveInputPath(clone_ref) : undefined;
  const cloneEngine = resolveCloneEngine(clone_engine ?? undefined);

  const dir = dirname(input);
  const base = basename(input, extname(input));
  // The new .vidlet lives in the SAME directory as the original so every
  // relative media path keeps resolving.
  const audioOut = reserveUniqueOutputPath(join(dir, `${base}_voiceover.mp3`));
  const projectOut = output_path
    ? safeOutputPath(input, resolve(output_path))
    : reserveUniqueOutputPath(join(dir, `${base}_voiceover.vidlet`));

  return runWriteTool(projectOut, () =>
    withSilencedStdout(async () => {
      try {
        await generateNarrationAudio({
          input: script,
          output: audioOut,
          language,
          gender,
          cloneRef,
          cloneEngine,
        });
        const duration = await getMediaDuration(audioOut);

        const mediaId = freeId('m', new Set(project.media.map((m) => m.id)));
        project.media.push({
          id: mediaId,
          kind: 'audio',
          name: basename(audioOut),
          bytes: statSync(audioOut).size,
          duration,
          sha256: await sha256File(audioOut),
          path: relative(dir, audioOut),
        });
        const clipIds = new Set(project.tracks.voice.map((c) => c.id));
        project.tracks.voice.push({
          id: freeId('vo', clipIds),
          mediaId,
          start: 0,
          sourceIn: 0,
          duration,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
          ducking: true,
        });
        touchModified(project);
        writeFileSync(projectOut, serializeProject(project), 'utf8');

        return jsonContent({
          project: projectOut,
          narration_audio: audioOut,
          narration_duration: Math.round(duration * 100) / 100,
          next_steps: [
            `Render with render_project (path: ${projectOut}).`,
            'Preview in the browser with open_in_editor.',
          ],
        });
      } catch (e) {
        releaseIfEmpty(audioOut);
        throw e;
      }
    })
  );
}

export const PROJECT_HANDLERS: Record<string, ToolHandler> = {
  create_project: handleCreateProject,
  validate_project: handleValidateProject,
  render_project: handleRenderProject,
  open_in_editor: handleOpenInEditor,
  add_voiceover_to_project: handleAddVoiceoverToProject,
};
