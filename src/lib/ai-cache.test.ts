import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cacheKey, resetResponseCache, withResponseCache } from './ai-cache.js';

const dir = mkdtempSync(join(tmpdir(), 'vidlet-aicache-'));

beforeAll(() => {
  process.env.VIDLET_AI_CACHE_DIR = dir;
});
afterEach(() => resetResponseCache());
afterAll(() => {
  process.env.VIDLET_AI_CACHE_DIR = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Plant an entry on disk. resetResponseCache() removes the whole directory. */
function seed(key: string, contents: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), contents, 'utf8');
}

describe('cacheKey', () => {
  it('is stable for identical payloads', () => {
    expect(cacheKey({ a: 1 })).toBe(cacheKey({ a: 1 }));
  });

  it('changes when any part of the payload changes', () => {
    const base = cacheKey({ model: 'm', messages: ['hello'] });
    expect(cacheKey({ model: 'm', messages: ['hello!'] })).not.toBe(base);
    expect(cacheKey({ model: 'other', messages: ['hello'] })).not.toBe(base);
  });

  it('is filename-safe, since keys become cache filenames', () => {
    expect(cacheKey({ weird: 'a/b\\c..d' })).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('withResponseCache', () => {
  it('pays for an identical prompt only once', async () => {
    const fetcher = vi.fn().mockResolvedValue('answer');
    const key = cacheKey({ p: 'titles' });
    expect(await withResponseCache(key, true, fetcher)).toBe('answer');
    expect(await withResponseCache(key, true, fetcher)).toBe('answer');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares ONE request between concurrent identical prompts', async () => {
    let release: (v: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((r) => (release = r)));
    const key = cacheKey({ p: 'concurrent' });

    const both = Promise.all([
      withResponseCache(key, true, fetcher),
      withResponseCache(key, true, fetcher),
    ]);
    release('shared');

    expect(await both).toEqual(['shared', 'shared']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never stores or shares when not cacheable', async () => {
    const fetcher = vi.fn().mockResolvedValue('varied');
    const key = cacheKey({ p: 'hot' });
    await withResponseCache(key, false, fetcher);
    await withResponseCache(key, false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps different prompts apart', async () => {
    const a = vi.fn().mockResolvedValue('A');
    const b = vi.fn().mockResolvedValue('B');
    expect(await withResponseCache(cacheKey({ p: 1 }), true, a)).toBe('A');
    expect(await withResponseCache(cacheKey({ p: 2 }), true, b)).toBe('B');
  });

  it('does not cache a rejection, so a transient failure is retried', async () => {
    const key = cacheKey({ p: 'flaky' });
    const failing = vi.fn().mockRejectedValue(new Error('groq down'));
    await expect(withResponseCache(key, true, failing)).rejects.toThrow('groq down');

    const recovered = vi.fn().mockResolvedValue('ok');
    expect(await withResponseCache(key, true, recovered)).toBe('ok');
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  // The reason this cache is on disk at all: an MCP tool call is a fresh
  // process, so a memory-only cache would miss between the draft render, the
  // final render and the upload.
  it('survives a new process', async () => {
    const key = cacheKey({ p: 'persisted' });
    const first = vi.fn().mockResolvedValue('from-disk');
    await withResponseCache(key, true, first);

    vi.resetModules();
    const fresh = await import('./ai-cache.js');
    const second = vi.fn().mockResolvedValue('should-not-run');
    expect(await fresh.withResponseCache(key, true, second)).toBe('from-disk');
    expect(second).not.toHaveBeenCalled();
  });

  it('misses on an expired entry rather than serving it', async () => {
    const key = cacheKey({ p: 'stale' });
    seed(key, JSON.stringify({ schema: 1, value: 'old', expiresAt: Date.now() - 1000 }));
    const fetcher = vi.fn().mockResolvedValue('fresh');
    expect(await withResponseCache(key, true, fetcher)).toBe('fresh');
  });

  it('misses on an entry from an older schema', async () => {
    const key = cacheKey({ p: 'oldschema' });
    seed(key, JSON.stringify({ schema: 0, value: 'old', expiresAt: Date.now() + 60_000 }));
    const fetcher = vi.fn().mockResolvedValue('fresh');
    expect(await withResponseCache(key, true, fetcher)).toBe('fresh');
  });

  it('treats an unreadable entry as a miss rather than throwing', async () => {
    const key = cacheKey({ p: 'corrupt' });
    seed(key, '{not json');
    const fetcher = vi.fn().mockResolvedValue('recovered');
    expect(await withResponseCache(key, true, fetcher)).toBe('recovered');
  });
});
