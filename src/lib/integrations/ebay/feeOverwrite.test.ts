import { applyFeeOverwrites, computeFeeOverwrites, FeeOverwritePermissionError, loadOverwriteSales, type OverwriteSaleRow } from "./feeOverwrite";
import type { EbayFinanceTransaction } from "./financesMap";

const money = (value: string, currency = "EUR") => ({ value, currency });
const row = (external_order_id: string, o: Partial<OverwriteSaleRow> = {}): OverwriteSaleRow => ({
  id: `id-${external_order_id}`, external_order_id, currency: "EUR", date: "2026-10-01",
  platform_fee: null, advertising_fee: null, ...o,
});
const saleTxn = (orderId: string, lines: EbayFinanceTransaction["orderLineItems"]): EbayFinanceTransaction => ({
  transactionId: `s-${orderId}`, transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z", orderId, orderLineItems: lines,
});
const adCharge = (orderId: string, value: string, currency = "EUR"): EbayFinanceTransaction => ({
  transactionId: `ad-${orderId}-${value}`, transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE", bookingEntry: "DEBIT",
  transactionDate: "2026-10-02T00:00:00Z", amount: money(value, currency),
  references: [{ referenceId: orderId, referenceType: "ORDER_ID" }],
});
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

  it("ignores the order-linked ad fee when any line has a SALE ad fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O1:L2", { advertising_fee: 0.4 })],
      [saleTxn("O1", [{ lineItemId: "L1" }, { lineItemId: "L2", marketplaceFees: [{ feeType: "AD_FEE", amount: money("0.40") }] }]), adCharge("O1", "9.99")]
    );
    expect(r.changes).toEqual([]);
  });

  it("counts an order-linked ad fee in another currency as a mismatch", () => {
    const r = computeFeeOverwrites([row("O1:L1")], [adCharge("O1", "1.00", "GBP")]);
    expect(r.changes).toEqual([]);
    expect(r.currencyMismatch).toBe(1);
  });

  it("counts orders with eBay fees but no imported sale as notImported", () => {
    const r = computeFeeOverwrites([], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]), adCharge("O2", "1.00"), saleTxn("O3", [{ lineItemId: "L1" }])]);
    expect(r.notImported).toBe(2);
  });
});

function fakeClient(opts: { sales?: OverwriteSaleRow[]; updateRows?: (id: string) => number; updateError?: { code?: string; message: string } }) {
  const updates: { patch: unknown; filters: [string, string, unknown][] }[] = [];
  const likes: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)), error: null }),
          like: (_c: string, pattern: string) => ({
            order: () => ({
              limit: async (n: number) => {
                likes.push(pattern);
                const prefix = pattern.replace(/%$/, "");
                return { data: (opts.sales ?? []).filter((s) => s.external_order_id.startsWith(prefix)).sort((a, b) => a.external_order_id.localeCompare(b.external_order_id)).slice(0, n), error: null };
              },
            }),
          }),
        }),
      }),
      update: (patch: unknown) => {
        const filters: [string, string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
          is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
          select: () => {
            updates.push({ patch, filters });
            if (opts.updateError) return Promise.resolve({ data: null, error: opts.updateError });
            const id = filters.find(([op, c]) => op === "eq" && c === "id")?.[2] as string;
            const n = opts.updateRows ? opts.updateRows(id) : 1;
            return Promise.resolve({ data: Array.from({ length: n }, () => ({ id })), error: null });
          },
        };
        return q;
      },
    }),
  };
  return { client: client as never, updates, likes };
}

describe("loadOverwriteSales", () => {
  it("reads SALE lines by id and looks up only uncovered order-linked orders", async () => {
    const sales = [row("O1:L1"), row("O2:L2"), row("O2:L1")];
    const { client, likes } = fakeClient({ sales });
    const out = await loadOverwriteSales(client, [
      saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]),
      adCharge("O1", "0.50"),
      adCharge("O2", "0.50"),
    ]);
    expect(likes).toEqual(["O2:%"]);
    expect(out.map((r) => r.external_order_id).sort()).toEqual(["O1:L1", "O2:L1"]);
  });
});

describe("applyFeeOverwrites", () => {
  it("guards on the previewed value (eq) or emptiness (is null) and counts stale rows", async () => {
    const { client, updates } = fakeClient({ updateRows: (id) => (id === "s2" ? 0 : 1) });
    const r = await applyFeeOverwrites(client, [
      { saleId: "s1", field: "platform_fee", from: 2, to: 1.2 },
      { saleId: "s2", field: "advertising_fee", from: null, to: 0.5 },
    ]);
    expect(updates[0]).toEqual({ patch: { platform_fee: 1.2 }, filters: [["eq", "id", "s1"], ["eq", "platform", "ebay"], ["eq", "platform_fee", 2]] });
    expect(updates[1].filters).toContainEqual(["is", "advertising_fee", null]);
    expect(r).toEqual({ applied: [{ saleId: "s1", field: "platform_fee", from: 2, to: 1.2 }], staleSkipped: 1 });
  });

  it("maps 42501 to FeeOverwritePermissionError", async () => {
    const { client } = fakeClient({ updateError: { code: "42501", message: "denied" } });
    await expect(applyFeeOverwrites(client, [{ saleId: "s1", field: "platform_fee", from: 1, to: 2 }])).rejects.toBeInstanceOf(FeeOverwritePermissionError);
  });
});
