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
 * Bounds on the FINAL contrast. Wide enough to let two ordinary screen
 * recordings actually meet - at 0.75/1.35 both clips hit a rail and stayed
 * visibly apart - but still a rail, so a pathologically flat clip is not
 * stretched until it bands. The harshness that first motivated tighter
 * bounds came from compounding the creative boost, which is now capped.
 */
const MIN_CONTRAST = 0.6;
const MAX_CONTRAST = 1.6;
const MAX_BRIGHTNESS = 0.25;

/**
 * How far toward the shared target a clip is moved.
 *
 * Full. Partial matching was a wrong turn: it was introduced to stop a flat
 * clip being stretched harshly, but the harshness came from MULTIPLYING the
 * creative boost onto the match, not from matching itself. At 0.6 the two
 * halves of a Short still measured visibly apart - 60 average luma against
 * 50, spread 71 against 56 - which is exactly the mismatch matching exists
 * to remove. Match fully, and keep the boost off the per-clip correction.
 */
const MATCH_STRENGTH = 1;

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

  // The boost is applied to the TARGET, not per clip, so every clip lands
  // on the same spread. Multiplying it in per clip compounded the
  // correction a flat clip already needed and produced a 1.73x stretch.
  const contrast = clamp(matched * Math.min(boost, 1.05), MIN_CONTRAST, MAX_CONTRAST);
  const m = clip.avg / 255;
  const brightness = clamp(
    target.avg / 255 - ((m - 0.5) * contrast + 0.5),
    -MAX_BRIGHTNESS,
    MAX_BRIGHTNESS
  );

  return { contrast: Number(contrast.toFixed(4)), brightness: Number(brightness.toFixed(4)) };
}
