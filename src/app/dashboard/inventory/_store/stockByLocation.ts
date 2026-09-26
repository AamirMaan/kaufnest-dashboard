import { createTenantClient } from "@/lib/supabase/client";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationTotals, type StockByLocationRow } from "../_lib/stockByLocation";

/** The RPC refuses more ids than this (047 installer); callers pass one table page at a time. */
export const STOCK_RPC_MAX_IDS = 200;

export async function fetchStockByLocation(productIds: string[]): Promise<StockByLocationRow[]> {
  if (productIds.length === 0) return [];
  const supabase = await createTenantClient();
  const rows: StockByLocationRow[] = [];
  for (let i = 0; i < productIds.length; i += STOCK_RPC_MAX_IDS) {
    const { data, error } = await supabase.rpc("inventory_stock_by_location", {
      p_product_ids: productIds.slice(i, i + STOCK_RPC_MAX_IDS),
    });
    if (error) throw new Error(inventoryErrorMessage(error, "Could not load stock by location."));
    rows.push(...((data ?? []) as StockByLocationRow[]));
  }
  return rows;
}

/** One row per location (bounded by the tenant's location count). */
export async function fetchLocationStockTotals(): Promise<Record<string, number>> {
  const supabase = await createTenantClient();
  const { data, error } = await supabase.rpc("inventory_stock_by_location_totals");
  if (error) throw new Error(inventoryErrorMessage(error, "Could not load stock totals."));
  return locationTotals((data ?? []) as { location_id: string; qty: number }[]);
}
