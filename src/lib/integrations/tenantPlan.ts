import { createControlClient } from "@/lib/supabase/control";
import type { TenantPlan } from "@/types";

/**
 * The tenant's plan from control.tenants. Defaults to "trial" when the row is
 * missing — the same fallback every integrations route already used inline.
 */
export async function getTenantPlan(tenantSchema: string): Promise<TenantPlan> {
  const control = createControlClient();
  const { data } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  return (data?.plan as TenantPlan | undefined) ?? "trial";
}
