import { fxReviewReducer, isReviewComplete, resolveRowRate, type FxReviewState } from "./fxReviewState";

describe("fxReviewReducer", () => {
  it("init sets ecb mode for resolved currencies, manual for unresolved ones", () => {
    const state = fxReviewReducer(
      { entries: {} },
      { type: "init", currencies: ["SEK", "XYZ"], unresolvedCurrencies: ["XYZ"] }
    );
    expect(state.entries.SEK.mode).toBe("ecb");
    expect(state.entries.XYZ.mode).toBe("manual");
    expect(state.entries.XYZ.startedUnresolved).toBe(true);
  });

  it("ratesResolved populates ecbRatesByDate keyed by date, per currency", () => {
    let state = fxReviewReducer({ entries: {} }, { type: "init", currencies: ["SEK"], unresolvedCurrencies: [] });
    state = fxReviewReducer(state, {
      type: "ratesResolved",
      rates: { "SEK:2026-05-29": { rate: 0.0877, rateDate: "2026-05-29" } },
    });
    expect(state.entries.SEK.ecbRatesByDate["2026-05-29"]).toBe(0.0877);
  });

  it("setMode flips one currency without affecting others", () => {
    let state = fxReviewReducer({ entries: {} }, { type: "init", currencies: ["SEK", "PLN"], unresolvedCurrencies: [] });
    state = fxReviewReducer(state, { type: "setMode", currency: "SEK", mode: "manual" });
    expect(state.entries.SEK.mode).toBe("manual");
    expect(state.entries.PLN.mode).toBe("ecb");
  });
});

describe("isReviewComplete", () => {
  it("is false when a manual-mode currency has no rate typed yet", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "", startedUnresolved: true } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });

  it("is true when manual mode has a positive numeric rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0.0877", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(true);
  });

  it("is false when manual mode has a zero or negative rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });

  it("is true when ecb mode has at least one resolved rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-29": 0.0877 }, manualRate: "", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(true);
  });

  it("is false when ecb mode has no resolved rate at all", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: {}, manualRate: "", startedUnresolved: false } },
    };
    expect(isReviewComplete(state)).toBe(false);
  });
});

describe("resolveRowRate", () => {
  it("returns the exact-date ECB rate when present", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-29": 0.0877, "2026-05-30": 0.0878 }, manualRate: "", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.0877, rateDate: "2026-05-29" });
  });

  it("falls back to the first available date when the row's exact date is missing", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "ecb", ecbRatesByDate: { "2026-05-30": 0.0878 }, manualRate: "", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.0878, rateDate: "2026-05-30" });
  });

  it("applies the manual rate to any row date, dated as the row's own date", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "0.09", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toEqual({ rate: 0.09, rateDate: "2026-05-29" });
  });

  it("returns null for a currency with no entry at all", () => {
    expect(resolveRowRate("XYZ", "2026-05-29", { entries: {} })).toBeNull();
  });

  it("returns null for manual mode with an unparseable/non-positive rate", () => {
    const state: FxReviewState = {
      entries: { SEK: { currency: "SEK", mode: "manual", ecbRatesByDate: {}, manualRate: "abc", startedUnresolved: false } },
    };
    expect(resolveRowRate("SEK", "2026-05-29", state)).toBeNull();
  });
});
