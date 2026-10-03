import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { requireBillingAdmin } from "@/lib/billing/authGuard";
import { getPlan } from "@/lib/plans/catalog";
import { canPurchase } from "@/lib/plans/entitlements";

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
  const { tenantSchema } = auth.context;

  let body: { plan?: string };
  try {
    body = (await req.json()) as { plan?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { plan } = body;
  if (!plan || typeof plan !== "string") {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("plan, stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ plan: string; stripe_subscription_id: string | null }>();

  if (tenantError && tenantError.code !== "PGRST116") {
    console.error("[billing/change-plan] tenant lookup failed:", tenantError.message);
    return NextResponse.json(
      { error: "Could not change plan. Please try again." },
      { status: 500 }
    );
  }

  const subscriptionId = tenant?.stripe_subscription_id ?? undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription to change." }, { status: 400 });
  }

  // Resolved after the tenant lookup: a hidden (custom) plan is purchasable
  // only by the tenant already on it (canPurchase).
  let target;
  try {
    target = await getPlan(plan);
  } catch (err) {
    console.error("[billing/change-plan] plan catalog unavailable", err);
    return NextResponse.json({ error: "Could not change plan. Please try again." }, { status: 500 });
  }
  if (!target || !canPurchase(target, tenant?.plan ?? null)) {
    return NextResponse.json({ error: "Plan not available" }, { status: 400 });
  }
  const priceId = target.stripePriceId!;

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0].id;

    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      // Default proration: the price difference lands on the next invoice
      // rather than being charged immediately.
      proration_behavior: "create_prorations",
      metadata: { plan },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[billing/change-plan] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not change plan. Please try again." },
      { status: 500 }
    );
  }
}
