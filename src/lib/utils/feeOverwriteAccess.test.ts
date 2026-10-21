import { canOverwriteEbayFees } from "./feeOverwriteAccess";

describe("canOverwriteEbayFees", () => {
  it("allows only super_admin", () => {
    expect(canOverwriteEbayFees("super_admin")).toBe(true);
    expect(canOverwriteEbayFees("admin")).toBe(false);
    expect(canOverwriteEbayFees("accountant")).toBe(false);
    expect(canOverwriteEbayFees(null)).toBe(false);
    expect(canOverwriteEbayFees(undefined)).toBe(false);
  });
});
