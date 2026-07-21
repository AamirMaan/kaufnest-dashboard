import { generateListingSku } from "./generateSku";

describe("generateListingSku", () => {
  it("starts with KN followed by 12 alphanumeric characters", () => {
    const sku = generateListingSku();
    expect(sku).toMatch(/^KN[A-Za-z0-9]{12}$/);
  });

  it("contains no hyphens or special characters", () => {
    const sku = generateListingSku();
    expect(sku).not.toMatch(/[^A-Za-z0-9]/);
  });

  it("generates distinct SKUs across many calls", () => {
    const skus = new Set(Array.from({ length: 500 }, () => generateListingSku()));
    expect(skus.size).toBe(500);
  });
});
