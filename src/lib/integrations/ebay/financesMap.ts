import type { Currency, ExpenseCategory } from "@/types";

export interface EbayFinanceMoney { value: string; currency: string }
export interface EbayMarketplaceFee { feeType?: string; amount?: EbayFinanceMoney; feeMemo?: string }
export interface EbayFinanceTransaction {
  transactionId: string;
  transactionType: string;          // SALE | REFUND | NON_SALE_CHARGE | SHIPPING_LABEL | CREDIT | …
  transactionDate: string;          // ISO timestamp
  bookingEntry?: "CREDIT" | "DEBIT";
  amount?: EbayFinanceMoney;
  orderId?: string;
  feeType?: string;                 // set on NON_SALE_CHARGE, and on a CREDIT that is a fee credit
  transactionMemo?: string;
  orderLineItems?: { lineItemId: string; marketplaceFees?: EbayMarketplaceFee[] }[];
  references?: { referenceId: string; referenceType: string }[];
}
/** `currency` is the one currency all counted fee entries share; null when none counted or they mixed (then both fees are null). */
export interface LineItemFees { platformFee: number | null; advertisingFee: number | null; currency: string | null }
export interface ChargeExpenseRow {
  title: string; amount: number; currency: Currency; category: ExpenseCategory;
  vendor: string; date: string; description: string | null; created_by: string;
  external_ref: string; connection_id: string | null;
}

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
export const CHARGE_TRANSACTION_TYPES = ["NON_SALE_CHARGE", "SHIPPING_LABEL", "CREDIT"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** eBay names ad fees several ways (AD_FEE, PREMIUM_AD_FEES, PROMOTED_LISTING_FEE). */
export function isAdFeeType(feeType: string | undefined): boolean {
  return !!feeType && (/(^|_)AD_FEES?$/.test(feeType) || feeType.startsWith("PROMOTED"));
}

/** A usable fee/charge magnitude: finite and non-zero (a stored 0 is sticky under fill-only-NULL). */
function moneyValue(m: EbayFinanceMoney | undefined): number | null {
  if (!m || m.value === undefined || m.value === null || m.value === "") return null;
  const v = Math.abs(Number(m.value));
  return Number.isFinite(v) && v !== 0 ? v : null;
}

/**
 * Per-line-item fees from SALE transactions, keyed like sales.external_order_id.
 * Missing, non-numeric and 0-valued fee entries are ignored. A line whose fees
 * come in more than one currency gets null fees and a null currency — never guessed.
 */
export function feesByLineItem(txns: EbayFinanceTransaction[]): Map<string, LineItemFees> {
  const out = new Map<string, LineItemFees>();
  for (const txn of txns) {
    if (txn.transactionType !== "SALE" || !txn.orderId) continue;
    for (const line of txn.orderLineItems ?? []) {
      let platform = 0, ad = 0, hasPlatform = false, hasAd = false;
      const currencies = new Set<string>();
      for (const fee of line.marketplaceFees ?? []) {
        const v = moneyValue(fee.amount);
        if (v === null || !fee.amount) continue;
        currencies.add(fee.amount.currency);
        if (isAdFeeType(fee.feeType)) { ad += v; hasAd = true; } else { platform += v; hasPlatform = true; }
      }
      const key = `${txn.orderId}:${line.lineItemId}`;
      if (currencies.size > 1) { out.set(key, { platformFee: null, advertisingFee: null, currency: null }); continue; }
      out.set(key, {
        platformFee: hasPlatform ? round2(platform) : null,
        advertisingFee: hasAd ? round2(ad) : null,
        currency: currencies.size === 1 ? [...currencies][0] : null,
      });
    }
  }
  return out;
}

/** Review prefill: fees only for a not-yet-imported order whose currency matches the fees' currency. */
export function prefillFeesFor(
  fees: LineItemFees | undefined,
  order: { currency: string; imported: boolean }
): LineItemFees | undefined {
  if (!fees || order.imported || fees.currency === null || fees.currency !== order.currency) return undefined;
  return fees;
}

/** bookingEntry CREDIT, or a CREDIT transactionType that carries no bookingEntry. */
export function isCreditTxn(txn: EbayFinanceTransaction): boolean {
  return txn.bookingEntry === "CREDIT" || (!txn.bookingEntry && txn.transactionType === "CREDIT");
}

export type FeeField = "platform_fee" | "advertising_fee" | "shipping_cost";

/** The eBay order id a charge is attached to (references entry of type ORDER_ID), else null. */
export function orderIdOf(txn: EbayFinanceTransaction): string | null {
  return txn.references?.find((r) => r.referenceType === "ORDER_ID" && r.referenceId)?.referenceId ?? null;
}

/** Which sales fee column an order-linked charge belongs in. */
export function orderChargeField(txn: EbayFinanceTransaction): FeeField {
  if (isAdFeeType(txn.feeType)) return "advertising_fee";
  if (txn.transactionType === "SHIPPING_LABEL") return "shipping_cost";
  return "platform_fee";
}

/** One order's order-linked charges in one currency: summed per fee field, plus how many charges went in. */
export interface OrderChargeGroup { fields: Partial<Record<FeeField, number>>; charges: number }

/**
 * Order-linked charges summed per order, currency and field (fees: orderId → currency → group).
 * Order-linked credits are counted, not applied. Unsupported currencies count as skippedCurrency;
 * a missing, non-finite or 0 amount counts as skippedInvalid and is never stored as a fee.
 */
export function orderLinkedChargeFees(txns: EbayFinanceTransaction[]): {
  fees: Map<string, Map<string, OrderChargeGroup>>; creditsSkipped: number; skippedCurrency: number; skippedInvalid: number;
} {
  const fees = new Map<string, Map<string, OrderChargeGroup>>();
  let creditsSkipped = 0, skippedCurrency = 0, skippedInvalid = 0;
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    const orderId = orderIdOf(txn);
    if (!orderId) continue;
    if (isCreditTxn(txn)) { creditsSkipped++; continue; }
    if (!txn.amount) { skippedInvalid++; continue; }
    const currency = txn.amount.currency as Currency;
    if (!CURRENCIES.includes(currency)) { skippedCurrency++; continue; }
    const value = moneyValue(txn.amount);
    if (value === null) { skippedInvalid++; continue; }
    const field = orderChargeField(txn);
    const byCurrency = fees.get(orderId) ?? new Map<string, OrderChargeGroup>();
    const group = byCurrency.get(currency) ?? { fields: {}, charges: 0 };
    group.fields[field] = round2((group.fields[field] ?? 0) + value);
    group.charges++;
    byCurrency.set(currency, group);
    fees.set(orderId, byCurrency);
  }
  return { fees, creditsSkipped, skippedCurrency, skippedInvalid };
}

/** Fields that are NULL on the sale and have a value from eBay: [field, value] pairs. */
export function feeFieldFills(
  existing: Record<FeeField, number | null>,
  fees: Partial<Record<FeeField, number | null>>
): [FeeField, number][] {
  const out: [FeeField, number][] = [];
  for (const f of ["platform_fee", "advertising_fee", "shipping_cost"] as const) {
    const v = fees[f];
    if (existing[f] === null && v !== undefined && v !== null) out.push([f, v]);
  }
  return out;
}

export function categoryForCharge(txn: EbayFinanceTransaction): ExpenseCategory {
  if (txn.transactionType === "SHIPPING_LABEL") return "shipping";
  if (isAdFeeType(txn.feeType)) return "advertising";
  return "platform_fees";
}

function chargeTitle(txn: EbayFinanceTransaction): string {
  const credit = txn.transactionType === "CREDIT" ? " credit" : "";
  if (txn.feeType) return `eBay ${txn.feeType.toLowerCase().replace(/_/g, " ")}${credit}`;
  if (txn.transactionType === "SHIPPING_LABEL") return "eBay shipping label";
  if (txn.transactionType === "CREDIT") return "eBay credit";
  return `eBay ${txn.transactionType.toLowerCase().replace(/_/g, " ")}`;
}

/**
 * Why a charge produced no expense row: `currency` (not EUR/USD/GBP), `invalid`
 * (missing, non-finite or 0 amount) or `nonFeeCredit` (a CREDIT transaction with
 * no feeType — not a fee refund, so not an expense).
 */
export type ChargeSkipReason = "currency" | "invalid" | "nonFeeCredit";
export type ChargeRowResult = { ok: true; row: ChargeExpenseRow } | { ok: false; reason: ChargeSkipReason };

/**
 * One account charge → an expenses insert row, or why it can't be stored.
 * A CREDIT transactionType is imported (negative) only when it carries a feeType;
 * a NON_SALE_CHARGE / SHIPPING_LABEL with bookingEntry CREDIT is a fee/label refund
 * and is imported negative.
 */
export function chargeToExpenseRow(
  txn: EbayFinanceTransaction,
  ctx: { createdBy: string; connectionId: string | null; accountLabel: string }
): ChargeRowResult {
  if (txn.transactionType === "CREDIT" && !txn.feeType) return { ok: false, reason: "nonFeeCredit" };
  if (!txn.amount) return { ok: false, reason: "invalid" };
  const currency = txn.amount.currency as Currency;
  if (!CURRENCIES.includes(currency)) return { ok: false, reason: "currency" };
  const value = moneyValue(txn.amount);
  if (value === null) return { ok: false, reason: "invalid" };
  const sign = isCreditTxn(txn) ? -1 : 1;
  const memo = txn.transactionMemo ?? txn.references?.[0]?.referenceId ?? null;
  return { ok: true, row: {
    title: chargeTitle(txn),
    amount: round2(sign * value),
    currency,
    category: categoryForCharge(txn),
    // "eBay" keeps get_platform_running_balance's strpos(lower(...),'ebay') match working.
    vendor: "eBay",
    date: txn.transactionDate.slice(0, 10),
    description: memo ? `${ctx.accountLabel} — ${memo}` : ctx.accountLabel,
    created_by: ctx.createdBy,
    external_ref: `ebay:${txn.transactionId}`,
    connection_id: ctx.connectionId,
  } };
}

/** eBay's fee credit on one REFUND transaction. `currency` is null when its fee entries mix currencies. */
export interface RefundFeeCredit { orderId: string; transactionId: string; amount: number; currency: string | null; date: string }

/**
 * Per REFUND transaction, the sum of |orderLineItems[].marketplaceFees| — eBay's fee credit
 * for that refund. Refunds with no order id or no usable (non-zero) fee entry yield nothing.
 */
export function refundFeeCredits(txns: EbayFinanceTransaction[]): RefundFeeCredit[] {
  const out: RefundFeeCredit[] = [];
  for (const txn of txns) {
    if (txn.transactionType !== "REFUND") continue;
    const orderId = txn.orderId ?? orderIdOf(txn);
    if (!orderId) continue;
    let total = 0;
    const currencies = new Set<string>();
    for (const line of txn.orderLineItems ?? []) {
      for (const fee of line.marketplaceFees ?? []) {
        const v = moneyValue(fee.amount);
        if (v === null || !fee.amount) continue;
        total += v;
        currencies.add(fee.amount.currency);
      }
    }
    if (total === 0) continue;
    out.push({
      orderId, transactionId: txn.transactionId, amount: round2(total),
      currency: currencies.size === 1 ? [...currencies][0] : null,
      date: txn.transactionDate.slice(0, 10),
    });
  }
  return out;
}

/** A refund fee credit → a negative platform_fees expense, idempotent on `ebay:<refund transactionId>`. */
export function refundCreditToExpenseRow(
  credit: RefundFeeCredit,
  currency: Currency,
  ctx: { createdBy: string; connectionId: string | null; accountLabel: string }
): ChargeExpenseRow {
  return {
    title: "eBay fee credit (refund)",
    amount: -round2(credit.amount),
    currency,
    category: "platform_fees",
    vendor: "eBay",
    date: credit.date,
    description: `${ctx.accountLabel} — order ${credit.orderId}`,
    created_by: ctx.createdBy,
    external_ref: `ebay:${credit.transactionId}`,
    connection_id: ctx.connectionId,
  };
}
