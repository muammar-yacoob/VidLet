import { describe, expect, it } from 'vitest';
import {
  SHORTS_MAX_CHARS,
  chunkWordsToLines,
  fittingMaxChars,
  mergePunctuationTokens,
} from './caption.js';

const w = (word: string, start: number, end: number) => ({ word, start, end });

describe('chunkWordsToLines', () => {
  it('keeps every line within the character budget', () => {
    const words = 'rigging a low poly duck in blender is genuinely so satisfying'
      .split(' ')
      .map((t, i) => w(t, i, i + 1));
    for (const line of chunkWordsToLines(words, SHORTS_MAX_CHARS)) {
      expect(line.map((x) => x.word).join(' ').length).toBeLessThanOrEqual(SHORTS_MAX_CHARS);
    }
  });

  it('loses no words', () => {
    const words = 'one two three four five six seven eight'
      .split(' ')
      .map((t, i) => w(t, i, i + 1));
    const flat = chunkWordsToLines(words, 12).flat();
    expect(flat.map((x) => x.word)).toEqual(words.map((x) => x.word));
  });

  it('gives an over-long word its own line rather than dropping it', () => {
    const words = [w('hi', 0, 1), w('supercalifragilistic', 1, 2), w('bye', 2, 3)];
    const lines = chunkWordsToLines(words, 10);
    expect(lines.flat()).toHaveLength(3);
    expect(lines.some((l) => l.length === 1 && l[0].word === 'supercalifragilistic')).toBe(true);
  });

  it('returns nothing for no words', () => {
    expect(chunkWordsToLines([], 28)).toEqual([]);
  });

  it('packs greedily rather than one word per line', () => {
    const words = 'a b c d e f'.split(' ').map((t, i) => w(t, i, i + 1));
    expect(chunkWordsToLines(words, 28)).toHaveLength(1);
  });
});

describe('fittingMaxChars', () => {
  it('narrows the budget when the requested line would overflow', () => {
    // 1080 wide, 120px font: 28 chars does not fit and used to clip.
    expect(fittingMaxChars(1080, 120, 60, 28)).toBeLessThan(28);
  });

  it('never widens past what the caller asked for', () => {
    expect(fittingMaxChars(3840, 40, 60, 28)).toBe(28);
  });

  it('keeps a usable floor on an absurdly narrow frame', () => {
    expect(fittingMaxChars(120, 120, 60, 28)).toBe(8);
  });

  it('lets a line span the usable width without exceeding it', () => {
    const n = fittingMaxChars(1080, 107, 60, 28);
    expect(n * 107 * 0.62).toBeLessThanOrEqual(1080 - 120);
  });
});

describe('mergePunctuationTokens', () => {
  it('glues a lone comma onto the word before it', () => {
    const merged = mergePunctuationTokens([w('place', 0, 1), w(',', 1, 1.1), w('and', 1.1, 2)]);
    expect(merged.map((x) => x.word)).toEqual(['place,', 'and']);
  });

  it('extends the merged word to cover the punctuation timing', () => {
    const merged = mergePunctuationTokens([w('place', 0, 1), w(',', 1, 1.4)]);
    expect(merged[0]).toEqual({ word: 'place,', start: 0, end: 1.4 });
  });

  it('leaves words with attached punctuation alone', () => {
    const merged = mergePunctuationTokens([w('place,', 0, 1), w('and', 1, 2)]);
    expect(merged.map((x) => x.word)).toEqual(['place,', 'and']);
  });

  it('keeps leading punctuation when there is nothing to attach it to', () => {
    expect(mergePunctuationTokens([w('-', 0, 1), w('go', 1, 2)]).map((x) => x.word)).toEqual([
      '-',
      'go',
    ]);
  });
});

describe('mergePunctuationTokens - contractions', () => {
  it('glues a split contraction tail back on', () => {
    const merged = mergePunctuationTokens([w('it', 0, 1), w("'s", 1, 1.2), w('fun', 1.2, 2)]);
    expect(merged.map((x) => x.word)).toEqual(["it's", 'fun']);
  });

  it('handles a typographic apostrophe', () => {
    expect(mergePunctuationTokens([w('you', 0, 1), w('’re', 1, 1.2)])[0].word).toBe('you’re');
  });

  it('does not swallow a real short word', () => {
    expect(mergePunctuationTokens([w('it', 0, 1), w('is', 1, 2)]).map((x) => x.word)).toEqual([
      'it',
      'is',
    ]);
  });
});
