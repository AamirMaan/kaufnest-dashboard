import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import type { SalesSummaryRow } from "@/types";

const sum = (rows: SalesSummaryRow[], pick: (r: SalesSummaryRow) => number) =>
  rows.reduce((acc, r) => acc + pick(r), 0);

/** Orders tiles, in spec order. VAT and Net only appear when VAT is non-zero (otherwise Net = Gross). */
export function buildSalesTiles(rows: SalesSummaryRow[]): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  return compactTiles([
    countTile("Orders", sum(rows, (r) => r.order_count)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
    moneyTile("Fees", rows, (r) => r.fees),
    moneyTile("Shipping charged", rows, (r) => r.shipping_charged),
    countTile("Excluded", sum(rows, (r) => r.excluded_count)),
  ]);
}
