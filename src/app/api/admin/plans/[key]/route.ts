import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { getStripe } from "@/lib/stripe";
import { getPlanCatalog, invalidatePlanCatalog } from "@/lib/plans/catalog";
import { planFromRow, type PlanRow } from "@/lib/plans/entitlements";
import { deactivateStripePrice, PlanSyncError, syncStripePlan } from "@/lib/plans/stripeSync";
import { parsePlanInput, planDiff, planInputToRow, validatePlan } from "@/lib/plans/validatePlan";
import { verifyPlatformAdmin } from "../../tenants/route";

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const { key } = await params;

  let catalog;
  try {
    invalidatePlanCatalog();
    catalog = await getPlanCatalog();
  } catch (err) {
    console.error("[admin/plans/:key] catalog read failed", err);
    return NextResponse.json({ error: "Could not save the plan. Please try again." }, { status: 500 });
  }

  const before = catalog.find((p) => p.key === key);
  if (!before) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const parsed = parsePlanInput(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // key and kind are immutable once created.
  const input = { ...parsed, key: before.key, kind: before.kind };

  const fieldErrors = validatePlan(input, { isCreate: false, catalog });
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "Please fix the highlighted fields.", fieldErrors }, { status: 400 });
  }

  let sync: { priceId?: string; deactivatePriceId?: string };
  try {
    sync = await syncStripePlan(getStripe(), before, input);
  } catch (err) {
    if (err instanceof PlanSyncError) {
      // PlanSyncError's message is a deliberate, friendly, user-facing
      // string (see stripeSync.ts), never a raw Postgres/Stripe error.
      return NextResponse.json({ error: err.message }, { status: 409 }); // verifier:allow db-error-to-client
    }
    console.error("[admin/plans/:key] Stripe sync failed", err);
    return NextResponse.json({ error: "Stripe didn't accept the change. Please try again." }, { status: 502 });
  }

  const control = createControlClient();
  const { data, error } = await control
    .schema("control")
    .from("plans")
    .update({
      ...planInputToRow(input),
      ...(sync.priceId ? { stripe_price_id: sync.priceId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("key", key)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/plans/:key] update failed", error);
    return NextResponse.json({ error: "Could not save the plan. Please try again." }, { status: 500 });
  }

  if (sync.priceId) {
    const { error: priceError } = await control
      .schema("control")
      .from("plan_prices")
      .insert({ stripe_price_id: sync.priceId, plan_key: key, monthly_eur: input.monthlyEur });
    if (priceError) console.error("[admin/plans/:key] plan_prices insert failed", priceError);
  }

  // Only deactivate the OLD price once control.plans has committed to the
  // NEW one — never before. If this fails, the old price is left active
  // (harmless: it only means it stays usable for new purchases a little
  // longer) rather than risking stripe_price_id pointing at an inactive
  // price if the DB write above had failed.
  if (sync.deactivatePriceId) {
    try {
      await deactivateStripePrice(getStripe(), sync.deactivatePriceId);
    } catch (err) {
      console.error("[admin/plans/:key] old price deactivation failed", err);
    }
  }

  invalidatePlanCatalog();
  const { error: auditError } = await control.schema("control").from("admin_audit_log").insert({
    admin_email: check.email,
    action: "plan_update",
    tenant_id: null,
    metadata: { key, changes: planDiff(before, input) },
  });
  if (auditError) console.error("[admin/plans/:key] audit insert failed", auditError);

  return NextResponse.json({ plan: planFromRow(data as PlanRow) });
}
