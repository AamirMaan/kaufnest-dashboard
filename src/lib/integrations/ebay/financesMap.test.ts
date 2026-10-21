import {
  orderIdOf, orderChargeField, orderLinkedChargeFees, feeFieldFills,
  categoryForCharge, chargeToExpenseRow, feesByLineItem, isAdFeeType, refundFeeCredits, refundCreditToExpenseRow,
  prefillFeesFor, withOrderLinkedAdFees, type EbayFinanceTransaction, type ChargeExpenseRow, type LineItemFees,
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
    expect(map.get("12-345:L1")).toEqual({ platformFee: 1.46, advertisingFee: 0.8, currency: "EUR", mixedCurrency: false });
    expect(map.get("12-345:L2")).toEqual({ platformFee: 2, advertisingFee: null, currency: "EUR", mixedCurrency: false });
  });

  it("ignores non-SALE transactions and SALEs without an orderId", () => {
    const charge: EbayFinanceTransaction = { transactionId: "t1", transactionType: "NON_SALE_CHARGE", transactionDate: "2026-10-01T00:00:00Z" };
    const noOrder = { ...sale([{ lineItemId: "L1", marketplaceFees: [] }]), orderId: undefined };
    expect(feesByLineItem([charge, noOrder]).size).toBe(0);
  });

  it("returns null fees and currency for a line whose fees mix currencies (P2)", () => {
    const map = feesByLineItem([sale([{ lineItemId: "L1", marketplaceFees: [
      { feeType: "FINAL_VALUE_FEE", amount: money("1.00", "EUR") },
      { feeType: "AD_FEE", amount: money("0.50", "GBP") },
    ] }])]);
    expect(map.get("12-345:L1")).toEqual({ platformFee: null, advertisingFee: null, currency: null, mixedCurrency: true });
  });

  it("treats a 0-valued fee entry as missing (P6)", () => {
    const map = feesByLineItem([sale([{ lineItemId: "L1", marketplaceFees: [
      { feeType: "FINAL_VALUE_FEE", amount: money("0.00") },
      { feeType: "AD_FEE", amount: money("0.40") },
    ] }])]);
    expect(map.get("12-345:L1")).toEqual({ platformFee: null, advertisingFee: 0.4, currency: "EUR", mixedCurrency: false });
  });
});

describe("prefillFeesFor (P1/P2)", () => {
  const fees = { platformFee: 1, advertisingFee: null, currency: "EUR", mixedCurrency: false };
  it("attaches fees only to a not-yet-imported order in the same currency", () => {
    expect(prefillFeesFor(fees, { currency: "EUR", imported: false })).toBe(fees);
    expect(prefillFeesFor(fees, { currency: "GBP", imported: false })).toBeUndefined();
    expect(prefillFeesFor(fees, { currency: "EUR", imported: true })).toBeUndefined();
    expect(prefillFeesFor({ ...fees, currency: null }, { currency: "EUR", imported: false })).toBeUndefined();
    expect(prefillFeesFor({ ...fees, platformFee: null, currency: null, mixedCurrency: true }, { currency: "EUR", imported: false })).toBeUndefined();
    expect(prefillFeesFor(undefined, { currency: "EUR", imported: false })).toBeUndefined();
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

  const rowOf = (t: EbayFinanceTransaction): ChargeExpenseRow | null => {
    const r = chargeToExpenseRow(t, ctx);
    return r.ok ? r.row : null;
  };

  it("builds a positive platform_fees expense with an ebay: external_ref", () => {
    expect(chargeToExpenseRow(charge, ctx)).toEqual({ ok: true, row: {
      title: "eBay insertion fee", amount: 0.35, currency: "EUR", category: "platform_fees",
      vendor: "eBay", date: "2026-10-03", description: "Main shop — Listing 1234",
      created_by: "user-1", external_ref: "ebay:abc123", connection_id: "conn-1",
    } });
  });

  it("stores a CREDIT booking as a negative amount", () => {
    expect(rowOf({ ...charge, bookingEntry: "CREDIT", amount: money("0.35") })?.amount).toBe(-0.35);
  });

  it("titles labels and fee credits sensibly", () => {
    expect(rowOf({ ...charge, transactionType: "SHIPPING_LABEL", feeType: undefined })?.title).toBe("eBay shipping label");
    expect(rowOf({ ...charge, transactionType: "CREDIT", feeType: "INSERTION_FEE" })?.title).toBe("eBay insertion fee credit");
  });

  it("separates an unsupported currency from a missing, non-finite or 0 amount (P6)", () => {
    expect(chargeToExpenseRow({ ...charge, amount: money("1.00", "PLN") }, ctx)).toEqual({ ok: false, reason: "currency" });
    expect(chargeToExpenseRow({ ...charge, amount: undefined }, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(chargeToExpenseRow({ ...charge, amount: money("abc") }, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(chargeToExpenseRow({ ...charge, amount: money("0.00") }, ctx)).toEqual({ ok: false, reason: "invalid" });
  });

  it("imports a CREDIT transaction only when it carries a feeType (P7)", () => {
    const credit: EbayFinanceTransaction = {
      transactionId: "cr", transactionType: "CREDIT", transactionDate: "2026-10-03T00:00:00Z", amount: money("2.00"),
    };
    expect(chargeToExpenseRow(credit, ctx)).toEqual({ ok: false, reason: "nonFeeCredit" });
    expect(chargeToExpenseRow({ ...credit, bookingEntry: "CREDIT" }, ctx)).toEqual({ ok: false, reason: "nonFeeCredit" });
    expect(rowOf({ ...credit, feeType: "FINAL_VALUE_FEE" })?.amount).toBe(-2);
  });

  it("still imports a NON_SALE_CHARGE / SHIPPING_LABEL with bookingEntry CREDIT as negative (P7)", () => {
    expect(rowOf({ ...charge, feeType: undefined, bookingEntry: "CREDIT" })?.amount).toBe(-0.35);
    expect(rowOf({ ...charge, transactionType: "SHIPPING_LABEL", feeType: undefined, bookingEntry: "CREDIT" })?.amount).toBe(-0.35);
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
    expect(m.get("O:L")).toEqual({ platformFee: null, advertisingFee: null, currency: null, mixedCurrency: false });
  });

  it("a fee-CREDIT transaction with no bookingEntry is stored negative", () => {
    const r = chargeToExpenseRow(
      { transactionId: "c", transactionType: "CREDIT", feeType: "INSERTION_FEE", transactionDate: "2026-10-01T00:00:00Z", amount: { value: "2.00", currency: "EUR" } },
      { createdBy: "u", connectionId: null, accountLabel: "A" }
    );
    expect(r.ok && r.row.amount).toBe(-2);
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
    expect(r.fees.get("O1")?.get("EUR")).toEqual({ fields: { platform_fee: 0.5, shipping_cost: 3 }, charges: 3 });
    expect(r.creditsSkipped).toBe(2);
  });

  it("aggregates per order and currency, never mixing currencies (P2)", () => {
    const r = orderLinkedChargeFees([
      linked("a", { amount: { value: "1.00", currency: "EUR" } }),
      linked("b", { amount: { value: "2.00", currency: "GBP" } }),
      linked("c", { amount: { value: "0.50", currency: "GBP" } }),
    ]);
    expect(r.fees.get("O1")?.get("EUR")).toEqual({ fields: { platform_fee: 1 }, charges: 1 });
    expect(r.fees.get("O1")?.get("GBP")).toEqual({ fields: { platform_fee: 2.5 }, charges: 2 });
  });

  it("counts unsupported currencies as skippedCurrency and missing / non-finite / 0 amounts as skippedInvalid (P6)", () => {
    const r = orderLinkedChargeFees([
      linked("a", { amount: { value: "1", currency: "PLN" } }),
      linked("b", { amount: undefined }),
      linked("c", { amount: { value: "abc", currency: "EUR" } }),
      linked("d", { amount: { value: "0", currency: "EUR" } }),
    ]);
    expect(r.fees.size).toBe(0);
    expect(r.skippedCurrency).toBe(1);
    expect(r.skippedInvalid).toBe(3);
  });
});

describe("withOrderLinkedAdFees", () => {
  const adCharge = (id: string, orderId: string, value: string, currency = "EUR"): EbayFinanceTransaction => ({
    transactionId: id, transactionType: "NON_SALE_CHARGE", bookingEntry: "DEBIT", feeType: "AD_FEE",
    transactionDate: "2026-10-18T12:00:00Z", amount: { value, currency },
    references: [{ referenceId: orderId, referenceType: "ORDER_ID" }, { referenceId: "123", referenceType: "ITEM_ID" }],
  });
  const fvf: LineItemFees = { platformFee: 3.11, advertisingFee: null, currency: "EUR", mixedCurrency: false };

  const eur = (id: string, imported = false) => ({ external_order_id: id, currency: "EUR", imported });

  it("adds the order's ad fee next to the SALE's platform fee (Anzeigengebühr Basis)", () => {
    const fees = new Map<string, LineItemFees>([["25-1:L1", fvf]]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L1")], [adCharge("a", "25-1", "-1.93")]);
    expect(out.get("25-1:L1")).toEqual({ platformFee: 3.11, advertisingFee: 1.93, currency: "EUR", mixedCurrency: false });
    expect(fees.get("25-1:L1")?.advertisingFee).toBeNull(); // input not mutated
  });

  it("sums the order's ad charges onto its first line item only", () => {
    const fees = new Map<string, LineItemFees>([["25-1:L2", fvf], ["25-1:L1", fvf]]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L2"), eur("25-1:L1")], [adCharge("a", "25-1", "1.00"), adCharge("b", "25-1", "0.25")]);
    expect(out.get("25-1:L1")?.advertisingFee).toBe(1.25);
    expect(out.get("25-1:L2")?.advertisingFee).toBeNull();
  });

  it("keeps an ad fee the SALE already reports (fill-only-NULL, like sync)", () => {
    const fees = new Map<string, LineItemFees>([["25-1:L1", { ...fvf, advertisingFee: 0.5 }]]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L1")], [adCharge("a", "25-1", "1.00")]);
    expect(out.get("25-1:L1")?.advertisingFee).toBe(0.5);
  });

  it("keeps a SALE ad fee on another line of the order instead of adding the charge", () => {
    const fees = new Map<string, LineItemFees>([["25-1:L1", fvf], ["25-1:L2", { ...fvf, advertisingFee: 1 }]]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L1"), eur("25-1:L2")], [adCharge("a", "25-1", "1.00")]);
    expect(out.get("25-1:L1")?.advertisingFee).toBeNull();
    expect(out.get("25-1:L2")?.advertisingFee).toBe(1);
  });

  it("ignores a SALE ad fee in another currency (prefillFeesFor drops it anyway)", () => {
    const fees = new Map<string, LineItemFees>([["25-1:L2", { ...fvf, advertisingFee: 1, currency: "GBP" }]]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L1"), eur("25-1:L2")], [adCharge("a", "25-1", "1.00")]);
    expect(out.get("25-1:L1")?.advertisingFee).toBe(1);
  });

  it("does not apply ad fee credits, like chargeSync's orderLinkedChargeFees", () => {
    const out = withOrderLinkedAdFees(new Map(), [eur("25-1:L1")], [
      adCharge("a", "25-1", "2.00"), { ...adCharge("b", "25-1", "0.50"), bookingEntry: "CREDIT" },
    ]);
    expect(out.get("25-1:L1")?.advertisingFee).toBe(2);
  });

  it("uses the order's currency: prefills with no SALE fees yet, ignores charges in other currencies", () => {
    const out = withOrderLinkedAdFees(new Map(), [eur("25-1:L1")], [adCharge("a", "25-1", "2.00"), adCharge("b", "25-1", "9.00", "GBP")]);
    expect(out.get("25-1:L1")).toEqual({ platformFee: null, advertisingFee: 2, currency: "EUR", mixedCurrency: false });
  });

  it("skips an order with any line already imported (sync fills its first imported line)", () => {
    const out = withOrderLinkedAdFees(new Map(), [eur("25-1:L1"), eur("25-1:L2", true)], [adCharge("a", "25-1", "1.00")]);
    expect(out.size).toBe(0);
  });

  it("skips mixed or other-currency lines, unknown orders, malformed keys and non-ad charges", () => {
    const fees = new Map<string, LineItemFees>([
      ["25-1:L1", { ...fvf, currency: "GBP" }],
      ["25-2:L1", { platformFee: null, advertisingFee: null, currency: null, mixedCurrency: true }],
    ]);
    const out = withOrderLinkedAdFees(fees, [eur("25-1:L1"), eur("25-2:L1"), eur("25-3:L1"), eur("25-4")], [
      adCharge("a", "25-1", "1.00"),
      adCharge("b", "25-2", "1.00"),
      adCharge("c", "99-9", "1.00"),
      { ...adCharge("d", "25-3", "1.00"), feeType: "INSERTION_FEE" },
      adCharge("e", "25-4", "1.00"), adCharge("f", "25-", "1.00"),
    ]);
    expect(out.get("25-1:L1")?.advertisingFee).toBeNull();
    expect(out.get("25-2:L1")?.mixedCurrency).toBe(true);
    expect(out.size).toBe(2);
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

describe("refundFeeCredits (P4)", () => {
  const refund = (over: Partial<EbayFinanceTransaction> = {}): EbayFinanceTransaction => ({
    transactionId: "r1", transactionType: "REFUND", transactionDate: "2026-10-05T09:00:00Z", orderId: "O1",
    orderLineItems: [
      { lineItemId: "L1", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: money("-1.10") }, { feeType: "AD_FEE", amount: money("0.40") }] },
      { lineItemId: "L2", marketplaceFees: [{ feeType: "FINAL_VALUE_FEE", amount: money("0.50") }, { feeType: "X", amount: money("0") }] },
    ],
    ...over,
  });

  it("sums the absolute marketplaceFees of each REFUND transaction", () => {
    expect(refundFeeCredits([refund()])).toEqual([
      { orderId: "O1", transactionId: "r1", amount: 2, currency: "EUR", date: "2026-10-05" },
    ]);
  });

  it("ignores non-REFUND transactions, refunds with no order, and refunds with no fee credit", () => {
    expect(refundFeeCredits([
      refund({ transactionType: "SALE" }),
      refund({ orderId: undefined }),
      refund({ orderLineItems: [{ lineItemId: "L1", marketplaceFees: [] }] }),
    ])).toEqual([]);
  });

  it("falls back to an ORDER_ID reference and returns a null currency when fees mix currencies", () => {
    const [c] = refundFeeCredits([refund({
      orderId: undefined, references: [{ referenceId: "O9", referenceType: "ORDER_ID" }],
      orderLineItems: [{ lineItemId: "L1", marketplaceFees: [{ amount: money("1", "EUR") }, { amount: money("1", "GBP") }] }],
    })]);
    expect(c).toMatchObject({ orderId: "O9", currency: null });
  });

  it("refundCreditToExpenseRow builds a negative platform_fees row keyed on the refund transaction", () => {
    expect(refundCreditToExpenseRow(
      { orderId: "O1", transactionId: "r1", amount: 2, currency: "EUR", date: "2026-10-05" }, "EUR", ctx,
    )).toEqual({
      title: "eBay fee credit (refund)", amount: -2, currency: "EUR", category: "platform_fees", vendor: "eBay",
      date: "2026-10-05", description: "Main shop — order O1", created_by: "user-1",
      external_ref: "ebay:r1", connection_id: "conn-1",
    });
  });
});
