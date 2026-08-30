import { getPlanLimits } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

/** The plans a visitor can actually buy — `trial` is granted, never sold. */
export type PaidPlan = Exclude<TenantPlan, "trial">;

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PricedPlan {
  plan: PaidPlan;
  name: string;
  monthlyEur: number;
  tagline: string;
  users: string;
  features: PlanFeature[];
  highlighted: boolean;
}

const ORDER: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

const MONTHLY_EUR: Record<PaidPlan, number> = {
  starter: 20,
  pro: 30,
  business: 50,
};

const NAMES: Record<PaidPlan, string> = {
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

const TAGLINES: Record<PaidPlan, string> = {
  starter: "Bookkeeping for a small team, entered by hand.",
  pro: "Pull your eBay and Amazon orders in automatically.",
  business: "Run listings, messages and the whole operation in one place.",
};

/**
 * The pricing table's data.
 *
 * Prices live here; **feature ticks are derived from `PLAN_LIMITS`**
 * (`lib/utils/planGating.ts`) rather than written out by hand, so this page
 * physically cannot advertise a capability the application gates off. Change
 * the plan matrix and this page follows.
 */
export function pricedPlans(): PricedPlan[] {
  return ORDER.map((plan) => {
    const limits = getPlanLimits(plan);

    return {
      plan,
      name: NAMES[plan],
      monthlyEur: MONTHLY_EUR[plan],
      tagline: TAGLINES[plan],
      users:
        limits.maxUsers === Infinity
          ? "Unlimited users"
          : `Up to ${limits.maxUsers} users`,
      features: [
        { label: "Sales, expenses, purchases & inventory", included: true },
        { label: "VAT tracking & PDF invoices", included: true },
        { label: "CSV import & export", included: true },
        { label: "Full audit trail", included: true },
        { label: "eBay & Amazon order import", included: limits.platformIntegrations },
        { label: "eBay listings & buyer messages", included: limits.messagingAndListings },
        { label: "AI-assisted insights", included: limits.aiFeatures },
      ],
      highlighted: plan === "pro",
    };
  });
}
