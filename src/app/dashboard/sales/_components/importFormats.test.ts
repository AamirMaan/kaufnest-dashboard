import {
  IMPORT_FORMATS,
  resolveHeaders,
  canonicalizeRow,
  normalizeStatus,
  normalizePlatform,
  validateRowForFormat,
} from "./importFormats";

const GENERIC = IMPORT_FORMATS.generic;
const AMAZON = IMPORT_FORMATS.amazon;
const EBAY = IMPORT_FORMATS.ebay;

/** Minimal valid Amazon-format row (canonical keys). */
const AMAZON_BASE: Record<string, string> = {
  order_id: "302-1234567-1234567",
  date: "15.01.2024",
  product_name: "Blue Widget",
  quantity: "2",
  total: "19,98",
};

describe("resolveHeaders", () => {
  it("resolves a German header line fully (generic format)", () => {
    const { mapping, missingRequired } = resolveHeaders(
      ["datum", "artikelname", "menge", "preis", "währung", "mwst"],
      GENERIC,
    );
    expect(missingRequired).toEqual([]);
    expect(mapping.get("datum")).toBe("date");
    expect(mapping.get("artikelname")).toBe("product_name");
    expect(mapping.get("menge")).toBe("quantity");
    expect(mapping.get("preis")).toBe("unit_price");
    expect(mapping.get("währung")).toBe("currency");
    expect(mapping.get("mwst")).toBe("vat_rate");
  });

  it("versandkosten → shipping_charged (I6); shipping_cost needs explicit header", () => {
    const { mapping } = resolveHeaders(["versandkosten", "shipping_cost"], GENERIC);
    expect(mapping.get("versandkosten")).toBe("shipping_charged");
    expect(mapping.get("shipping_cost")).toBe("shipping_cost");
  });

  it("ignores unknown columns without error", () => {
    const { mapping } = resolveHeaders(["date", "käufername"], GENERIC);
    expect(mapping.has("käufername")).toBe(false);
    expect(mapping.get("date")).toBe("date");
  });

  it("reports missing required columns by canonical name", () => {
    const { missingRequired } = resolveHeaders(["date", "product_name"], AMAZON);
    expect(missingRequired).toEqual(expect.arrayContaining(["order_id", "quantity", "total"]));
    expect(missingRequired).not.toContain("date");
  });

  it("first matching header wins on duplicates", () => {
    const { mapping } = resolveHeaders(["preis", "unit_price"], GENERIC);
    expect(mapping.get("preis")).toBe("unit_price");
    expect(mapping.has("unit_price")).toBe(false);
  });
});

describe("canonicalizeRow", () => {
  it("re-keys raw row to canonical keys", () => {
    const { mapping } = resolveHeaders(["datum", "menge"], GENERIC);
    expect(canonicalizeRow({ datum: "15.01.2024", menge: "2" }, mapping)).toEqual({
      date: "15.01.2024",
      quantity: "2",
    });
  });
});

describe("normalizeStatus (I8)", () => {
  it.each<[string, string]>([
    ["versandt", "shipped"],
    ["Geliefert", "delivered"],
    ["storniert", "cancelled"],
    ["Retoure", "returned"],
    ["offen", "pending"],
    ["in bearbeitung", "processing"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected);
  });

  it("blank → pending; custom strings pass through", () => {
    expect(normalizeStatus("")).toBe("pending");
    expect(normalizeStatus(undefined)).toBe("pending");
    expect(normalizeStatus("awaiting pickup")).toBe("awaiting pickup");
  });
});

describe("validateRowForFormat — amazon/ebay", () => {
  it("valid German row → data with forced platform + external_order_id", () => {
    const r = validateRowForFormat(AMAZON, AMAZON_BASE, 2);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({
      platform: "amazon",
      external_order_id: "302-1234567-1234567",
      date: "2024-01-15",
      quantity: 2,
      total_amount: 19.98,
      unit_price: 9.99, // derived: total / qty (I4)
      currency: "EUR",
      status: "pending",
      restock: false,
    });
  });

  it("ebay format forces platform ebay", () => {
    const r = validateRowForFormat(EBAY, AMAZON_BASE, 2);
    expect(r.data?.platform).toBe("ebay");
  });

  it("missing order_id → row error", () => {
    const r = validateRowForFormat(AMAZON, { ...AMAZON_BASE, order_id: "" }, 3);
    expect(r.error).toMatch(/order_id/);
    expect(r.data).toBeNull();
  });

  it("total + consistent unit_price → both kept (eBay, I4 rule)", () => {
    const r = validateRowForFormat(EBAY, { ...AMAZON_BASE, unit_price: "9,99" }, 2);
    expect(r.error).toBeNull();
    expect(r.data?.unit_price).toBe(9.99);
    expect(r.data?.total_amount).toBe(19.98);
  });

  it("total disagreeing with qty × unit_price by > 0.02 → row error (eBay, I4)", () => {
    const r = validateRowForFormat(EBAY, { ...AMAZON_BASE, unit_price: "8,00" }, 2);
    expect(r.error).toMatch(/disagrees/);
  });

  it("vat + fees parse with decimal commas", () => {
    const r = validateRowForFormat(
      AMAZON,
      { ...AMAZON_BASE, vat_rate: "0,19", shipping_charged: "4,99", shipping_cost: "3,20", advertising_fee: "1,50" },
      2,
    );
    expect(r.error).toBeNull();
    expect(r.data?.total_amount).toBe(14.99); // 19.98 total - 4.99 shipping = 14.99 items
    expect(r.data?.vat_rate).toBe(19);
    expect(r.data?.vat_amount).toBe(2.39); // 14.99 × 19/119, rounded
    expect(r.data?.shipping_charged).toBe(4.99);
    expect(r.data?.shipping_cost).toBe(3.2);
    expect(r.data?.advertising_fee).toBe(1.5);
  });

  it("German status synonym normalized", () => {
    const r = validateRowForFormat(AMAZON, { ...AMAZON_BASE, status: "storniert" }, 2);
    expect(r.data?.status).toBe("cancelled");
  });
});

describe("validateRowForFormat — generic (back-compat + new tolerance)", () => {
  const BASE: Record<string, string> = {
    date: "2024-01-15",
    product_name: "Blue Widget",
    platform: "amazon",
    quantity: "5",
    unit_price: "9.99",
  };

  it("original template row still validates identically", () => {
    const r = validateRowForFormat(GENERIC, BASE, 2);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({
      platform: "amazon",
      quantity: 5,
      unit_price: 9.99,
      total_amount: 49.95,
      currency: "EUR",
      status: "pending",
      external_order_id: null,
    });
  });

  it("platform defaults to other; invalid platform → error", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "" }, 2).data?.platform).toBe("other");
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "walmart" }, 2).error).toMatch(/platform/);
  });

  it("regional amazon variants normalize to amazon", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "amazon.de" }, 2).data?.platform).toBe("amazon");
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "amazon.nl" }, 2).data?.platform).toBe("amazon");
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "amazon.co.uk" }, 2).data?.platform).toBe("amazon");
  });

  it("regional ebay variants normalize to ebay", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "ebay.de" }, 2).data?.platform).toBe("ebay");
    expect(validateRowForFormat(GENERIC, { ...BASE, platform: "eBay.nl" }, 2).data?.platform).toBe("ebay");
  });

  it("date with dash separator DD-MM-YYYY accepted", () => {
    const r = validateRowForFormat(GENERIC, { ...BASE, date: "26-03-2026" }, 2);
    expect(r.error).toBeNull();
    expect(r.data?.date).toBe("2026-03-26");
  });

  it("German date + decimal comma accepted (I5)", () => {
    const r = validateRowForFormat(GENERIC, { ...BASE, date: "15.01.2024", unit_price: "9,99" }, 2);
    expect(r.error).toBeNull();
    expect(r.data?.date).toBe("2024-01-15");
    expect(r.data?.total_amount).toBe(49.95);
  });

  it("two-digit year rejected (I7)", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, date: "15.01.24" }, 2).error).toMatch(/date/);
  });

  it("quantity must be a positive integer — '2,5' rejected", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, quantity: "2,5" }, 2).error).toMatch(/quantity/);
    expect(validateRowForFormat(GENERIC, { ...BASE, quantity: "0" }, 2).error).toMatch(/quantity/);
  });

  it("optional total column: alone → unit_price derived; missing both prices → error", () => {
    const derived = validateRowForFormat(GENERIC, { ...BASE, unit_price: "", total: "49,95" }, 2);
    expect(derived.error).toBeNull();
    expect(derived.data?.unit_price).toBe(9.99);
    expect(validateRowForFormat(GENERIC, { ...BASE, unit_price: "" }, 2).error).toMatch(/unit_price/);
  });

  it("optional order_id lands in external_order_id", () => {
    const r = validateRowForFormat(GENERIC, { ...BASE, order_id: "ABC-1" }, 2);
    expect(r.data?.external_order_id).toBe("ABC-1");
  });

  it("vat_rate out of range → error; valid → vat_amount computed", () => {
    expect(validateRowForFormat(GENERIC, { ...BASE, vat_rate: "101" }, 2).error).toMatch(/vat_rate/);
    const r = validateRowForFormat(GENERIC, { ...BASE, vat_rate: "19" }, 2);
    expect(r.data?.vat_amount).toBe(7.98); // 49.95 × 19/119 = 7.9752 → rounded
  });

  it("sku present → carried on ParsedRow.sku, absent from data", () => {
    const r = validateRowForFormat(GENERIC, { ...BASE, sku: "WIDGET-BLU" }, 2);
    expect(r.error).toBeNull();
    expect(r.sku).toBe("WIDGET-BLU");
    // product_id resolution happens in the modal, not here
    expect(r.data).not.toHaveProperty("product_id");
  });

  it("sku blank/absent → ParsedRow.sku is null", () => {
    expect(validateRowForFormat(GENERIC, BASE, 2).sku).toBeNull();
    expect(validateRowForFormat(GENERIC, { ...BASE, sku: "  " }, 2).sku).toBeNull();
  });
});

describe("normalizePlatform", () => {
  it.each<[string, string]>([
    ["amazon", "amazon"],
    ["amazon.de", "amazon"],
    ["amazon.nl", "amazon"],
    ["amazon.co.uk", "amazon"],
    ["Amazon.de", "amazon"],
    ["ebay", "ebay"],
    ["ebay.de", "ebay"],
    ["eBay", "ebay"],
    ["shopify", "shopify"],
    ["etsy", "etsy"],
    ["other", "other"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePlatform(input)).toBe(expected);
  });
});

describe("resolveHeaders — sku aliases", () => {
  it("'artikelnummer' resolves to sku", () => {
    const { mapping } = resolveHeaders(["date", "product_name", "quantity", "unit_price", "artikelnummer"], GENERIC);
    expect(mapping.get("artikelnummer")).toBe("sku");
  });

  it("'sku' resolves to sku in all formats", () => {
    for (const fmt of [GENERIC, AMAZON, EBAY]) {
      const { mapping } = resolveHeaders(["sku"], fmt);
      expect(mapping.get("sku")).toBe("sku");
    }
  });
});

describe("amazon vat_rate is a fraction", () => {
  const amazon = IMPORT_FORMATS.amazon;

  it("declares the fraction flag", () => {
    expect(amazon.vatRateIsFraction).toBe(true);
    expect(IMPORT_FORMATS.generic.vatRateIsFraction).toBeFalsy();
    expect(IMPORT_FORMATS.ebay.vatRateIsFraction).toBeFalsy();
  });

  it("scales 0.19 to 19", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "306-4103530-5332345",
      date: "30-04-2026",
      product_name: "Baumwolltasche",
      quantity: "1",
      total: "9.89",
      unit_price: "9.89",
      currency: "EUR",
      vat_rate: "0.19",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_rate).toBe(19);
  });

  it("scales the Swedish 0.25 to 25", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "406-4012512-5663517",
      date: "08-04-2026",
      product_name: "Textilpennor",
      quantity: "1",
      total: "73.99",
      unit_price: "73.99",
      currency: "EUR",
      vat_rate: "0.25",
    }, 2);
    expect(row.data?.vat_rate).toBe(25);
  });

  it("leaves the generic format's 19 alone", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.generic, {
      date: "2026-04-30",
      product_name: "Widget",
      quantity: "1",
      unit_price: "9.89",
      vat_rate: "19",
    }, 2);
    expect(row.data?.vat_rate).toBe(19);
  });

  it("scales the edge case 1 (100%) to 100", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "506-5555555-5555555",
      date: "01-01-2026",
      product_name: "Edge Case",
      quantity: "1",
      total: "100.00",
      unit_price: "100.00",
      currency: "EUR",
      vat_rate: "1",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_rate).toBe(100);
  });
});

describe("amazon line totals", () => {
  const amazon = IMPORT_FORMATS.amazon;

  // Order 028-4502196-4511533 from the April 2026 report.
  it("derives a per-unit price from a line total at quantity 2", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-4502196-4511533",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "2",
      unit_price: "16.10",
      total: "16.10",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.unit_price).toBe(8.05);
    expect(row.data?.total_amount).toBe(16.10);
  });

  // Order 028-7135526-5060303: items 7.99 + shipping 2.00 = total 9.99.
  it("accepts a total that includes shipping, and stores items only", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-7135526-5060303",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      unit_price: "7.99",
      total: "9.99",
      shipping_charged: "2.00",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.unit_price).toBe(7.99);
    // CRITICAL: 7.99, not 9.99. aggregateSales adds shipping_charged on top,
    // so storing 9.99 here would report 11.99 revenue for a 9.99 order.
    expect(row.data?.total_amount).toBe(7.99);
    expect(row.data?.shipping_charged).toBe(2);
  });

  it("errors when total does not reconcile with items + shipping", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "7.99",
      total: "50.00",
      shipping_charged: "2.00",
      currency: "EUR",
    }, 2);
    expect(row.error).toContain("does not reconcile");
  });

  it("still enforces quantity x unit_price for the generic format", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.generic, {
      date: "2026-04-30",
      product_name: "Widget",
      quantity: "2",
      unit_price: "16.10",
      total: "16.10",
    }, 2);
    expect(row.error).toContain("disagrees with quantity");
  });

  it("backs the item total out of the sheet total when unit_price is absent", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      total: "19,98",
      shipping_charged: "4,99",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    // 19.98 total - 4.99 shipping = 14.99 items. Storing 19.98 here would make
    // aggregateSales report 24.97 revenue for a 19.98 order.
    expect(row.data?.total_amount).toBe(14.99);
    expect(row.data?.unit_price).toBe(14.99);
    expect(row.data?.shipping_charged).toBe(4.99);
  });
});

describe("vat_amount column", () => {
  const amazon = IMPORT_FORMATS.amazon;

  // Order 028-7135526-5060303: item VAT 1.28 + shipping VAT 0.32 = 1.60.
  it("prefers the CSV vat_amount over deriving it", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "028-7135526-5060303",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      unit_price: "7.99",
      total: "9.99",
      shipping_charged: "2.00",
      vat_rate: "0.19",
      vat_amount: "1.60",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_amount).toBe(1.6);
  });

  it("still derives vat_amount when the column is absent", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "11.90",
      total: "11.90",
      vat_rate: "0.19",
      currency: "EUR",
    }, 2);
    expect(row.data?.vat_amount).toBeCloseTo(1.9, 1);
  });

  it("rejects a negative vat_amount", () => {
    const row = validateRowForFormat(amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "7.99",
      total: "7.99",
      vat_amount: "-1",
      currency: "EUR",
    }, 2);
    expect(row.error).toContain("vat_amount");
  });
});
