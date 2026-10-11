import { createControlClient } from "@/lib/supabase/control";
import { entitlementsOf, planFromRow, type Plan, type PlanEntitlements, type PlanRow } from "./entitlements";

/**
 * Server-only. Reads control.plans (control-plane 012) with a 60 s
 * in-memory cache per server instance. /admin writes call
 * invalidatePlanCatalog() so the instance that saved sees the change at once;
 * other instances pick it up within 60 s. The app uses no Next.js caching,
 * so this deliberately does not adopt Cache Components.
 */

const TTL_MS = 60_000;
const DEFAULT_TRIAL_DAYS = 14;

let cache: { at: number; plans: Plan[] } | null = null;

export function invalidatePlanCatalog(): void {
  cache = null;
}

export async function getPlanCatalog(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.plans;

  const { data, error } = await createControlClient()
    .schema("control")
    .from("plans")
    .select("*")
    .order("sort_order")
    .order("key");

  if (error || !data) {
    if (cache) {
      console.error("[plans/catalog] refresh failed, serving previous catalog", error);
      return cache.plans;
    }
    throw new Error(`Could not load plan catalog: ${error?.message ?? "no data"}`);
  }

  const plans = (data as PlanRow[]).map(planFromRow);
  cache = { at: Date.now(), plans };
  return plans;
}

export async function getPlan(key: string | null | undefined): Promise<Plan | null> {
  if (!key) return null;
  return (await getPlanCatalog()).find((p) => p.key === key) ?? null;
}

export async function getEntitlements(key: string | null | undefined): Promise<PlanEntitlements> {
  return entitlementsOf(await getPlan(key));
}

/** Trial length for NEW sign-ups. Running trials keep their trial_ends_at. */
export async function getTrialDays(): Promise<number> {
  try {
    const trial = (await getPlanCatalog()).find((p) => p.kind === "trial");
    if (trial?.trialDays) return trial.trialDays;
    console.error("[plans/catalog] no trial plan row, using default trial length");
  } catch (err) {
    console.error("[plans/catalog] trial length lookup failed, using default", err);
  }
  return DEFAULT_TRIAL_DAYS;
}

/** Every Stripe price id ever used → plan key (control.plan_prices). Not cached. */
export async function getPlanPriceMap(): Promise<Map<string, string>> {
  const { data, error } = await createControlClient()
    .schema("control")
    .from("plan_prices")
    .select("stripe_price_id, plan_key");
  if (error || !data) throw new Error(`Could not load plan prices: ${error?.message ?? "no data"}`);
  return new Map((data as { stripe_price_id: string; plan_key: string }[]).map((r) => [r.stripe_price_id, r.plan_key]));
}
