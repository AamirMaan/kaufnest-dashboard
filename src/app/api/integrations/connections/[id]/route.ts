import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnectionById, listConnections, updateConnection } from "@/lib/integrations/tokenStore";
import { isConnectionId, parseConnectionPatch } from "@/lib/integrations/connectionPatch";
import { getTenantPlan } from "@/lib/integrations/tenantPlan";
import { canResumeAccount } from "@/lib/utils/activeAccounts";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { PlatformConnection } from "@/types";

const SAFE_COLUMNS =
  "id, platform, status, external_account_id, external_username, display_name, is_active, marketplace_id, last_synced_at, last_sync_status, last_sync_error, created_at, updated_at";

/** Rename / pause / resume one connected account. Admin (integrations ≥ 2) only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const plan = await getTenantPlan(tenantSchema);
  if (!hasPlatformIntegrations(plan)) {
    return NextResponse.json({ error: "Platform integrations require the Pro or Business plan." }, { status: 403 });
  }

  if (!isConnectionId(id)) return NextResponse.json({ error: "INTEGRATION_ACCOUNT_UNKNOWN" }, { status: 404 });

  const parsed = parseConnectionPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const conn = await getConnectionById(client, id);
    if (!conn) return NextResponse.json({ error: "INTEGRATION_ACCOUNT_UNKNOWN" }, { status: 404 });

    if (parsed.patch.is_active === true && !conn.is_active) {
      const rows = await listConnections(client, conn.platform);
      if (!canResumeAccount(rows, id, plan)) {
        return NextResponse.json({ error: "INTEGRATION_ACCOUNT_LIMIT" }, { status: 409 });
      }
    }

    await updateConnection(client, id, parsed.patch);

    const { data, error } = await client
      .from("platform_connections")
      .select(SAFE_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, connection: data as PlatformConnection });
  } catch (err) {
    console.error("[integrations/connections] update failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not update the account. Please try again." }, { status: 500 });
  }
}
