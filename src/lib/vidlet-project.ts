/**
 * The `.vidlet` project format (v1) — parse, validate, resolve media.
 *
 * Implements the CC0 format spec vendored at docs/vidlet-format.md and
 * res/vidlet-1.schema.json (https://vidlet.app/schema/vidlet-1.json).
 * Unknown fields are preserved on parse (zod passthrough) so editing tools
 * round-trip data written by newer or other implementations, and files
 * whose `vidlet` version is greater than ours are refused with a clear
 * "made by a newer Vidlet" message, per the spec.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export const VIDLET_FORMAT_VERSION = 1;

// ============ SCHEMA (mirrors res/vidlet-1.schema.json) ============

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a "#RRGGBB" color');

const metaSchema = z
  .object({
    title: z.string(),
    createdAt: z.string(),
    modifiedAt: z.string(),
    generator: z.string(),
  })
  .passthrough();

const settingsSchema = z
  .object({
    width: z.number().int().min(16),
    height: z.number().int().min(16),
    fps: z.number().positive(),
    background: hexColorSchema,
  })
  .passthrough();

const mediaEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['video', 'image', 'audio']),
    name: z.string().min(1),
    bytes: z.number().int().min(0),
    duration: z.number().min(0).optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256 digest')
      .optional(),
    path: z.string().optional(),
  })
  .passthrough();

// Optional-field defaults per docs/vidlet-format.md.
const baseClipShape = {
  id: z.string().min(1),
  mediaId: z.string().min(1),
  start: z.number().min(0),
  sourceIn: z.number().min(0).default(0),
  duration: z.number().positive(),
};

const videoClipSchema = z
  .object({
    ...baseClipShape,
    gain: z.number().min(0).default(1),
    muted: z.boolean().default(false),
    /**
     * Playback rate. `duration` is always the length on the TIMELINE, so a
     * clip with speed 20 consumes 20x that much source. Timelapse edits are
     * unrepresentable without this, and a project that cannot express the
     * edit it came from is not worth emitting.
     */
    speed: z.number().positive().max(100).default(1),
  })
  .passthrough();

const overlayClipSchema = z
  .object({
    ...baseClipShape,
    x: z.number().default(0),
    y: z.number().default(0),
    scale: z.number().positive().default(0.3),
    opacity: z.number().min(0).max(1).default(1),
    loop: z.boolean().default(false),
    fit: z.enum(['free', 'cover']).default('free'),
  })
  .passthrough();

/** `ducking` defaults to true only on the voice track (spec: "voice only"). */
function audioClipSchema(duckingDefault: boolean) {
  return z
    .object({
      ...baseClipShape,
      gain: z.number().min(0).default(1),
      fadeIn: z.number().min(0).default(0),
      fadeOut: z.number().min(0).default(0),
      loop: z.boolean().default(false),
      ducking: z.boolean().default(duckingDefault),
    })
    .passthrough();
}

const voiceClipSchema = audioClipSchema(true);

/**
 * `captionStyle` and `highlightColor` are VidLet extensions, not spec fields.
 * The v1 schema constrains neither `additionalProperties` here nor on entries,
 * so carrying them is legal and other tools ignore them - which is the point:
 * without a record of HOW captions were burned, a project round-trip silently
 * downgrades a Short's karaoke to plain sentence blocks.
 */
const subtitleStyleSchema = z
  .object({
    fontFamily: z.string(),
    fontSize: z.number().positive(),
    color: hexColorSchema,
    position: z.enum(['top', 'center', 'bottom']),
    outline: z.boolean(),
    captionStyle: z.enum(['plain', 'shorts', 'karaoke', 'hormozi', 'classic']).optional(),
    highlightColor: z.string().optional(),
  })
  .passthrough();

const subtitleWordSchema = z
  .object({
    word: z.string(),
    start: z.number().min(0),
    end: z.number().min(0),
  })
  .passthrough();

const subtitleEntrySchema = z
  .object({
    id: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string(),
    /** Per-word timings. Absent on hand-written projects; interpolated then. */
    words: z.array(subtitleWordSchema).optional(),
  })
  .passthrough();

export const vidletProjectSchema = z
  .object({
    vidlet: z.literal(1),
    meta: metaSchema,
    settings: settingsSchema,
    media: z.array(mediaEntrySchema),
    tracks: z
      .object({
        video: z.array(videoClipSchema),
        overlay: z.array(overlayClipSchema),
        voice: z.array(voiceClipSchema),
        music: z.array(audioClipSchema(false)),
        sfx: z.array(audioClipSchema(false)),
      })
      .passthrough(),
    subtitles: z
      .object({
        style: subtitleStyleSchema,
        entries: z.array(subtitleEntrySchema),
      })
      .passthrough(),
  })
  .passthrough();

export type VidletProject = z.infer<typeof vidletProjectSchema>;
export type MediaEntry = z.infer<typeof mediaEntrySchema>;
export type VideoClip = z.infer<typeof videoClipSchema>;
export type OverlayClip = z.infer<typeof overlayClipSchema>;
export type AudioClip = z.infer<typeof voiceClipSchema>;
export type SubtitleEntry = z.infer<typeof subtitleEntrySchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;

// ============ PARSE / VALIDATE ============

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parse and validate a `.vidlet` JSON text. Throws readable errors; unknown
 * fields survive into the returned object.
 */
export function parseProject(jsonText: string): VidletProject {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Not a .vidlet project: file is not valid JSON (${(e as Error).message}).`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Not a .vidlet project: expected a JSON object at the top level.');
  }
  const version = (raw as Record<string, unknown>).vidlet;
  if (typeof version === 'number' && version > VIDLET_FORMAT_VERSION) {
    throw new Error(
      `This project was made by a newer Vidlet (format v${version}; this build reads ` +
        `v${VIDLET_FORMAT_VERSION}). Update @spark-apps/vidlet and try again.`
    );
  }
  const parsed = vidletProjectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid .vidlet project:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export async function loadProject(path: string): Promise<VidletProject> {
  return parseProject(await readFile(path, 'utf8'));
}

export function serializeProject(project: VidletProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export async function saveProject(project: VidletProject, path: string): Promise<void> {
  await writeFile(path, serializeProject(project), 'utf8');
}

export function touchModified(project: VidletProject): void {
  project.meta.modifiedAt = new Date().toISOString();
}

/** Project duration = max clip end across all tracks, or subtitle end. */
export function projectDuration(project: VidletProject): number {
  const { video, overlay, voice, music, sfx } = project.tracks;
  const clips: Array<{ start: number; duration: number }> = [
    ...video,
    ...overlay,
    ...voice,
    ...music,
    ...sfx,
  ];
  let max = 0;
  for (const clip of clips) max = Math.max(max, clip.start + clip.duration);
  for (const entry of project.subtitles.entries) max = Math.max(max, entry.end);
  return max;
}

// ============ MEDIA RESOLUTION ============

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export interface MissingMedia {
  name: string;
  hint: string;
}

export interface ResolvedMedia {
  /** mediaId -> absolute file path, for every entry that was found. */
  files: Map<string, string>;
  warnings: string[];
  missing: MissingMedia[];
}

/**
 * Locate each media entry on disk: the entry's relative `path` first, then
 * a file called `name` beside the project. Hash mismatches warn but do not
 * fail — the user may have deliberately swapped the file.
 */
export async function resolveProjectMedia(
  project: VidletProject,
  projectPath: string
): Promise<ResolvedMedia> {
  const dir = dirname(resolve(projectPath));
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const missing: MissingMedia[] = [];

  for (const media of project.media) {
    const candidates: string[] = [];
    if (media.path) {
      candidates.push(isAbsolute(media.path) ? media.path : resolve(dir, media.path));
    }
    candidates.push(join(dir, media.name));
    const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());

    if (!found) {
      const hint = media.path
        ? `expected at ${candidates[0]} — restore the file there, or fix this entry's "path"`
        : `place "${media.name}" in ${dir}, or add a "path" to this media entry`;
      missing.push({ name: media.name, hint });
      continue;
    }

    if (media.sha256) {
      const actual = await sha256File(found);
      if (actual !== media.sha256) {
        warnings.push(
          `${media.name}: sha256 mismatch at ${found} — the file differs from the one this project referenced; using it anyway.`
        );
      }
    } else if (media.bytes > 0 && statSync(found).size !== media.bytes) {
      warnings.push(
        `${media.name}: size mismatch at ${found} (expected ${media.bytes} bytes, found ${statSync(found).size}); using it anyway.`
      );
    }
    files.set(media.id, found);
  }

  return { files, warnings, missing };
}
