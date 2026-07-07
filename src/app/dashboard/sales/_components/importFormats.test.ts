import {
  IMPORT_FORMATS,
  resolveHeaders,
  canonicalizeRow,
  normalizeStatus,
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

  it("total + consistent unit_price → both kept", () => {
    const r = validateRowForFormat(AMAZON, { ...AMAZON_BASE, unit_price: "9,99" }, 2);
    expect(r.error).toBeNull();
    expect(r.data?.unit_price).toBe(9.99);
    expect(r.data?.total_amount).toBe(19.98);
  });

  it("total disagreeing with qty × unit_price by > 0.02 → row error (I4)", () => {
    const r = validateRowForFormat(AMAZON, { ...AMAZON_BASE, unit_price: "8,00" }, 2);
    expect(r.error).toMatch(/disagrees/);
  });

  it("vat + fees parse with decimal commas", () => {
    const r = validateRowForFormat(
      AMAZON,
      { ...AMAZON_BASE, vat_rate: "19", shipping_charged: "4,99", shipping_cost: "3,20", advertising_fee: "1,50" },
      2,
    );
    expect(r.error).toBeNull();
    expect(r.data?.vat_rate).toBe(19);
    expect(r.data?.vat_amount).toBe(3.19); // 19.98 × 19/119, rounded
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
