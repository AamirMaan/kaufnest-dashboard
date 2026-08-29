import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { requireBillingAdmin } from "@/lib/billing/authGuard";
import { createControlClient } from "@/lib/supabase/control";
import type { PaidPlan } from "@/lib/utils/pricing";

const VALID_PLANS: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

// Subscription statuses that represent a still-live (or still-recoverable)
// Stripe subscription — used to block a second checkout while one of these
// exists, rather than trusting `control.tenants.status`, which lags Stripe
// and conflates tenant lifecycle with billing state (see the 409 guard
// below).
const LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
] as const;

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — String(err) on those yields "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST(req: NextRequest) {
  const auth = await requireBillingAdmin();
  if (auth.error) return auth.error;
  const { userEmail, tenantSchema } = auth.context;

  let body: { plan?: string };
  try {
    body = (await req.json()) as { plan?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { plan } = body;
  if (!plan || !VALID_PLANS.includes(plan as PaidPlan)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = PLANS[plan as PaidPlan];

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("*")
    .eq("schema_name", tenantSchema)
    .single();

  if (tenantError) {
    console.error("[billing/checkout] tenant lookup failed:", tenantError.message);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  try {
    const stripe = getStripe();

    // A tenant with a still-live (or still-recoverable, e.g. past_due)
    // Stripe subscription must not be allowed to start a second one.
    // `control.tenants.status` is written by the webhook and lags Stripe —
    // it can already read "deactivated" while the underlying subscription
    // is still active and auto-recovering via Stripe's own retry schedule —
    // so this checks Stripe directly instead of trusting that field.
    if (tenant.stripe_customer_id) {
      const existingSubs = await stripe.subscriptions.list({
        customer: tenant.stripe_customer_id as string,
        status: "all",
      });
      const hasLiveSubscription = existingSubs.data.some((sub) =>
        (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)
      );
      if (hasLiveSubscription) {
        return NextResponse.json(
          { error: "Already subscribed — manage your plan from Settings." },
          { status: 409 }
        );
      }
    }

    // Create or reuse Stripe customer
    let stripeCustomerId = tenant.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      // Idempotency key keyed only on tenant.id (no timestamp): two
      // near-simultaneous first-time-subscribe requests for the same tenant
      // get back the *same* Stripe customer object instead of two different
      // ones, closing the orphan risk before the DB write race even
      // matters — both requests now write the identical value.
      const customer = await stripe.customers.create(
        {
          email: userEmail,
          metadata: { tenant_schema: tenantSchema, tenant_id: tenant.id as string },
        },
        { idempotencyKey: `billing-customer-${tenant.id}` }
      );
      stripeCustomerId = customer.id;

      const { error: updateError } = await control
        .schema("control")
        .from("tenants")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", tenant.id);

      if (updateError) {
        console.error(
          "[billing/checkout] failed to save stripe_customer_id:",
          updateError.message
        );
        return NextResponse.json(
          { error: "Could not start checkout. Please try again." },
          { status: 500 }
        );
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=cancelled`,
      // The session's own `metadata` does NOT propagate to the subscription
      // Stripe creates from it — `subscription_data.metadata` is what the
      // webhook's `sub.metadata.plan` read (customer.subscription.created/
      // updated) actually sees. Without this, every new subscription
      // silently defaults to "starter" in the webhook.
      subscription_data: {
        metadata: { tenant_id: tenant.id as string, plan },
      },
      metadata: { tenant_id: tenant.id as string },
    });

    if (!session.url) {
      console.error("[billing/checkout] Stripe returned a session with no url");
      return NextResponse.json(
        { error: "Could not start checkout. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error("[billing/checkout] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
