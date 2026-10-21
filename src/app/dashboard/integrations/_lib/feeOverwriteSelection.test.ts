import { addApplyCounts, applyPayload, applySummary, batchChanges, groupOverwriteRows, previewSkipNote, type FeeChangeDto } from "./feeOverwriteSelection";

const c = (saleId: string, field: FeeChangeDto["field"], from: number | null, to: number): FeeChangeDto => ({
  saleId, externalOrderId: `${saleId}:L1`, currency: "EUR", date: "2026-10-01", field, from, to,
});

describe("groupOverwriteRows", () => {
  it("merges a sale's two field changes into one row, keeping first-seen order", () => {
    const rows = groupOverwriteRows([c("a", "platform_fee", 2, 1.2), c("b", "advertising_fee", null, 1), c("a", "advertising_fee", null, 0.5)]);
    expect(rows).toEqual([
      { saleId: "a", externalOrderId: "a:L1", currency: "EUR", date: "2026-10-01", platform_fee: { from: 2, to: 1.2 }, advertising_fee: { from: null, to: 0.5 } },
      { saleId: "b", externalOrderId: "b:L1", currency: "EUR", date: "2026-10-01", advertising_fee: { from: null, to: 1 } },
    ]);
  });
});

describe("applyPayload", () => {
  it("includes only selected rows, one change per changed field", () => {
    const rows = groupOverwriteRows([c("a", "platform_fee", 2, 1.2), c("a", "advertising_fee", null, 0.5), c("b", "platform_fee", 1, 3)]);
    expect(applyPayload("conn", rows, new Set(["a"]))).toEqual({
      connectionId: "conn",
      changes: [
        { saleId: "a", field: "platform_fee", from: 2, to: 1.2 },
        { saleId: "a", field: "advertising_fee", from: null, to: 0.5 },
      ],
    });
  });
});

describe("previewSkipNote", () => {
  it("is null when nothing was skipped", () => expect(previewSkipNote({ currencyMismatch: 0, notImported: 0 })).toBeNull());
  it("lists non-zero counts", () =>
    expect(previewSkipNote({ currencyMismatch: 1, notImported: 3 })).toBe("Not shown: 3 orders not imported yet, 1 fee in a different currency from its order."));
});

describe("applySummary", () => {
  it("reports updated and skipped orders", () => {
    expect(applySummary({ applied: 1, stale: 0 })).toBe("Updated fees on 1 order.");
    expect(applySummary({ applied: 4, stale: 2 })).toBe("Updated fees on 4 orders. 2 orders were skipped — changed since the preview, or you can't edit orders.");
  });
});

describe("batchChanges / addApplyCounts", () => {
  it("splits into request-sized batches", () => {
    expect(batchChanges([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batchChanges([], 2)).toEqual([]);
  });
  it("sums batch results, treating missing fields as 0", () => {
    expect(addApplyCounts({ applied: 1, stale: 2, failed: 0 }, { applied: 3, failed: 1 })).toEqual({ applied: 4, stale: 2, failed: 1 });
  });
});
