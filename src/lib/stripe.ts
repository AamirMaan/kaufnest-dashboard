import Stripe from "stripe";

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
