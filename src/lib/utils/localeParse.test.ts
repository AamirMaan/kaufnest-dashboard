import {
  parseLocaleNumber,
  parseFlexibleDate,
  detectDateOrder,
  firstAmbiguousDate,
  hasOrderSensitiveDate,
  parseLocaleRate,
} from "./localeParse";

describe("parseLocaleNumber", () => {
  it.each<[string, number]>([
    ["1.234,56", 1234.56], // German thousands + decimal comma
    ["9,99", 9.99], // decimal comma
    ["1,234.56", 1234.56], // English thousands + decimal point
    ["1.234", 1234], // German thousands (exact grouping)
    ["12.345.678", 12345678], // multiple German thousands groups
    ["1,234,567", 1234567], // multiple English thousands groups
    ["9.99", 9.99], // plain decimal point
    ["0,5", 0.5],
    ["-3,5", -3.5],
    ["+2,50", 2.5],
    ["€ 12,50", 12.5], // currency symbol + space
    ["$1,234.56", 1234.56],
    ["19", 19],
    ["0", 0],
    ["12,3456", 12.3456], // single comma is always decimal
  ])("%s → %d", (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });

  it.each<[string]>([
    [""],
    ["   "],
    ["abc"],
    ["N/A"],
    ["1.23.45"], // dots, not a grouping pattern
    ["1,23,45"], // commas, not a grouping pattern
  ])("unparseable %s → null", (input) => {
    expect(parseLocaleNumber(input)).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseLocaleNumber(undefined)).toBeNull();
  });
});

describe("parseFlexibleDate", () => {
  it.each<[string, string]>([
    ["2024-01-15", "2024-01-15"],
    ["15.01.2024", "2024-01-15"],
    ["1.2.2024", "2024-02-01"],
    ["15/01/2024", "2024-01-15"],
    ["26-03-2026", "2026-03-26"], // dash separator (DD-MM-YYYY)
    ["1-2-2024", "2024-02-01"],   // dash separator, single-digit day/month
    ["29.02.2024", "2024-02-29"], // leap year
  ])("%s → %s", (input, expected) => {
    expect(parseFlexibleDate(input)).toBe(expected);
  });

  it.each<[string]>([
    [""],
    ["not a date"],
    ["31.02.2024"], // no Feb 31
    ["29.02.2023"], // not a leap year
    ["15.01.24"], // two-digit year rejected (I7)
    ["2024-1-15"], // ISO must be zero-padded
    ["32.01.2024"],
    ["15.13.2024"],
  ])("invalid %s → null", (input) => {
    expect(parseFlexibleDate(input)).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseFlexibleDate(undefined)).toBeNull();
  });
});

describe("detectDateOrder", () => {
  it("proves day-first from a first field over 12", () => {
    // 30-04-2026 is real: it is in the April Amazon report.
    const d = detectDateOrder(["30-04-2026", "10-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("proves month-first from a second field over 12", () => {
    const d = detectDateOrder(["04/30/2026", "04/10/2026"]);
    expect(d.order).toBe("mdy");
    expect(d.confident).toBe(true);
  });

  it("reports ambiguity when every date reads both ways, defaulting to dmy", () => {
    const d = detectDateOrder(["10-04-2026", "05-06-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(false);
    expect(d.conflict).toBeUndefined();
  });

  it("reports an evidence conflict when the file proves both (same separator)", () => {
    const d = detectDateOrder(["30-04-2026", "04-30-2026"]);
    expect(d.confident).toBe(false);
    expect(d.conflict).toEqual({
      kind: "evidence",
      sampleA: "30-04-2026",
      sampleB: "04-30-2026",
    });
  });

  it("reports a separator conflict when the file mixes / and -, even with no per-value evidence conflict", () => {
    // This is the shape of the real incident file: Excel silently rewrote
    // the cells it could read as US dates (both fields ≤ 12) to "/", and
    // left the rest as "-" text. "04/09/2026" alone sets NO evidence (9 and
    // 4 are both valid as day or month), so an evidence-only check can never
    // catch it — the mismatched separators are the only signal.
    const d = detectDateOrder(["30-04-2026", "04/09/2026"]);
    expect(d.confident).toBe(false);
    expect(d.conflict).toEqual({
      kind: "separator",
      sampleA: "30-04-2026",
      sampleB: "04/09/2026",
    });
  });

  it("does not conflict when the separator is consistent and evidence agrees (dmy)", () => {
    const d = detectDateOrder(["30-04-2026", "10-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("does not conflict when the separator is consistent and evidence agrees (mdy)", () => {
    const d = detectDateOrder(["04/30/2026", "04/09/2026"]);
    expect(d.order).toBe("mdy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("ignores ISO dates entirely — they never cause a conflict", () => {
    const d = detectDateOrder(["2026-04-30", "2026-04-10", "30-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("ignores dot-separated dates — they are day-first by convention", () => {
    const d = detectDateOrder(["15.01.2024", "30.01.2024"]);
    expect(d.confident).toBe(false);
  });

  it("ignores blank and malformed values without throwing", () => {
    const d = detectDateOrder(["", "   ", "not a date", "10-4-26", "30-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
  });

  it("returns ambiguous for an empty list", () => {
    const d = detectDateOrder([]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(false);
  });
});

describe("firstAmbiguousDate", () => {
  it("returns the first separated date where neither field proves an order", () => {
    expect(firstAmbiguousDate(["2026-04-30", "10-04-2026", "30-04-2026"])).toBe("10-04-2026");
  });

  it("returns undefined when every value has evidence, is ISO, or is dot-separated", () => {
    expect(firstAmbiguousDate(["30-04-2026", "2026-04-10", "15.01.2024"])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(firstAmbiguousDate([])).toBeUndefined();
  });
});

describe("hasOrderSensitiveDate", () => {
  it("is true when a /- or --separated date is present", () => {
    expect(hasOrderSensitiveDate(["15.01.2024", "10-04-2026"])).toBe(true);
  });

  it("is false when every date is dot-separated or ISO", () => {
    expect(hasOrderSensitiveDate(["15.01.2024", "30.01.2024", "2026-04-10"])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(hasOrderSensitiveDate([])).toBe(false);
  });
});

describe("parseFlexibleDate with an explicit order", () => {
  it("defaults to day-first when no order is given", () => {
    expect(parseFlexibleDate("10-04-2026")).toBe("2026-04-10");
  });

  it("reads month-first when told to", () => {
    expect(parseFlexibleDate("10-04-2026", "mdy")).toBe("2026-10-04");
  });

  it("rejects an impossible month-first reading", () => {
    // 30 is not a month, so mdy has no valid interpretation.
    expect(parseFlexibleDate("30-04-2026", "mdy")).toBeNull();
  });

  it("keeps dot-separated dates day-first even under mdy", () => {
    expect(parseFlexibleDate("15.01.2024", "mdy")).toBe("2024-01-15");
  });

  it("leaves ISO untouched under either order", () => {
    expect(parseFlexibleDate("2026-04-10", "mdy")).toBe("2026-04-10");
    expect(parseFlexibleDate("2026-04-10", "dmy")).toBe("2026-04-10");
  });
});

describe("parseLocaleRate", () => {
  it("accepts a trailing percent sign", () => {
    expect(parseLocaleRate("19%")).toBe(19);
    expect(parseLocaleRate("19 %")).toBe(19);
  });

  it("still accepts a plain number and German decimals", () => {
    expect(parseLocaleRate("19")).toBe(19);
    expect(parseLocaleRate("7,5")).toBe(7.5);
  });

  it("returns null for blank or unparseable input", () => {
    expect(parseLocaleRate("")).toBeNull();
    expect(parseLocaleRate(undefined)).toBeNull();
    expect(parseLocaleRate("abc")).toBeNull();
  });
});
