import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, listConnections, type ConnectionRow } from "@/lib/integrations/tokenStore";
import { getTenantPlan } from "@/lib/integrations/tenantPlan";
import { resolveActiveAccounts } from "@/lib/utils/activeAccounts";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { IntegrationPlatform } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export type ReviewOrder = NormalizedOrder & { imported: boolean; connection_id: string; account_name: string };
export type ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & {
  /** Keyed by account display name. */
  errors?: Record<string, string>;
  /** Display names of connected accounts left out because they're paused. */
  pausedAccounts?: string[];
};

const REVIEW_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

function accountLabel(c: Pick<ConnectionRow, "display_name" | "platform">): string {
  return c.display_name ?? (c.platform === "ebay" ? "eBay" : "Amazon");
}

export async function GET(_req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const plan = await getTenantPlan(tenantSchema);
  if (!hasPlatformIntegrations(plan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  let active: ConnectionRow[];
  let paused: ConnectionRow[];
  let importedSet: Set<string>;
  try {
    ({ active, paused } = resolveActiveAccounts(await listConnections(client), plan));
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

  await Promise.all(
    active.map(async (conn) => {
      const name = accountLabel(conn);
      try {
        const adapter = getAdapter(conn.platform);
        const token = await ensureValidAccessToken(client, conn, adapter);
        const orders = await adapter.fetchOrders(token, since, conn.marketplace_id);
        const bucket = (result[conn.platform] ??= { orders: [] });
        bucket.orders.push(
          ...orders.map((o) => ({
            ...o,
            imported: importedSet.has(`${conn.platform}:${o.external_order_id}`),
            connection_id: conn.id,
            account_name: name,
          }))
        );
      } catch (err) {
        console.error(
          `[integrations/review] fetch failed (platform=${conn.platform}, connection=${conn.id}):`,
          err instanceof Error ? err.message : err
        );
        errors[name] = `Couldn't fetch orders from ${name}. Try again, or reconnect the account if this keeps happening.`;
      }
    })
  );

  if (Object.keys(errors).length > 0) result.errors = errors;
  if (paused.length > 0) result.pausedAccounts = paused.map(accountLabel);
  return NextResponse.json(result);
}
