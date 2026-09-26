import { createTenantClient } from "@/lib/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/utils/fetchAllRows";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import type { StockLot } from "@/types";

/** One product's open batches grow with its purchase history, so read them with fetchAllRowsOrThrow. */
export const PRODUCT_LOTS_CAP = 1000;

/** Batches with units left (or a shortfall) for one product, oldest first. */
export async function fetchOpenLots(productId: string): Promise<StockLot[]> {
  const supabase = await createTenantClient();
  try {
    return await fetchAllRowsOrThrow<StockLot>(
      async (from, to) =>
        await supabase
          .from("stock_lots")
          .select("*", { count: "exact" })
          .eq("product_id", productId)
          .neq("qty_remaining", 0)
          .order("received_at", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, to),
      PRODUCT_LOTS_CAP,
    );
  } catch (e) {
    throw new Error(inventoryErrorMessage(e, "Could not load this product's batches."));
  }
}
