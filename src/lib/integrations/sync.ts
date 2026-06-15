import type { IntegrationPlatform } from "@/types";
import { normalizedOrderToSaleRow } from "./mapToSale";
import { getAdapter } from "./registry";
import { ensureValidAccessToken, getConnection, upsertConnection } from "./tokenStore";
import type { IntegrationsClient, SyncResult } from "./types";

// How far back to look the very first time a connection is synced.
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Runs one sync pass for `platform`: fetches orders since the last sync (or
 * the last 30 days for a brand-new connection), upserts them into `sales`
 * keyed on `(platform, external_order_id)`, and records the outcome back
 * onto the `platform_connections` row. Used by both the manual "Sync now"
 * route and the cron route — errors are caught and stored rather than thrown
 * so a failing tenant/platform doesn't abort a batch cron run.
 */
export async function syncPlatformOrders(
  client: IntegrationsClient,
  platform: IntegrationPlatform,
  connectedBy: string
): Promise<SyncResult> {
  const adapter = getAdapter(platform);
  const connection = await getConnection(client, platform);

  if (!connection || connection.status !== "connected") {
    return { ok: false, synced: 0, error: "Not connected" };
  }

  try {
    const accessToken = await ensureValidAccessToken(client, connection, adapter);
    const since = connection.last_synced_at ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
    const orders = await adapter.fetchOrders(accessToken, since, connection.marketplace_id);
    const rows = orders.map((order) => normalizedOrderToSaleRow(order, platform, connectedBy));

    if (rows.length > 0) {
      const { error } = await client.from("sales").upsert(rows, { onConflict: "platform,external_order_id" });
      if (error) throw error;
    }

    await upsertConnection(client, platform, {
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_sync_status: "ok",
      last_sync_error: null,
    });

    return { ok: true, synced: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await upsertConnection(client, platform, {
      last_sync_status: "error",
      last_sync_error: message,
    });

    return { ok: false, synced: 0, error: message };
  }
}
