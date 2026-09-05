import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter, createShippingFulfillment, cancelOrder } from "@/lib/integrations/ebay";
import type { Sale } from "@/types";

interface SyncStatusBody {
  status: "shipped" | "cancelled";
  trackingNumber: string | null;
  carrier: string | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ saleId: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const { saleId } = await params;

  let status: SyncStatusBody["status"];
  let trackingNumber: SyncStatusBody["trackingNumber"];
  let carrier: SyncStatusBody["carrier"];
  try {
    ({ status, trackingNumber, carrier } = (await req.json()) as SyncStatusBody);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (status !== "shipped" && status !== "cancelled") {
    return NextResponse.json(
      { error: 'status must be "shipped" or "cancelled"' },
      { status: 400 }
    );
  }

  const { data: sale, error: fetchError } = await client
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .single<Sale>();

  if (fetchError || !sale || sale.platform !== "ebay" || !sale.external_order_id) {
    return NextResponse.json(
      { error: "Order not found or not an eBay-sourced sale" },
      { status: 404 }
    );
  }

  if (status === "shipped" && (!trackingNumber || !carrier)) {
    return NextResponse.json(
      { error: "Tracking number and carrier are required to mark an eBay order shipped" },
      { status: 400 }
    );
  }

  let conn;
  try {
    conn = await getConnection(client, "ebay");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to look up eBay connection";
    console.error("[ebay/sync-status] getConnection failed:", message);
    await client.from("sales").update({ ebay_sync_error: message }).eq("id", saleId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[ebay/sync-status] token refresh failed:", message);
    await client.from("sales").update({ ebay_sync_error: message }).eq("id", saleId);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // external_order_id is "${orderId}:${lineItemId}" (mapToSale.ts) — split
  // on the LAST ":" since eBay's own orderId/lineItemId never contain one,
  // per the existing dedup-key convention (see src/lib/integrations/
  // SKILL.md's "external_order_id dedup contract").
  const separatorIndex = sale.external_order_id.lastIndexOf(":");
  const orderId =
    separatorIndex === -1 ? sale.external_order_id : sale.external_order_id.slice(0, separatorIndex);
  const lineItemId =
    separatorIndex === -1 ? sale.external_order_id : sale.external_order_id.slice(separatorIndex + 1);

  try {
    if (status === "shipped") {
      const { fulfillmentId } = await createShippingFulfillment(accessToken, orderId, {
        lineItems: [{ lineItemId, quantity: sale.quantity }],
        shippedDate: new Date().toISOString(),
        shippingCarrierCode: carrier!,
        trackingNumber: trackingNumber!,
      });

      const { error: updateError } = await client
        .from("sales")
        .update({
          ebay_fulfillment_id: fulfillmentId,
          ebay_sync_error: null,
          ebay_synced_at: new Date().toISOString(),
        })
        .eq("id", saleId);
      if (updateError) throw updateError;
    } else {
      // status === "cancelled". See cancelOrder's own doc comment (ebay.ts)
      // for the "unverified against eBay's live sandbox" caveat.
      await cancelOrder(accessToken, orderId);

      const { error: updateError } = await client
        .from("sales")
        .update({
          ebay_sync_error: null,
          ebay_synced_at: new Date().toISOString(),
        })
        .eq("id", saleId);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "eBay sync failed";
    console.error("[ebay/sync-status] eBay call failed:", message);
    await client.from("sales").update({ ebay_sync_error: message }).eq("id", saleId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
