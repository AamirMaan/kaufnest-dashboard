import { accountScope, applyFeeOverwrites, computeFeeOverwrites, lineCounts, loadOverwriteSales, type OverwriteSaleRow } from "./feeOverwrite";
import type { EbayFinanceTransaction } from "./financesMap";

const money = (value: string, currency = "EUR") => ({ value, currency });
const row = (external_order_id: string, o: Partial<OverwriteSaleRow> = {}): OverwriteSaleRow => ({
  id: `id-${external_order_id}`, external_order_id, currency: "EUR", date: "2026-10-01",
  platform_fee: null, advertising_fee: null, ...o,
});
const saleTxn = (orderId: string, lines: EbayFinanceTransaction["orderLineItems"]): EbayFinanceTransaction => ({
  transactionId: `s-${orderId}`, transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z", orderId, orderLineItems: lines,
});
const orderCharge = (
  orderId: string, value: string, o: { currency?: string; feeType?: string; credit?: boolean; type?: string } = {}
): EbayFinanceTransaction => ({
  transactionId: `c-${orderId}-${value}-${o.feeType ?? "AD_FEE"}-${o.credit ? "cr" : "db"}`,
  transactionType: o.type ?? "NON_SALE_CHARGE", feeType: o.feeType ?? "AD_FEE", bookingEntry: o.credit ? "CREDIT" : "DEBIT",
  transactionDate: "2026-10-02T00:00:00Z", amount: money(value, o.currency ?? "EUR"),
  references: [{ referenceId: orderId, referenceType: "ORDER_ID" }],
});
const adCharge = (orderId: string, value: string, currency = "EUR") => orderCharge(orderId, value, { currency });
const fvf = (value: string, currency = "EUR") => ({ feeType: "FINAL_VALUE_FEE", amount: money(value, currency) });

describe("computeFeeOverwrites", () => {
  it("emits nothing when stored fees already match eBay (2 dp)", () => {
    const r = computeFeeOverwrites([row("O1:L1", { platform_fee: 1.2 })], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20")] }])]);
    expect(r.changes).toEqual([]);
  });

  it("emits current → eBay for a differing and an empty fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1", { platform_fee: 2 })],
      [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20"), { feeType: "AD_FEE", amount: money("0.50") }] }])]
    );
    expect(r.changes).toEqual([
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "platform_fee", from: 2, to: 1.2 },
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "advertising_fee", from: null, to: 0.5 },
    ]);
  });

  it("never proposes clearing a fee eBay has no value for", () => {
    const r = computeFeeOverwrites([row("O1:L1", { platform_fee: 1.2, advertising_fee: 3 })], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20")] }])]);
    expect(r.changes).toEqual([]);
  });

  it("counts a currency mismatch and a mixed-currency line instead of changing them", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O2:L1")],
      [
        saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00", "GBP")] }]),
        saleTxn("O2", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00"), fvf("1.00", "GBP")] }]),
      ]
    );
    expect(r.changes).toEqual([]);
    expect(r.currencyMismatch).toBe(2);
  });

  it("puts platform fees per line item on a multi-line order", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O1:L2")],
      [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }, { lineItemId: "L2", marketplaceFees: [fvf("2.00")] }])]
    );
    expect(r.changes.map((c) => [c.externalOrderId, c.field, c.to])).toEqual([["O1:L1", "platform_fee", 1], ["O1:L2", "platform_fee", 2]]);
  });

  it("puts an order-linked ad fee on the first line item only", () => {
    const r = computeFeeOverwrites([row("O1:L2"), row("O1:L1")], [adCharge("O1", "0.70"), adCharge("O1", "0.30")]);
    expect(r.changes).toEqual([
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "advertising_fee", from: null, to: 1 },
    ]);
  });

  it("nets order-linked ad fee credits, so a refunded ad fee becomes 0", () => {
    const r = computeFeeOverwrites([row("O1:L1", { advertising_fee: 1 })], [adCharge("O1", "1.00"), orderCharge("O1", "1.00", { credit: true })]);
    expect(r.changes.map((c) => [c.field, c.from, c.to])).toEqual([["advertising_fee", 1, 0]]);
  });

  it("ignores order-linked credits without a feeType", () => {
    const bare: EbayFinanceTransaction = { ...orderCharge("O1", "5.00", { credit: true, type: "CREDIT" }), feeType: undefined };
    const r = computeFeeOverwrites([row("O1:L1")], [adCharge("O1", "1.00"), bare]);
    expect(r.changes.map((c) => [c.field, c.to])).toEqual([["advertising_fee", 1]]);
  });

  it("adds order-linked platform charges to the first line's SALE platform fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1", { platform_fee: 1.5 }), row("O1:L2")],
      [
        saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20")] }, { lineItemId: "L2", marketplaceFees: [fvf("2.00")] }]),
        orderCharge("O1", "0.30", { feeType: "REGULATORY_OPERATING_FEE" }),
      ]
    );
    expect(r.changes.map((c) => [c.externalOrderId, c.field, c.to])).toEqual([["O1:L2", "platform_fee", 2]]);
  });

  it("proposes no platform fee from order-linked charges alone (SALE fees unknown)", () => {
    const r = computeFeeOverwrites([row("O1:L1", { platform_fee: 5 })], [orderCharge("O1", "0.30", { feeType: "REGULATORY_OPERATING_FEE" })]);
    expect(r.changes).toEqual([]);
  });

  it("ignores the order-linked ad fee when any line has a SALE ad fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O1:L2", { advertising_fee: 0.4 })],
      [saleTxn("O1", [{ lineItemId: "L1" }, { lineItemId: "L2", marketplaceFees: [{ feeType: "AD_FEE", amount: money("0.40") }] }]), adCharge("O1", "9.99")]
    );
    expect(r.changes).toEqual([]);
  });

  it("proposes nothing from a credit whose charge fell before the window", () => {
    const r = computeFeeOverwrites([row("O1:L1", { advertising_fee: 3 })], [orderCharge("O1", "2.00", { credit: true })]);
    expect(r.changes).toEqual([]);
    expect(r.notImported).toBe(0);
  });

  it("doesn't count an imported order with only order-linked platform charges as not imported", () => {
    const r = computeFeeOverwrites([], [orderCharge("O1", "0.30", { feeType: "REGULATORY_OPERATING_FEE" })]);
    expect(r.notImported).toBe(0);
  });

  it("counts an order-linked fee group in another currency as a mismatch", () => {
    const r = computeFeeOverwrites([row("O1:L1")], [adCharge("O1", "1.00", "GBP")]);
    expect(r.changes).toEqual([]);
    expect(r.currencyMismatch).toBe(1);
  });

  it("counts orders with eBay fees but no imported sale as notImported", () => {
    const r = computeFeeOverwrites([], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]), adCharge("O2", "1.00"), saleTxn("O3", [{ lineItemId: "L1" }])]);
    expect(r.notImported).toBe(2);
  });
});

type Recorded = { op: string; args: unknown[] };

/** Chainable fake: records every builder call; terminal calls resolve per `resolve`. */
function fakeClient(resolve: (calls: Recorded[]) => { data: unknown; error: { code?: string; message: string } | null }) {
  const queries: Recorded[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Recorded[] = [{ op: "from", args: [table] }];
      queries.push(calls);
      const q: Record<string, unknown> = {};
      for (const op of ["select", "update", "eq", "or", "is", "in", "like", "order"]) {
        q[op] = (...args: unknown[]) => { calls.push({ op, args }); return q; };
      }
      q.limit = (...args: unknown[]) => { calls.push({ op: "limit", args }); return Promise.resolve(resolve(calls)); };
      // .in(...) and update(...).select() are terminal in the code under test
      q.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(resolve(calls)).then(ok, err);
      return q;
    },
  };
  return { client: client as never, queries };
}
const arg = (calls: Recorded[], op: string, i = 0) => calls.find((c) => c.op === op)?.args[i];

describe("loadOverwriteSales", () => {
  it("scopes to the account, reads SALE lines by id and looks up only uncovered ad-fee orders", async () => {
    const sales = [row("O1:L1"), row("O2:L2"), row("O2:L1"), row("O3:L1")];
    const { client, queries } = fakeClient((calls) => {
      const ids = arg(calls, "in", 1) as string[] | undefined;
      if (ids) return { data: sales.filter((s) => ids.includes(s.external_order_id)), error: null };
      const prefix = String(arg(calls, "like", 1)).replace(/%$/, "");
      return { data: sales.filter((s) => s.external_order_id.startsWith(prefix)).sort((a, b) => a.external_order_id.localeCompare(b.external_order_id)).slice(0, 1), error: null };
    });
    const out = await loadOverwriteSales(client, [
      saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]),
      adCharge("O1", "0.50"),
      adCharge("O2", "0.50"),
      orderCharge("O3", "0.30", { feeType: "REGULATORY_OPERATING_FEE" }), // non-ad only: not looked up
    ], "conn-1");
    expect(queries.map((c) => arg(c, "like", 1)).filter(Boolean)).toEqual(["O2:%"]);
    expect(queries.every((c) => arg(c, "or") === accountScope("conn-1"))).toBe(true);
    expect(out.map((r) => r.external_order_id).sort()).toEqual(["O1:L1", "O2:L1"]);
  });
});

describe("applyFeeOverwrites", () => {
  const changes = [
    { saleId: "s1", field: "platform_fee" as const, from: 2, to: 1.2 },
    { saleId: "s2", field: "advertising_fee" as const, from: null, to: 0.5 },
    { saleId: "s3", field: "platform_fee" as const, from: 1, to: 3 },
  ];

  it("guards on the previewed value (eq) or emptiness (is null), scopes to the account, and splits applied/stale", async () => {
    const { client, queries } = fakeClient((calls) => {
      const id = calls.find((c) => c.op === "eq" && c.args[0] === "id")?.args[1];
      return { data: id === "s2" ? [] : [{ id }], error: null };
    });
    const r = await applyFeeOverwrites(client, changes, "conn-1");
    expect(queries[0].map((c) => [c.op, ...c.args])).toEqual([
      ["from", "sales"], ["update", { platform_fee: 1.2 }], ["eq", "id", "s1"], ["eq", "platform", "ebay"],
      ["or", accountScope("conn-1")], ["eq", "platform_fee", 2], ["select", "id"],
    ]);
    expect(queries[1].map((c) => [c.op, ...c.args])).toContainEqual(["is", "advertising_fee", null]);
    expect(r).toEqual({ applied: [changes[0], changes[2]], stale: [changes[1]], failed: 0, permissionDenied: false });
  });

  it("keeps going past errors and reports what was applied, failed and denied", async () => {
    const { client } = fakeClient((calls) => {
      const id = calls.find((c) => c.op === "eq" && c.args[0] === "id")?.args[1];
      if (id === "s1") return { data: null, error: { code: "42501", message: "denied" } };
      if (id === "s2") return { data: null, error: { message: "boom" } };
      return { data: [{ id }], error: null };
    });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await applyFeeOverwrites(client, changes, "conn-1");
    spy.mockRestore();
    expect(r).toEqual({ applied: [changes[2]], stale: [], failed: 2, permissionDenied: true });
  });
});

describe("lineCounts", () => {
  it("counts a line once: applied if any fee wrote, stale only if nothing did", () => {
    expect(lineCounts({
      applied: [{ saleId: "a", field: "platform_fee", from: null, to: 1 }, { saleId: "b", field: "platform_fee", from: null, to: 1 }],
      stale: [{ saleId: "a", field: "advertising_fee", from: null, to: 1 }, { saleId: "c", field: "platform_fee", from: 1, to: 2 }],
    })).toEqual({ applied: 2, stale: 1 });
  });
});
