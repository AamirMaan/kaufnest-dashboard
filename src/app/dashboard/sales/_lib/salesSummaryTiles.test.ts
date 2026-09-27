import { buildSalesTiles } from "./salesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { SalesSummaryRow } from "@/types";

const row = (o: Partial<SalesSummaryRow> = {}): SalesSummaryRow => ({
  currency: "EUR", order_count: 3, gross: 119, vat: 19, fees: 12, shipping_charged: 4.99, excluded_count: 1, ...o,
});

const labels = (rows: SalesSummaryRow[]) => buildSalesTiles(rows).map((t) => t.label);

describe("buildSalesTiles", () => {
  it("shows every tile when all values are present", () => {
    expect(labels([row()])).toEqual(["Orders", "Gross", "VAT", "Net", "Fees", "Shipping charged", "Excluded"]);
  });

  it("computes Net as gross minus VAT per currency", () => {
    const net = buildSalesTiles([row()]).find((t) => t.label === "Net");
    expect(net?.lines).toEqual([formatCurrency(100, "EUR")]);
  });

  it("hides VAT and Net when there is no VAT, and zero fees/shipping", () => {
    expect(labels([row({ vat: 0, fees: 0, shipping_charged: 0 })])).toEqual(["Orders", "Gross", "Excluded"]);
  });

  it("sums counts across currencies", () => {
    const tiles = buildSalesTiles([row(), row({ currency: "GBP", order_count: 2, excluded_count: 0 })]);
    expect(tiles.find((t) => t.label === "Orders")?.lines).toEqual(["5"]);
    expect(tiles.find((t) => t.label === "Excluded")?.lines).toEqual(["1"]);
    expect(tiles.find((t) => t.label === "Gross")?.lines).toHaveLength(2);
  });

  it("shows zero counts and no money tiles for an empty result", () => {
    expect(buildSalesTiles([])).toEqual([
      { label: "Orders", lines: ["0"] },
      { label: "Excluded", lines: ["0"] },
    ]);
  });
});
