/**
 * Contrast matching across clips.
 *
 * Stitching several recordings together exposes how differently they were
 * exposed - one clip looks flat next to another, and a single global
 * `eq=contrast` bump preserves that mismatch instead of fixing it. So each
 * clip is measured (ffmpeg signalstats) and given its OWN eq that lands it
 * on a shared target, and the creative boost rides on top of that.
 */

export interface LumaStats {
  /** Mean luma, 0-255. */
  avg: number;
  /** 10th-percentile luma, 0-255. */
  low: number;
  /** 90th-percentile luma, 0-255. */
  high: number;
}

export interface GradeParams {
  contrast: number;
  brightness: number;
}

/**
 * Bounds on the FINAL contrast. Deliberately tight: fully equalising two
 * clips means stretching the flatter one hard, and a 1.7x stretch on a
 * screen recording amplifies banding and crushes the darks into a look
 * that reads as harsh next to its neighbour. Matching should close the gap,
 * not erase it at any cost.
 */
const MIN_CONTRAST = 0.75;
const MAX_CONTRAST = 1.35;
const MAX_BRIGHTNESS = 0.15;

/**
 * How far toward the shared target a clip is moved. Below 1 because the
 * goal is that neighbouring clips stop LOOKING different, which is reached
 * well before they are numerically identical.
 */
const MATCH_STRENGTH = 0.6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Average the YAVG / YLOW / YHIGH lines emitted by
 * `signalstats,metadata=print`. Returns null when nothing parsed.
 */
export function parseLumaStats(log: string): LumaStats | null {
  const pick = (key: string): number[] =>
    [...log.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`, 'g'))].map((m) =>
      Number.parseFloat(m[1])
    );
  const avg = pick('YAVG');
  const low = pick('YLOW');
  const high = pick('YHIGH');
  if (avg.length === 0) return null;
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    avg: mean(avg),
    low: low.length ? mean(low) : 0,
    high: high.length ? mean(high) : 255,
  };
}

/** The shared look every clip is graded towards: the average of them all. */
export function averageStats(all: LumaStats[]): LumaStats {
  const mean = (f: (s: LumaStats) => number): number =>
    all.reduce((n, s) => n + f(s), 0) / all.length;
  return { avg: mean((s) => s.avg), low: mean((s) => s.low), high: mean((s) => s.high) };
}

/**
 * eq params that move `clip` onto `target`, then apply `boost` on top.
 *
 * ffmpeg's eq computes out = (in - 0.5) * contrast + 0.5 + brightness on
 * normalised luma, so matching the 10-90 spread fixes contrast and the
 * brightness term re-centres the mean afterwards.
 */
export function matchGrade(clip: LumaStats, target: LumaStats, boost = 1): GradeParams {
  const clipSpread = Math.max(1, clip.high - clip.low) / 255;
  const targetSpread = Math.max(1, target.high - target.low) / 255;

  // Move PART of the way to the target rather than all of it. Full
  // correction gave a flat clip 1.39x, which the creative boost then
  // compounded to 1.73x - the second half of a Short looking visibly
  // harsher than the first.
  const full = targetSpread / clipSpread;
  const matched = 1 + (full - 1) * MATCH_STRENGTH;

  const contrast = clamp(matched * boost, MIN_CONTRAST, MAX_CONTRAST);
  const m = clip.avg / 255;
  const brightness = clamp(
    (target.avg / 255 - ((m - 0.5) * contrast + 0.5)) * MATCH_STRENGTH,
    -MAX_BRIGHTNESS,
    MAX_BRIGHTNESS
  );

  return { contrast: Number(contrast.toFixed(4)), brightness: Number(brightness.toFixed(4)) };
}
