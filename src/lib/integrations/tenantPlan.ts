import { createControlClient } from "@/lib/supabase/control";
import { getEntitlements } from "@/lib/plans/catalog";
import type { PlanEntitlements } from "@/lib/plans/entitlements";

/**
 * The tenant's plan entitlements (control.tenants.plan → control.plans).
 * A missing tenant row or unknown plan key resolves to NO_ENTITLEMENTS —
 * never a default plan. Throws when the tenant or catalog lookup fails;
 * callers answer "Could not check your plan" rather than guessing.
 */
export async function getTenantEntitlements(tenantSchema: string): Promise<PlanEntitlements> {
  const { data, error } = await createControlClient()
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .maybeSingle<{ plan: string }>();
  if (error) throw new Error(`tenant plan lookup failed: ${error.message}`);
  return getEntitlements(data?.plan ?? null);
}
