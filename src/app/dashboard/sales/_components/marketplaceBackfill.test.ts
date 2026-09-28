import { markExistingOrders, groupBackfills, type ExistingSaleRef } from "./marketplaceBackfill";
import type { ParsedRow } from "./importFormats";

const sale = (id: string, marketplace: string | null, extra: Partial<ParsedRow> = {}): ParsedRow => ({
  rowNum: 1,
  error: null,
  data: { platform: "amazon", external_order_id: id, marketplace } as ParsedRow["data"],
  ...extra,
});

const existing = (entries: [string, ExistingSaleRef][]) => new Map(entries);

describe("markExistingOrders", () => {
  it("marks a match as 'order already exists' and plans a backfill when the stored marketplace is null", () => {
    const [r] = markExistingOrders([sale("A", "amazon.de")], existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(r.skipped).toBe("order already exists");
    expect(r.backfill).toEqual({ saleId: "s1", marketplace: "amazon.de" });
  });

  it("never overwrites a stored marketplace", () => {
    const [r] = markExistingOrders([sale("A", "amazon.fr")], existing([["amazon:A", { id: "s1", marketplace: "amazon.de" }]]));
    expect(r.skipped).toBe("order already exists");
    expect(r.backfill).toBeUndefined();
  });

  it("no backfill when the file row has no marketplace", () => {
    const [r] = markExistingOrders([sale("A", null)], existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(r.backfill).toBeUndefined();
  });

  it("leaves new orders, refunds and already-skipped rows alone", () => {
    const rows = [
      sale("NEW", "amazon.de"),
      { ...sale("A", "amazon.de"), isRefund: true },
      sale("A", "amazon.de", { skipped: "duplicate in file" }),
    ];
    const out = markExistingOrders(rows, existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(out[0].skipped).toBeUndefined();
    expect(out[1]).toBe(rows[1]);
    expect(out[2].skipped).toBe("duplicate in file");
    expect(out[2].backfill).toBeUndefined();
  });
});

describe("groupBackfills", () => {
  it("groups sale ids by marketplace", () => {
    const rows: ParsedRow[] = [
      { rowNum: 1, error: null, data: null, backfill: { saleId: "s1", marketplace: "amazon.de" } },
      { rowNum: 2, error: null, data: null, backfill: { saleId: "s2", marketplace: "amazon.fr" } },
      { rowNum: 3, error: null, data: null, backfill: { saleId: "s3", marketplace: "amazon.de" } },
      { rowNum: 4, error: null, data: null },
    ];
    expect(groupBackfills(rows)).toEqual(new Map([["amazon.de", ["s1", "s3"]], ["amazon.fr", ["s2"]]]));
  });
});
