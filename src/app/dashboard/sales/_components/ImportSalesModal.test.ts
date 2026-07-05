import { IMPORT_FORMATS, validateRowForFormat, type ParsedRow } from "./importFormats";

/** Fee-field behavior is format-independent; these run against the generic format. */
function validateRow(raw: Record<string, string>, rowNum: number): ParsedRow {
  return validateRowForFormat(IMPORT_FORMATS.generic, raw, rowNum);
}

/** Minimal valid row — used as the base for every variant test. */
const BASE: Record<string, string> = {
  date: "2024-01-15",
  product_name: "Blue Widget",
  platform: "amazon",
  quantity: "5",
  unit_price: "9.99",
  currency: "EUR",
  vat_rate: "",
  status: "pending",
  description: "",
  shipping_cost: "",
  shipping_charged: "",
  advertising_fee: "",
};

function make(overrides: Record<string, string> = {}): Record<string, string> {
  return { ...BASE, ...overrides };
}

describe("validateRow — fee fields", () => {
  // ----- shipping_cost -----
  describe("shipping_cost", () => {
    it("blank → null (no error)", () => {
      const result = validateRow(make({ shipping_cost: "" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_cost).toBeNull();
    });

    it("missing key → null (no error)", () => {
      const row = { ...BASE };
      delete (row as Record<string, string>).shipping_cost;
      const result = validateRow(row, 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_cost).toBeNull();
    });

    it("valid positive number → number", () => {
      const result = validateRow(make({ shipping_cost: "3.50" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_cost).toBe(3.5);
    });

    it("zero → 0 (valid non-negative)", () => {
      const result = validateRow(make({ shipping_cost: "0" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_cost).toBe(0);
    });

    it("non-numeric string → row error", () => {
      const result = validateRow(make({ shipping_cost: "abc" }), 2);
      expect(result.error).toMatch(/shipping_cost/);
      expect(result.data).toBeNull();
    });

    it("negative value → row error", () => {
      const result = validateRow(make({ shipping_cost: "-1.00" }), 2);
      expect(result.error).toMatch(/shipping_cost/);
      expect(result.data).toBeNull();
    });
  });

  // ----- shipping_charged -----
  describe("shipping_charged", () => {
    it("blank → null (no error)", () => {
      const result = validateRow(make({ shipping_charged: "" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_charged).toBeNull();
    });

    it("valid positive number → number", () => {
      const result = validateRow(make({ shipping_charged: "5.00" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.shipping_charged).toBe(5);
    });

    it("non-numeric string → row error", () => {
      const result = validateRow(make({ shipping_charged: "free" }), 2);
      expect(result.error).toMatch(/shipping_charged/);
      expect(result.data).toBeNull();
    });

    it("negative value → row error", () => {
      const result = validateRow(make({ shipping_charged: "-0.01" }), 2);
      expect(result.error).toMatch(/shipping_charged/);
      expect(result.data).toBeNull();
    });
  });

  // ----- advertising_fee -----
  describe("advertising_fee", () => {
    it("blank → null (no error)", () => {
      const result = validateRow(make({ advertising_fee: "" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.advertising_fee).toBeNull();
    });

    it("valid positive number → number", () => {
      const result = validateRow(make({ advertising_fee: "1.25" }), 2);
      expect(result.error).toBeNull();
      expect(result.data?.advertising_fee).toBe(1.25);
    });

    it("non-numeric string → row error", () => {
      const result = validateRow(make({ advertising_fee: "N/A" }), 2);
      expect(result.error).toMatch(/advertising_fee/);
      expect(result.data).toBeNull();
    });

    it("negative value → row error", () => {
      const result = validateRow(make({ advertising_fee: "-2" }), 2);
      expect(result.error).toMatch(/advertising_fee/);
      expect(result.data).toBeNull();
    });
  });

  // ----- all three present together -----
  it("all three fee fields populated → correct values on data", () => {
    const result = validateRow(
      make({ shipping_cost: "2.00", shipping_charged: "4.50", advertising_fee: "0.75" }),
      2
    );
    expect(result.error).toBeNull();
    expect(result.data?.shipping_cost).toBe(2);
    expect(result.data?.shipping_charged).toBe(4.5);
    expect(result.data?.advertising_fee).toBe(0.75);
  });
});
