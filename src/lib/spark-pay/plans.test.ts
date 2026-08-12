import { describe, expect, it } from 'vitest';
import { nextTierUp, PLANS, planAllows, planLimit, TIER_ORDER, tierUnlocking } from './index.js';
import { check, utcDay } from './meter.js';

describe('plan catalog', () => {
  it('defines every tier the code orders', () => {
    for (const tier of TIER_ORDER) expect(PLANS[tier]).toBeDefined();
  });

  it('gives every tier the features and comparison rows the pricing page renders', () => {
    for (const tier of TIER_ORDER) {
      expect(PLANS[tier]?.features.length).toBeGreaterThan(0);
      expect(Object.keys(PLANS[tier]?.compare ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('compares every tier on the same rows, so the table has no holes', () => {
    const rows = Object.keys(PLANS.free?.compare ?? {}).sort();
    for (const tier of TIER_ORDER) {
      expect(Object.keys(PLANS[tier]?.compare ?? {}).sort()).toEqual(rows);
    }
  });
});

describe('limits', () => {
  it('caps free MCP usage at 10 a day and leaves paid tiers unlimited', () => {
    expect(planLimit('free', 'mcp_calls_daily')).toBe(10);
    expect(planLimit('pro', 'mcp_calls_daily')).toBe(-1);
    expect(planLimit('studio', 'mcp_calls_daily')).toBe(-1);
  });

  it('keeps YouTube publishing and AI hashtags on Studio only', () => {
    for (const key of ['youtube_publish', 'ai_hashtags']) {
      expect(planAllows('free', key)).toBe(false);
      expect(planAllows('pro', key)).toBe(false);
      expect(planAllows('studio', key)).toBe(true);
    }
  });

  it('treats unlimited (-1) as enabled, not as disabled', () => {
    expect(planAllows('studio', 'ai_generations_daily')).toBe(true);
  });

  it('falls back rather than throwing on a key no tier defines', () => {
    expect(planLimit('free', 'not_a_real_key', 42)).toBe(42);
    expect(planAllows('free', 'not_a_real_key')).toBe(false);
  });
});

describe('upgrade targets', () => {
  it('names Studio as the tier that unlocks YouTube', () => {
    expect(tierUnlocking('youtube_publish')?.name).toBe('Studio');
  });

  it('walks up the catalog and stops at the top', () => {
    expect(nextTierUp('free')?.name).toBe('Pro');
    expect(nextTierUp('pro')?.name).toBe('Studio');
    expect(nextTierUp('studio')).toBeNull();
  });
});

describe('meter', () => {
  it('short-circuits unlimited plans without reading the meter file', () => {
    const v = check('mcp_calls_daily', -1);
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('buckets by UTC day, not local time', () => {
    // 23:30 UTC and 00:30 UTC the next day are different buckets even though
    // a westward local timezone would still call both "today".
    expect(utcDay(new Date('2026-08-12T23:30:00Z'))).toBe('2026-08-12');
    expect(utcDay(new Date('2026-08-13T00:30:00Z'))).toBe('2026-08-13');
  });
});
