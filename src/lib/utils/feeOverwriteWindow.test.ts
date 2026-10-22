import { overwriteFromBounds, parseOverwriteFrom } from "./feeOverwriteWindow";

const NOW = new Date("2026-10-22T10:30:00.000Z");

describe("overwriteFromBounds", () => {
  it("spans one day inside 36 months back through today, defaulting to 90 days back", () => {
    expect(overwriteFromBounds(NOW)).toEqual({ min: "2023-10-23", max: "2026-10-22", fallback: "2026-07-24" });
  });
});

describe("parseOverwriteFrom", () => {
  it("keeps the 90-day default when absent or blank", () => {
    const expected = { ok: true, from: "2026-07-24T10:30:00.000Z" };
    expect(parseOverwriteFrom(undefined, NOW)).toEqual(expected);
    expect(parseOverwriteFrom(null, NOW)).toEqual(expected);
    expect(parseOverwriteFrom("", NOW)).toEqual(expected);
  });

  it("starts a picked date at UTC midnight", () => {
    expect(parseOverwriteFrom("2026-05-01", NOW)).toEqual({ ok: true, from: "2026-05-01T00:00:00.000Z" });
  });

  it("accepts the bounds themselves", () => {
    expect(parseOverwriteFrom("2023-10-23", NOW).ok).toBe(true);
    expect(parseOverwriteFrom("2026-10-22", NOW).ok).toBe(true);
  });

  it("rejects dates outside eBay's 36-month window or in the future", () => {
    expect(parseOverwriteFrom("2023-10-22", NOW).ok).toBe(false);
    expect(parseOverwriteFrom("2026-10-23", NOW).ok).toBe(false);
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-5-1", "01.05.2026", "2026-02-30", 20260501, {}]) {
      expect(parseOverwriteFrom(bad, NOW).ok).toBe(false);
    }
  });
});
