import { describe, expect, it } from 'vitest';
import { MIN_IDLE_SECONDS, idleRunsToSegments, pickShortSpans } from './demo.js';

describe('idleRunsToSegments', () => {
  // interval 0.5s, minimum idle 2s => 4 consecutive static steps
  it('turns long static runs into idle segments', () => {
    // 2s motion, 3s static, 2s motion  (14 steps at 0.5s)
    const flags = [...Array(4).fill(false), ...Array(6).fill(true), ...Array(4).fill(false)];
    expect(idleRunsToSegments(flags, 0.5, 2)).toEqual([{ start: 2, end: 5 }]);
  });

  it('ignores static blips shorter than the minimum', () => {
    const flags = [false, true, true, false, false]; // 1s blip < 2s min
    expect(idleRunsToSegments(flags, 0.5, 2)).toEqual([]);
  });

  it('closes an idle run at the end of the video', () => {
    const flags = [false, false, ...Array(6).fill(true)];
    expect(idleRunsToSegments(flags, 0.5, 2)).toEqual([{ start: 1, end: 4 }]);
  });

  it('handles all-motion videos', () => {
    expect(idleRunsToSegments(Array(10).fill(false), 0.5, MIN_IDLE_SECONDS)).toEqual([]);
  });
});

describe('pickShortSpans', () => {
  it('prefers longer spans within the budget, chronological output', () => {
    const spans = [
      { start: 0, end: 10 }, // 10s
      { start: 20, end: 60 }, // 40s
      { start: 70, end: 90 }, // 20s
    ];
    const picked = pickShortSpans(spans, 55);
    expect(picked).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 60 },
    ]);
  });

  it('caps one giant span to the budget', () => {
    const picked = pickShortSpans([{ start: 0, end: 300 }], 55);
    expect(picked).toEqual([{ start: 0, end: 55 }]);
  });
});
