import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, listConnections, type ConnectionRow } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { resolveActiveAccounts } from "@/lib/utils/activeAccounts";
import { accountLabel } from "@/lib/utils/platformAccounts";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";
import type { IntegrationPlatform } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";
import { fetchFinanceTransactions, FinancesScopeError, FinancesSignatureError } from "@/lib/integrations/ebay/finances";
import {
  feesByLineItem, prefillFeesFor, withOrderLinkedAdFees, type EbayFinanceTransaction, type LineItemFees,
} from "@/lib/integrations/ebay/financesMap";
import { INTEGRATION_ERRORS } from "@/lib/utils/integrationErrors";

export type ReviewOrder = NormalizedOrder & {
  imported: boolean; connection_id: string; account_name: string;
  /** eBay-reported fees from the Finances API (eBay only; absent when unavailable). */
  fees?: LineItemFees;
};
export type ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & {
  /** Keyed by connection id (display names aren't unique); each message names its account. */
  errors?: Record<string, string>;
  /** Non-fatal per-account notices keyed by connection id; that account's orders loaded fine. */
  warnings?: Record<string, string>;
  /** Display names of connected accounts left out because they're paused. */
  pausedAccounts?: string[];
};

const REVIEW_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[integrations/review] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  let active: ConnectionRow[];
  let paused: ConnectionRow[];
  let importedSet: Set<string>;
  try {
    ({ active, paused } = resolveActiveAccounts(await listConnections(client), ent));
    if (active.length === 0) {
      return NextResponse.json(paused.length ? { pausedAccounts: paused.map(accountLabel) } : {});
    }

    // Fetch existing external_order_ids from sales for dedup
    const activePlatforms = [...new Set(active.map((c) => c.platform))];
    const { data: existingSales } = await client
      .from("sales")
      .select("platform, external_order_id")
      .in("platform", activePlatforms)
      .not("external_order_id", "is", null);

    importedSet = new Set(
      (existingSales ?? []).map(
        (s: { platform: string; external_order_id: string }) =>
          `${s.platform}:${s.external_order_id}`
      )
    );
  } catch (err) {
    console.error("[integrations/review] load failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load connections" }, { status: 500 });
  }

  const result: ReviewResponse = {};
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  await Promise.all(
    active.map(async (conn) => {
      const name = accountLabel(conn);
      try {
        const adapter = getAdapter(conn.platform);
        const token = await ensureValidAccessToken(client, conn, adapter);
        // Fee prefill runs alongside the order fetch and must never block order review:
        // it catches its own errors and only reports a warning once the orders loaded.
        // SALE carries the selling fees; the Promoted Listings ad fee is a separate
        // order-linked NON_SALE_CHARGE, merged in once the order line ids are known.
        const financesPromise: Promise<{ txns: EbayFinanceTransaction[]; warning?: string }> =
          conn.platform !== "ebay"
            ? Promise.resolve({ txns: [] })
            : fetchFinanceTransactions(token, {
                from: since, to: new Date().toISOString(), types: ["SALE", "NON_SALE_CHARGE"], marketplaceId: conn.marketplace_id,
              }).then(
                (txns) => ({ txns }),
                (err: unknown) => {
                  if (err instanceof FinancesSignatureError) {
                    return { txns: [], warning: `${name}: ${INTEGRATION_ERRORS.INTEGRATION_FINANCES_SIGNATURE}` };
                  }
                  if (err instanceof FinancesScopeError) {
                    return { txns: [], warning: `${name}: ${INTEGRATION_ERRORS.INTEGRATION_FINANCES_SCOPE}` };
                  }
                  console.error(`[integrations/review] finances fetch failed (connection=${conn.id}):`, err instanceof Error ? err.message : err);
                  return { txns: [] };
                }
              );
        const [orders, { txns, warning }] = await Promise.all([
          adapter.fetchOrders(token, since, conn.marketplace_id),
          financesPromise,
        ]);
        const fees = withOrderLinkedAdFees(feesByLineItem(txns), orders.map((o) => o.external_order_id), txns);
        if (warning) warnings[conn.id] = warning;
        const bucket = (result[conn.platform] ??= { orders: [] });
        bucket.orders.push(
          ...orders.map((o) => {
            const imported = importedSet.has(`${conn.platform}:${o.external_order_id}`);
            return {
              ...o,
              imported,
              connection_id: conn.id,
              account_name: name,
              // Only not-yet-imported orders, and only fees in the order's own currency.
              fees: prefillFeesFor(fees.get(o.external_order_id), { currency: o.currency, imported }),
            };
          })
        );
      } catch (err) {
        console.error(
          `[integrations/review] fetch failed (platform=${conn.platform}, connection=${conn.id}):`,
          err instanceof Error ? err.message : err
        );
        errors[conn.id] = `Couldn't fetch orders from ${name}. Try again, or reconnect the account if this keeps happening.`;
      }
    })
  );

  if (Object.keys(errors).length > 0) result.errors = errors;
  if (Object.keys(warnings).length > 0) result.warnings = warnings;
  if (paused.length > 0) result.pausedAccounts = paused.map(accountLabel);
  return NextResponse.json(result);
}
