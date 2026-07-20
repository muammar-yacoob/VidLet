import { describe, expect, it } from 'vitest';
import { centroidToCropX, diffCentroidX } from '../lib/motion.js';
import {
  MIN_CLIP_LENGTH,
  batchOutputName,
  dropCrossShortOverlaps,
  formatTranscript,
  sanitizeClips,
} from './short.js';

describe('dropCrossShortOverlaps', () => {
  it('ranks by score and gives contested clips to the stronger short', () => {
    const result = dropCrossShortOverlaps([
      {
        score: 60,
        clips: [
          { start: 10, end: 20 },
          { start: 40, end: 50 },
        ],
      },
      { score: 90, clips: [{ start: 15, end: 25 }] },
    ]);
    expect(result[0]).toEqual({ score: 90, clips: [{ start: 15, end: 25 }] });
    // Weaker short loses the 10-20 clip (overlaps 15-25) but keeps 40-50.
    expect(result[1]).toEqual({ score: 60, clips: [{ start: 40, end: 50 }] });
  });

  it('removes shorts left with no clips', () => {
    const result = dropCrossShortOverlaps([
      { score: 80, clips: [{ start: 0, end: 30 }] },
      { score: 40, clips: [{ start: 10, end: 25 }] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(80);
  });
});

describe('batchOutputName', () => {
  it('injects index and rounded score before the extension', () => {
    expect(batchOutputName('/x/VidLet/v_short.mp4', 2, 86.6)).toBe(
      '/x/VidLet/v_short-2-score87.mp4'
    );
  });

  it('handles extensionless bases', () => {
    expect(batchOutputName('/x/out', 1, 90)).toBe('/x/out-1-score90.mp4');
  });
});

describe('sanitizeClips', () => {
  it('clamps clips to video bounds and drops too-short ones', () => {
    const clips = sanitizeClips(
      [
        { start: -5, end: 4 },
        { start: 10, end: 10.5 }, // shorter than MIN_CLIP_LENGTH
        { start: 50, end: 120 },
      ],
      60,
      57
    );
    expect(clips).toEqual([
      { start: 0, end: 4 },
      { start: 50, end: 60 },
    ]);
  });

  it('sorts chronologically and removes overlaps', () => {
    const clips = sanitizeClips(
      [
        { start: 20, end: 30 },
        { start: 5, end: 12 },
        { start: 25, end: 40 }, // overlaps the 20-30 clip
      ],
      100,
      57
    );
    expect(clips.map((c) => c.start)).toEqual([5, 20]);
    expect(clips[1].end).toBe(40); // overlap fused, not dropped
  });

  it('fuses back-to-back clips so the render has no needless cuts', () => {
    const clips = sanitizeClips(
      [
        { start: 17.6, end: 21 },
        { start: 21, end: 24.9 },
        { start: 24.9, end: 27.7 },
        { start: 40, end: 45 }, // real gap - stays separate
      ],
      100,
      57
    );
    expect(clips).toEqual([
      { start: 17.6, end: 27.7 },
      { start: 40, end: 45 },
    ]);
  });

  it('trims the last clip to fit the duration budget', () => {
    const clips = sanitizeClips(
      [
        { start: 0, end: 30 },
        { start: 40, end: 80 },
      ],
      100,
      45
    );
    expect(clips[1]).toEqual({ start: 40, end: 55 });
    const total = clips.reduce((s, c) => s + c.end - c.start, 0);
    expect(total).toBe(45);
  });

  it('drops a trailing clip when the leftover budget is below minimum length', () => {
    const clips = sanitizeClips(
      [
        { start: 0, end: 56 },
        { start: 60, end: 70 },
      ],
      100,
      57
    );
    expect(clips).toHaveLength(1);
    expect(MIN_CLIP_LENGTH).toBeGreaterThan(57 - 56);
  });
});

describe('centroidToCropX', () => {
  // 1920x1080 source → 9:16 crop window is 607.5px wide
  it('centers the window on the action', () => {
    // Action at the exact center → cropX 0.5
    expect(centroidToCropX(0.5, 1920, 1080)).toBeCloseTo(0.5, 5);
  });

  it('clamps at the edges', () => {
    expect(centroidToCropX(0.01, 1920, 1080)).toBe(0);
    expect(centroidToCropX(0.99, 1920, 1080)).toBe(1);
  });

  it('falls back to center for already-narrow sources', () => {
    expect(centroidToCropX(0.9, 600, 1080)).toBe(0.5);
  });
});

describe('diffCentroidX', () => {
  function frame(width: number, height: number, fill = 0): Buffer {
    return Buffer.alloc(width * height * 4, fill);
  }

  it('returns null for identical frames', () => {
    expect(diffCentroidX(frame(10, 10), frame(10, 10), 10, 10)).toBeNull();
  });

  it('finds the x of a localized change', () => {
    const a = frame(100, 10);
    const b = frame(100, 10);
    // "Cursor" moved: change a 3px-wide column around x=80
    for (let y = 0; y < 10; y++) {
      for (let x = 79; x <= 81; x++) {
        b[(y * 100 + x) * 4] = 255;
      }
    }
    const centroid = diffCentroidX(a, b, 100, 10);
    expect(centroid).not.toBeNull();
    expect(centroid as number).toBeCloseTo(0.8, 1);
  });
});

describe('formatTranscript', () => {
  it('renders timestamped lines', () => {
    const out = formatTranscript([
      { start: 0, end: 2.5, text: ' Hello there. ', words: [] },
      { start: 2.5, end: 5, text: 'Welcome back.', words: [] },
    ]);
    expect(out).toBe('[0.0-2.5] Hello there.\n[2.5-5.0] Welcome back.');
  });
});
