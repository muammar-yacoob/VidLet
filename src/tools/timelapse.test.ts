import { describe, expect, it } from 'vitest';
import type { TimeSegment } from '../lib/segments.js';
import {
  buildFilterGraph,
  buildSelectExpr,
  buildTimestampAss,
  escapeFilterPath,
  formatClock,
  sourceTimeAt,
} from './timelapse.js';

const SPANS: TimeSegment[] = [
  { start: 10, end: 40 }, // 30s source -> output 0..2 at 15x
  { start: 100, end: 190 }, // 90s source -> output 2..8
];

describe('formatClock', () => {
  it('pads to mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(677.48)).toBe('11:17');
  });

  it('floors negatives to zero rather than emitting a negative clock', () => {
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('buildSelectExpr', () => {
  it('ORs one between() per kept span', () => {
    expect(buildSelectExpr(SPANS)).toBe('between(t,10.000,40.000)+between(t,100.000,190.000)');
  });
});

describe('sourceTimeAt', () => {
  it('maps the start of each span to that span source time', () => {
    expect(sourceTimeAt(SPANS, 15, 0)).toBeCloseTo(10, 3);
    expect(sourceTimeAt(SPANS, 15, 2)).toBeCloseTo(100, 3);
  });

  it('advances at the speed multiplier within a span', () => {
    expect(sourceTimeAt(SPANS, 15, 1)).toBeCloseTo(25, 3); // 10 + 1*15
    expect(sourceTimeAt(SPANS, 15, 4)).toBeCloseTo(130, 3); // 100 + 2*15
  });

  it('jumps the cut gap instead of drifting through it', () => {
    // A naive t*speed reading would say 30s here; the truth is 100s.
    expect(sourceTimeAt(SPANS, 15, 2)).toBeGreaterThan(90);
  });

  it('pins to the final source time past the end', () => {
    expect(sourceTimeAt(SPANS, 15, 8)).toBeCloseTo(190, 3);
    expect(sourceTimeAt(SPANS, 15, 99)).toBeCloseTo(190, 3);
  });

  it('is monotonic across the whole output', () => {
    let prev = Number.NEGATIVE_INFINITY;
    for (let t = 0; t <= 8; t += 0.1) {
      const v = sourceTimeAt(SPANS, 15, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('degrades to zero with no spans', () => {
    expect(sourceTimeAt([], 15, 3)).toBe(0);
  });
});

describe('buildTimestampAss', () => {
  const ass = buildTimestampAss({
    spans: SPANS,
    speed: 15,
    outputDuration: 8,
    sourceDuration: 677.48,
    width: 1080,
    height: 1920,
  });

  it('declares the play resolution it was laid out for', () => {
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it('emits one cue per step and covers the full output', () => {
    const cues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(cues).toHaveLength(16); // 8s at 0.5s steps
    expect(cues[0]).toContain('0:00:00.00');
    expect(cues[cues.length - 1]).toContain('0:00:08.00');
  });

  it('shows source time, not output time', () => {
    const first = ass.split('\n').find((l) => l.startsWith('Dialogue:'));
    expect(first).toContain('00:10 / 11:17'); // first kept span starts at 10s
  });

  it('reflects the cut gap in the readout', () => {
    // The cue covering output t=2 must read ~01:40, not ~00:30.
    const cues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(cues[4]).toContain('01:40');
  });

  it('never emits a hundredths field of 100', () => {
    // Rounding 0.999 up would otherwise produce "0:00:00.100".
    const odd = buildTimestampAss({
      spans: SPANS,
      speed: 15,
      outputDuration: 2,
      sourceDuration: 100,
      width: 1080,
      height: 1920,
      step: 0.999,
    });
    expect(odd).not.toMatch(/\.\d{3}/);
  });
});

describe('escapeFilterPath', () => {
  it('escapes the characters ffmpeg filter args treat as syntax', () => {
    expect(escapeFilterPath('/tmp/a:b/c.ass')).toBe('/tmp/a\\:b/c.ass');
    expect(escapeFilterPath("/tmp/it's.ass")).toBe("/tmp/it\\'s.ass");
  });
});

describe('buildFilterGraph', () => {
  const base = {
    spans: SPANS,
    speed: 15,
    outputDuration: 8,
    fps: 30,
    portrait: true,
    overlay: true,
    hasMusic: false,
    musicVolume: 0.35,
    timestampAssPath: '/tmp/clock.ass',
  };

  it('always terminates in a [v] label ffmpeg can map', () => {
    expect(buildFilterGraph(base)).toContain('[v]');
    expect(buildFilterGraph({ ...base, overlay: false })).toContain('[v]');
    expect(buildFilterGraph({ ...base, overlay: false, portrait: false })).toContain('[v]');
  });

  it('resamples after setpts so the sped-up frames are actually dropped', () => {
    expect(buildFilterGraph(base)).toContain('setpts=PTS/15,fps=30');
  });

  it('pads to 1080x1920 over a blurred copy when portrait', () => {
    const graph = buildFilterGraph(base);
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(graph).toContain('overlay=(W-w)/2:(H-h)/2');
  });

  it('omits the pad chain when portrait is off', () => {
    expect(buildFilterGraph({ ...base, portrait: false })).not.toContain('split=2[bg][fg]');
  });

  it('burns the clock track when one was generated', () => {
    expect(buildFilterGraph(base)).toContain("subtitles='/tmp/clock.ass'");
  });

  it('still renders the bar when no clock track was generated', () => {
    const graph = buildFilterGraph({ ...base, timestampAssPath: undefined });
    expect(graph).not.toContain('subtitles=');
    expect(graph).toContain('thickness=fill');
  });

  it('keeps the graph free of the huge per-span expression that broke parsing', () => {
    // Regression: the readout used to inline one gated term per span, twice.
    const graph = buildFilterGraph(base);
    expect(graph).not.toContain('gte(t,');
    expect(graph.length).toBeLessThan(2000);
  });

  it('emits an [a] chain only when music is present', () => {
    expect(buildFilterGraph(base)).not.toContain('[a]');
    const scored = buildFilterGraph({ ...base, hasMusic: true });
    expect(scored).toContain('[1:a]');
    expect(scored).toContain('[a]');
  });

  it('fades the bed out before the clip ends', () => {
    expect(buildFilterGraph({ ...base, hasMusic: true })).toContain('afade=t=out:st=6.0000');
  });

  it('does not start the fade before zero on a very short clip', () => {
    const graph = buildFilterGraph({ ...base, hasMusic: true, outputDuration: 1 });
    expect(graph).toContain('afade=t=out:st=0.0000');
  });
});
