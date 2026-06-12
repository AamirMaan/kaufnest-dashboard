import Stripe from "stripe";

let stripeClient: Stripe | null = null;

// Lazily constructed so `next build` doesn't fail evaluating this module
// before STRIPE_SECRET_KEY is configured (see SAAS_MIGRATION.md — Stripe
// project setup is still pending).
export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return stripeClient;
}

export const PLANS = {
  starter:  { monthly: "price_starter_monthly",  annual: "price_starter_annual"  },
  pro:      { monthly: "price_pro_monthly",       annual: "price_pro_annual"       },
  business: { monthly: "price_business_monthly",  annual: "price_business_annual"  },
} as const;

export type PlanKey = keyof typeof PLANS;
