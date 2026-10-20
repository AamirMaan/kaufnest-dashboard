import { salesFilterParams, salesSummaryRpcArgs } from "./salesFilterParams";
import { DEFAULT_SALES_FILTERS } from "@/lib/utils/filters";

describe("salesFilterParams", () => {
  it("maps default filters to all-null params", () => {
    expect(salesFilterParams(DEFAULT_SALES_FILTERS)).toEqual({
      p_from: null, p_to: null, p_platform: null, p_currency: null, p_status: null, p_pattern: null, p_marketplace: null,
      p_connection_id: null, p_location_id: null,
    });
  });

  it("passes through concrete filter values", () => {
    expect(
      salesFilterParams({
        preset: "custom", dateFrom: "2026-01-01", dateTo: "2026-03-31",
        platform: "ebay", currency: "EUR", status: "shipped", search: " mug ", marketplace: "all", account: "all",
        location: "all",
      })
    ).toEqual({
      p_from: "2026-01-01", p_to: "2026-03-31", p_platform: "ebay",
      p_currency: "EUR", p_status: "shipped", p_pattern: "%mug%", p_marketplace: null, p_connection_id: null,
      p_location_id: null,
    });
  });

  it("maps the location filter to p_location_id", () => {
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, location: "all" }).p_location_id).toBeNull();
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, location: "loc-1" }).p_location_id).toBe("loc-1");
  });

  it("passes marketplace through, including the unknown sentinel", () => {
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, marketplace: "amazon.de" }).p_marketplace).toBe("amazon.de");
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, marketplace: "__unknown__" }).p_marketplace).toBe("__unknown__");
  });

  it("maps the account filter to p_connection_id", () => {
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "all" }).p_connection_id).toBeNull();
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "conn-1" }).p_connection_id).toBe("conn-1");
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "__unassigned__" }).p_connection_id).toBe("__unassigned__");
  });
});

describe("salesSummaryRpcArgs", () => {
  it("leaves p_connection_id out when no account filter is set (pre-056 7-arg function)", () => {
    expect(salesSummaryRpcArgs(DEFAULT_SALES_FILTERS)).not.toHaveProperty("p_connection_id");
  });

  it("sends p_connection_id when an account is picked", () => {
    expect(salesSummaryRpcArgs({ ...DEFAULT_SALES_FILTERS, account: "conn-1" }).p_connection_id).toBe("conn-1");
  });

  it("leaves p_location_id out when no location is set (pre-057 8-arg function)", () => {
    expect(salesSummaryRpcArgs(DEFAULT_SALES_FILTERS)).not.toHaveProperty("p_location_id");
  });

  it("sends p_location_id when a location is picked", () => {
    expect(salesSummaryRpcArgs({ ...DEFAULT_SALES_FILTERS, location: "loc-1" }).p_location_id).toBe("loc-1");
  });
});
