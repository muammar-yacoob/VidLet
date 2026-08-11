import { describe, expect, it } from 'vitest';
import { buildMaskGraph, parseTesseractTsv } from './mask.js';

const HEADER = 'level\tpage\tblock\tpara\tline\tword\tleft\ttop\twidth\theight\tconf\ttext';
const row = (left: number, conf: number, text: string) =>
  `5\t1\t1\t1\t1\t1\t${left}\t100\t40\t12\t${conf}\t${text}`;

describe('parseTesseractTsv', () => {
  it('reads word boxes out of the TSV', () => {
    const words = parseTesseractTsv(
      [HEADER, row(10, 90, 'hello'), row(60, 88, 'world')].join('\n')
    );
    expect(words).toHaveLength(2);
    expect(words[0]).toEqual({ text: 'hello', x: 10, y: 100, width: 40, height: 12 });
  });

  it('drops low-confidence junk that would trigger false masks', () => {
    const words = parseTesseractTsv([HEADER, row(10, 12, '4242'), row(60, 95, 'ok')].join('\n'));
    expect(words.map((w) => w.text)).toEqual(['ok']);
  });

  it('ignores blank text rows and malformed lines', () => {
    const words = parseTesseractTsv([HEADER, row(10, 95, ''), 'garbage', ''].join('\n'));
    expect(words).toEqual([]);
  });
});

describe('buildMaskGraph', () => {
  const region = { x: 100, y: 50, width: 200, height: 40, kinds: ['card' as const] };

  it('produces nothing when there is nothing to hide', () => {
    expect(buildMaskGraph([], 0.12)).toBe('');
  });

  it('pixelates in place and ends on a mappable label', () => {
    const g = buildMaskGraph([region], 0.12);
    expect(g).toContain('crop=200:40:100:50');
    expect(g).toContain('flags=neighbor');
    expect(g).toContain('overlay=100:50');
    expect(g).toContain('[masked]');
  });

  it('chains regions so each builds on the last', () => {
    const g = buildMaskGraph([region, { ...region, x: 400 }], 0.12);
    expect(g).toContain('[m0]split=2[keep1][cut1]');
    expect(g).toContain('[m1]null[masked]');
  });

  it('never scales a region below a usable size', () => {
    const tiny = { x: 0, y: 0, width: 3, height: 3, kinds: ['email' as const] };
    const g = buildMaskGraph([tiny], 0.9);
    expect(g).not.toMatch(/scale=[01]:/);
    expect(g).not.toMatch(/scale=\d+:[01],/);
  });
});
