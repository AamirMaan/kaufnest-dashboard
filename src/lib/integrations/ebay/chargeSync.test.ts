import { applyFinanceTransactions, ChargeSyncPermissionError, ChargeSyncSchemaError, mapLimit, WRITE_CONCURRENCY } from "./chargeSync";
import type { EbayFinanceTransaction } from "./financesMap";

type Call = { table: string; op: string; args: unknown[] };
type SaleRow = {
  id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null;
  shipping_cost?: number | null; currency?: string; status?: string;
};

function fakeClient(opts: {
  upsertReturns?: { data: { id: string }[] | null; error: { code?: string; message: string } | null };
  sales?: SaleRow[];
  /** rows each guarded update returns (default: one row = written). */
  updateRows?: number;
}) {
  const calls: Call[] = [];
  const withNulls = (s: SaleRow) => ({ shipping_cost: null, currency: "EUR", status: "pending", ...s });
  /** Max concurrent order lookups seen (each resolves on a later tick). */
  const stats = { inFlight: 0, maxInFlight: 0 };
  const client = {
    from(table: string) {
      return {
        upsert: (...args: unknown[]) => { calls.push({ table, op: "upsert", args }); return { select: () => Promise.resolve(opts.upsertReturns ?? { data: [], error: null }) }; },
        select: () => ({
          eq: () => ({
            in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)).map(withNulls), error: null }),
            like: (_c: string, pattern: string) => ({
              order: () => ({
                limit: async (n: number) => {
                  calls.push({ table, op: "like", args: [pattern, n] });
                  stats.inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
                  await new Promise((r) => setTimeout(r, 1));
                  stats.inFlight--;
                  const prefix = pattern.replace(/%$/, "");
                  const hit = (opts.sales ?? []).filter((x) => x.external_order_id.startsWith(prefix)).sort((x, y) => x.external_order_id.localeCompare(y.external_order_id)).slice(0, n);
                  return { data: hit.map(withNulls), error: null };
                },
              }),
            }),
          }),
        }),
        update: (patch: unknown) => ({
          eq: (_c: string, id: string) => ({
            is: (col: string, val: unknown) => ({
              select: () => {
                calls.push({ table, op: "update", args: [patch, id, col, val] });
                const n = opts.updateRows ?? 1;
                return Promise.resolve({ data: Array.from({ length: n }, () => ({ id })), error: null });
              },
            }),
          }),
        }),
      };
    },
  };
  return { client: client as never, calls, stats };
}

const ctx = { createdBy: "u1", connectionId: "c1", accountLabel: "Shop" };
const charge = (id: string, currency = "EUR"): EbayFinanceTransaction => ({
  transactionId: id, transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE",
  transactionDate: "2026-10-02T00:00:00Z", bookingEntry: "DEBIT", amount: { value: "0.35", currency },
});
const saleTxn: EbayFinanceTransaction = {
  transactionId: "s1", transactionType: "SALE", transactionDate: "2026-10-02T00:00:00Z", orderId: "O1",
  orderLineItems: [{ lineItemId: "L1", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: { value: "1.20", currency: "EUR" } }] }],
};

describe("applyFinanceTransactions", () => {
  it("upserts charges with ignoreDuplicates on external_ref and counts new vs existing and skipped currency", async () => {
    const { client, calls } = fakeClient({ upsertReturns: { data: [{ id: "e1" }], error: null } });
    const r = await applyFinanceTransactions(client, [charge("a"), charge("b"), charge("c", "PLN")], ctx);
    const up = calls.find((c) => c.op === "upsert")!;
    expect((up.args[0] as unknown[]).length).toBe(2);
    expect(up.args[1]).toEqual({ onConflict: "external_ref", ignoreDuplicates: true });
    expect(r).toMatchObject({ chargesImported: 1, chargesAlreadyImported: 1, skippedCurrency: 1 });
  });

  it("fills only empty fees on matching eBay sales", async () => {
    const { client, calls } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }],
    });
    const r = await applyFinanceTransactions(client, [saleTxn], ctx);
    expect(calls.filter((c) => c.op === "update")).toEqual([{ table: "sales", op: "update", args: [{ platform_fee: 1.2 }, "sale-1", "platform_fee", null] }]);
    expect(r.ordersFeesFilled).toBe(1);
  });

  it("leaves a sale with a user-entered fee untouched", async () => {
    const { client, calls } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: 0.5, advertising_fee: null }],
    });
    const r = await applyFinanceTransactions(client, [saleTxn], ctx);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(r.ordersFeesFilled).toBe(0);
  });

  it("throws ChargeSyncPermissionError on an RLS 42501", async () => {
    const { client } = fakeClient({ upsertReturns: { data: null, error: { code: "42501", message: "denied" } } });
    await expect(applyFinanceTransactions(client, [charge("a")], ctx)).rejects.toBeInstanceOf(ChargeSyncPermissionError);
  });

  it("does not count a 0-row update as filled and reports it as not written", async () => {
    const { client } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }],
      updateRows: 0,
    });
    const r = await applyFinanceTransactions(client, [saleTxn], ctx);
    expect(r.ordersFeesFilled).toBe(0);
    expect(r.ordersFeesNotWritten).toBe(1);
  });

  it("guards every update with .is(field, null)", async () => {
    const { client, calls } = fakeClient({
      sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }],
    });
    await applyFinanceTransactions(client, [saleTxn], ctx);
    const up = calls.find((c) => c.op === "update")!;
    expect(up.args.slice(2)).toEqual(["platform_fee", null]);
  });

  it("maps PGRST204 / 42703 on the expenses upsert to ChargeSyncSchemaError", async () => {
    for (const code of ["PGRST204", "42703"]) {
      const { client } = fakeClient({ upsertReturns: { data: null, error: { code, message: "no column" } } });
      await expect(applyFinanceTransactions(client, [charge("a")], ctx)).rejects.toBeInstanceOf(ChargeSyncSchemaError);
    }
  });

  describe("order-linked charges", () => {
    const linked = (id: string, over: Partial<EbayFinanceTransaction> = {}): EbayFinanceTransaction => ({
      ...charge(id), references: [{ referenceId: "O1", referenceType: "ORDER_ID" }], ...over,
    });
    const sales: SaleRow[] = [
      { id: "s-b", external_order_id: "O1:L2", platform_fee: null, advertising_fee: null },
      { id: "s-a", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null },
    ];

    it("creates no expense; fills the first line item with the summed field, bounded by limit(1)", async () => {
      const { client, calls } = fakeClient({ sales });
      const r = await applyFinanceTransactions(client, [linked("a"), linked("b")], ctx);
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
      expect(calls.find((c) => c.op === "like")!.args).toEqual(["O1:%", 1]);
      const ups = calls.filter((c) => c.op === "update");
      expect(ups).toHaveLength(1);
      expect(ups[0].args).toEqual([{ platform_fee: 0.7 }, "s-a", "platform_fee", null]);
      expect(r.ordersFeesFilled).toBe(1);
      expect(r.chargesImported).toBe(0);
    });

    it("routes ad fees and shipping labels to their own columns", async () => {
      const { client, calls } = fakeClient({ sales });
      await applyFinanceTransactions(client, [linked("a", { feeType: "AD_FEE" }), linked("b", { transactionType: "SHIPPING_LABEL", feeType: undefined })], ctx);
      const cols = calls.filter((c) => c.op === "update").map((c) => c.args[2]).sort();
      expect(cols).toEqual(["advertising_fee", "shipping_cost"]);
    });

    it("skips and counts order-linked credits", async () => {
      const { client, calls } = fakeClient({ sales });
      const r = await applyFinanceTransactions(client, [linked("a", { bookingEntry: "CREDIT" })], ctx);
      expect(r.orderLinkedCreditsSkipped).toBe(1);
      expect(calls.some((c) => c.op === "update" || c.op === "upsert")).toBe(false);
    });

    it("counts charges for orders not in the dashboard as unmatched, with no expense", async () => {
      const { client, calls } = fakeClient({ sales: [] });
      const r = await applyFinanceTransactions(client, [linked("a")], ctx);
      expect(r.orderLinkedUnmatched).toBe(1);
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
    });

    it("does not overwrite an already-filled field", async () => {
      const { client, calls } = fakeClient({ sales: [{ id: "s-a", external_order_id: "O1:L1", platform_fee: 9, advertising_fee: null }] });
      const r = await applyFinanceTransactions(client, [linked("a")], ctx);
      expect(calls.some((c) => c.op === "update")).toBe(false);
      expect(r.ordersFeesFilled).toBe(0);
    });
  });
  describe("skip counters (P6/P7)", () => {
    it("counts a 0 amount as skippedInvalid and a non-fee CREDIT as nonFeeCreditsSkipped, apart from skippedCurrency", async () => {
      const { client, calls } = fakeClient({});
      const zero = { ...charge("z"), amount: { value: "0.00", currency: "EUR" } };
      const bareCredit: EbayFinanceTransaction = { transactionId: "cr", transactionType: "CREDIT", transactionDate: "2026-10-02T00:00:00Z", amount: { value: "5", currency: "EUR" } };
      const r = await applyFinanceTransactions(client, [zero, bareCredit, charge("p", "PLN")], ctx);
      expect(r).toMatchObject({ skippedInvalid: 1, nonFeeCreditsSkipped: 1, skippedCurrency: 1 });
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
    });
  });

  describe("currency checks (P2)", () => {
    it("step 2 fills only when the fee currency equals the sale currency", async () => {
      const { client, calls } = fakeClient({
        sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null, currency: "GBP" }],
      });
      const r = await applyFinanceTransactions(client, [saleTxn], ctx);
      expect(calls.some((c) => c.op === "update")).toBe(false);
      expect(r.currencyMismatch).toBe(1);
      expect(r.ordersFeesFilled).toBe(0);
    });

    it("step 2 counts a mixed-currency SALE line in currencyMismatch and writes nothing", async () => {
      const mixed: EbayFinanceTransaction = {
        ...saleTxn,
        orderLineItems: [{ lineItemId: "L1", marketplaceFees: [
          { feeType: "FINAL_VALUE_FEE", amount: { value: "1.20", currency: "EUR" } },
          { feeType: "FINAL_VALUE_FEE", amount: { value: "0.50", currency: "GBP" } },
        ] }],
      };
      const { client, calls } = fakeClient({
        sales: [{ id: "sale-1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }],
      });
      const r = await applyFinanceTransactions(client, [mixed], ctx);
      expect(calls.some((c) => c.op === "update")).toBe(false);
      expect(r.currencyMismatch).toBe(1);
    });

    it("step 3 keeps only the order-linked charges in the sale currency", async () => {
      const ref = [{ referenceId: "O1", referenceType: "ORDER_ID" }];
      const { client, calls } = fakeClient({
        sales: [{ id: "s-a", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null, currency: "EUR" }],
      });
      const r = await applyFinanceTransactions(client, [
        { ...charge("a"), references: ref },
        { ...charge("b", "GBP"), references: ref },
        { ...charge("c", "GBP"), references: ref },
      ], ctx);
      expect(calls.filter((c) => c.op === "update").map((c) => c.args[0])).toEqual([{ platform_fee: 0.35 }]);
      expect(r.currencyMismatch).toBe(2);
      expect(r.ordersFeesFilled).toBe(1);
    });
  });

  describe("order-linked counters (P3/P6)", () => {
    const ref = [{ referenceId: "O1", referenceType: "ORDER_ID" }];
    it("counts a field dropped because it is already filled", async () => {
      const { client } = fakeClient({ sales: [{ id: "s-a", external_order_id: "O1:L1", platform_fee: 9, advertising_fee: null }] });
      const r = await applyFinanceTransactions(client, [{ ...charge("a"), references: ref }, { ...charge("b"), references: ref }], ctx);
      expect(r.orderLinkedAlreadyFilled).toBe(1);
    });
    it("counts an order-linked charge with a missing or 0 amount as skippedInvalid", async () => {
      const { client, calls } = fakeClient({ sales: [{ id: "s-a", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }] });
      const r = await applyFinanceTransactions(client, [
        { ...charge("a"), references: ref, amount: undefined },
        { ...charge("b"), references: ref, amount: { value: "0", currency: "EUR" } },
      ], ctx);
      expect(r.skippedInvalid).toBe(2);
      expect(calls.some((c) => c.op === "update")).toBe(false);
    });
  });

  describe("refund fee credits (P4)", () => {
    const refund = (orderId: string, currency = "EUR"): EbayFinanceTransaction => ({
      transactionId: `r-${orderId}`, transactionType: "REFUND", transactionDate: "2026-10-05T00:00:00Z", orderId,
      orderLineItems: [{ lineItemId: "L1", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: { value: "-1.20", currency } }] }],
    });

    it("stores a negative platform_fees expense for a refund on a live sale, bounded by limit(1)", async () => {
      const { client, calls } = fakeClient({
        sales: [{ id: "s1", external_order_id: "O1:L1", platform_fee: 1.2, advertising_fee: null }],
        upsertReturns: { data: [{ id: "e1" }], error: null },
      });
      const r = await applyFinanceTransactions(client, [refund("O1")], ctx);
      expect(calls.find((c) => c.op === "like")!.args).toEqual(["O1:%", 1]);
      const up = calls.find((c) => c.op === "upsert")!;
      expect(up.args[0]).toEqual([expect.objectContaining({
        title: "eBay fee credit (refund)", amount: -1.2, category: "platform_fees", external_ref: "ebay:r-O1",
        description: "Shop — order O1",
      })]);
      expect(up.args[1]).toEqual({ onConflict: "external_ref", ignoreDuplicates: true });
      expect(r.refundCreditsImported).toBe(1);
      expect(r.refundCreditsSkipped).toBe(0);
    });

    it("skips refunds whose sale is returned, cancelled or not imported", async () => {
      const { client, calls } = fakeClient({ sales: [
        { id: "s1", external_order_id: "O1:L1", platform_fee: 1, advertising_fee: null, status: "returned" },
        { id: "s2", external_order_id: "O2:L1", platform_fee: 1, advertising_fee: null, status: "cancelled" },
      ] });
      const r = await applyFinanceTransactions(client, [refund("O1"), refund("O2"), refund("O3")], ctx);
      expect(r.refundCreditsSkipped).toBe(3);
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
    });

    it("skips and counts a refund whose sale has no recorded platform_fee", async () => {
      const { client, calls } = fakeClient({ sales: [{ id: "s1", external_order_id: "O1:L1", platform_fee: null, advertising_fee: null }] });
      const r = await applyFinanceTransactions(client, [refund("O1")], ctx);
      expect(r.refundCreditsSkipped).toBe(1);
      expect(r.refundCreditsImported).toBe(0);
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
    });

    it("skips a refund credit in another currency than the sale and counts currencyMismatch", async () => {
      const { client, calls } = fakeClient({ sales: [{ id: "s1", external_order_id: "O1:L1", platform_fee: 1, advertising_fee: null, currency: "GBP" }] });
      const r = await applyFinanceTransactions(client, [refund("O1", "EUR")], ctx);
      expect(r.currencyMismatch).toBe(1);
      expect(calls.some((c) => c.op === "upsert")).toBe(false);
    });
  });

  describe("bounded concurrency (P1)", () => {
    it("runs order lookups in parallel, never more than WRITE_CONCURRENCY at once, with exact counts", async () => {
      const n = 25;
      const sales: SaleRow[] = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, external_order_id: `O${i}:L1`, platform_fee: null, advertising_fee: null }));
      const txns = sales.map((s, i) => ({ ...charge(`c${i}`), references: [{ referenceId: `O${i}`, referenceType: "ORDER_ID" }] }));
      const { client, stats } = fakeClient({ sales });
      const r = await applyFinanceTransactions(client, txns, ctx);
      expect(stats.maxInFlight).toBeGreaterThan(1);
      expect(stats.maxInFlight).toBeLessThanOrEqual(WRITE_CONCURRENCY);
      expect(r.ordersFeesFilled).toBe(n);
    });
  });
});

describe("mapLimit", () => {
  it("preserves order and caps in-flight work at the limit", async () => {
    let inFlight = 0, max = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (x) => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, x));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(max).toBe(2);
  });

  it("starts no new item after one has failed", async () => {
    const started: number[] = [];
    await expect(mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
      started.push(x);
      await new Promise((r) => setTimeout(r, 1));
      if (x === 2) throw new Error("boom");
      return x;
    })).rejects.toThrow("boom");
    await new Promise((r) => setTimeout(r, 20));
    expect(started).not.toContain(5);
    expect(started).not.toContain(6);
  });

  it("handles an empty list and rejects when a task throws", async () => {
    expect(await mapLimit([], 10, async (x: number) => x)).toEqual([]);
    await expect(mapLimit([1, 2], 10, async (x) => { if (x === 2) throw new Error("boom"); return x; })).rejects.toThrow("boom");
  });
});
