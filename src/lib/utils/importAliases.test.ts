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

  it("prefers an EXACT header match over a normalised one, whatever the order", () => {
    // The regression this pins: a Sales sheet with "Total (net)" BEFORE
    // "Total". `normalizeHeader` strips the trailing "(net)", so a single
    // pass let "Total (net)" claim the `total` key first and the real "Total"
    // column was then dropped by the first-wins guard — silently importing
    // the net figure as the order total. Two passes fix it: exact names get
    // first refusal, normalised names only fill what is still unclaimed.
    const salesColumns: ColumnSpec[] = [
      { key: "total", aliases: ["total", "gesamt"], required: true },
    ];
    const { mapping, missingRequired } = resolveHeaders(["Total (net)", "Total"], salesColumns);
    expect(missingRequired).toEqual([]);
    expect(mapping.get("Total")).toBe("total");
    expect(mapping.has("Total (net)")).toBe(false);
  });

  it("still resolves a unit-suffixed header when nothing matches it exactly", () => {
    // The other half of the same rule — dropping the trailing unit is what
    // makes "Gross Amount (€)" work at all, so pass 2 must remain.
    const { mapping } = resolveHeaders(["Gross Amount (€)"], columns);
    expect(mapping.get("Gross Amount (€)")).toBe("amount");
  });

  it("lets an exact match win even when the normalised one comes first", () => {
    // Order-independence, stated directly: "Amount (net)" normalises to
    // "amount", but the literal "Amount" column owns the key.
    const { mapping } = resolveHeaders(["Amount (net)", "Amount"], columns);
    expect(mapping.get("Amount")).toBe("amount");
    expect(mapping.has("Amount (net)")).toBe(false);
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
