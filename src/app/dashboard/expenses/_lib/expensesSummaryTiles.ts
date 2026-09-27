import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import { formatCurrency } from "@/lib/utils/currency";
import type { ExpenseCategory, ExpensesSummaryRow } from "@/types";

/**
 * Expenses tiles, in spec order. `categoryLabel` is injected (the page passes
 * Badge's CATEGORY_LABELS) so this module stays React-free and testable.
 */
export function buildExpensesTiles(
  rows: ExpensesSummaryRow[],
  categoryLabel: (c: ExpenseCategory) => string
): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  const topRows = rows.filter((r) => r.top_category !== null && r.top_category_amount !== null);
  const top: SummaryTile | null =
    topRows.length === 0
      ? null
      : {
          label: "Top category",
          lines: topRows.map(
            (r) => `${categoryLabel(r.top_category as ExpenseCategory)} · ${formatCurrency(r.top_category_amount as number, r.currency)}`
          ),
        };

  return compactTiles([
    countTile("Expenses", rows.reduce((acc, r) => acc + r.expense_count, 0)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
    top,
  ]);
}
