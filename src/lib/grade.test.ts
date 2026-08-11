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

  it('grades two different clips onto the same spread', () => {
    // Chosen to sit inside the contrast clamp, so this measures the matching
    // maths rather than the safety rails (covered by the clamp test above).
    const dull = { avg: 80, low: 60, high: 120 };
    const lively = { avg: 128, low: 40, high: 200 };
    const target = averageStats([dull, lively]);
    const spreadAfter = (s: typeof dull) => (s.high - s.low) * matchGrade(s, target).contrast;
    expect(spreadAfter(dull)).toBeCloseTo(spreadAfter(lively), 0);
  });

  it('gives up matching rather than exceeding the clamp on an extreme clip', () => {
    // A near-flat clip cannot reach a wide target without destroying it.
    const g = matchGrade({ avg: 128, low: 127, high: 129 }, punchy);
    expect(g.contrast).toBe(3);
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
