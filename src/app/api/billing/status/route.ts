import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import type { TenantPlan } from "@/types";

export async function GET() {
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

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("plan, status, stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ plan: TenantPlan; status: string; stripe_subscription_id: string | null }>();

  if (tenantError) {
    if (tenantError.code === "PGRST116") {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    console.error("[billing/status] tenant lookup failed:", tenantError.message);
    return NextResponse.json({ error: "Could not load billing status." }, { status: 500 });
  }
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const hasSubscription = Boolean(tenant.stripe_subscription_id) && tenant.status === "active";

  let cancelAtPeriodEnd = false;
  if (hasSubscription && tenant.stripe_subscription_id) {
    try {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
      cancelAtPeriodEnd = subscription.cancel_at_period_end;
    } catch (err: unknown) {
      // Degrade gracefully rather than failing the whole status read over a
      // transient Stripe API issue — plan/hasSubscription (the DB-backed
      // fields) are still accurate; only the cancellation flag is stale.
      console.error(
        "[billing/status] failed to read subscription from Stripe:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return NextResponse.json({ plan: tenant.plan, hasSubscription, cancelAtPeriodEnd });
}
