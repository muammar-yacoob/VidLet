import { describe, expect, it } from 'vitest';
import { DEFAULT_MOOD, listBundledMusic, resolveMusicChoice } from './music.js';

describe('resolveMusicChoice', () => {
  it('scores by default when the bundled pack is present', () => {
    const bundled = listBundledMusic();
    if (bundled.length === 0) return; // pack not installed in this checkout
    expect(resolveMusicChoice(undefined)?.mood).toBe(DEFAULT_MOOD);
    expect(resolveMusicChoice('auto')?.mood).toBe(DEFAULT_MOOD);
  });

  it('honours an explicit silence request', () => {
    expect(resolveMusicChoice('none')).toBeNull();
  });

  it('ships only CC0 beds, since they are redistributed in the package', () => {
    for (const track of listBundledMusic()) {
      expect(track.license).toMatch(/CC0|public domain/i);
    }
  });

  it('rejects a path that does not exist rather than silently going quiet', () => {
    expect(() => resolveMusicChoice('/nope/missing.mp3')).toThrow(/not found/i);
  });
});
