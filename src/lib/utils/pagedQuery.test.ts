import { rangeFor, DEFAULT_PAGE_SIZE } from "./pagedQuery";

describe("rangeFor", () => {
  it("page 1, size 50 → [0, 49]", () => {
    expect(rangeFor({ page: 1, pageSize: 50 })).toEqual([0, 49]);
  });

  it("page 2, size 50 → [50, 99]", () => {
    expect(rangeFor({ page: 2, pageSize: 50 })).toEqual([50, 99]);
  });

  it("page 1, size 25 → [0, 24]", () => {
    expect(rangeFor({ page: 1, pageSize: 25 })).toEqual([0, 24]);
  });

  it("page 3, size 100 → [200, 299]", () => {
    expect(rangeFor({ page: 3, pageSize: 100 })).toEqual([200, 299]);
  });
});

describe("DEFAULT_PAGE_SIZE", () => {
  it("is 50", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });
});
