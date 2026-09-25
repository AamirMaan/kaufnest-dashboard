import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { canEnableAdvancedInventory } from "@/lib/inventory/access";
import type { Profile, TenantPlan } from "@/types";

export interface AdvancedInventoryAuthContext {
  userId: string;
  tenantSchema: string;
}

export type AdvancedInventoryAuthResult =
  | { context: AdvancedInventoryAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Guard for advanced-inventory admin routes. Checks, in order: signed in,
 * has a tenant, and canEnableAdvancedInventory(plan, role). The plan lives
 * in the control plane (Project A), which the tenant database cannot see —
 * that is why enable_advanced_inventory() is service_role-only and this
 * guard is the enforcement point. Server-only.
 */
export async function requireAdvancedInventoryAdmin(): Promise<AdvancedInventoryAuthResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<Pick<Profile, "role">>();

  let plan: TenantPlan | null;
  try {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("plan")
      .eq("schema_name", tenantSchema)
      .single();
    plan = (tenant as { plan: TenantPlan } | null)?.plan ?? null;
  } catch (err) {
    console.error("requireAdvancedInventoryAdmin failed", err);
    return { error: NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 }) };
  }

  if (!plan) {
    return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }
  if (!canEnableAdvancedInventory(plan, profile?.role)) {
    return {
      error: NextResponse.json(
        { error: "Batches and locations are available to admins on the Business plan." },
        { status: 403 },
      ),
    };
  }

  return { context: { userId: user.id, tenantSchema } };
}
