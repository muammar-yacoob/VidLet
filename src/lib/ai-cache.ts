import { createHash } from 'node:crypto';
/**
 * Response cache for the Groq calls, ported from ViralCat's
 * lib/ai/response-cache.ts and adapted to how VidLet actually runs.
 *
 * Two savings against the same bill, both inherited from that design:
 *   - Cache: an identical low-temperature prompt replays the stored
 *     completion instead of paying for it again.
 *   - In-flight dedup: concurrent identical prompts share ONE request. A
 *     render asks for titles and hashtags in the same breath, and the
 *     hashtag path can re-enter its own prompt on the fallback branch.
 *
 * What changed in the port: ViralCat is a warm serverless app, so a
 * process-local Map with a 10-minute TTL pays off inside one request. VidLet
 * is a short-lived MCP tool call - the process usually dies between the draft
 * render, the final render, and the upload. A memory-only cache would miss
 * every single time and the whole point is to fetch ONCE PER VIDEO PROJECT,
 * so the entries are also written to disk beside the plan cache.
 *
 * No project id is needed in the key: these prompts already embed the topic
 * and narration, so an identical prompt IS the same project's material.
 *
 * Deliberately conservative, same as plan-cache.ts: any doubt about an entry
 * (unreadable, wrong schema, expired) is a MISS. Re-asking Groq costs cents;
 * serving the wrong video's titles would be worse.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Above this temperature the caller wants variety, so never replay. */
export const CACHEABLE_TEMP_MAX = 0.3;

/**
 * ViralCat uses 10 minutes because its cache only has to outlive one warm
 * instance. Here an entry has to survive from the draft render to the final
 * one to the upload, which is a working session, not a request.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on retained entries; oldest are evicted first. */
const MAX_ENTRIES = 200;

/**
 * Resolved per call, not at import, so tests can point it somewhere
 * disposable - resetResponseCache() deletes the whole directory, and that
 * must never be a real user's cache.
 */
function cacheDir(): string {
  return process.env.VIDLET_AI_CACHE_DIR?.trim() || join(homedir(), '.cache', 'vidlet', 'ai');
}

/** Bump when the stored shape changes, to invalidate old entries. */
const SCHEMA = 1;

interface Entry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

/**
 * sha256 rather than ViralCat's FNV-1a. Theirs keys a Map that is discarded
 * within minutes, where a 32-bit space is plenty; these keys are filenames
 * that persist for a week, so the collision budget is much tighter - and a
 * collision here serves one project's completion to another.
 */
export function cacheKey(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function entryPath(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

/** Disk read. Any problem at all is a miss. */
function readDisk(key: string): Entry | null {
  try {
    const path = entryPath(key);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      schema?: number;
      value?: string;
      expiresAt?: number;
    };
    if (parsed.schema !== SCHEMA) return null;
    if (typeof parsed.value !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Date.now()) return null;
    return { value: parsed.value, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** Disk write. Best effort - a cache that cannot write must not fail a render. */
function writeDisk(key: string, entry: Entry): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(entryPath(key), JSON.stringify({ schema: SCHEMA, ...entry }), 'utf8');
    evictDisk();
  } catch {
    // Ignore: the in-memory entry still serves this process.
  }
}

/** Oldest-first eviction, matching ViralCat's cap. */
function evictDisk(): void {
  try {
    const dir = cacheDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length <= MAX_ENTRIES) return;
    const byAge = files
      .map((f) => {
        const full = join(dir, f);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    for (const { full } of byAge.slice(0, files.length - MAX_ENTRIES)) {
      rmSync(full, { force: true });
    }
  } catch {
    // A cache that cannot be pruned is still a working cache.
  }
}

/**
 * Run `fetcher` through the cache + dedup layer. When `cacheable` is false the
 * fetcher is invoked directly, with no storing and no sharing.
 */
export async function withResponseCache(
  key: string,
  cacheable: boolean,
  fetcher: () => Promise<string>
): Promise<string> {
  if (!cacheable) return fetcher();

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) cache.delete(key);

  const onDisk = readDisk(key);
  if (onDisk) {
    cache.set(key, onDisk);
    return onDisk.value;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher()
    .then((value) => {
      const entry = { value, expiresAt: Date.now() + TTL_MS };
      cache.set(key, entry);
      if (cache.size > MAX_ENTRIES) {
        // Map preserves insertion order, so the first key is the oldest.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      writeDisk(key, entry);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Test seam: drop all cached and in-flight state, memory and disk. */
export function resetResponseCache(): void {
  cache.clear();
  inflight.clear();
  try {
    const dir = cacheDir();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    // Nothing to do; the memory cache is already clear.
  }
}
