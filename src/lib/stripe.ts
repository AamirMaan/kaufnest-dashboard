import Stripe from "stripe";
import type { PaidPlan } from "@/lib/utils/pricing";

let stripeClient: Stripe | null = null;

// Lazily constructed so `next build` doesn't fail evaluating this module
// before STRIPE_SECRET_KEY is configured.
export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return stripeClient;
}

// Real Stripe price IDs, not hardcoded literals: test-mode and live-mode
// price IDs are different values for the same-looking product, so hardcoding
// them here would force a code change on every mode switch. Populated by
// `npm run stripe:setup` (scripts/stripe-setup.mjs) — see that script and
// .env.local.example.
export const PLANS: Record<PaidPlan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
  business: process.env.STRIPE_PRICE_BUSINESS!,
};
