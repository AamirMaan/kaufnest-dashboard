import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import type { PurchasesSummaryRow } from "@/types";

const sum = (rows: PurchasesSummaryRow[], pick: (r: PurchasesSummaryRow) => number) =>
  rows.reduce((acc, r) => acc + pick(r), 0);

/** Purchases tiles, in spec order. VAT and Net only appear when VAT is non-zero. */
export function buildPurchasesTiles(rows: PurchasesSummaryRow[]): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  return compactTiles([
    countTile("Purchases", sum(rows, (r) => r.purchase_count)),
    countTile("Units bought", sum(rows, (r) => r.units)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
  ]);
}
