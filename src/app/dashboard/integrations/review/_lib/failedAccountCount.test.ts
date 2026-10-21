import { failedAccountCount } from "./failedAccountCount";

describe("failedAccountCount", () => {
  it("counts only errors, not warnings", () => {
    expect(failedAccountCount({ errors: { a: "x" }, warnings: { a: "w", b: "w" } })).toBe(1);
    expect(failedAccountCount({ warnings: { b: "w" } })).toBe(0);
    expect(failedAccountCount({})).toBe(0);
  });
});
