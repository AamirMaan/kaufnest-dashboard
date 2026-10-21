import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationSuperAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { fetchFinanceTransactions, FinancesScopeError, FinancesSignatureError } from "@/lib/integrations/ebay/finances";
import { computeFeeOverwrites, loadOverwriteSales } from "@/lib/integrations/ebay/feeOverwrite";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // same window as Review Orders / charge sync

// Up to 50 Finances pages plus bounded sales lookups.
export const maxDuration = 60;

/** Read-only: what overwriting this account's order fees with eBay's would change. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationSuperAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/fees/preview] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { connectionId?: unknown } | null;
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });
    const token = await ensureValidAccessToken(client, conn, getAdapter("ebay"));
    const to = new Date();
    const txns = await fetchFinanceTransactions(token, {
      from: new Date(to.getTime() - LOOKBACK_MS).toISOString(),
      to: to.toISOString(),
      types: ["SALE", "NON_SALE_CHARGE"],
      marketplaceId: conn.marketplace_id,
    });
    const sales = await loadOverwriteSales(client, txns, conn.id);
    return NextResponse.json(computeFeeOverwrites(sales, txns));
  } catch (err) {
    if (err instanceof IntegrationAccountError) return NextResponse.json({ error: err.code }, { status: 409 });
    if (err instanceof FinancesSignatureError) return NextResponse.json({ error: "INTEGRATION_FINANCES_SIGNATURE" }, { status: 409 });
    if (err instanceof FinancesScopeError) return NextResponse.json({ error: "INTEGRATION_FINANCES_SCOPE" }, { status: 409 });
    console.error("[ebay/fees/preview] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't load fees from eBay. Please try again." }, { status: 502 });
  }
}
