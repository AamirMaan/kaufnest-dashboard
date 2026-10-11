/**
 * Which plan a Stripe subscription is on (billing webhook). The price id
 * first, via control.plan_prices — it is what Stripe actually bills, so a
 * price swapped in the Stripe dashboard (whose metadata.plan still names the
 * old plan) resolves correctly, as do grandfathered prices. metadata.plan
 * (written by checkout/change-plan) is the fallback for a price missing from
 * the history. Null = unknown: the webhook then leaves tenants.plan untouched
 * instead of the old silent "starter" default.
 */
export function resolvePlanKey(input: {
  metadataPlan: string | null | undefined;
  priceId: string | null | undefined;
  paidPlanKeys: ReadonlySet<string>;
  priceToPlan: ReadonlyMap<string, string>;
}): string | null {
  const { metadataPlan, priceId, paidPlanKeys, priceToPlan } = input;
  const fromPrice = priceId ? priceToPlan.get(priceId) : undefined;
  if (fromPrice && paidPlanKeys.has(fromPrice)) return fromPrice;
  if (metadataPlan && paidPlanKeys.has(metadataPlan)) return metadataPlan;
  return null;
}
