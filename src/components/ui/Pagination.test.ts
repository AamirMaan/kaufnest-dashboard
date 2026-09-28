import { pageNumbers, pageRangeLabel } from "./Pagination";

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

describe("pageNumbers", () => {
  it("lists every page when there are 7 or fewer", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 2)).toEqual([1, 2]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses the tail near the start", () => {
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
    expect(pageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
  });

  it("collapses the head near the end", () => {
    expect(pageNumbers(20, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
    expect(pageNumbers(17, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
  });

  it("collapses both sides in the middle, always 7 slots", () => {
    expect(pageNumbers(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(pageNumbers(5, 20)).toHaveLength(7);
  });
});
