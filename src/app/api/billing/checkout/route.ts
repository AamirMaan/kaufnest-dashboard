import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import type { PaidPlan } from "@/lib/utils/pricing";

const VALID_PLANS: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const { plan } = (await req.json()) as { plan?: string };
  if (!plan || !VALID_PLANS.includes(plan as PaidPlan)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = PLANS[plan as PaidPlan];

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("*")
    .eq("schema_name", tenantSchema)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (tenant.stripe_subscription_id && tenant.status === "active") {
    return NextResponse.json(
      { error: "Already subscribed — manage your plan from Settings." },
      { status: 409 }
    );
  }

  try {
    const stripe = getStripe();

    // Create or reuse Stripe customer
    let stripeCustomerId = tenant.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { tenant_schema: tenantSchema, tenant_id: tenant.id as string },
      });
      stripeCustomerId = customer.id;
      await control
        .schema("control")
        .from("tenants")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", tenant.id);
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

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error("[billing/checkout] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
