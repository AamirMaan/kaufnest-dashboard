import { entitlementsOf, sortPlans, type Plan } from "@/lib/plans/entitlements";

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PricedPlan {
  plan: string;
  name: string;
  monthlyEur: number;
  tagline: string;
  users: string;
  features: PlanFeature[];
  highlighted: boolean;
}

/**
 * Pricing cards for the given plans (control.plans rows). Callers choose
 * which plans to show — the marketing page passes public plans,
 * /api/billing/status passes the plans this tenant may buy. Feature ticks are
 * derived from the same entitlements the app gates on, so a card cannot
 * advertise a capability the app does not grant.
 */
export function pricedPlans(plans: readonly Plan[]): PricedPlan[] {
  return sortPlans(plans)
    .filter((p): p is Plan & { monthlyEur: number } => p.kind === "paid" && p.monthlyEur !== null)
    .map((p) => {
      const ent = entitlementsOf(p);
      return {
        plan: p.key,
        name: p.name,
        monthlyEur: p.monthlyEur,
        tagline: p.tagline,
        users:
          ent.maxUsers === Infinity
            ? "Unlimited users"
            : `Up to ${ent.maxUsers} user${ent.maxUsers === 1 ? "" : "s"}`,
        features: [
          { label: "Sales, expenses, purchases & inventory", included: true },
          { label: "VAT tracking & PDF invoices", included: true },
          { label: "CSV import & export", included: true },
          { label: "Full audit trail", included: true },
          { label: "eBay & Amazon order import", included: ent.platformIntegrations },
          { label: "eBay listings & buyer messages", included: ent.messagingAndListings },
          { label: "AI-assisted insights", included: ent.aiFeatures },
        ],
        highlighted: p.highlighted,
      };
    });
}
