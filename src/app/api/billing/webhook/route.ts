import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import type Stripe from "stripe";

// Disable body parsing — Stripe needs the raw body to verify the signature
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const control = createControlClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = (sub.metadata?.plan as string) ?? "starter";

      const patch: { stripe_subscription_id: string; plan: string; status?: string } = {
        stripe_subscription_id: sub.id,
        plan,
      };

      // Only touch status for unambiguous outcomes. "incomplete" (payment
      // still processing) and "trialing" (this app never sets
      // trial_period_days on a subscription — Boughtopia's own 14-day trial
      // is unrelated to Stripe's "trialing" status — so this shouldn't
      // occur, but the mapping stays defensive rather than assuming) are
      // deliberately left alone rather than prematurely deactivating a
      // tenant that wasn't deactivated a moment ago.
      if (sub.status === "active") {
        patch.status = "active";
      } else if (
        sub.status === "past_due" ||
        sub.status === "unpaid" ||
        sub.status === "canceled" ||
        sub.status === "incomplete_expired" ||
        sub.status === "paused"
      ) {
        patch.status = "deactivated";
      }

      await logIfUnmatched(
        control
          .schema("control")
          .from("tenants")
          .update(patch)
          .eq("stripe_customer_id", sub.customer as string)
          .select("id"),
        sub.customer as string
      );
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await logIfUnmatched(
        control
          .schema("control")
          .from("tenants")
          .update({ status: "deactivated" })
          .eq("stripe_customer_id", sub.customer as string)
          .select("id"),
        sub.customer as string
      );
      break;
    }
  }

  // Always 200 to Stripe, even when nothing matched — a stripe_customer_id
  // with no tenant row is not a transient failure Stripe should retry.
  return NextResponse.json({ received: true });
}

async function logIfUnmatched(
  query: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>,
  stripeCustomerId: string
): Promise<void> {
  const { data, error } = await query;
  if (error) {
    console.error("[billing/webhook] update failed:", error.message);
  } else if (!data || data.length === 0) {
    console.error(`[billing/webhook] no tenant found for stripe_customer_id=${stripeCustomerId}`);
  }
}
