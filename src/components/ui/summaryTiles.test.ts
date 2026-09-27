import { compactTiles, countTile, moneyTile } from "./summaryTiles";
import { formatCurrency } from "@/lib/utils/currency";

const rows = [
  { currency: "EUR" as const, gross: 1234.5, vat: 0 },
  { currency: "GBP" as const, gross: 10, vat: 0 },
];

describe("moneyTile", () => {
  it("renders one formatted line per currency", () => {
    expect(moneyTile("Gross", rows, (r) => r.gross)).toEqual({
      label: "Gross",
      lines: [formatCurrency(1234.5, "EUR"), formatCurrency(10, "GBP")],
    });
  });

  it("returns null when every value is zero", () => {
    expect(moneyTile("VAT", rows, (r) => r.vat)).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(moneyTile("Gross", [], () => 1)).toBeNull();
  });

  it("keeps a tile whose only non-zero value is negative (credit notes)", () => {
    const tile = moneyTile("VAT", [{ currency: "EUR" as const, v: -3.2 }], (r) => r.v);
    expect(tile?.lines).toEqual([formatCurrency(-3.2, "EUR")]);
  });
});

describe("countTile", () => {
  it("always renders, including zero", () => {
    expect(countTile("Orders", 0)).toEqual({ label: "Orders", lines: ["0"] });
  });
  it("groups thousands", () => {
    expect(countTile("Orders", 12345).lines[0]).toBe(new Intl.NumberFormat("de-DE").format(12345));
  });
});

describe("compactTiles", () => {
  it("drops null tiles and keeps order", () => {
    const a = countTile("A", 1);
    const b = countTile("B", 2);
    expect(compactTiles([a, null, b])).toEqual([a, b]);
  });
});
