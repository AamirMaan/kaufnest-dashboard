import { purchasesFilterParams } from "./purchasesFilterParams";

describe("purchasesFilterParams", () => {
  it("maps 'all' selections and blank search to null", () => {
    expect(
      purchasesFilterParams({ preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" })
    ).toEqual({ p_from: null, p_to: null, p_currency: null, p_pattern: null });
  });

  it("passes through concrete filter values", () => {
    expect(
      purchasesFilterParams({ preset: "custom", dateFrom: "2026-05-01", dateTo: "2026-05-31", currency: "GBP", search: "tape" })
    ).toEqual({ p_from: "2026-05-01", p_to: "2026-05-31", p_currency: "GBP", p_pattern: "%tape%" });
  });
});
