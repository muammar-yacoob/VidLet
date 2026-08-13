/**
 * Local usage meter for per-day plan limits.
 *
 * State lives beside the config in ~/.config/vidlet/usage.json, bucketed by
 * UTC day so the count resets without a scheduler. UTC rather than local
 * time: the bucket has to agree with whatever SparkPay reports for the same
 * period, and a laptop that crosses timezones would otherwise hand itself a
 * fresh allowance mid-flight.
 *
 * This is a meter, not a lock. It counts what this machine did; someone who
 * wants to reset it can delete the file. That is an accepted property — see
 * the note at the top of ./index.ts about what is genuinely gateable.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface UsageFile {
  /** UTC date the counts belong to, YYYY-MM-DD. */
  day: string;
  counts: Record<string, number>;
  /**
   * Counters that do NOT reset at midnight. A trial allowance is spent over
   * the whole trial window, so bucketing it by day would hand the caller a
   * fresh five uploads every morning.
   */
  totals?: Record<string, number>;
}

function usagePath(): string {
  return join(homedir(), '.config', 'vidlet', 'usage.json');
}

/** Today in UTC as YYYY-MM-DD. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function read(day: string): UsageFile {
  try {
    const parsed = JSON.parse(readFileSync(usagePath(), 'utf-8')) as UsageFile;
    if (parsed?.day === day && parsed.counts) return parsed;
    // Day rolled over: the daily counts go, the lifetime totals stay.
    if (parsed?.totals) return { day, counts: {}, totals: parsed.totals };
  } catch {
    // Missing or corrupt: start the day fresh rather than failing the call.
  }
  return { day, counts: {} };
}

function write(state: UsageFile): void {
  const path = usagePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Write-then-rename: two MCP tool calls can land at once, and a partial
    // write would make the file unparseable and silently reset the day.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, path);
  } catch {
    // An unwritable meter must never fail the underlying tool call.
  }
}

/** Current count for `key` today. */
export function used(key: string, now: Date = new Date()): number {
  return read(utcDay(now)).counts[key] ?? 0;
}

/**
 * Record one use of `key` and return the new count.
 *
 * Called only after a gated operation is allowed to proceed, so a rejected
 * call never eats the caller's allowance.
 */
export function record(key: string, now: Date = new Date()): number {
  const day = utcDay(now);
  const state = read(day);
  const next = (state.counts[key] ?? 0) + 1;
  state.counts[key] = next;
  write(state);
  return next;
}

/** Lifetime count for `key` - never reset by the day rollover. */
export function usedTotal(key: string, now: Date = new Date()): number {
  return read(utcDay(now)).totals?.[key] ?? 0;
}

/** Record one lifetime use of `key` and return the new count. */
export function recordTotal(key: string, now: Date = new Date()): number {
  const day = utcDay(now);
  const state = read(day);
  const totals = state.totals ?? {};
  const next = (totals[key] ?? 0) + 1;
  totals[key] = next;
  write({ ...state, totals });
  return next;
}

export interface MeterVerdict {
  allowed: boolean;
  used: number;
  /** -1 when the plan is unlimited. */
  limit: number;
  remaining: number;
}

/**
 * Would one more use of `key` stay inside `limit`? `-1` means unlimited and
 * short-circuits without touching the meter file.
 */
export function check(key: string, limit: number, now: Date = new Date()): MeterVerdict {
  if (limit === -1) {
    return { allowed: true, used: 0, limit: -1, remaining: Number.POSITIVE_INFINITY };
  }
  const count = used(key, now);
  return {
    allowed: count < limit,
    used: count,
    limit,
    remaining: Math.max(0, limit - count),
  };
}
