import { computePending } from "./platformBalance";

describe("computePending", () => {
  it("subtracts the pre-summed transferred amount from balance", () => {
    expect(computePending(500, 200)).toBe(300);
  });

  it("returns a negative pending when more was transferred than earned", () => {
    expect(computePending(100, 150)).toBe(-50);
  });
});
