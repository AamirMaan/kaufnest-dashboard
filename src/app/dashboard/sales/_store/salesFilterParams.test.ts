import { salesFilterParams } from "./salesFilterParams";
import { DEFAULT_SALES_FILTERS } from "@/lib/utils/filters";

describe("salesFilterParams", () => {
  it("maps default filters to all-null params", () => {
    expect(salesFilterParams(DEFAULT_SALES_FILTERS)).toEqual({
      p_from: null, p_to: null, p_platform: null, p_currency: null, p_status: null, p_pattern: null,
    });
  });

  it("passes through concrete filter values", () => {
    expect(
      salesFilterParams({
        preset: "custom", dateFrom: "2026-01-01", dateTo: "2026-03-31",
        platform: "ebay", currency: "EUR", status: "shipped", search: " mug ",
      })
    ).toEqual({
      p_from: "2026-01-01", p_to: "2026-03-31", p_platform: "ebay",
      p_currency: "EUR", p_status: "shipped", p_pattern: "%mug%",
    });
  });
});
