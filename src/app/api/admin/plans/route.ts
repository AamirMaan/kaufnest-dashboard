import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { getStripe } from "@/lib/stripe";
import { getPlanCatalog, invalidatePlanCatalog } from "@/lib/plans/catalog";
import { planFromRow, type PlanRow } from "@/lib/plans/entitlements";
import { createStripePlan } from "@/lib/plans/stripeSync";
import { parsePlanInput, planDiff, planInputToRow, validatePlan } from "@/lib/plans/validatePlan";
import { verifyPlatformAdmin } from "../tenants/route";

export async function GET() {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  try {
    invalidatePlanCatalog();
    const plans = await getPlanCatalog();
    const control = createControlClient();
    // One head-count per plan — bounded by the number of plans, not tenants.
    const counts = await Promise.all(
      plans.map(async (p) => {
        const { count, error } = await control
          .schema("control")
          .from("tenants")
          .select("id", { count: "exact", head: true })
          .eq("plan", p.key);
        if (error) throw new Error(error.message);
        return [p.key, count ?? 0] as const;
      })
    );
    return NextResponse.json({ plans, tenantCounts: Object.fromEntries(counts) });
  } catch (err) {
    console.error("[admin/plans] list failed", err);
    return NextResponse.json({ error: "Could not load plans." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const input = parsePlanInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  let catalog;
  try {
    invalidatePlanCatalog();
    catalog = await getPlanCatalog();
  } catch (err) {
    console.error("[admin/plans] catalog read failed", err);
    return NextResponse.json({ error: "Could not create the plan. Please try again." }, { status: 500 });
  }

  const fieldErrors = validatePlan(input, { isCreate: true, catalog });
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "Please fix the highlighted fields.", fieldErrors }, { status: 400 });
  }

  let stripeIds: { productId: string; priceId: string };
  try {
    stripeIds = await createStripePlan(getStripe(), input);
  } catch (err) {
    console.error("[admin/plans] Stripe create failed", err);
    return NextResponse.json({ error: "Stripe didn't accept the new plan. Please try again." }, { status: 502 });
  }

  const control = createControlClient();
  const { data, error } = await control
    .schema("control")
    .from("plans")
    .insert({ ...planInputToRow(input), stripe_product_id: stripeIds.productId, stripe_price_id: stripeIds.priceId })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/plans] insert failed", error);
    const status = error?.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "A plan with this key already exists." : "Could not save the plan. Please try again." },
      { status }
    );
  }

  const { error: priceError } = await control
    .schema("control")
    .from("plan_prices")
    .insert({ stripe_price_id: stripeIds.priceId, plan_key: input.key, monthly_eur: input.monthlyEur });
  if (priceError) console.error("[admin/plans] plan_prices insert failed", priceError);

  invalidatePlanCatalog();
  const { error: auditError } = await control.schema("control").from("admin_audit_log").insert({
    admin_email: check.email,
    action: "plan_create",
    tenant_id: null,
    metadata: { key: input.key, changes: planDiff(null, input) },
  });
  if (auditError) console.error("[admin/plans] audit insert failed", auditError);

  return NextResponse.json({ plan: planFromRow(data as PlanRow) }, { status: 201 });
}
