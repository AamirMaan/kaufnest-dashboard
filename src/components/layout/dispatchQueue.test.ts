import { dispatchBannerLines, shouldRequestFlush } from "./dispatchQueue";

describe("dispatchBannerLines", () => {
  it("pluralises and links each location", () => {
    expect(
      dispatchBannerLines([
        { location_id: "l1", location_name: "Berlin", open_count: 1 },
        { location_id: "l 2", location_name: "Hamburg", open_count: 3 },
      ])
    ).toEqual([
      { key: "l1", count: "1 order", location: "Berlin", href: "/dashboard/sales?location=l1" },
      { key: "l 2", count: "3 orders", location: "Hamburg", href: "/dashboard/sales?location=l%202" },
    ]);
  });

  it("drops zero-count rows", () => {
    expect(dispatchBannerLines([{ location_id: "l1", location_name: "Berlin", open_count: 0 }])).toEqual([]);
  });
});

describe("shouldRequestFlush", () => {
  it("flushes on mount (nothing flushed yet)", () => {
    expect(shouldRequestFlush(null, 0, true)).toBe(true);
  });

  it("does not re-flush on navigation when summaryVersion is unchanged", () => {
    expect(shouldRequestFlush(3, 3, true)).toBe(false);
  });

  it("flushes again after a sales write bumps summaryVersion", () => {
    expect(shouldRequestFlush(3, 4, true)).toBe(true);
  });

  it("never flushes for users without Orders view access", () => {
    expect(shouldRequestFlush(null, 0, false)).toBe(false);
    expect(shouldRequestFlush(3, 4, false)).toBe(false);
  });
});
