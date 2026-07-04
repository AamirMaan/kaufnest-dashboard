import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { upsertConnection } from "@/lib/integrations/tokenStore";
import { normalizedOrderToSaleRow } from "@/lib/integrations/mapToSale";
import { mergeImportedSale } from "@/lib/integrations/mergeImportedSale";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { Currency, IntegrationPlatform, Purchase, Sale, TenantPlan } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  if (!hasPlatformIntegrations((tenant?.plan ?? "trial") as TenantPlan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  const body = (await req.json()) as {
    items: { platform: IntegrationPlatform; order: NormalizedOrder }[];
    purchaseCosts?: Record<string, { price: string; vendor: string }>;
  };

  if (!body.items?.length) {
    return NextResponse.json({ imported: 0 });
  }

  const incomingRows = body.items.map(({ platform, order }) =>
    normalizedOrderToSaleRow(order, platform, userId)
  );

  // Fetch existing rows so we can preserve user-owned fields on re-import
  const extIds = incomingRows
    .map((r) => r.external_order_id)
    .filter((id): id is string => id !== null);

  const existingByExtId = new Map<string, Sale>();
  if (extIds.length > 0) {
    const { data: existingRows } = await client
      .from("sales")
      .select("*")
      .in("external_order_id", extIds);
    for (const row of existingRows ?? []) {
      if (row.external_order_id) {
        existingByExtId.set(row.external_order_id, row as Sale);
      }
    }
  }

  const rows = incomingRows.map((incoming) =>
    mergeImportedSale(
      incoming.external_order_id
        ? existingByExtId.get(incoming.external_order_id)
        : undefined,
      incoming as Sale
    )
  );

  const { data: upsertedSales, error } = await client
    .from("sales")
    .upsert(rows, { onConflict: "platform,external_order_id" })
    .select("id, external_order_id");

  if (error) {
    return NextResponse.json(
      { error: "Import failed", detail: error.message },
      { status: 500 }
    );
  }

  // Create linked purchases for orders where the user filled in a cost
  const purchaseCosts = body.purchaseCosts ?? {};
  const saleIdByExtId = new Map<string, string>();
  for (const sale of upsertedSales ?? []) {
    if (sale.external_order_id) {
      saleIdByExtId.set(sale.external_order_id, sale.id);
    }
  }

  const purchaseInserts: Array<Omit<Purchase, "id" | "created_by" | "created_at">> = [];
  for (const { order } of body.items) {
    const costEntry = purchaseCosts[order.external_order_id];
    const rawPrice = parseFloat(costEntry?.price ?? "");
    if (!isNaN(rawPrice) && rawPrice > 0) {
      const saleId = saleIdByExtId.get(order.external_order_id);
      if (saleId) {
        const qty = order.quantity ?? 1;
        purchaseInserts.push({
          product_name: order.product_name,
          product_id: null,
          quantity: qty,
          unit_price: rawPrice / qty,
          total_amount: rawPrice,
          currency: (order.currency ?? "EUR") as Currency,
          vendor: costEntry?.vendor?.trim() || null,
          date: order.date,
          description: null,
          vat_rate: null,
          vat_amount: null,
          sale_id: saleId,
        });
      }
    }
  }

  let createdPurchases: Purchase[] = [];
  if (purchaseInserts.length > 0) {
    const { data: newPurchases, error: purchaseError } = await client
      .from("purchases")
      .insert(purchaseInserts)
      .select();

    if (purchaseError) {
      console.error("[import] purchase insert failed:", purchaseError.message);
      createdPurchases = [];
    } else {
      createdPurchases = (newPurchases ?? []) as Purchase[];
    }
  }

  // Update last_synced_at for each platform that had items imported
  const platforms = [...new Set(body.items.map((i) => i.platform))];
  await Promise.all(
    platforms.map((platform) =>
      upsertConnection(client, platform, {
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      })
    )
  );

  return NextResponse.json({
    imported: rows.length,
    createdPurchases,
    ...(purchaseInserts.length > 0 && createdPurchases.length < purchaseInserts.length
      ? { purchaseWarning: "Some purchase costs could not be saved — add them manually from the Purchases page." }
      : {}),
  });
}
