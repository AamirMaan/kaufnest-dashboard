import { createTenantClient } from "@/lib/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/utils/fetchAllRows";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import type { StockLot } from "@/types";

/** One product's open batches grow with its purchase history, so read them with fetchAllRowsOrThrow. */
export const PRODUCT_LOTS_CAP = 1000;

/**
 * The batches the Batches modal lists for one product, oldest first: every
 * batch with units left (or a shortfall), PLUS every opening-balance batch
 * even when fully used up — its opening cost stays editable (re-costing the
 * orders that consumed it), so it must stay reachable. A used-up opening
 * batch shows Remaining 0. Fully consumed purchase/transfer batches are
 * omitted.
 */
export async function fetchOpenLots(productId: string): Promise<StockLot[]> {
  const supabase = await createTenantClient();
  try {
    return await fetchAllRowsOrThrow<StockLot>(
      async (from, to) =>
        await supabase
          .from("stock_lots")
          .select("*", { count: "exact" })
          .eq("product_id", productId)
          .or("qty_remaining.neq.0,kind.eq.opening")
          .order("received_at", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, to),
      PRODUCT_LOTS_CAP,
    );
  } catch (e) {
    throw new Error(inventoryErrorMessage(e, "Could not load this product's batches."));
  }
}

/**
 * The batches a transfer can draw from: one product at one location with
 * units left, never the shortfall lot — the same set, in the same FIFO
 * order, that inv_transfer_after_insert (047) consumes. Feeds fifoPreview.
 */
export async function fetchAvailableLots(productId: string, locationId: string): Promise<StockLot[]> {
  const supabase = await createTenantClient();
  try {
    return await fetchAllRowsOrThrow<StockLot>(
      async (from, to) =>
        await supabase
          .from("stock_lots")
          .select("*", { count: "exact" })
          .eq("product_id", productId)
          .eq("location_id", locationId)
          .neq("kind", "shortfall")
          .gt("qty_remaining", 0)
          .order("received_at", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      PRODUCT_LOTS_CAP,
    );
  } catch (e) {
    throw new Error(inventoryErrorMessage(e, "Could not load the stock at this location."));
  }
}
