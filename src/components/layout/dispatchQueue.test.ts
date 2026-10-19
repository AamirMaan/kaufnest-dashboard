import { dispatchBannerLines } from "./dispatchQueue";

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
