import type Stripe from "stripe";
import type { Plan } from "./entitlements";
import type { PlanInput } from "./validatePlan";

/**
 * Server-only. Keeps Stripe products/prices in step with control.plans.
 * Called BEFORE the DB write: if the DB write then fails, the new price is
 * an unused orphan (harmless) and the retry reuses it via the idempotency
 * key. Old prices are deactivated for NEW purchases only — existing
 * subscriptions keep billing on them (grandfathering).
 *
 * `syncStripePlan` itself never deactivates the OLD price — it only reports
 * which one to deactivate (`deactivatePriceId`) via `deactivateStripePrice`,
 * and the caller runs that AFTER its own DB write commits. Deactivating
 * up front would leave `stripe_price_id` pointing at an inactive price (and
 * checkout/change-plan broken) if the DB write then failed.
 */

// Deviation from the brief: this SDK version (stripe@22) names these
// `Stripe.ProductResource` / `Stripe.PriceResource` (singular) — there is no
// `ProductsResource`/`PricesResource` export. Confirmed via
// node_modules/stripe/cjs/resources/{Products,Prices}.d.ts.
export type StripePlanApi = {
  products: Pick<Stripe.ProductResource, "create" | "update">;
  prices: Pick<Stripe.PriceResource, "create" | "update">;
};

export class PlanSyncError extends Error {}

export const toCents = (eur: number): number => Math.round(eur * 100);

const productName = (name: string) => `Boughtopia ${name}`;

export async function createStripePlan(
  stripe: StripePlanApi,
  input: Pick<PlanInput, "key" | "name" | "tagline" | "monthlyEur">
): Promise<{ productId: string; priceId: string }> {
  const product = await stripe.products.create(
    {
      name: productName(input.name),
      ...(input.tagline ? { description: input.tagline } : {}),
      metadata: { plan_key: input.key },
    },
    { idempotencyKey: `plan-create-product-${input.key}` }
  );
  const cents = toCents(input.monthlyEur!);
  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: "eur",
      unit_amount: cents,
      recurring: { interval: "month" },
      metadata: { plan_key: input.key },
    },
    { idempotencyKey: `plan-create-price-${input.key}-${cents}` }
  );
  return { productId: product.id, priceId: price.id };
}

/** Deactivates a Stripe price so it can no longer be used for NEW purchases/plan-changes. */
export async function deactivateStripePrice(stripe: StripePlanApi, priceId: string): Promise<void> {
  await stripe.prices.update(priceId, { active: false });
}

export async function syncStripePlan(
  stripe: StripePlanApi,
  before: Plan,
  after: PlanInput
): Promise<{ priceId?: string; deactivatePriceId?: string }> {
  if (before.kind !== "paid") return {};

  const priceChanged = after.monthlyEur !== null && toCents(after.monthlyEur) !== toCents(before.monthlyEur ?? 0);
  const productUpdate: Stripe.ProductUpdateParams = {};
  if (after.name !== before.name) productUpdate.name = productName(after.name);
  if (after.tagline !== before.tagline && after.tagline) productUpdate.description = after.tagline;
  const wasRetired = before.visibility === "retired";
  const isRetired = after.visibility === "retired";
  if (wasRetired !== isRetired) productUpdate.active = !isRetired;

  const needsStripe = priceChanged || Object.keys(productUpdate).length > 0;
  if (!needsStripe) return {};
  if (!before.stripeProductId) {
    throw new PlanSyncError("This plan isn't linked to Stripe yet. Run npm run plans:seed-stripe first.");
  }

  if (Object.keys(productUpdate).length > 0) {
    await stripe.products.update(before.stripeProductId, productUpdate);
  }

  if (!priceChanged) return {};
  const cents = toCents(after.monthlyEur!);
  const price = await stripe.prices.create(
    {
      product: before.stripeProductId,
      currency: "eur",
      unit_amount: cents,
      recurring: { interval: "month" },
      metadata: { plan_key: before.key },
    },
    { idempotencyKey: `plan-price-${before.key}-${cents}-${before.stripePriceId ?? "none"}` }
  );
  return { priceId: price.id, ...(before.stripePriceId ? { deactivatePriceId: before.stripePriceId } : {}) };
}
