import { describe, expect, it } from 'vitest';
import {
  chunkWordsToLines,
  estimateTextWidth,
  fittingMaxChars,
  generateShortsAss,
  isUrlOrEmail,
  mergePunctuationTokens,
  SHORTS_MAX_CHARS,
  scaleToFit,
  toCaptionCase,
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

describe('estimateTextWidth / scaleToFit', () => {
  it('reports 100 (no shrink) when the line already fits', () => {
    expect(scaleToFit('short line', 48, 1000)).toBe(100);
  });

  it('shrinks proportionally when a line is wider than the frame', () => {
    const wide = 'a'.repeat(80); // width 2380.8px at fontSize 48
    const scale = scaleToFit(wide, 48, 1800); // needs ~76%, above the readability floor
    expect(scale).toBeLessThan(100);
    expect(scale).toBeGreaterThan(40);
    const scaledWidth = estimateTextWidth(wide, 48) * (scale / 100);
    expect(scaledWidth).toBeLessThanOrEqual(1800 + 30); // floor() rounds down, so within a step
  });

  it('never shrinks below the readability floor', () => {
    expect(scaleToFit('x'.repeat(500), 48, 10)).toBe(40);
  });
});

describe('isUrlOrEmail', () => {
  it('recognises a bare domain and an email', () => {
    expect(isUrlOrEmail('taxducks.com')).toBe(true);
    expect(isUrlOrEmail('hello@site.com')).toBe(true);
    expect(isUrlOrEmail('https://taxducks.com/blog')).toBe(true);
  });

  it('tolerates trailing sentence punctuation', () => {
    expect(isUrlOrEmail('taxducks.com.')).toBe(true);
    expect(isUrlOrEmail('taxducks.com,')).toBe(true);
  });

  it('does not flag ordinary words or abbreviations', () => {
    for (const w of ['duck', 'e.g.', 'Mr.', 'dot', 'com', 'hello,']) {
      expect(isUrlOrEmail(w), `should not flag: ${w}`).toBe(false);
    }
  });
});

describe('URL/email survive the render path intact (regression)', () => {
  it('chunkWordsToLines keeps a domain as a single atomic token', () => {
    const words = 'check us out at taxducks.com today'
      .split(' ')
      .map((t, i) => ({ word: t, start: i, end: i + 1 }));
    const lines = chunkWordsToLines(words, 28);
    const flat = lines.flat().map((w) => w.word);
    expect(flat).toContain('taxducks.com');
    // Never split across a word boundary: exactly one token holds it.
    expect(flat.filter((w) => w.includes('taxducks')).length).toBe(1);
  });

  it('uppercasing a domain preserves the @ and the dot literally', () => {
    expect(toCaptionCase('taxducks.com', true)).toBe('TAXDUCKS.COM');
    expect(toCaptionCase('hello@site.com', true)).toBe('HELLO@SITE.COM');
  });

  it('a burned line for a URL contains the real characters, not spelled-out words', () => {
    const ass = generateShortsAss({
      entries: [
        {
          index: 1,
          startTime: 0,
          endTime: 2,
          text: 'visit taxducks.com',
          words: [
            { word: 'visit', start: 0, end: 1 },
            { word: 'taxducks.com', start: 1, end: 2 },
          ],
        },
      ],
      videoWidth: 1080,
      videoHeight: 1920,
      fontSize: 48,
      fontName: 'Arial Black',
      position: 'bottom',
      highlightColor: '&H00FFFF&',
      maxChars: 28,
    });
    expect(ass).toContain('TAXDUCKS.COM');
    expect(ass).not.toMatch(/DOT|\bAT\b/);
  });

  it('a domain too wide for the frame gets a scale tag instead of wrapping', () => {
    const ass = generateShortsAss({
      entries: [
        {
          index: 1,
          startTime: 0,
          endTime: 2,
          text: 'x',
          words: [{ word: `${'reallylongsubdomain'.repeat(3)}.com`, start: 0, end: 2 }],
        },
      ],
      videoWidth: 1080,
      videoHeight: 1920,
      fontSize: 100,
      fontName: 'Arial Black',
      position: 'bottom',
      highlightColor: '&H00FFFF&',
      maxChars: 28,
    });
    expect(ass).toMatch(/\\fscx\d+\\fscy\d+/);
  });
});
