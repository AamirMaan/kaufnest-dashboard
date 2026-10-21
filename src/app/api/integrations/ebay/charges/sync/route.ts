import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { fetchFinanceTransactions, FinancesScopeError } from "@/lib/integrations/ebay/finances";
import { applyFinanceTransactions, ChargeSyncPermissionError, ChargeSyncSchemaError } from "@/lib/integrations/ebay/chargeSync";
import { CHARGE_TRANSACTION_TYPES } from "@/lib/integrations/ebay/financesMap";
import { accountLabel } from "@/lib/utils/platformAccounts";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // same window as Review Orders

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/charges/sync] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const { connectionId } = (await req.json().catch(() => ({}))) as { connectionId?: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });

    const token = await ensureValidAccessToken(client, conn, getAdapter("ebay"));
    const to = new Date();
    const txns = await fetchFinanceTransactions(token, {
      from: new Date(to.getTime() - LOOKBACK_MS).toISOString(),
      to: to.toISOString(),
      types: ["SALE", ...CHARGE_TRANSACTION_TYPES],
      marketplaceId: conn.marketplace_id,
    });
    const result = await applyFinanceTransactions(client, txns, {
      createdBy: userId, connectionId: conn.id, accountLabel: accountLabel(conn),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IntegrationAccountError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    if (err instanceof FinancesScopeError) {
      return NextResponse.json({ error: "INTEGRATION_FINANCES_SCOPE" }, { status: 409 });
    }
    if (err instanceof ChargeSyncSchemaError) {
      console.error("[ebay/charges/sync] tenant schema missing migration 058:", err.message);
      return NextResponse.json({ error: "INTEGRATION_FINANCES_DB_PENDING" }, { status: 409 });
    }
    if (err instanceof ChargeSyncPermissionError) {
      return NextResponse.json({ error: "You don't have permission to add expenses or edit orders." }, { status: 403 });
    }
    console.error("[ebay/charges/sync] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't sync eBay charges. Please try again." }, { status: 502 });
  }
}
