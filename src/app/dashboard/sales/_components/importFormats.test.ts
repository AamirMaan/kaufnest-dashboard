import {
  IMPORT_FORMATS,
  resolveHeaders,
  canonicalizeRow,
  normalizeStatus,
  normalizePlatform,
  validateRowForFormat,
  classifySkip,
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
      GENERIC.columns,
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
    const { mapping } = resolveHeaders(["versandkosten", "shipping_cost"], GENERIC.columns);
    expect(mapping.get("versandkosten")).toBe("shipping_charged");
    expect(mapping.get("shipping_cost")).toBe("shipping_cost");
  });

  it("ignores unknown columns without error", () => {
    const { mapping } = resolveHeaders(["date", "käufername"], GENERIC.columns);
    expect(mapping.has("käufername")).toBe(false);
    expect(mapping.get("date")).toBe("date");
  });

  it("reports missing required columns by canonical name", () => {
    const { missingRequired } = resolveHeaders(["date", "product_name"], AMAZON.columns);
    expect(missingRequired).toEqual(expect.arrayContaining(["order_id", "quantity", "total"]));
    expect(missingRequired).not.toContain("date");
  });

  it("first matching header wins on duplicates", () => {
    const { mapping } = resolveHeaders(["preis", "unit_price"], GENERIC.columns);
    expect(mapping.get("preis")).toBe("unit_price");
    expect(mapping.has("unit_price")).toBe(false);
  });
});

describe("canonicalizeRow", () => {
  it("re-keys raw row to canonical keys", () => {
    const { mapping } = resolveHeaders(["datum", "menge"], GENERIC.columns);
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
    const { mapping } = resolveHeaders(["date", "product_name", "quantity", "unit_price", "artikelnummer"], GENERIC.columns);
    expect(mapping.get("artikelnummer")).toBe("sku");
  });

  it("'sku' resolves to sku in all formats", () => {
    for (const fmt of [GENERIC, AMAZON, EBAY]) {
      const { mapping } = resolveHeaders(["sku"], fmt.columns);
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

  it("parses a German decimal comma in vat_amount", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "028-7135526-5060303",
      date: "30-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      unit_price: "7,99",
      total: "9,99",
      shipping_charged: "2,00",
      vat_rate: "0,19",
      vat_amount: "1,60",
      currency: "EUR",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.data?.vat_amount).toBe(1.6);
  });

  it("rejects a non-numeric vat_amount rather than silently deriving", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "X",
      date: "30-04-2026",
      product_name: "Widget",
      quantity: "1",
      unit_price: "7.99",
      total: "7.99",
      vat_rate: "0.19",
      vat_amount: "abc",
      currency: "EUR",
    }, 2);
    expect(row.error).toContain("vat_amount");
    expect(row.data).toBeNull();
  });
});

describe("classifySkip", () => {
  const amazon = IMPORT_FORMATS.amazon;
  const sale = {
    order_id: "X", date: "30-04-2026", product_name: "W",
    quantity: "1", unit_price: "7.99", total: "7.99",
    currency: "EUR", status: "SALE",
  };

  it("passes a SALE row through", () => {
    expect(classifySkip(amazon, sale)).toBeNull();
  });

  it("skips a wholly blank row", () => {
    expect(classifySkip(amazon, { order_id: "", date: "", product_name: "", quantity: "" }))
      .toBe("blank row");
  });

  // The real file's trailing row puts "Total" in the FIRST column
  // (UNIQUE_ACCOUNT_IDENTIFIER), which is not mapped to any canonical key, and
  // scatters two stray numbers across unmapped columns. So it is NOT blank and
  // its order_id IS empty — detect it by the required fields all being empty.
  it("skips the trailing Total summary row", () => {
    expect(classifySkip(amazon, {
      order_id: "", date: "", product_name: "", quantity: "", total: "4.46",
    })).toBe("summary row");
  });

  it("does not mistake a real row missing only its date for a summary row", () => {
    expect(classifySkip(amazon, { ...sale, date: "" })).toBeNull();
  });

  it.each(["RETURN", "FC_TRANSFER"])("skips %s rows", (status) => {
    expect(classifySkip(amazon, { ...sale, status })).toBe("not a sale");
  });

  it("skips an unsupported currency", () => {
    expect(classifySkip(amazon, { ...sale, currency: "SEK" })).toBe("unsupported currency");
  });

  it("never skips rows for the generic format", () => {
    expect(classifySkip(IMPORT_FORMATS.generic, { ...sale, status: "REFUND" })).toBeNull();
    expect(classifySkip(IMPORT_FORMATS.generic, { ...sale, currency: "SEK" })).toBeNull();
  });

  it("never skips a blank row for the generic format", () => {
    expect(classifySkip(IMPORT_FORMATS.generic, {
      date: "", product_name: "", quantity: "", unit_price: "",
    })).toBeNull();
  });

  it("still skips a blank row for the amazon format", () => {
    expect(classifySkip(IMPORT_FORMATS.amazon, {
      date: "", product_name: "", quantity: "", unit_price: "",
    })).toBe("blank row");
  });

  it("marks the row skipped rather than errored via validateRowForFormat", () => {
    const row = validateRowForFormat(amazon, { ...sale, currency: "SEK" }, 7);
    expect(row.error).toBeNull();
    expect(row.data).toBeNull();
    expect(row.skipped).toBe("unsupported currency");
  });
});

describe("Amazon REFUND rows", () => {
  // Order 304-8612000-9060321 from the April 2026 report. Note `date` is EMPTY
  // on a REFUND row, exactly as on a RETURN row.
  const refundRow = {
    order_id: "304-8612000-9060321",
    date: "",
    product_name: "Textilstifte",
    quantity: "1",
    sku: "K2T-PFM-024",
    status: "REFUND",
    unit_price: "-7.99",
    total: "-7.99",
    vat_amount: "0",
    currency: "EUR",
  };

  it("parses despite an empty date and negative amounts", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.error).toBeNull();
    expect(row.isRefund).toBe(true);
  });

  it("carries a POSITIVE magnitude, not the negative sheet value", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.refund?.amount).toBe(7.99);
    expect(row.refund?.vatAmount).toBe(0);
  });

  it("carries the match target and sku", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.refund?.externalOrderId).toBe("304-8612000-9060321");
    expect(row.refund?.platform).toBe("amazon");
    expect(row.sku).toBe("K2T-PFM-024");
  });

  it("produces no insertable data — a refund never becomes a row", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
    expect(row.data).toBeNull();
  });

  it("errors when the order_id is missing", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...refundRow, order_id: "" },
      2,
    );
    expect(row.error).toContain("order_id");
  });

  it("errors on a zero refund amount", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...refundRow, total: "0", unit_price: "0" },
      2,
    );
    expect(row.error).toContain("total");
  });

  it("is never classified as a summary row, even with product_name and quantity blank", () => {
    // A REFUND has no `date` by design. An export that also blanks
    // product_name and quantity would otherwise trip the structural
    // summary-row heuristic, and every refund would be dropped under a skip
    // reason with nothing to do with refunds.
    const bare = { ...refundRow, product_name: "", quantity: "" };
    expect(classifySkip(IMPORT_FORMATS.amazon, bare)).toBeNull();
    expect(validateRowForFormat(IMPORT_FORMATS.amazon, bare, 2).isRefund).toBe(true);
  });

  it("still applies the currency guard to a refund row", () => {
    // The summary-row carve-out is scoped to that one heuristic, not an early
    // return — a refund in an unsupported currency must still be skipped.
    expect(classifySkip(IMPORT_FORMATS.amazon, { ...refundRow, currency: "JPY" })).toBe(
      "unsupported currency",
    );
  });

  it("leaves vatAmount null when the column is absent", () => {
    const { vat_amount, ...noVat } = refundRow;
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, noVat, 2);
    expect(row.refund?.vatAmount).toBeNull();
  });

  // A SALE's total_amount holds the ITEM total only — shipping lives in
  // shipping_charged. The sheet's `total` is items + shipping, so the refund
  // must be split or every shipped order is over-deducted. 39 of 525 Amazon
  // rows in tenant_k2_textil carry shipping, up to €9.24.
  describe("item / shipping split", () => {
    it("splits a refund that includes shipping", () => {
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, unit_price: "-20.00", total: "-24.99" },
        2,
      );
      expect(row.refund?.amount).toBe(24.99);
      expect(row.refund?.itemAmount).toBe(20.0);
      expect(row.refund?.shippingAmount).toBe(4.99);
    });

    it("reports no shipping portion when the two columns agree", () => {
      const row = validateRowForFormat(IMPORT_FORMATS.amazon, refundRow, 2);
      expect(row.refund?.amount).toBe(7.99);
      expect(row.refund?.itemAmount).toBe(7.99);
      expect(row.refund?.shippingAmount).toBe(0);
    });

    // A blank column and an absent one take the identical path — both are
    // falsy after `?.trim()`.
    it("falls back to `total` for the item portion when unit_price is blank", () => {
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, unit_price: "" },
        2,
      );
      expect(row.refund?.amount).toBe(7.99);
      expect(row.refund?.itemAmount).toBe(7.99);
      expect(row.refund?.shippingAmount).toBe(0);
    });

    it("falls back to `unit_price` for the full amount when total is blank", () => {
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, total: "" },
        2,
      );
      expect(row.refund?.amount).toBe(7.99);
      expect(row.refund?.itemAmount).toBe(7.99);
      expect(row.refund?.shippingAmount).toBe(0);
    });

    // The fixture above has no shipping at all, which is why the blank-column
    // cases below need their own: with `shipping_charged` absent, backing the
    // item portion out of the activity value is indistinguishable from using
    // it raw.
    const withShipping = {
      ...refundRow,
      unit_price: "-20.00",
      total: "-24.99",
      shipping_charged: "-4.99",
    };

    it("backs the item portion out of `total` using shipping_charged when unit_price is blank", () => {
      // Reading `total` raw here would yield itemAmount 24.99 against a sale
      // whose total_amount is 20.00, and the refund would be wrongly rejected
      // as larger than its order.
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...withShipping, unit_price: "" },
        2,
      );
      expect(row.error).toBeNull();
      expect(row.refund?.amount).toBe(24.99);
      expect(row.refund?.itemAmount).toBe(20.0);
      expect(row.refund?.shippingAmount).toBe(4.99);
    });

    it("fails a row whose item portion exceeds the refund total", () => {
      // Previously passed both checks and wrote total_amount −24.99 while
      // recording refunded_amount 20.00 — a deduction that disagreed with its
      // own audit record.
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, unit_price: "-24.99", total: "-20.00" },
        2,
      );
      expect(row.error).toContain("item portion");
      expect(row.refund).toBeUndefined();
    });

    it("fails a row whose shipping portion exceeds the refund total", () => {
      // Backing out would give a negative item portion, which as a deduction
      // would INCREASE the order's total_amount.
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, unit_price: "", total: "-20.00", shipping_charged: "-24.99" },
        2,
      );
      expect(row.error).toContain("item portion");
      expect(row.refund).toBeUndefined();
    });

    it("prefers an explicit unit_price over backing out of shipping_charged", () => {
      const row = validateRowForFormat(IMPORT_FORMATS.amazon, withShipping, 2);
      expect(row.refund?.itemAmount).toBe(20.0);
      expect(row.refund?.shippingAmount).toBe(4.99);
    });

    it("handles German decimal commas on both columns", () => {
      const row = validateRowForFormat(
        IMPORT_FORMATS.amazon,
        { ...refundRow, unit_price: "-20,00", total: "-24,99" },
        2,
      );
      expect(row.refund?.itemAmount).toBe(20.0);
      expect(row.refund?.shippingAmount).toBe(4.99);
    });
  });
});

describe("RETURN and FC_TRANSFER are now noise", () => {
  it("skips a RETURN row with an empty date instead of erroring", () => {
    // This is the exact `Row 21: invalid or missing "date"` failure.
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "306-2809374-5735538",
      date: "",
      product_name: "Baumwolltasche",
      quantity: "1",
      sku: "100-CNC-2832-10P",
      status: "RETURN",
    }, 21);
    expect(row.error).toBeNull();
    expect(row.skipped).toBe("not a sale");
    expect(row.data).toBeNull();
  });

  it("still skips FC_TRANSFER", () => {
    expect(classifySkip(IMPORT_FORMATS.amazon, {
      order_id: "x", date: "28-04-2026", product_name: "W",
      quantity: "10", status: "FC_TRANSFER",
    })).toBe("not a sale");
  });

  it("no longer skips REFUND", () => {
    expect(classifySkip(IMPORT_FORMATS.amazon, {
      order_id: "x", date: "", product_name: "W",
      quantity: "1", status: "REFUND",
    })).toBeNull();
  });

  it("leaves a SALE row completely unaffected", () => {
    // The 20 Apr sale that the refund above belongs to. Regression guard: the
    // new branch sits in the middle of validateRowForFormat, so it must not
    // intercept anything that is not a REFUND.
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, {
      order_id: "304-8612000-9060321",
      date: "20-04-2026",
      product_name: "Textilstifte",
      quantity: "1",
      sku: "K2T-PFM-024",
      status: "SALE",
      unit_price: "8.05",
      total: "8.05",
    }, 2);
    expect(row.error).toBeNull();
    expect(row.isRefund).toBeUndefined();
    expect(row.data?.total_amount).toBe(8.05);
    expect(row.data?.date).toBe("2026-04-20");
  });

  it("still skips nothing for the generic format", () => {
    expect(classifySkip(IMPORT_FORMATS.generic, {
      order_id: "x", date: "", product_name: "W",
      quantity: "1", status: "RETURN",
    })).toBeNull();
  });
});

describe("normalizeStatus with SALE mapping", () => {
  it("SALE → delivered (Amazon VAT report is completed transactions only)", () => {
    expect(normalizeStatus("SALE")).toBe("delivered");
    expect(normalizeStatus("sale")).toBe("delivered");
    expect(normalizeStatus("Sale")).toBe("delivered");
  });
});

describe("validateRowForFormat honours the date order", () => {
  const amazonRow = {
    order_id: "028-5781430-5293162",
    date: "10-04-2026",
    product_name: "Textilstifte",
    quantity: "1",
    unit_price: "8.05",
    total: "8.05",
    currency: "EUR",
    status: "SALE",
  };

  it("defaults to day-first when no order is passed", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, amazonRow, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-04-10");
  });

  it("reads month-first when told to", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, amazonRow, 2, "mdy");
    expect(row.data?.date).toBe("2026-10-04");
  });

  it("errors when the month-first reading is impossible", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...amazonRow, date: "30-04-2026" },
      2,
      "mdy",
    );
    expect(row.error).toContain("date");
  });

  it("applies the order to the generic format too", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.generic,
      { date: "10-04-2026", product_name: "Widget", quantity: "1", unit_price: "9.99" },
      2,
      "mdy",
    );
    expect(row.data?.date).toBe("2026-10-04");
  });
});
