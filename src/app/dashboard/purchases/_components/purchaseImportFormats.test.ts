import {
  validatePurchaseRow,
  resolveHeaders,
  canonicalizeRow,
  PURCHASE_IMPORT_COLUMNS,
  TEMPLATE_HEADERS,
  TEMPLATE_EXAMPLE,
} from "./purchaseImportFormats";

const BASE: Record<string, string> = {
  date: "2024-01-15",
  product_name: "Blue Widget",
  vendor: "Acme Supplies",
  quantity: "50",
  unit_price: "4.99",
  currency: "EUR",
  vat_rate: "19",
  description: "Sample purchase",
};

describe("resolveHeaders (German aliases now work)", () => {
  it("resolves a German header line fully", () => {
    const { mapping, missingRequired } = resolveHeaders(
      ["datum", "artikelname", "menge", "preis", "lieferant", "währung", "mwst"],
      PURCHASE_IMPORT_COLUMNS,
    );
    expect(missingRequired).toEqual([]);
    expect(mapping.get("datum")).toBe("date");
    expect(mapping.get("artikelname")).toBe("product_name");
    expect(mapping.get("menge")).toBe("quantity");
    expect(mapping.get("preis")).toBe("unit_price");
    expect(mapping.get("lieferant")).toBe("vendor");
    expect(mapping.get("währung")).toBe("currency");
    expect(mapping.get("mwst")).toBe("vat_rate");
  });

  it("reports missing required columns", () => {
    const { missingRequired } = resolveHeaders(["vendor"], PURCHASE_IMPORT_COLUMNS);
    expect(missingRequired).toEqual(expect.arrayContaining(["date", "product_name", "quantity", "unit_price"]));
  });
});

describe("validatePurchaseRow — required columns", () => {
  it("accepts a valid row", () => {
    const row = validatePurchaseRow(BASE, 2);
    expect(row.error).toBeNull();
    expect(row.data?.product_name).toBe("Blue Widget");
    expect(row.data?.vendor).toBe("Acme Supplies");
    expect(row.data?.quantity).toBe(50);
    expect(row.data?.unit_price).toBe(4.99);
    expect(row.data?.total_amount).toBe(249.5); // 50 * 4.99
  });

  it("errors on missing product_name", () => {
    const row = validatePurchaseRow({ ...BASE, product_name: "" }, 2);
    expect(row.error).toContain("product_name");
  });

  it("errors on a non-positive quantity", () => {
    expect(validatePurchaseRow({ ...BASE, quantity: "0" }, 2).error).toContain("quantity");
    expect(validatePurchaseRow({ ...BASE, quantity: "-1" }, 2).error).toContain("quantity");
  });

  it("errors on a fractional quantity (stricter than the old parseInt truncation)", () => {
    expect(validatePurchaseRow({ ...BASE, quantity: "2.5" }, 2).error).toContain("quantity");
  });

  it("errors on a non-positive unit_price", () => {
    expect(validatePurchaseRow({ ...BASE, unit_price: "0" }, 2).error).toContain("unit_price");
  });

  it("errors on an invalid date", () => {
    expect(validatePurchaseRow({ ...BASE, date: "not-a-date" }, 2).error).toContain("date");
  });
});

describe("validatePurchaseRow — German/locale tolerance (new)", () => {
  it("accepts a German date format", () => {
    const row = validatePurchaseRow({ ...BASE, date: "15.01.2024" }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2024-01-15");
  });

  it("accepts a decimal-comma unit_price", () => {
    const row = validatePurchaseRow({ ...BASE, unit_price: "4,99" }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.unit_price).toBe(4.99);
  });
});

describe("validatePurchaseRow — VAT", () => {
  it("computes vat_amount from vat_rate when present", () => {
    const row = validatePurchaseRow(BASE, 2);
    expect(row.data?.vat_rate).toBe(19);
    expect(row.data?.vat_amount).not.toBeNull();
  });

  it("leaves vat_amount null when vat_rate is absent", () => {
    const row = validatePurchaseRow({ ...BASE, vat_rate: "" }, 2);
    expect(row.data?.vat_rate).toBeNull();
    expect(row.data?.vat_amount).toBeNull();
  });

  it("errors on an out-of-range vat_rate", () => {
    expect(validatePurchaseRow({ ...BASE, vat_rate: "101" }, 2).error).toContain("vat_rate");
  });
});

describe("validatePurchaseRow — currency resolution (FX review)", () => {
  it("treats a blank/base-currency value as no conversion needed", () => {
    const blank = validatePurchaseRow({ ...BASE, currency: "" }, 2, "dmy", "EUR");
    expect(blank.sheetCurrency).toBeNull();
    expect(blank.data?.currency).toBe("EUR");

    const same = validatePurchaseRow({ ...BASE, currency: "eur" }, 2, "dmy", "EUR");
    expect(same.sheetCurrency).toBeNull();
    expect(same.data?.currency).toBe("EUR");
  });

  it("resolves a non-base ISO currency instead of erroring — routes to FX review", () => {
    const row = validatePurchaseRow({ ...BASE, currency: "SEK" }, 2, "dmy", "EUR");
    expect(row.error).toBeNull();
    expect(row.sheetCurrency).toBe("SEK");
    // Unconverted at parse time — data.currency is the BASE currency, and
    // total_amount is still the sheet's raw (unconverted) figure.
    expect(row.data?.currency).toBe("EUR");
    expect(row.data?.original_currency).toBeNull();
  });

  it("errors on a currency value that isn't a plausible ISO code", () => {
    const row = validatePurchaseRow({ ...BASE, currency: "XYZ123" }, 2);
    expect(row.error).toContain("unsupported currency");
  });
});

describe("template", () => {
  it("TEMPLATE_HEADERS matches PURCHASE_IMPORT_COLUMNS exactly, in order", () => {
    expect(TEMPLATE_HEADERS).toEqual(PURCHASE_IMPORT_COLUMNS.map((c) => c.key));
  });

  it("TEMPLATE_EXAMPLE re-imports cleanly under TEMPLATE_HEADERS", () => {
    const raw: Record<string, string> = {};
    TEMPLATE_HEADERS.forEach((key, i) => (raw[key] = TEMPLATE_EXAMPLE[i]));
    const canonical = canonicalizeRow(raw, new Map(TEMPLATE_HEADERS.map((k) => [k, k])));
    const row = validatePurchaseRow(canonical, 2);
    expect(row.error).toBeNull();
  });
});
