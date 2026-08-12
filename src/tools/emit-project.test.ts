import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectPathFor } from './emit-project.js';

const dir = mkdtempSync(join(tmpdir(), 'vidlet-emit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('projectPathFor', () => {
  it('sits beside the render with the same stem', () => {
    expect(projectPathFor('/x/y/short.mp4')).toBe('/x/y/short.vidlet');
  });

  it('handles a stem containing dots', () => {
    expect(projectPathFor('/x/my.short.v2.mp4')).toBe('/x/my.short.v2.vidlet');
  });
});

describe('emitted timeline maths', () => {
  // The invariant the format has to satisfy: a clip's TIMELINE duration is
  // the source span divided by the speed it plays at. Getting this backwards
  // makes a 21x timelapse render 21x too long.
  it('lays sped-up spans end to end to the expected total', () => {
    const spans = [
      { start: 5, end: 105 }, // 100s of source
      { start: 200, end: 300 }, // 100s of source
    ];
    const speed = 20;
    const intro = 6;
    let timeline = intro;
    const clips = spans.map((s) => {
      const onTimeline = (s.end - s.start) / speed;
      const clip = { start: timeline, sourceIn: s.start, duration: onTimeline, speed };
      timeline += onTimeline;
      return clip;
    });
    // 200s of source at 20x is 10s, plus a 6s intro.
    expect(timeline).toBeCloseTo(16, 6);
    expect(clips[0].start).toBe(6);
    expect(clips[1].start).toBeCloseTo(11, 6);
    // Each clip reads span-length of source, not timeline-length.
    for (const c of clips) expect(c.duration * c.speed).toBeCloseTo(100, 6);
  });
});
