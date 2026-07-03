import { pageRangeLabel } from "./Pagination";

describe("pageRangeLabel", () => {
  it("page 1, size 50, total 127 → 'Showing 1–50 of 127'", () => {
    expect(pageRangeLabel(1, 50, 127)).toBe("Showing 1–50 of 127");
  });

  it("page 2, size 50, total 127 → 'Showing 51–100 of 127'", () => {
    expect(pageRangeLabel(2, 50, 127)).toBe("Showing 51–100 of 127");
  });

  it("page 3, size 50, total 127 → 'Showing 101–127 of 127' (last page partial)", () => {
    expect(pageRangeLabel(3, 50, 127)).toBe("Showing 101–127 of 127");
  });

  it("page 1, size 50, total 0 → 'Showing 0–0 of 0'", () => {
    expect(pageRangeLabel(1, 50, 0)).toBe("Showing 0–0 of 0");
  });
});
