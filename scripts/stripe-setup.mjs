// Run once per Stripe mode (test/live) to create the three Products + their
// monthly EUR Prices, then paste the printed price IDs into .env.local as
// STRIPE_PRICE_STARTER/_PRO/_BUSINESS.
//
// Usage: npm run stripe:setup
//
// Not idempotent — running it twice creates duplicate Products. If you need
// to re-run it (e.g. you fat-fingered a price), delete the stale Products
// in the Stripe Dashboard first.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = [
  { key: "starter", name: "Starter", eur: 20 },
  { key: "pro", name: "Pro", eur: 30 },
  { key: "business", name: "Business", eur: 50 },
];

async function main() {
  console.log(`Creating Stripe Products/Prices in ${
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "TEST"
  } mode...\n`);

  const results = [];
  for (const plan of PLANS) {
    const product = await stripe.products.create({ name: `Boughtopia ${plan.name}` });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: plan.eur * 100,
      recurring: { interval: "month" },
    });
    results.push({ ...plan, priceId: price.id });
  }

  console.log("Done. Paste these into .env.local:\n");
  for (const r of results) {
    console.log(`STRIPE_PRICE_${r.key.toUpperCase()}=${r.priceId}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
