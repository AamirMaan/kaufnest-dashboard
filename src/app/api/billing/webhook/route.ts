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
      await control
        .schema("control")
        .from("tenants")
        .update({
          stripe_subscription_id: sub.id,
          plan: (sub.metadata?.plan as string) ?? "starter",
          status: sub.status === "active" ? "active" : "inactive",
        })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await control
        .schema("control")
        .from("tenants")
        .update({ status: "cancelled" })
        .eq("stripe_customer_id", sub.customer as string);
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      await control
        .schema("control")
        .from("tenants")
        .update({ status: "inactive" })
        .eq("stripe_customer_id", inv.customer as string);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
