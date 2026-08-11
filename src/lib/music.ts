/**
 * Bundled background-music beds.
 *
 * Everything listed in assets/music/manifest.json must be CC0 / public
 * domain — VidLet ships it inside the package, so anything with an
 * attribution or share-alike condition would push that condition onto every
 * user of the tool. The manifest records provenance anyway, both so the
 * claim is auditable and so `list_capabilities` can surface it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const MUSIC_MOODS = ['upbeat', 'calm', 'tense', 'playful'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

/** Mood used when the caller does not name one. */
export const DEFAULT_MOOD: MusicMood = 'upbeat';

const trackSchema = z.object({
  file: z.string(),
  title: z.string(),
  artist: z.string(),
  license: z.string(),
  source: z.string(),
  mood: z.enum(MUSIC_MOODS),
  duration: z.number().optional(),
});

const manifestSchema = z.object({
  tracks: z.array(trackSchema),
});

export type MusicTrack = z.infer<typeof trackSchema>;
export interface ResolvedTrack extends MusicTrack {
  path: string;
}

/**
 * assets/ sits beside dist/ in the published package and beside src/ in the
 * repo, so walk up from this module until a music manifest turns up.
 */
function musicDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'assets', 'music');
    if (existsSync(join(candidate, 'manifest.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Every manifest entry whose audio file is actually present on disk. */
export function listBundledMusic(): ResolvedTrack[] {
  const dir = musicDir();
  if (!dir) return [];
  let parsed: z.infer<typeof manifestSchema>;
  try {
    parsed = manifestSchema.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  } catch {
    return []; // A malformed manifest must not take a render down.
  }
  return parsed.tracks
    .map((t) => ({ ...t, path: join(dir, t.file) }))
    .filter((t) => existsSync(t.path));
}

/**
 * Turn a `music` argument into a file path. A mood name picks from the
 * bundled CC0 pack; anything else is treated as a path to the caller's own
 * file. Returns null for "no music", and throws only when the caller named
 * something that cannot be honoured.
 */
export function resolveMusicChoice(choice: string | undefined): ResolvedTrack | null {
  if (choice === 'none') return null;

  // Omitted means "score it for me": pick a bundled bed rather than shipping
  // a silent Short, but stay silent (not error) if the pack is missing.
  if (!choice || choice === 'auto') {
    const bundled = listBundledMusic();
    return bundled.find((t) => t.mood === DEFAULT_MOOD) ?? bundled[0] ?? null;
  }

  if ((MUSIC_MOODS as readonly string[]).includes(choice)) {
    const matches = listBundledMusic().filter((t) => t.mood === choice);
    if (matches.length === 0) {
      const available = [...new Set(listBundledMusic().map((t) => t.mood))];
      throw new Error(
        `No bundled "${choice}" track is installed. ${
          available.length
            ? `Available moods: ${available.join(', ')}.`
            : 'The bundled music pack is missing — pass a path to your own audio file instead.'
        }`
      );
    }
    return matches[0];
  }

  const path = isAbsolute(choice) ? choice : resolve(choice);
  if (!existsSync(path)) {
    throw new Error(
      `Music not found: ${path}. Pass a file path, or one of: ${MUSIC_MOODS.join(', ')}.`
    );
  }
  return {
    path,
    file: path,
    title: 'user-supplied',
    artist: 'unknown',
    license: 'unknown',
    source: 'caller',
    mood: 'calm',
  };
}
