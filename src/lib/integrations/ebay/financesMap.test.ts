import {
  orderIdOf, orderChargeField, orderLinkedChargeFees, feeFieldFills,
  categoryForCharge, chargeToExpenseRow, feesByLineItem, fillEmptyFees, isAdFeeType,
  type EbayFinanceTransaction,
} from "./financesMap";

const money = (value: string, currency = "EUR") => ({ value, currency });
const ctx = { createdBy: "user-1", connectionId: "conn-1", accountLabel: "Main shop" };

function sale(lines: EbayFinanceTransaction["orderLineItems"]): EbayFinanceTransaction {
  return { transactionId: "t-sale", transactionType: "SALE", transactionDate: "2026-10-01T10:00:00.000Z", orderId: "12-345", orderLineItems: lines };
}

describe("isAdFeeType", () => {
  it.each(["AD_FEE", "PREMIUM_AD_FEES", "PROMOTED_LISTING_FEE"])("%s is advertising", (t) => {
    expect(isAdFeeType(t)).toBe(true);
  });
  it.each(["FINAL_VALUE_FEE", "INSERTION_FEE", "INTERNATIONAL_FEE", undefined])("%s is not", (t) => {
    expect(isAdFeeType(t)).toBe(false);
  });
});

describe("feesByLineItem", () => {
  it("keys by orderId:lineItemId and buckets ad vs platform fees, summing and rounding", () => {
    const map = feesByLineItem([
      sale([
        {
          lineItemId: "L1",
          marketplaceFees: [
            { feeType: "FINAL_VALUE_FEE", amount: money("1.11") },
            { feeType: "FINAL_VALUE_FEE_FIXED_PER_ORDER", amount: money("0.35") },
            { feeType: "AD_FEE", amount: money("0.80") },
          ],
        },
        { lineItemId: "L2", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: money("2.00") }] },
      ]),
    ]);
    expect(map.get("12-345:L1")).toEqual({ platformFee: 1.46, advertisingFee: 0.8 });
    expect(map.get("12-345:L2")).toEqual({ platformFee: 2, advertisingFee: null });
  });

  it("ignores non-SALE transactions and SALEs without an orderId", () => {
    const charge: EbayFinanceTransaction = { transactionId: "t1", transactionType: "NON_SALE_CHARGE", transactionDate: "2026-10-01T00:00:00Z" };
    const noOrder = { ...sale([{ lineItemId: "L1", marketplaceFees: [] }]), orderId: undefined };
    expect(feesByLineItem([charge, noOrder]).size).toBe(0);
  });
});

describe("categoryForCharge", () => {
  it("maps ad charges to advertising, labels to shipping, the rest to platform_fees", () => {
    const base = { transactionId: "t", transactionDate: "2026-10-01T00:00:00Z" };
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE" })).toBe("advertising");
    expect(categoryForCharge({ ...base, transactionType: "SHIPPING_LABEL" })).toBe("shipping");
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE" })).toBe("platform_fees");
    expect(categoryForCharge({ ...base, transactionType: "NON_SALE_CHARGE", feeType: "SUBSCRIPTION_FEE" })).toBe("platform_fees");
    expect(categoryForCharge({ ...base, transactionType: "CREDIT" })).toBe("platform_fees");
  });
});

describe("chargeToExpenseRow", () => {
  const charge: EbayFinanceTransaction = {
    transactionId: "abc123", transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE",
    transactionDate: "2026-10-03T08:15:00.000Z", bookingEntry: "DEBIT", amount: money("0.35"),
    transactionMemo: "Listing 1234",
  };

  it("builds a positive platform_fees expense with an ebay: external_ref", () => {
    expect(chargeToExpenseRow(charge, ctx)).toEqual({
      title: "eBay insertion fee", amount: 0.35, currency: "EUR", category: "platform_fees",
      vendor: "eBay", date: "2026-10-03", description: "Main shop — Listing 1234",
      created_by: "user-1", external_ref: "ebay:abc123", connection_id: "conn-1",
    });
  });

  it("stores a CREDIT booking as a negative amount", () => {
    const row = chargeToExpenseRow({ ...charge, bookingEntry: "CREDIT", amount: money("0.35") }, ctx);
    expect(row?.amount).toBe(-0.35);
  });

  it("titles labels and bare credits sensibly", () => {
    expect(chargeToExpenseRow({ ...charge, transactionType: "SHIPPING_LABEL", feeType: undefined }, ctx)?.title).toBe("eBay shipping label");
    expect(chargeToExpenseRow({ ...charge, transactionType: "CREDIT", feeType: undefined }, ctx)?.title).toBe("eBay credit");
  });

  it("returns null for an unsupported currency or a missing amount", () => {
    expect(chargeToExpenseRow({ ...charge, amount: money("1.00", "PLN") }, ctx)).toBeNull();
    expect(chargeToExpenseRow({ ...charge, amount: undefined }, ctx)).toBeNull();
  });
});

describe("fillEmptyFees", () => {
  it("fills only NULL fields and never overwrites a user value", () => {
    expect(fillEmptyFees({ platform_fee: null, advertising_fee: 1 }, { platformFee: 2, advertisingFee: 3 }))
      .toEqual({ platform_fee: 2 });
    expect(fillEmptyFees({ platform_fee: 0, advertising_fee: 5 }, { platformFee: 2, advertisingFee: 3 })).toBeNull();
  });
  it("returns null when eBay has nothing to add", () => {
    expect(fillEmptyFees({ platform_fee: null, advertising_fee: null }, { platformFee: null, advertisingFee: null })).toBeNull();
  });
});

describe("F3/F4 edge cases", () => {
  it("feesByLineItem ignores a fee entry with a missing or non-numeric amount", () => {
    const m = feesByLineItem([{
      transactionId: "s", transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z", orderId: "O",
      orderLineItems: [{ lineItemId: "L", marketplaceFees: [
        { feeType: "FINAL_VALUE_FEE" }, { feeType: "AD_FEE", amount: { value: "abc", currency: "EUR" } },
      ] }],
    }]);
    expect(m.get("O:L")).toEqual({ platformFee: null, advertisingFee: null });
  });

  it("a CREDIT transaction with no bookingEntry is stored negative", () => {
    const row = chargeToExpenseRow(
      { transactionId: "c", transactionType: "CREDIT", transactionDate: "2026-10-01T00:00:00Z", amount: { value: "2.00", currency: "EUR" } },
      { createdBy: "u", connectionId: null, accountLabel: "A" }
    );
    expect(row?.amount).toBe(-2);
  });
});

describe("order-linked charges", () => {
  const base = { transactionDate: "2026-10-01T00:00:00Z" };
  const linked = (id: string, over: Partial<EbayFinanceTransaction>): EbayFinanceTransaction => ({
    transactionId: id, transactionType: "NON_SALE_CHARGE", bookingEntry: "DEBIT", amount: { value: "1.00", currency: "EUR" },
    references: [{ referenceId: "O1", referenceType: "ORDER_ID" }], ...base, ...over,
  });

  it("orderIdOf finds an ORDER_ID reference only", () => {
    expect(orderIdOf(linked("a", {}))).toBe("O1");
    expect(orderIdOf(linked("a", { references: [{ referenceId: "X", referenceType: "LISTING_ID" }] }))).toBeNull();
    expect(orderIdOf(linked("a", { references: undefined }))).toBeNull();
  });

  it("orderChargeField maps ad fees, labels, everything else", () => {
    expect(orderChargeField(linked("a", { feeType: "AD_FEE" }))).toBe("advertising_fee");
    expect(orderChargeField(linked("a", { transactionType: "SHIPPING_LABEL" }))).toBe("shipping_cost");
    expect(orderChargeField(linked("a", { feeType: "INSERTION_FEE" }))).toBe("platform_fee");
  });

  it("sums per order+field, and counts order-linked credits instead of summing them", () => {
    const r = orderLinkedChargeFees([
      linked("a", { feeType: "INSERTION_FEE", amount: { value: "0.35", currency: "EUR" } }),
      linked("b", { feeType: "OTHER_FEE", amount: { value: "0.15", currency: "EUR" } }),
      linked("c", { transactionType: "SHIPPING_LABEL", amount: { value: "3.00", currency: "EUR" } }),
      linked("d", { bookingEntry: "CREDIT" }),
      linked("e", { transactionType: "CREDIT", bookingEntry: undefined }),
      linked("f", { references: [] }),
    ]);
    expect(r.fees.get("O1")).toEqual({ platform_fee: 0.5, shipping_cost: 3 });
    expect(r.creditsSkipped).toBe(2);
  });

  it("skips unsupported currencies and missing amounts, counting the currency skips", () => {
    const r = orderLinkedChargeFees([
      linked("a", { amount: { value: "1", currency: "PLN" } }),
      linked("b", { amount: undefined }),
    ]);
    expect(r.fees.size).toBe(0);
    expect(r.skippedCurrency).toBe(1);
  });
});

describe("feeFieldFills", () => {
  it("returns only the fields that are NULL on the sale and present in the fees", () => {
    expect(feeFieldFills(
      { platform_fee: null, advertising_fee: 2, shipping_cost: null },
      { platform_fee: 1, advertising_fee: 5, shipping_cost: null }
    )).toEqual([["platform_fee", 1]]);
  });
});
