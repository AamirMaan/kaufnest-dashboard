import { applyFinanceTransactions, ChargeSyncPermissionError } from "./chargeSync";
import type { EbayFinanceTransaction } from "./financesMap";

type Call = { table: string; op: string; args: unknown[] };

function fakeClient(opts: {
  upsertReturns?: { data: { id: string }[] | null; error: { code?: string; message: string } | null };
  sales?: { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null }[];
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const q = {
        upsert: (...args: unknown[]) => { calls.push({ table, op: "upsert", args }); return { select: () => Promise.resolve(opts.upsertReturns ?? { data: [], error: null }) }; },
        select: () => ({
          eq: () => ({ in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)), error: null }) }),
        }),
        update: (patch: unknown) => ({ eq: (_c: string, id: string) => { calls.push({ table, op: "update", args: [patch, id] }); return Promise.resolve({ error: null }); } }),
      };
      return q;
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
    expect(calls.filter((c) => c.op === "update")).toEqual([{ table: "sales", op: "update", args: [{ platform_fee: 1.2 }, "sale-1"] }]);
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
});
