import { describe, expect, it } from 'vitest';
import { type AbSnapshot, computeVerdict, nextVariant, sidecarPathFor } from './ab-test.js';

const HOUR = 3_600_000;
const snap = (variant: 'a' | 'b', hours: number, views: number): AbSnapshot => ({
  variant,
  at: hours * HOUR,
  views,
  likes: 0,
});

describe('computeVerdict', () => {
  it('withholds a verdict until both variants have an hour of exposure', () => {
    const verdict = computeVerdict([snap('a', 0, 0), snap('a', 2, 100), snap('b', 2.5, 120)]);
    expect(verdict.winner).toBeNull();
    expect(verdict.note).toContain('Not enough exposure');
  });

  it('attributes each window to the variant that was live during it', () => {
    // A live 0-10h gaining 100 views; B live 10-20h gaining 300.
    const verdict = computeVerdict([snap('a', 0, 0), snap('a', 10, 100), snap('b', 20, 400)]);
    expect(verdict.a.viewsGained).toBe(100);
    expect(verdict.b.viewsGained).toBe(300);
    expect(verdict.winner).toBe('b');
  });

  it('compares velocity, not raw totals, so a longer run cannot buy the win', () => {
    // A: 300 views over 30h (10/h). B: 100 views over 5h (20/h).
    const verdict = computeVerdict([snap('a', 0, 0), snap('a', 30, 300), snap('b', 35, 400)]);
    expect(verdict.winner).toBe('b');
    expect(verdict.b.viewsPerHour).toBeGreaterThan(verdict.a.viewsPerHour);
  });

  it('accumulates multiple windows per variant across rotations', () => {
    const verdict = computeVerdict([
      snap('a', 0, 0),
      snap('a', 2, 40),
      snap('b', 4, 80),
      snap('a', 6, 100),
      snap('b', 8, 180),
    ]);
    expect(verdict.a.hoursLive).toBe(4);
    expect(verdict.b.hoursLive).toBe(4);
    expect(verdict.a.viewsGained).toBe(60);
    expect(verdict.b.viewsGained).toBe(120);
  });

  it('never reports negative gains when YouTube stats regress', () => {
    const verdict = computeVerdict([snap('a', 0, 100), snap('a', 2, 90), snap('b', 4, 95)]);
    expect(verdict.a.viewsGained).toBe(0);
    expect(verdict.b.viewsGained).toBe(5);
  });

  it('calls a tie a tie', () => {
    const verdict = computeVerdict([snap('a', 0, 0), snap('a', 2, 50), snap('b', 4, 100)]);
    expect(verdict.winner).toBeNull();
    expect(verdict.note).toContain('Dead even');
  });
});

describe('nextVariant', () => {
  it('alternates', () => {
    expect(nextVariant('a')).toBe('b');
    expect(nextVariant('b')).toBe('a');
  });
});

describe('sidecarPathFor', () => {
  it('sits beside the video', () => {
    expect(sidecarPathFor('/x/y/short.mp4')).toBe('/x/y/short.mp4.youtube.json');
  });
});
