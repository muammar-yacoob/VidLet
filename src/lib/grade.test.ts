import { describe, expect, it } from 'vitest';
import { averageStats, matchGrade, parseLumaStats } from './grade.js';

const LOG = `
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YLOW=38
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YAVG=80
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YHIGH=140
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YLOW=42
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YAVG=90
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YHIGH=150
`;

describe('parseLumaStats', () => {
  it('averages every sampled frame', () => {
    expect(parseLumaStats(LOG)).toEqual({ avg: 85, low: 40, high: 145 });
  });

  it('returns null when the log has no stats', () => {
    expect(parseLumaStats('frame= 100 fps=25')).toBeNull();
  });
});

describe('matchGrade', () => {
  const flat = { avg: 80, low: 60, high: 100 }; // narrow spread
  const punchy = { avg: 128, low: 20, high: 235 }; // wide spread

  it('raises contrast on a flat clip', () => {
    expect(matchGrade(flat, punchy).contrast).toBeGreaterThan(1);
  });

  it('lowers contrast on a clip punchier than the target', () => {
    expect(matchGrade(punchy, flat).contrast).toBeLessThan(1);
  });

  it('is a near no-op when the clip already matches the target', () => {
    const g = matchGrade(flat, flat);
    expect(g.contrast).toBeCloseTo(1, 3);
    expect(g.brightness).toBeCloseTo(0, 2);
  });

  it('multiplies the creative boost on top of the match', () => {
    expect(matchGrade(flat, flat, 1.25).contrast).toBeCloseTo(1.25, 3);
  });

  it('clamps rather than blowing the picture out', () => {
    const g = matchGrade({ avg: 128, low: 127, high: 129 }, punchy, 3);
    expect(g.contrast).toBeLessThanOrEqual(3);
    expect(Math.abs(g.brightness)).toBeLessThanOrEqual(0.3);
  });

  it('closes the gap between two clips without erasing it', () => {
    // Matching is deliberately partial: fully equalising meant stretching
    // the flatter clip so hard that it read as harsher than its neighbour.
    const dull = { avg: 80, low: 60, high: 120 }; // spread 60
    const lively = { avg: 128, low: 40, high: 200 }; // spread 160
    const target = averageStats([dull, lively]);
    const spreadAfter = (s: typeof dull) => (s.high - s.low) * matchGrade(s, target).contrast;
    const before = Math.abs(160 - 60);
    const after = Math.abs(spreadAfter(lively) - spreadAfter(dull));
    expect(after).toBeLessThan(before); // closer than they started
    expect(after).toBeGreaterThan(0); // but not forced identical
  });

  it('gives up matching rather than exceeding the clamp on an extreme clip', () => {
    // A near-flat clip cannot reach a wide target without destroying it,
    // so it stops at the ceiling instead of being stretched to breaking.
    const g = matchGrade({ avg: 128, low: 127, high: 129 }, punchy);
    expect(g.contrast).toBe(1.35);
  });

  it('never pushes a clip into a harsh grade, even against a punchy target', () => {
    // Regression: full matching plus the creative boost compounded to 1.73x
    // on a flat screen recording, which looked visibly harsher than the
    // clip beside it.
    const flatScreen = { avg: 65, low: 37, high: 90 };
    const target = { avg: 70, low: 37, high: 111 };
    expect(matchGrade(flatScreen, target, 1.12).contrast).toBeLessThanOrEqual(1.35);
  });
});

describe('averageStats', () => {
  it('averages each channel', () => {
    expect(
      averageStats([
        { avg: 80, low: 40, high: 140 },
        { avg: 120, low: 60, high: 160 },
      ])
    ).toEqual({ avg: 100, low: 50, high: 150 });
  });
});
