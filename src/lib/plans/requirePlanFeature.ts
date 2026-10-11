import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { getEntitlements } from "./catalog";
import type { PlanFeature } from "./entitlements";

/**
 * Server-only plan gate for API routes. Call it right after the route's
 * auth/section guard with the tenantSchema that guard resolved:
 *
 *   const planError = await requireMessagingAndListings(auth.context.tenantSchema);
 *   if (planError) return planError;
 *
 * Reads control.tenants.plan by schema_name and checks the catalog's
 * entitlements. Returns null when allowed, otherwise the response to return.
 * Fails closed: no tenant row → no entitlements → 403. Never returns raw DB
 * error text.
 */

const FORBIDDEN_COPY: Record<PlanFeature, string> = {
  platformIntegrations: "Platform integrations are not included in your plan.",
  aiFeatures: "AI features are not included in your plan.",
  messagingAndListings: "Listings and messages are not included in your plan.",
  advancedInventory: "Advanced inventory is not included in your plan.",
};

const LOOKUP_FAILED = "Could not check your plan. Please try again.";

export async function requirePlanFeature(tenantSchema: string, feature: PlanFeature): Promise<NextResponse | null> {
  let allowed: boolean;
  try {
    const { data, error } = await createControlClient()
      .schema("control")
      .from("tenants")
      .select("plan")
      .eq("schema_name", tenantSchema)
      .maybeSingle();
    if (error) {
      console.error("[requirePlanFeature] tenant lookup failed", { feature, code: (error as { code?: string }).code });
      return NextResponse.json({ error: LOOKUP_FAILED }, { status: 500 });
    }
    const plan = (data as { plan: string | null } | null)?.plan ?? null;
    allowed = (await getEntitlements(plan))[feature];
  } catch (err) {
    console.error("[requirePlanFeature] plan check failed", { feature }, err);
    return NextResponse.json({ error: LOOKUP_FAILED }, { status: 500 });
  }
  if (!allowed) {
    return NextResponse.json({ error: FORBIDDEN_COPY[feature] }, { status: 403 });
  }
  return null;
}

/** Listings (incl. listings AI) and messages API routes. */
export function requireMessagingAndListings(tenantSchema: string): Promise<NextResponse | null> {
  return requirePlanFeature(tenantSchema, "messagingAndListings");
}
