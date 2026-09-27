import { buildExpensesTiles } from "./expensesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { ExpenseCategory, ExpensesSummaryRow } from "@/types";

const label = (c: ExpenseCategory) => c.toUpperCase();
const row = (o: Partial<ExpensesSummaryRow> = {}): ExpensesSummaryRow => ({
  currency: "EUR", expense_count: 6, gross: 119, vat: 19, top_category: "shipping", top_category_amount: 80, ...o,
});

describe("buildExpensesTiles", () => {
  it("shows all tiles in order", () => {
    expect(buildExpensesTiles([row()], label).map((t) => t.label))
      .toEqual(["Expenses", "Gross", "VAT", "Net", "Top category"]);
  });

  it("formats top category per currency", () => {
    const tile = buildExpensesTiles([row()], label).find((t) => t.label === "Top category");
    expect(tile?.lines).toEqual([`SHIPPING · ${formatCurrency(80, "EUR")}`]);
  });

  it("keeps a negative VAT total (credit notes)", () => {
    const tiles = buildExpensesTiles([row({ gross: -50, vat: -8 })], label);
    expect(tiles.find((t) => t.label === "VAT")?.lines).toEqual([formatCurrency(-8, "EUR")]);
  });

  it("hides VAT/Net without VAT and Top category without data", () => {
    expect(buildExpensesTiles([row({ vat: 0, top_category: null, top_category_amount: null })], label).map((t) => t.label))
      .toEqual(["Expenses", "Gross"]);
  });

  it("shows only the zero count for an empty result", () => {
    expect(buildExpensesTiles([], label)).toEqual([{ label: "Expenses", lines: ["0"] }]);
  });
});
