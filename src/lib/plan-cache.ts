import { createHash } from 'node:crypto';
/**
 * Cache of the analysis pass, keyed by what the analysis actually depends
 * on: each source file's identity (path + size + mtime) and the settings
 * that change what gets kept.
 *
 * Analysis is deterministic - the same footage under the same settings
 * always yields the same spans and luma - so re-deriving it on every render
 * of the same material is pure waste. It is also the second-slowest stage,
 * and iterating on a Short means rendering the same sources many times over
 * (narration tweak, different bed, new title). This makes the preview
 * genuinely cheap: the draft pays for the analysis, and the approved final
 * render inherits it.
 *
 * Deliberately conservative: any doubt about whether the inputs still match
 * is a cache MISS. Serving a stale edit would be far worse than re-running
 * a few seconds of ffmpeg.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LumaStats } from './grade.js';
import type { TimeSegment } from './segments.js';

const CACHE_DIR = join(homedir(), '.cache', 'vidlet', 'plans');
/** Bump when the analysis logic changes shape, to invalidate old entries. */
const SCHEMA = 2;

export interface CachedClip {
  source: string;
  spans: TimeSegment[];
  luma: LumaStats | null;
  kept: number;
  retakesDropped: number;
  voiced: boolean;
}

export interface CachedPlan {
  schema: number;
  key: string;
  clips: CachedClip[];
}

/** Identity of a file for cache purposes: path, size, mtime. */
function fileStamp(path: string): string {
  try {
    const s = statSync(path);
    return `${path}:${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    // A file we cannot stat gets a unique stamp, so it never matches.
    return `${path}:missing:${Math.random()}`;
  }
}

/**
 * Cache key. Every input that can change the RESULT of analysis belongs
 * here; anything that only affects the render (music, canvas, titles) must
 * NOT, or the cache would miss on changes it should survive.
 */
export function planKey(sources: string[], settings: Record<string, unknown>): string {
  const h = createHash('sha256');
  h.update(`v${SCHEMA}`);
  for (const s of sources) h.update(fileStamp(s));
  h.update(JSON.stringify(settings, Object.keys(settings).sort()));
  return h.digest('hex').slice(0, 32);
}

export function readPlan(key: string): CachedPlan | null {
  const file = join(CACHE_DIR, `${key}.json`);
  try {
    if (!existsSync(file)) return null;
    const plan = JSON.parse(readFileSync(file, 'utf8')) as CachedPlan;
    if (plan.schema !== SCHEMA || plan.key !== key) return null;
    // The denoised copies a cached plan points at live in a temp dir that
    // is gone by now, so a plan is only usable when every source is still
    // on disk. Otherwise the render would fail deep in ffmpeg instead of
    // simply re-analysing.
    if (!plan.clips.every((c) => existsSync(c.source))) return null;
    return plan;
  } catch {
    return null;
  }
}

export function writePlan(key: string, clips: CachedClip[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const plan: CachedPlan = { schema: SCHEMA, key, clips };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(plan), 'utf8');
  } catch {
    // A cache that cannot be written is a slow render, not a failed one.
  }
}

export function planCacheDir(): string {
  return CACHE_DIR;
}

/** Where a denoised working copy lives, so a cached plan can point at it. */
export function stableWorkPath(source: string, key: string, label: string): string {
  const dir = join(CACHE_DIR, 'work', key);
  mkdirSync(dir, { recursive: true });
  return join(
    dir,
    `${label}-${createHash('sha1').update(dirname(source)).digest('hex').slice(0, 8)}.mp4`
  );
}
