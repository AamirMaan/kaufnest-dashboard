import { fetchFinanceTransactions, FinancesScopeError } from "./finances";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const page = (ids: string[], total: number, offset: number) => ({
  ok: true, status: 200,
  json: () => Promise.resolve({
    total, offset, limit: 1000,
    transactions: ids.map((id) => ({ transactionId: id, transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z" })),
  }),
});

const opts = { from: "2026-07-23T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", types: ["SALE", "NON_SALE_CHARGE"], marketplaceId: "EBAY_DE" };

describe("fetchFinanceTransactions", () => {
  it("calls the apiz Finances endpoint with date+type filters and the marketplace header", async () => {
    const fetchMock = jest.fn().mockResolvedValue(page(["a"], 1, 0));
    global.fetch = fetchMock as unknown as typeof fetch;

    const txns = await fetchFinanceTransactions("tok", opts);

    expect(txns.map((t) => t.transactionId)).toEqual(["a"]);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://apiz.ebay.com/sell/finances/v1/transaction");
    expect(u.searchParams.get("filter")).toBe(
      "transactionDate:[2026-07-23T00:00:00.000Z..2026-10-21T00:00:00.000Z],transactionType:{SALE|NON_SALE_CHARGE}"
    );
    expect(u.searchParams.get("limit")).toBe("1000");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_DE");
  });

  it("follows offsets until total is reached", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(page(Array.from({ length: 1000 }, (_, i) => `a${i}`), 1500, 0))
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, (_, i) => `b${i}`), 1500, 1000));
    global.fetch = fetchMock as unknown as typeof fetch;

    const txns = await fetchFinanceTransactions("tok", opts);

    expect(txns).toHaveLength(1500);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("offset")).toBe("1000");
  });

  it("throws FinancesScopeError on 403", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("insufficient scope") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.toBeInstanceOf(FinancesScopeError);
  });

  it("throws a plain Error on other failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.not.toBeInstanceOf(FinancesScopeError);
  });
});
