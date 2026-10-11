// One-off, per Stripe mode (test/live): copy the existing Stripe price IDs
// (STRIPE_PRICE_STARTER/_PRO/_BUSINESS in .env.local) into the seeded
// control.plans rows (control-plane 012), plus their product IDs and a
// control.plan_prices history row. Idempotent — safe to re-run.
//
// Usage: npm run plans:seed-stripe
//
// After this has run in an environment, the STRIPE_PRICE_* env vars are no
// longer read by the app and can be deleted.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const control = createClient(
  process.env.CONTROL_SUPABASE_URL,
  process.env.CONTROL_SUPABASE_SERVICE_KEY
).schema("control");

const ENV = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

async function main() {
  console.log(`Seeding plan Stripe IDs (${
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "TEST"
  } mode)...\n`);

  const skipped = [];
  for (const [key, priceId] of Object.entries(ENV)) {
    if (!priceId) {
      console.log(`- ${key}: STRIPE_PRICE_${key.toUpperCase()} not set, skipped`);
      continue;
    }
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const monthlyEur = (price.unit_amount ?? 0) / 100;

    // Never link a Stripe price whose amount disagrees with the catalog row:
    // checkout would charge one amount while the pricing page shows another.
    const { data: row, error: rowError } = await control
      .from("plans")
      .select("monthly_eur")
      .eq("key", key)
      .maybeSingle();
    if (rowError) throw new Error(`${key}: ${rowError.message}`);
    if (!row) {
      console.warn(`! ${key}: no control.plans row with this key — SKIPPED`);
      skipped.push(key);
      continue;
    }
    const rowEur = row.monthly_eur === null ? null : Number(row.monthly_eur);
    if (rowEur !== monthlyEur) {
      console.warn(
        `! ${key}: Stripe price ${priceId} is €${monthlyEur}/mo but control.plans.monthly_eur is ` +
          `${rowEur === null ? "null" : `€${rowEur}`} — SKIPPED (nothing written). Fix the env var or the row, then re-run.`
      );
      skipped.push(key);
      continue;
    }

    const { error: planError } = await control
      .from("plans")
      .update({ stripe_price_id: priceId, stripe_product_id: productId, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (planError) throw new Error(`${key}: ${planError.message}`);

    const { error: historyError } = await control
      .from("plan_prices")
      .upsert({ stripe_price_id: priceId, plan_key: key, monthly_eur: monthlyEur }, { onConflict: "stripe_price_id" });
    if (historyError) throw new Error(`${key} history: ${historyError.message}`);

    console.log(`- ${key}: price ${priceId} (€${monthlyEur}), product ${productId}`);
  }
  if (skipped.length > 0) {
    console.error(`\nDone with ${skipped.length} plan(s) skipped: ${skipped.join(", ")}.`);
    process.exit(1);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
