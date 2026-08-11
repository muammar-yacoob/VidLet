/**
 * A/B bookkeeping for YouTube uploads.
 *
 * Studio's native "Test & compare" has no public API, so VidLet runs the
 * test the way third-party tools do: upload with variant A, later swap the
 * title/thumbnail to variant B, and compare view velocity per variant.
 * Pure logic lives here; the API calls and the sidecar file live with the
 * tool. Velocity (views gained per hour of exposure) is the comparison
 * metric, because raw totals just reward whichever variant ran longer.
 */

export interface AbVariant {
  title: string;
  /** Absolute path to the thumbnail frame for this variant. */
  thumbnail: string;
}

export interface AbSnapshot {
  /** Which variant was LIVE during the window this snapshot closes. */
  variant: 'a' | 'b';
  at: number; // epoch ms
  views: number;
  likes: number;
}

export interface AbSidecar {
  videoId: string;
  url: string;
  a: AbVariant;
  b: AbVariant;
  active: 'a' | 'b';
  description: string;
  tags: string[];
  snapshots: AbSnapshot[];
}

export interface VariantPerformance {
  variant: 'a' | 'b';
  hoursLive: number;
  viewsGained: number;
  viewsPerHour: number;
}

export interface AbVerdict {
  a: VariantPerformance;
  b: VariantPerformance;
  /** null until both variants have at least an hour of exposure. */
  winner: 'a' | 'b' | null;
  note: string;
}

/**
 * Fold the snapshot history into per-variant exposure and view velocity.
 *
 * Each snapshot closes the window that started at the previous snapshot,
 * and attributes that window's gained views to the variant that was live
 * during it (recorded on the snapshot itself at rotation time).
 */
export function computeVerdict(snapshots: AbSnapshot[]): AbVerdict {
  const perf: Record<'a' | 'b', { ms: number; views: number }> = {
    a: { ms: 0, views: 0 },
    b: { ms: 0, views: 0 },
  };

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const cur = snapshots[i];
    const bucket = perf[cur.variant];
    bucket.ms += Math.max(0, cur.at - prev.at);
    bucket.views += Math.max(0, cur.views - prev.views);
  }

  const toPerf = (v: 'a' | 'b'): VariantPerformance => {
    const hours = perf[v].ms / 3_600_000;
    return {
      variant: v,
      hoursLive: Number(hours.toFixed(1)),
      viewsGained: perf[v].views,
      viewsPerHour: hours > 0 ? Number((perf[v].views / hours).toFixed(1)) : 0,
    };
  };
  const a = toPerf('a');
  const b = toPerf('b');

  // A verdict on minutes of data is noise dressed as an answer.
  if (a.hoursLive < 1 || b.hoursLive < 1) {
    return {
      a,
      b,
      winner: null,
      note:
        'Not enough exposure yet: each variant needs at least an hour live before the ' +
        'comparison means anything. Rotate again later.',
    };
  }

  if (a.viewsPerHour === b.viewsPerHour) {
    return { a, b, winner: null, note: 'Dead even so far. Keep rotating.' };
  }
  const winner = a.viewsPerHour > b.viewsPerHour ? 'a' : 'b';
  const lead = winner === 'a' ? a : b;
  const trail = winner === 'a' ? b : a;
  return {
    a,
    b,
    winner,
    note:
      `Variant ${winner.toUpperCase()} is winning: ${lead.viewsPerHour} views/hour against ` +
      `${trail.viewsPerHour}. Apply it permanently once the gap holds across a few rotations.`,
  };
}

/** The variant to switch TO on rotation. */
export function nextVariant(active: 'a' | 'b'): 'a' | 'b' {
  return active === 'a' ? 'b' : 'a';
}

/** Sidecar path convention, beside the uploaded file. */
export function sidecarPathFor(videoPath: string): string {
  return `${videoPath}.youtube.json`;
}
