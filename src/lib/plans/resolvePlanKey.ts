/**
 * Which plan a Stripe subscription is on (billing webhook). Metadata first
 * (checkout/change-plan always write metadata.plan), then the price id via
 * control.plan_prices — covers grandfathered prices and subscriptions edited
 * in the Stripe dashboard. Null = unknown: the webhook then leaves
 * tenants.plan untouched instead of the old silent "starter" default.
 */
export function resolvePlanKey(input: {
  metadataPlan: string | null | undefined;
  priceId: string | null | undefined;
  paidPlanKeys: ReadonlySet<string>;
  priceToPlan: ReadonlyMap<string, string>;
}): string | null {
  const { metadataPlan, priceId, paidPlanKeys, priceToPlan } = input;
  if (metadataPlan && paidPlanKeys.has(metadataPlan)) return metadataPlan;
  const fromPrice = priceId ? priceToPlan.get(priceId) : undefined;
  if (fromPrice && paidPlanKeys.has(fromPrice)) return fromPrice;
  return null;
}
