import type { StockLocation } from "@/types";

/** Row shape of the inventory_stock_by_location RPC (047 installer). */
export interface StockByLocationRow {
  product_id: string;
  location_id: string;
  qty: number;          // net units, negative for a shortfall
  positive_qty: number; // units actually on hand
  stock_value: number;  // value of the on-hand units at their lot cost
}

export const MAX_STOCK_COLUMNS = 4;
export const OTHER_COLUMN_ID = "other";

export interface StockColumn {
  id: string;
  label: string;
}

export interface ProductStockSummary {
  cells: Record<string, number>;
  total: number;
  avgUnitCost: number | null;
}

const byName = (a: StockLocation, b: StockLocation) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** First MAX_STOCK_COLUMNS active, stock-holding locations by name, plus "Other" when more exist. */
export function stockColumns(locations: StockLocation[]): StockColumn[] {
  const holding = locations.filter((l) => l.type !== "dropship");
  const shown = holding.filter((l) => l.is_active).sort(byName).slice(0, MAX_STOCK_COLUMNS);
  const columns = shown.map((l) => ({ id: l.id, label: l.name }));
  const hasMore = holding.some((l) => !shown.some((s) => s.id === l.id));
  return hasMore ? [...columns, { id: OTHER_COLUMN_ID, label: "Other" }] : columns;
}

export function summarizeStock(
  rows: StockByLocationRow[],
  columns: StockColumn[],
): Record<string, ProductStockSummary> {
  const shownIds = new Set(columns.filter((c) => c.id !== OTHER_COLUMN_ID).map((c) => c.id));
  const acc: Record<string, { cells: Record<string, number>; total: number; onHand: number; value: number }> = {};
  for (const r of rows) {
    const s = (acc[r.product_id] ??= { cells: {}, total: 0, onHand: 0, value: 0 });
    const col = shownIds.has(r.location_id) ? r.location_id : OTHER_COLUMN_ID;
    const qty = Number(r.qty);
    s.cells[col] = (s.cells[col] ?? 0) + qty;
    s.total += qty;
    s.onHand += Number(r.positive_qty);
    s.value += Number(r.stock_value);
  }
  const out: Record<string, ProductStockSummary> = {};
  for (const [productId, s] of Object.entries(acc)) {
    out[productId] = {
      cells: s.cells,
      total: s.total,
      avgUnitCost: s.onHand > 0 ? Math.round((s.value / s.onHand) * 100) / 100 : null,
    };
  }
  return out;
}

export function locationTotals(rows: { location_id: string; qty: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.location_id, Number(r.qty)]));
}
