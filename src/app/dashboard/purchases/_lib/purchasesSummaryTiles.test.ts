import { buildPurchasesTiles } from "./purchasesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { PurchasesSummaryRow } from "@/types";

const row = (o: Partial<PurchasesSummaryRow> = {}): PurchasesSummaryRow => ({
  currency: "EUR", purchase_count: 4, units: 40, gross: 238, vat: 38, ...o,
});

describe("buildPurchasesTiles", () => {
  it("shows all tiles in order", () => {
    expect(buildPurchasesTiles([row()]).map((t) => t.label)).toEqual(["Purchases", "Units bought", "Gross", "VAT", "Net"]);
  });

  it("computes Net as gross minus VAT", () => {
    expect(buildPurchasesTiles([row()]).find((t) => t.label === "Net")?.lines).toEqual([formatCurrency(200, "EUR")]);
  });

  it("hides VAT and Net without VAT", () => {
    expect(buildPurchasesTiles([row({ vat: 0 })]).map((t) => t.label)).toEqual(["Purchases", "Units bought", "Gross"]);
  });

  it("sums counts and units across currencies", () => {
    const tiles = buildPurchasesTiles([row(), row({ currency: "GBP", purchase_count: 1, units: 5 })]);
    expect(tiles.find((t) => t.label === "Purchases")?.lines).toEqual(["5"]);
    expect(tiles.find((t) => t.label === "Units bought")?.lines).toEqual(["45"]);
  });

  it("shows zero counts for an empty result", () => {
    expect(buildPurchasesTiles([])).toEqual([
      { label: "Purchases", lines: ["0"] },
      { label: "Units bought", lines: ["0"] },
    ]);
  });
});
