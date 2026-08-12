/**
 * The timeline arithmetic behind an auto-edit.
 *
 * A Short plays kept spans of source footage end to end, each sped up, so
 * two clocks exist at once: SOURCE time (where a moment sits in the
 * original recording) and OUTPUT time (where it lands in the render).
 * Everything that converts between them, decides a speed, or assigns
 * narration lines to sections of footage lives here.
 *
 * This is the part that goes wrong invisibly: a narration line placed on
 * output time when it should have been source time still renders, it just
 * talks about the wrong footage.
 */
import type { TimeSegment } from '@spark-apps/video-kit';

/** Speed multiplier that lands the kept footage inside the ceiling. */
export function speedFor(keptSeconds: number, maxSeconds: number): number {
  if (keptSeconds <= maxSeconds) return 1;
  return Math.min(60, keptSeconds / maxSeconds);
} /** A stretch of output time belonging to one source clip. */
export interface SectionWindow {
  start: number;
  end: number;
} /**
 * Split lines across sections in proportion to how long each section runs.
 *
 * A script written as "first we model, then we rig" only lines up if the
 * modelling lines play over the modelling clip. Spreading every line evenly
 * across the whole timeline ignores that the clips are different lengths,
 * so the rigging narration starts while the modelling footage is still on
 * screen. Lines keep their order; only the boundaries move.
 */
export function allocateLinesToSections<T extends { duration: number }>(
  lines: T[],
  windows: SectionWindow[]
): T[][] {
  if (windows.length <= 1 || lines.length === 0) return [lines];

  const totalWindow = windows.reduce((n, w) => n + (w.end - w.start), 0);
  const totalSpeech = lines.reduce((n, l) => n + l.duration, 0);

  const groups: T[][] = windows.map(() => []);
  let spoken = 0;
  for (const line of lines) {
    // Place the line by where its MIDPOINT falls in the speech, so a long
    // line straddling a boundary lands where most of it belongs.
    const mid = (spoken + line.duration / 2) / (totalSpeech || 1);
    let acc = 0;
    let target = windows.length - 1;
    for (let i = 0; i < windows.length; i++) {
      acc += (windows[i].end - windows[i].start) / (totalWindow || 1);
      if (mid <= acc) {
        target = i;
        break;
      }
    }
    groups[target].push(line);
    spoken += line.duration;
  }
  return groups;
} /** Where a moment in the finished Short came from in the source footage. */
export interface SourcePoint {
  clipIndex: number;
  sourceTime: number;
} /**
 * Map a time in the finished Short back to the clip and source timestamp it
 * came from, so a frame can be pulled for that exact moment.
 *
 * Kept spans are laid end to end and sped up, so output time walks the
 * spans in order at `speed`. Anything before the intro ends, or past the
 * last span, clamps to the nearest real frame.
 */
export function outputTimeToSource(
  clips: Array<{ spans: TimeSegment[] }>,
  speed: number,
  introSeconds: number,
  outputTime: number
): SourcePoint | null {
  const target = (outputTime - introSeconds) * speed;
  if (target < 0) return null; // still in the intro
  let elapsed = 0;
  let last: SourcePoint | null = null;
  for (let c = 0; c < clips.length; c++) {
    for (const span of clips[c].spans) {
      const len = span.end - span.start;
      if (target < elapsed + len) {
        return { clipIndex: c, sourceTime: span.start + (target - elapsed) };
      }
      elapsed += len;
      last = { clipIndex: c, sourceTime: span.end };
    }
  }
  return last;
} /**
 * How long after the lead-in the first line may start. Zero: the opening
 * beat is fixed for every Short, so the vision model decides the SPACING of
 * the lines but never when the video starts talking.
 */
const MAX_OPENING_DELAY = 0;

export function startsFromAssignment(
  lines: Array<{ duration: number }>,
  assignment: number[],
  keyframeTimes: number[],
  earliest: number,
  latest: number,
  gap = 0.18
): number[] {
  const starts: number[] = [];
  let cursor = earliest;
  let lastIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = assignment[i];
    const idx = Math.min(
      keyframeTimes.length - 1,
      Math.max(lastIndex, Number.isFinite(raw) ? Math.trunc(raw) : lastIndex)
    );
    lastIndex = idx;
    const start = Math.max(cursor, keyframeTimes[idx] ?? cursor);
    starts.push(start);
    cursor = start + lines[i].duration + gap;
  }

  // A Short must not open with dead air. The vision model picks which
  // MOMENT each line belongs to, but it has no stake in when the video
  // starts talking, and it will happily anchor the opening line to a
  // keyframe deep into the footage - one assignment put it 20s in, so the
  // Short began with twenty seconds of silence. Slide the whole run earlier
  // so the first line lands promptly, preserving the relative spacing the
  // model chose. A small delay is fine and often deliberate; a long one is
  // always a mistake.
  const openingDelay = starts[0] - earliest;
  if (openingDelay > MAX_OPENING_DELAY) {
    const shift = openingDelay - MAX_OPENING_DELAY;
    for (let i = 0; i < starts.length; i++) starts[i] -= shift;
  }

  // The assignment can also point past the end - a model may put the
  // closing line on the final frame, leaving no room to say it. Rather than
  // clamping line by line, which just stacks them up against the wall and
  // reintroduces overlap, slide the whole run earlier by the overflow so
  // the spacing the vision model chose is preserved.
  const lastEnd = starts[starts.length - 1] + lines[lines.length - 1].duration;
  const overflow = lastEnd - latest;
  if (overflow > 0) {
    const shift = Math.min(overflow, starts[0] - earliest);
    for (let i = 0; i < starts.length; i++) starts[i] -= shift;
  }

  // If it still does not fit, the script is simply longer than the video:
  // pack from the earliest point and let the gaps collapse.
  if (starts[starts.length - 1] + lines[lines.length - 1].duration > latest) {
    let packed = earliest;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = packed;
      packed += lines[i].duration;
    }
  }
  return starts;
} /**
 * Map a source timestamp onto the finished timeline, or null when that
 * moment was cut.
 *
 * The inverse of outputTimeToSource. Needed to reuse a transcript of the
 * ORIGINAL audio as captions: the words were timed against the source, but
 * they have to be drawn against the edit.
 */
export function sourceTimeToOutput(
  clips: Array<{ spans: TimeSegment[] }>,
  speed: number,
  introSeconds: number,
  clipIndex: number,
  sourceTime: number
): number | null {
  let elapsed = 0;
  for (let c = 0; c < clips.length; c++) {
    for (const span of clips[c].spans) {
      const len = span.end - span.start;
      if (c === clipIndex && sourceTime >= span.start && sourceTime < span.end) {
        return introSeconds + (elapsed + (sourceTime - span.start)) / speed;
      }
      elapsed += len;
    }
  }
  return null; // this moment did not survive the cut
} /**
 * Speed each clip so its share of the runtime matches its share of the
 * NARRATION, rather than its share of the source footage.
 *
 * With one global speed, output time is proportional to how much footage
 * survived the cut. That is fine until the script says otherwise: pinning
 * seven rigging lines to a clip that only earned 13 seconds of a 57 second
 * Short cannot work, and the narration ends up sprawling over whichever
 * footage happens to be on screen. Giving the talkative clip more runtime
 * and the quiet one less is what makes "this line describes this footage"
 * actually true.
 *
 * Returns one multiplier per clip. A clip with no lines still gets shown -
 * silence over footage is fine - it just gets the minimum share.
 */
export function speedPerSection(
  keptDurations: number[],
  sectionSpeech: number[],
  availableSeconds: number,
  minShare = 0.12
): number[] {
  const totalSpeech = sectionSpeech.reduce((a, b) => a + b, 0);
  if (totalSpeech <= 0 || keptDurations.length === 0) {
    // Nothing to balance against: one speed for everything.
    const totalKept = keptDurations.reduce((a, b) => a + b, 0);
    const uniform = Math.max(1, totalKept / Math.max(0.001, availableSeconds));
    return keptDurations.map(() => uniform);
  }

  // Every clip keeps a floor of the runtime so a silent section does not
  // flash past unreadably.
  const rawShares = sectionSpeech.map((s) => s / totalSpeech);
  const floored = rawShares.map((s) => Math.max(s, minShare));
  const sum = floored.reduce((a, b) => a + b, 0);
  const shares = floored.map((s) => s / sum);

  return keptDurations.map((kept, i) => {
    const seconds = Math.max(0.001, shares[i] * availableSeconds);
    // Never slow footage down below realtime; a timelapse only speeds up.
    return Math.max(1, kept / seconds);
  });
} /** Output-time window per clip given a per-clip speed. */
export function windowsFromSpeeds(
  keptDurations: number[],
  speeds: number[],
  offset: number
): SectionWindow[] {
  const out: SectionWindow[] = [];
  let at = offset;
  for (let i = 0; i < keptDurations.length; i++) {
    const end = at + keptDurations[i] / speeds[i];
    out.push({ start: at, end });
    at = end;
  }
  return out;
}
