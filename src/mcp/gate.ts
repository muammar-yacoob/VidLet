/**
 * Plan gating for the MCP tool surface.
 *
 * Two independent checks wrap every handler:
 *
 *  1. Feature gates — a tool listed in FEATURE_GATES needs its limit key
 *     enabled on the caller's tier (YouTube publishing and AI hashtags are
 *     Studio-only).
 *  2. A daily call meter — `mcp_calls_daily` from the plan catalog, which is
 *     10 on Free and unlimited on every paid tier.
 *
 * Both fail toward letting the call through when SparkPay cannot be reached;
 * see getTier in ../lib/spark-pay/index.ts for why that is the right default
 * for a tool that runs on other people's laptops.
 */
import {
  accountEmail,
  getEntitlement,
  planAllows,
  planLimit,
  pricingUrl,
  type Tier,
  tierUnlocking,
} from '../lib/spark-pay/index.js';
import { check, record, recordTotal, usedTotal } from '../lib/spark-pay/meter.js';
import type { ToolHandler, ToolResult } from './shared.js';

/** Tools that need a specific plan limit enabled, and the key that enables it. */
const FEATURE_GATES: Record<string, string> = {
  connect_youtube: 'youtube_publish',
  upload_to_youtube: 'youtube_publish',
  rotate_youtube_test: 'youtube_publish',
};

/**
 * What a trial may do with a feature its tier has not bought.
 *
 * Publishing is the payoff moment - a trial that cannot reach it is a trial
 * of everything except the reason to buy. So connecting is free and uploads
 * get a small lifetime allowance, while `rotate_youtube_test` stays paid:
 * A/B rotation is the recurring value, and it only means anything after
 * enough uploads to compare.
 */
const TRIAL_ALLOWANCE: Record<string, { limitKey: string | null }> = {
  connect_youtube: { limitKey: null },
  upload_to_youtube: { limitKey: 'youtube_uploads_trial' },
};

const TRIAL_METER_PREFIX = 'trial:';

/**
 * Used when the catalog carries no `youtube_uploads_trial` for the tier.
 * The catalog is authoritative when it has an answer; this only stops the
 * allowance reading as 0 - which would gate the feature shut rather than
 * open, the opposite of the intent.
 */
const DEFAULT_TRIAL_UPLOADS = 5;

/**
 * Discovery is never metered. An agent that cannot call list_capabilities
 * cannot find out what it is allowed to do, which turns a quota into a
 * mystery failure.
 */
const UNMETERED = new Set(['list_capabilities']);

const METER_KEY = 'mcp_calls_daily';

function blocked(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** The upgrade line shown when a feature is not on the caller's plan. */
function upgradeMessage(tool: string, limitKey: string, tier: Tier): string {
  const needed = tierUnlocking(limitKey);
  const plan = needed ? needed.name : 'a paid plan';
  return [
    `\`${tool}\` is not available on the ${plan === 'Free' ? 'Free' : tier} plan.`,
    `It is included in ${plan}.`,
    `Upgrade: ${pricingUrl(accountEmail() ?? undefined)}`,
  ].join(' ');
}

/** The message shown when a trial has spent its whole upload allowance. */
function trialSpentMessage(tool: string, spent: number, cap: number): string {
  return [
    `Trial upload allowance used: ${spent}/${cap}. \`${tool}\` needs a paid plan now.`,
    'Everything else - editing, captions, rendering - keeps working.',
    `Upgrade: ${pricingUrl(accountEmail() ?? undefined)}`,
  ].join(' ');
}

/** The message shown when the day's call allowance is gone. */
function quotaMessage(usedToday: number, limit: number, tier: Tier): string {
  return [
    `Daily MCP limit reached: ${usedToday}/${limit} calls today on the ${tier} plan.`,
    'It resets at 00:00 UTC.',
    `For unlimited calls: ${pricingUrl(accountEmail() ?? undefined)}`,
  ].join(' ');
}

/**
 * Wrap one handler with the feature gate and the daily meter.
 *
 * A call rejected by either gate never reaches the meter, so being told "not
 * on your plan" costs nothing. Once a call is admitted it is counted in a
 * `finally`: tool handlers here both return `isError` results AND throw, and
 * counting only the former left a caller able to hammer a throwing tool for
 * free. "Calls admitted today" is the honest meaning of the limit.
 */
function gateOne(name: string, handler: ToolHandler): ToolHandler {
  return async (args) => {
    const { tier, onTrial } = await getEntitlement();

    const limitKey = FEATURE_GATES[name];
    let spendTrialUpload: string | null = null;
    if (limitKey && !planAllows(tier, limitKey)) {
      const allowance = onTrial ? TRIAL_ALLOWANCE[name] : undefined;
      if (!allowance) return blocked(upgradeMessage(name, limitKey, tier));

      if (allowance.limitKey) {
        const cap = planLimit(tier, allowance.limitKey, DEFAULT_TRIAL_UPLOADS);
        const meterKey = `${TRIAL_METER_PREFIX}${allowance.limitKey}`;
        const spent = usedTotal(meterKey);
        if (cap !== -1 && spent >= cap) {
          return blocked(trialSpentMessage(name, spent, cap));
        }
        // Counted only once the handler actually succeeds, below.
        spendTrialUpload = meterKey;
      }
    }

    if (UNMETERED.has(name)) return handler(args);

    const verdict = check(METER_KEY, planLimit(tier, METER_KEY, -1));
    if (!verdict.allowed) {
      return blocked(quotaMessage(verdict.used, verdict.limit, tier));
    }

    try {
      const result = await handler(args);
      // Unlike the daily meter, a trial allowance does not come back
      // tomorrow - so a failed upload must not cost one of the five.
      if (spendTrialUpload && result?.isError !== true) recordTotal(spendTrialUpload);
      return result;
    } finally {
      record(METER_KEY);
    }
  };
}

/** Apply the gates across a whole handler map. */
export function gateHandlers(handlers: Record<string, ToolHandler>): Record<string, ToolHandler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, gateOne(name, handler)])
  );
}
