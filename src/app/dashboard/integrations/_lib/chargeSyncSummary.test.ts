import { chargeSyncSummary } from "./chargeSyncSummary";

describe("chargeSyncSummary", () => {
  it("is one sentence when nothing was skipped", () => {
    expect(chargeSyncSummary({ chargesImported: 3, ordersFeesFilled: 2 }))
      .toBe("3 new expenses, 2 orders got fees.");
  });

  it("singularises and mentions refund fee credits only when there are some", () => {
    expect(chargeSyncSummary({ chargesImported: 1, ordersFeesFilled: 1, refundCreditsImported: 1 }))
      .toBe("1 new expense, 1 order got fees, 1 refund fee credit.");
  });

  it("appends only the non-zero notes, using 'orders not imported yet' for unmatched", () => {
    const text = chargeSyncSummary({
      chargesImported: 0, ordersFeesFilled: 0, skippedCurrency: 2, skippedInvalid: 0,
      orderLinkedUnmatched: 4, currencyMismatch: 1, nonFeeCreditsSkipped: 0,
    });
    expect(text).toBe(
      "0 new expenses, 0 orders got fees. Not applied: 2 in an unsupported currency; 1 in a different currency from its order; 4 orders not imported yet."
    );
    expect(text).not.toContain("no usable amount");
  });

  it("lists every counter's note when all are set", () => {
    const text = chargeSyncSummary({
      skippedCurrency: 1, skippedInvalid: 1, nonFeeCreditsSkipped: 1, currencyMismatch: 1, ordersFeesNotWritten: 1,
      orderLinkedAlreadyFilled: 1, orderLinkedCreditsSkipped: 1, orderLinkedUnmatched: 1, refundCreditsSkipped: 1,
    });
    expect(text.split("; ")).toHaveLength(9);
  });
});
