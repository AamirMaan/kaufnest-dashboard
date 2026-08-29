import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { requireBillingAdmin } from "@/lib/billing/authGuard";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST() {
  const auth = await requireBillingAdmin();
  if (auth.error) return auth.error;
  const { tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ stripe_subscription_id: string | null }>();

  if (tenantError && tenantError.code !== "PGRST116") {
    console.error("[billing/cancel] tenant lookup failed:", tenantError.message);
    return NextResponse.json(
      { error: "Could not cancel subscription. Please try again." },
      { status: 500 }
    );
  }

  const subscriptionId = tenant?.stripe_subscription_id ?? undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription to cancel." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: true });
  } catch (err: unknown) {
    console.error("[billing/cancel] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not cancel subscription. Please try again." },
      { status: 500 }
    );
  }
}
