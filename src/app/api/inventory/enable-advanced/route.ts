import { NextResponse } from "next/server";
import { requireAdvancedInventoryAdmin } from "@/lib/inventory/authGuard";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";

/**
 * One-way switch for batches & locations. Idempotent — the RPC returns
 * early when already enabled. Audit logging happens client-side after a
 * 200 (Phase 2's enable card), the same way every other feature writes
 * writeAuditLog.
 */
export async function POST() {
  const auth = await requireAdvancedInventoryAdmin();
  if (auth.error) return auth.error;

  const service = createServiceClientForTenant(auth.context.tenantSchema);
  const { error } = await service.rpc("enable_advanced_inventory");
  if (error) {
    console.error("enable_advanced_inventory failed", error);
    return NextResponse.json({ error: inventoryErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
