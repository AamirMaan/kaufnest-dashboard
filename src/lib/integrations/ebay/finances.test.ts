import { generateKeyPairSync } from "crypto";
import { fetchFinanceTransactions, FinancesScopeError, FinancesSignatureError, FinancesTruncatedError, settleFinanceFetches } from "./finances";

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

  it("stops at the page cap: partial by default, FinancesTruncatedError when requireComplete", async () => {
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve(page(["x"], 1_000_000, 0))) as unknown as typeof fetch;

    expect(await fetchFinanceTransactions("tok", opts)).toHaveLength(50);
    await expect(fetchFinanceTransactions("tok", { ...opts, requireComplete: true })).rejects.toBeInstanceOf(FinancesTruncatedError);
  });

  it("throws FinancesScopeError on 403", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("insufficient scope") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.toBeInstanceOf(FinancesScopeError);
  });

  it("signs the request when a signing key is configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue(page(["a"], 1, 0));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { privateKey } = generateKeyPairSync("ed25519");

    await fetchFinanceTransactions("tok", { ...opts, signing: { privateKey, jwe: "the-jwe" } });

    const h = fetchMock.mock.calls[0][1].headers;
    expect(h["x-ebay-signature-key"]).toBe("the-jwe");
    expect(h["Signature-Input"]).toMatch(/^sig1=\("x-ebay-signature-key" "@method" "@path" "@authority"\);created=\d+$/);
    expect(h.Signature).toMatch(/^sig1=:.+:$/);
  });

  it("sends no signature headers when signing is not configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue(page(["a"], 1, 0));
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchFinanceTransactions("tok", { ...opts, signing: null });
    expect(fetchMock.mock.calls[0][1].headers["x-ebay-signature-key"]).toBeUndefined();
  });

  it.each([403, 400, 401])("throws FinancesSignatureError for a 215xxx signature error (HTTP %i), not a scope error", async (status) => {
    const body = JSON.stringify({ errors: [{ errorId: 215111, message: "Missing signature header" }] });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status, text: () => Promise.resolve(body) }) as unknown as typeof fetch;
    const err = await fetchFinanceTransactions("tok", { ...opts, signing: null }).catch((e) => e);
    expect(err).toBeInstanceOf(FinancesSignatureError);
    expect(err).not.toBeInstanceOf(FinancesScopeError);
  });

  it("keeps a 403 with a non-signature errorId (e.g. 1100 insufficient permissions) as a scope error", async () => {
    const body = JSON.stringify({ errors: [{ errorId: 1100, message: "Access denied" }] });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve(body) }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", { ...opts, signing: null })).rejects.toBeInstanceOf(FinancesScopeError);
  });

  it("throws a plain Error on other failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") }) as unknown as typeof fetch;
    await expect(fetchFinanceTransactions("tok", opts)).rejects.not.toBeInstanceOf(FinancesScopeError);
  });
});

describe("settleFinanceFetches", () => {
  const txn = { transactionId: "t1", transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z" };
  const ok = (v = [txn]): PromiseSettledResult<typeof v> => ({ status: "fulfilled", value: v });
  const fail = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

  it("keeps the fetch that succeeded when the other fails", () => {
    const r = settleFinanceFetches([ok(), fail(new Error("500"))]);
    expect(r.txns).toEqual([txn]);
    expect(r.error?.kind).toBe("other");
  });

  it("prefers an actionable error over a generic one, signature before scope", () => {
    expect(settleFinanceFetches([fail(new Error("500")), fail(new FinancesScopeError("x"))]).error?.kind).toBe("scope");
    expect(settleFinanceFetches([fail(new FinancesScopeError("x")), fail(new FinancesSignatureError("y"))]).error?.kind).toBe("signature");
  });

  it("reports no error when every fetch succeeded", () => {
    expect(settleFinanceFetches([ok(), ok([])])).toEqual({ txns: [txn], error: null });
  });
});
