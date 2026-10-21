import { applyFinanceTransactions, ChargeSyncPermissionError, ChargeSyncSchemaError } from "./chargeSync";
import type { EbayFinanceTransaction } from "./financesMap";

type Call = { table: string; op: string; args: unknown[] };
type SaleRow = { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null; shipping_cost?: number | null };

function fakeClient(opts: {
  upsertReturns?: { data: { id: string }[] | null; error: { code?: string; message: string } | null };
  sales?: SaleRow[];
  /** rows each guarded update returns (default: one row = written). */
  updateRows?: number;
}) {
  const calls: Call[] = [];
  const withNulls = (s: SaleRow) => ({ shipping_cost: null, ...s });
  const client = {
    from(table: string) {
      return {
        upsert: (...args: unknown[]) => { calls.push({ table, op: "upsert", args }); return { select: () => Promise.resolve(opts.upsertReturns ?? { data: [], error: null }) }; },
        select: () => ({
          eq: () => ({
            in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)).map(withNulls), error: null }),
            like: (_c: string, pattern: string) => ({
              order: () => ({
                limit: (n: number) => {
                  calls.push({ table, op: "like", args: [pattern, n] });
                  const prefix = pattern.replace(/%$/, "");
                  const hit = (opts.sales ?? []).filter((x) => x.external_order_id.startsWith(prefix)).sort((x, y) => x.external_order_id.localeCompare(y.external_order_id)).slice(0, n);
                  return Promise.resolve({ data: hit.map(withNulls), error: null });
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
  return { client: client as never, calls };
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
});
