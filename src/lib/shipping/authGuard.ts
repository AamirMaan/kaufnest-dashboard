import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";

export interface ShippingLabelAccessResult {
  error?: NextResponse;
}

/**
 * Guard for `/api/shipping/rates` and `/api/shipping/buy`. Checks
 * `control.tenants.shipping_labels_enabled` — the platform-admin per-tenant
 * switch for EasyPost purchasing (no plan tie, control-plane migration 010).
 *
 * Called AFTER `requireIntegrationAdmin()` in both routes, which already
 * confirms the caller is signed in, belongs to a tenant, and holds
 * admin/super_admin. This guard only adds the tenant-visibility check on
 * top — it does not re-check auth.
 *
 * The order-detail page hides the "Generate Shipping Label" (EasyPost)
 * button when the flag is off and shows a free plain PDF label instead,
 * but hidden chrome is presentation — this is the enforcement.
 */
export async function requireShippingLabelAccess(
  tenantSchema: string
): Promise<ShippingLabelAccessResult> {
  try {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("shipping_labels_enabled")
      .eq("schema_name", tenantSchema)
      .single();

    if (!tenant) {
      return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
    }

    if (!tenant.shipping_labels_enabled) {
      return {
        error: NextResponse.json(
          { error: "Shipping label purchasing is not enabled for this account." },
          { status: 403 }
        ),
      };
    }

    return {};
  } catch (err) {
    // createControlClient() throws synchronously on missing env vars; the
    // Supabase call can also throw on a genuine DB error. Either way, this
    // must surface as a clean 500, not an unhandled exception.
    console.error("requireShippingLabelAccess failed", err);
    return {
      error: NextResponse.json(
        { error: "Failed to verify shipping label access." },
        { status: 500 }
      ),
    };
  }
}
