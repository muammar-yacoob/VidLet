/**
 * SparkPay integration (poll mode), ported from still-applying's
 * lib/spark-pay and ViralCat's server gate, adapted for a local tool.
 *
 * SparkPay (sparkpay.dev) owns Stripe checkout and subscription state. VidLet
 * never talks to Stripe: it polls subscription status by email and enforces
 * the per-plan limits in ./plans.json. Tier names and limit keys must match
 * what is registered on SparkPay — regenerate with `npm run plans:sync`.
 *
 * What is actually gateable here is narrower than it looks. The CLI is AGPL
 * and the local tools call local binaries, so a determined user can always
 * build past any check in this file. These gates are honest metering for the
 * things that cost real money (server-side AI, the YouTube broker), not a
 * copy-protection scheme, and they are deliberately not obfuscated.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import plansJson from './plans.json' with { type: 'json' };

export type Tier = 'free' | 'pro' | 'studio';

export interface Plan {
  name: string;
  payment_type?: string;
  monthly_price?: number;
  yearly_price?: number;
  trial_days?: number;
  recommended?: boolean;
  is_elite?: boolean;
  features: string[];
  limits: Record<string, number>;
  compare: Record<string, string>;
}

// Partial: a tier named here need not survive in the regenerated catalog, so
// every lookup tolerates undefined rather than assuming the key exists.
export const PLANS = plansJson as unknown as Partial<Record<Tier, Plan>>;
export const TIER_ORDER: Tier[] = ['free', 'pro', 'studio'];

const APP_ID = 'vidlet';
const OWNER_SLUG = 'spark';
const BASE = process.env.SPARK_PAY_URL || 'https://sparkpay.dev';

interface SparkStatus {
  registered: boolean;
  verified: boolean;
  access: { tier: string | null; is_paid: boolean; show_paywall: boolean };
  plan: { limits?: Record<string, number> } | null;
  subscription: { status: string; current_period_end: string | null } | null;
}

/** Hosted pricing page for this app, prefilled with the caller's email. */
export function pricingUrl(email?: string): string {
  const u = new URL(`/${OWNER_SLUG}/${APP_ID}`, BASE);
  if (email) u.searchParams.set('email', email);
  return u.toString();
}

/**
 * The account this machine bills against. `VIDLET_EMAIL` wins so CI and
 * scripted runs need no config file; otherwise it comes from the same
 * config.json the GUI writes.
 */
export function accountEmail(): string | null {
  const fromEnv = process.env.VIDLET_EMAIL?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(join(homedir(), '.config', 'vidlet', 'config.json'), 'utf-8');
    const email = JSON.parse(raw)?.app?.accountEmail;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
  } catch {
    return null;
  }
}

// ============ STATUS, WITH A LAST-KNOWN-GOOD CACHE ============

/**
 * Entitlements are cached on disk, not just in memory: the CLI is a new
 * process per invocation, so an in-process cache would re-poll SparkPay on
 * every single command.
 */
function cachePath(): string {
  return join(homedir(), '.config', 'vidlet', 'entitlement.json');
}

const FRESH_MS = 10 * 60 * 1000; // re-poll after this
const STALE_MS = 14 * 24 * 60 * 60 * 1000; // trust offline for this long

interface CachedStatus {
  email: string;
  tier: Tier;
  at: number;
}

function readCache(email: string): CachedStatus | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(), 'utf-8')) as CachedStatus;
    return c.email === email.toLowerCase() ? c : null;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedStatus): void {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // A cache we cannot write is a slow gate, not a broken one.
  }
}

async function fetchStatus(email: string): Promise<SparkStatus | null> {
  try {
    const url = `${BASE}/api/public/subscription/status-public?email=${encodeURIComponent(
      email
    )}&app_id=${APP_ID}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as SparkStatus;
  } catch {
    return null;
  }
}

/**
 * The caller's tier.
 *
 * Falls back to the last known good answer rather than to `free` when
 * SparkPay is unreachable: this runs on laptops that are offline for days,
 * and dropping a paying user to free-tier limits mid-flight on a plane is a
 * worse failure than trusting a two-week-old answer. Beyond STALE_MS the
 * cached answer is discarded and the user is treated as free.
 */
export async function getTier(): Promise<Tier> {
  const email = accountEmail();
  if (!email) return 'free';
  const key = email.toLowerCase();

  const cached = readCache(key);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.tier;

  const status = await fetchStatus(email);
  if (!status) {
    if (cached && Date.now() - cached.at < STALE_MS) return cached.tier;
    return 'free';
  }

  const raw = status.access?.tier;
  // Only ever return a tier the catalog defines: a tier retired on SparkPay
  // would otherwise flow through and blow up on PLANS[tier].name.
  const tier: Tier = raw && raw !== 'free' && PLANS[raw as Tier] ? (raw as Tier) : 'free';
  writeCache({ email: key, tier, at: Date.now() });
  return tier;
}

// ============ LIMITS ============

/** Limit for `key` on `tier` from the plan catalog. -1 means unlimited. */
export function planLimit(tier: Tier, key: string, fallback = 0): number {
  return PLANS[tier]?.limits?.[key] ?? fallback;
}

/** A 0/1 limit read as a feature flag. -1 (unlimited) counts as enabled. */
export function planAllows(tier: Tier, key: string): boolean {
  const v = planLimit(tier, key, 0);
  return v === -1 || v >= 1;
}

/**
 * The next tier above `tier` that actually exists in the catalog, or null
 * when this is already the top. Derived from PLANS rather than hardcoded so
 * an upgrade prompt can never name a plan nobody can buy.
 */
export function nextTierUp(tier: Tier): Plan | null {
  const available = TIER_ORDER.filter((t) => PLANS[t]);
  const next = available[available.indexOf(tier) + 1];
  return (next && PLANS[next]) || null;
}

/** The cheapest tier in the catalog that enables `key`, for upgrade copy. */
export function tierUnlocking(key: string): Plan | null {
  for (const t of TIER_ORDER) {
    if (PLANS[t] && planAllows(t, key)) return PLANS[t] ?? null;
  }
  return null;
}
