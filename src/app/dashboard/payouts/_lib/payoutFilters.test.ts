import { resolveDateBounds } from "@/lib/utils/filters";
import { DEFAULT_PAYOUT_FILTERS, isDefaultPayoutFilters, payoutFilterParams } from "./payoutFilters";

describe("payoutFilterParams", () => {
  it("maps the defaults to all-null params", () => {
    expect(payoutFilterParams(DEFAULT_PAYOUT_FILTERS)).toEqual({ from: null, to: null, platform: null, currency: null });
  });

  it("passes a specific platform and currency through", () => {
    const p = payoutFilterParams({ ...DEFAULT_PAYOUT_FILTERS, platform: "amazon", currency: "GBP" });
    expect(p.platform).toBe("amazon");
    expect(p.currency).toBe("GBP");
  });

  it("uses a custom range's bounds", () => {
    const f = { ...DEFAULT_PAYOUT_FILTERS, preset: "custom" as const, dateFrom: "2026-01-01", dateTo: "2026-03-31" };
    const p = payoutFilterParams(f);
    expect(p.from).toBe("2026-01-01");
    expect(p.to).toBe("2026-03-31");
  });

  it("resolves a preset the same way the other list pages do", () => {
    const f = { ...DEFAULT_PAYOUT_FILTERS, preset: "this_year" as const };
    const { from, to } = resolveDateBounds(f);
    expect(payoutFilterParams(f)).toMatchObject({ from, to });
    expect(from).not.toBeNull();
  });
});

describe("isDefaultPayoutFilters", () => {
  it("is true for the defaults", () => {
    expect(isDefaultPayoutFilters(DEFAULT_PAYOUT_FILTERS)).toBe(true);
  });
  it("is false once any filter is set", () => {
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, platform: "ebay" })).toBe(false);
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, currency: "USD" })).toBe(false);
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, preset: "this_month" })).toBe(false);
  });
});
