/**
 * Pull the live plan catalog from SparkPay and rewrite
 * src/lib/spark-pay/plans.json to match, so plan edits made in the SparkPay
 * dashboard never need hand-copying.
 *
 * Run: npm run plans:sync   (then review the git diff and commit)
 *
 * Ported from still-applying's scripts/sync-spark-plans.ts. Differences: node
 * + .mjs rather than bun + TS, 2-space JSON to match this repo's formatting,
 * and no plan_uid (the CLI never builds checkout links itself — it hands the
 * user the hosted pricing page).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SPARK_PAY_URL || 'https://sparkpay.dev';
const APP_ID = process.env.SPARK_APP_ID || 'vidlet';

const res = await fetch(`${BASE}/api/public/convert-prices?app_id=${APP_ID}`);
if (!res.ok) {
  console.error(`SparkPay responded ${res.status}`);
  process.exit(1);
}
const { pricing_plans: plans } = await res.json();

if (!Array.isArray(plans) || plans.length === 0) {
  console.error('SparkPay returned no plans; refusing to write an empty catalog.');
  process.exit(1);
}

// Same shape and field order as the checked-in plans.json.
const out = {};
for (const p of plans) {
  out[p.tier] = {
    name: p.name,
    ...(p.payment_type && p.payment_type !== 'subscription' && { payment_type: p.payment_type }),
    ...(p.monthly_amount_cents != null && { monthly_price: p.monthly_amount_cents / 100 }),
    ...(p.yearly_amount_cents != null && { yearly_price: p.yearly_amount_cents / 100 }),
    ...(p.recommended && { recommended: true }),
    ...(p.trial_days ? { trial_days: p.trial_days } : {}),
    ...(p.is_elite && { is_elite: true }),
    features: p.features ?? [],
    limits: p.limits ?? {},
    compare: p.compare ?? {},
  };
}

// An empty features/limits/compare on every tier means the catalog itself is
// unpopulated: overwriting a hand-written local file with that would silently
// delete the gating rules, so say so loudly instead.
const bare = Object.values(out).every(
  (p) => p.features.length === 0 && Object.keys(p.limits).length === 0
);
if (bare) {
  console.error(
    'Every tier came back with empty features and limits.\n' +
      'Populate them on SparkPay first (update_plan_limits / the dashboard),\n' +
      'otherwise this would wipe the local catalog. Nothing written.'
  );
  process.exit(1);
}

const path = fileURLToPath(new URL('../src/lib/spark-pay/plans.json', import.meta.url));
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `Wrote ${Object.keys(out).length} plans to src/lib/spark-pay/plans.json — review with: git diff`
);
