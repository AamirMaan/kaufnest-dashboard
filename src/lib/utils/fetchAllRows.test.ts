import { fetchAllRows, fetchAllRowsOrThrow } from "./fetchAllRows";

const pageOf = (from: number, to: number, total: number) =>
  Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ n: from + i }));

describe("fetchAllRowsOrThrow", () => {
  it("collects every page like fetchAllRows", async () => {
    const rows = await fetchAllRowsOrThrow(
      async (from, to) => ({ data: pageOf(from, to, 1500), error: null, count: 1500 }),
      5000,
    );
    expect(rows).toHaveLength(1500);
  });

  it("throws the page error instead of returning a partial list", async () => {
    const boom = { message: "permission denied" };
    await expect(
      fetchAllRowsOrThrow(async () => ({ data: null, error: boom, count: null }), 100),
    ).rejects.toBe(boom);
  });
});

describe("fetchAllRows (unchanged behaviour)", () => {
  it("still stops quietly on a page error", async () => {
    const rows = await fetchAllRows(async () => ({ data: null, error: { message: "x" }, count: null }), 100);
    expect(rows).toEqual([]);
  });
});
