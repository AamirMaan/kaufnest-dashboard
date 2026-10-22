import { feeBreakdown } from "./feeBreakdown";

const fees = (shipping_cost: number | null, advertising_fee: number | null, platform_fee: number | null) => ({
  shipping_cost,
  advertising_fee,
  platform_fee,
});

describe("feeBreakdown", () => {
  it("returns null when every fee is null", () => {
    expect(feeBreakdown(fees(null, null, null))).toBeNull();
  });

  it("lists all three fees in a fixed order with their total", () => {
    expect(feeBreakdown(fees(4.99, 1.5, 3))).toEqual({
      lines: [
        { label: "Shipping", amount: 4.99 },
        { label: "Advertising", amount: 1.5 },
        { label: "Platform fee", amount: 3 },
      ],
      total: 9.49,
    });
  });

  it("keeps null fees as null lines and treats them as 0 in the total", () => {
    expect(feeBreakdown(fees(null, 2, null))).toEqual({
      lines: [
        { label: "Shipping", amount: null },
        { label: "Advertising", amount: 2 },
        { label: "Platform fee", amount: null },
      ],
      total: 2,
    });
  });

  it("treats an explicit 0 as a value, not missing", () => {
    expect(feeBreakdown(fees(0, null, null))?.total).toBe(0);
  });

  it("rounds the total to cents", () => {
    expect(feeBreakdown(fees(0.1, 0.2, null))?.total).toBe(0.3);
  });
});
