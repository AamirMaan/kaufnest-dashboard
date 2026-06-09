import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia",
});

export const PLANS = {
  starter:  { monthly: "price_starter_monthly",  annual: "price_starter_annual"  },
  pro:      { monthly: "price_pro_monthly",       annual: "price_pro_annual"       },
  business: { monthly: "price_business_monthly",  annual: "price_business_annual"  },
} as const;

export type PlanKey = keyof typeof PLANS;
