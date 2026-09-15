import { fetchAllRows } from "./fetchAllRows";

function serverCappedFetcher<T>(allRows: T[], serverMaxRows: number) {
  return async (from: number, to: number) => {
    const requestedWidth = to - from + 1;
    const width = Math.min(requestedWidth, serverMaxRows);
    const data = allRows.slice(from, from + width);
    return { data, error: null, count: allRows.length };
  };
}

describe("fetchAllRows", () => {
  it("collects every row even when the server caps each page below the requested width", async () => {
    const allRows = Array.from({ length: 1510 }, (_, i) => ({ id: i }));
    const fetchPage = serverCappedFetcher(allRows, 1000);

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toHaveLength(1510);
    expect(result[0]).toEqual({ id: 0 });
    expect(result[1509]).toEqual({ id: 1509 });
  });

  it("stops at the overall cap even when more rows exist", async () => {
    const allRows = Array.from({ length: 6000 }, (_, i) => ({ id: i }));
    const fetchPage = serverCappedFetcher(allRows, 1000);

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toHaveLength(5000);
  });

  it("returns all rows in a single page when under both caps", async () => {
    const allRows = Array.from({ length: 42 }, (_, i) => ({ id: i }));
    const fetchPage = serverCappedFetcher(allRows, 1000);

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toHaveLength(42);
  });

  it("returns an empty array when there are no rows", async () => {
    const fetchPage = serverCappedFetcher<{ id: number }>([], 1000);

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toEqual([]);
  });

  it("returns whatever was accumulated so far if a later page errors", async () => {
    let call = 0;
    const fetchPage = async (from: number, to: number) => {
      call += 1;
      if (call === 2) {
        return { data: null, error: new Error("boom"), count: null };
      }
      const width = to - from + 1;
      const data = Array.from({ length: width }, (_, i) => ({ id: from + i }));
      return { data, error: null, count: 1510 };
    };

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toHaveLength(1000);
  });
});
