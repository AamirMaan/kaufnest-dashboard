import { ALIASES, normalizeHeader, resolveHeaders, canonicalizeRow, type ColumnSpec } from "./importAliases";

describe("normalizeHeader", () => {
  it("strips a trailing parenthesised unit", () => {
    // "Gross Amount (€)" — and the € is often mojibaked to "â¬" by Excel's
    // encoding, so matching on it directly is fragile.
    expect(normalizeHeader("Gross Amount (€)")).toBe("gross amount");
    expect(normalizeHeader("Gross Amount (â¬)")).toBe("gross amount");
    expect(normalizeHeader("VAT Rate (%)")).toBe("vat rate");
  });

  it("lowercases and trims", () => {
    expect(normalizeHeader("  Datum  ")).toBe("datum");
  });

  it("leaves a mid-string parenthesis alone", () => {
    expect(normalizeHeader("Fee (net) total")).toBe("fee (net) total");
  });
});

describe("resolveHeaders", () => {
  const columns: ColumnSpec[] = [
    { key: "date", aliases: ["date", "datum"], required: true },
    { key: "amount", aliases: ["amount", "gross amount", "brutto"], required: true },
    { key: "vendor", aliases: ["vendor", "supplier", "lieferant"], required: false },
  ];

  it("maps German and unit-suffixed headers", () => {
    const { mapping, missingRequired } = resolveHeaders(
      ["Datum", "Gross Amount (€)", "Lieferant"],
      columns,
    );
    expect(missingRequired).toEqual([]);
    expect(mapping.get("Datum")).toBe("date");
    expect(mapping.get("Gross Amount (€)")).toBe("amount");
    expect(mapping.get("Lieferant")).toBe("vendor");
  });

  it("reports missing required columns", () => {
    const { missingRequired } = resolveHeaders(["Datum"], columns);
    expect(missingRequired).toEqual(["amount"]);
  });

  it("keeps the FIRST header when two map to one key", () => {
    const { mapping } = resolveHeaders(["Amount", "Brutto"], columns);
    expect(mapping.get("Amount")).toBe("amount");
    expect(mapping.has("Brutto")).toBe(false);
  });
});

describe("canonicalizeRow", () => {
  it("rekeys a raw row and fills missing values with empty string", () => {
    const mapping = new Map([["Datum", "date"], ["Lieferant", "vendor"]]);
    expect(canonicalizeRow({ Datum: "13.04.2026" }, mapping)).toEqual({
      date: "13.04.2026",
      vendor: "",
    });
  });
});

describe("ALIASES", () => {
  it("carries the expense vocabulary the vorsteuer format needs", () => {
    expect(ALIASES.vendor).toContain("supplier");
    expect(ALIASES.invoice_number).toContain("rechnungsnummer");
    expect(ALIASES.vendor_vat_number).toContain("ustid des anbieters");
    expect(ALIASES.tax_number).toContain("steuernummer");
    expect(ALIASES.net_amount).toContain("net amount");
  });

  it("keeps vendor_vat_number and tax_number separate", () => {
    // The sheet has BOTH columns and populates whichever the vendor has, so
    // they must resolve independently and be merged per ROW, not per file.
    expect(ALIASES.vendor_vat_number).not.toContain("steuernummer");
  });
});
