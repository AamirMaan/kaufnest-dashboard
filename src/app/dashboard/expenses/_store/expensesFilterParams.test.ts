import { expensesFilterParams } from "./expensesFilterParams";

describe("expensesFilterParams", () => {
  it("maps 'all' selections and blank search to null", () => {
    expect(
      expensesFilterParams({ preset: "all", dateFrom: "", dateTo: "", category: "all", currency: "all", search: "" })
    ).toEqual({ p_from: null, p_to: null, p_category: null, p_currency: null, p_pattern: null });
  });

  it("passes through concrete filter values", () => {
    expect(
      expensesFilterParams({ preset: "custom", dateFrom: "2026-04-01", dateTo: "", category: "shipping", currency: "EUR", search: "DHL" })
    ).toEqual({ p_from: "2026-04-01", p_to: null, p_category: "shipping", p_currency: "EUR", p_pattern: "%DHL%" });
  });
});
