import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter, createShippingFulfillment, cancelOrder } from "@/lib/integrations/ebay";
import { isEbayIntegrationSyncedSale } from "@/lib/utils/filters";
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

  // Shared predicate (lib/utils/filters.ts) — also gates the Carrier/Tracking
  // fields in EditSaleModal. It requires the "${orderId}:${lineItemId}" shape,
  // so a CSV-imported "ebay" row (plain order id, no line item) is rejected
  // here instead of being turned into a call eBay can only reject.
  const externalOrderId = sale?.external_order_id;
  if (fetchError || !sale || !externalOrderId || !isEbayIntegrationSyncedSale(sale)) {
    return NextResponse.json(
      { error: "Order not found, or not an eBay order synced from the Integrations pipeline" },
      { status: 404 }
    );
  }

  // Idempotency guard for the "eBay call succeeded, local write failed" case.
  // `createShippingFulfillment` has no natural idempotency key on eBay's side —
  // eBay allows several fulfillments per order (partial shipments), so calling
  // it twice succeeds silently and leaves the order double-shipped. Once
  // `ebay_fulfillment_id` is stored, the shipment is already on eBay: re-run
  // only the local write instead. Deliberately NOT applied to the "cancelled"
  // branch — cancellation stores no equivalent key in this design.
  if (status === "shipped" && sale.ebay_fulfillment_id) {
    const { error: updateError } = await client
      .from("sales")
      .update({ ebay_sync_error: null, ebay_synced_at: new Date().toISOString() })
      .eq("id", saleId);
    if (updateError) {
      console.error("[ebay/sync-status] re-sync write failed:", updateError.message);
      return NextResponse.json(
        { error: "The shipment is already on eBay, but recording it locally failed. Try again." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
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
  // `isEbayIntegrationSyncedSale` above already guarantees a ":" is present,
  // so both slices are real ids — there is no whole-string fallback any more.
  const separatorIndex = externalOrderId.lastIndexOf(":");
  const orderId = externalOrderId.slice(0, separatorIndex);
  const lineItemId = externalOrderId.slice(separatorIndex + 1);

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
