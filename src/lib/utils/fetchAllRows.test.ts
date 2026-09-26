import { fetchAllRows, fetchAllRowsOrThrow } from "./fetchAllRows";

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
    // This fixture has total > cap, so fetchAllRows legitimately fires its
    // cap-reached warning — silence it so the suite's output stays clean.
    // (The warning itself is asserted in the "cap-reached warning" describe.)
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await fetchAllRows(fetchPage, 5000);

    expect(result).toHaveLength(5000);
    warnSpy.mockRestore();
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

  describe("fetchAllRows cap-reached warning", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("warns when the real row count exceeds the cap", async () => {
      const allRows = Array.from({ length: 6000 }, (_, i) => ({ id: i }));
      const fetchPage = serverCappedFetcher(allRows, 1000);

      await fetchAllRows(fetchPage, 5000);

      expect(warnSpy).toHaveBeenCalledWith("[fetchAllRows] cap reached", {
        cap: 5000,
        total: 6000,
      });
    });

    it("does not warn when the real row count is within the cap", async () => {
      const allRows = Array.from({ length: 1510 }, (_, i) => ({ id: i }));
      const fetchPage = serverCappedFetcher(allRows, 1000);

      await fetchAllRows(fetchPage, 5000);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

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

  it("rejects with the page error even after earlier pages succeeded (throw, not partial list)", async () => {
    const boom = new Error("boom on page 2");
    let call = 0;
    const fetchPage = async (from: number, to: number) => {
      call += 1;
      if (call === 2) {
        return { data: null, error: boom, count: null };
      }
      const width = to - from + 1;
      const data = Array.from({ length: width }, (_, i) => ({ id: from + i }));
      return { data, error: null, count: 1510 };
    };

    await expect(fetchAllRowsOrThrow(fetchPage, 5000)).rejects.toBe(boom);
  });
});

describe("fetchAllRows (unchanged behaviour)", () => {
  it("still stops quietly on a page error", async () => {
    const rows = await fetchAllRows(async () => ({ data: null, error: { message: "x" }, count: null }), 100);
    expect(rows).toEqual([]);
  });
});
