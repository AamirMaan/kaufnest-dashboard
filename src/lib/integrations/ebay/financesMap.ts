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
export interface LineItemFees {
  platformFee: number | null; advertisingFee: number | null; currency: string | null;
  /** True when the line's fees come in more than one currency (fees and currency are then null). */
  mixedCurrency: boolean;
}
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
      if (currencies.size > 1) { out.set(key, { platformFee: null, advertisingFee: null, currency: null, mixedCurrency: true }); continue; }
      out.set(key, {
        platformFee: hasPlatform ? round2(platform) : null,
        advertisingFee: hasAd ? round2(ad) : null,
        currency: currencies.size === 1 ? [...currencies][0] : null,
        mixedCurrency: false,
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

/** One order's order-linked platform/ad fees in one currency (see orderLinkedNetFees). */
export type OrderNetFees = Partial<Record<"platform_fee" | "advertising_fee", number>>;

/**
 * Fee overwrite only: order-linked fees per order → currency → field.
 * - advertising_fee: in-window AD_FEE charges MINUS in-window ad-fee credits (a refunded
 *   ad fee nets to 0, not the gross charge). eBay doesn't say which charge a credit
 *   reverses, so when credits exceed the in-window charges (one reverses a charge from
 *   before the window) or there are no charges, the net is unknown and the field is left
 *   out. Never negative.
 * - platform_fee: in-window non-ad charges only. Platform-fee credits are NOT netted:
 *   they can refund the SALE's own fees (not these charges), and charge sync already
 *   books fee refunds as negative platform_fees expenses.
 * Credits without a feeType aren't fee refunds; shipping labels are left out (the
 * overwrite doesn't touch shipping_cost).
 */
export function orderLinkedNetFees(txns: EbayFinanceTransaction[]): Map<string, Map<string, OrderNetFees>> {
  type Acc = { platform: number; hasPlatform: boolean; adCharges: number; hasAd: boolean; adCredits: number };
  const acc = new Map<string, Map<string, Acc>>();
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    const orderId = orderIdOf(txn);
    if (!orderId || !txn.amount) continue;
    const credit = isCreditTxn(txn);
    if (credit && !txn.feeType) continue;
    const currency = txn.amount.currency as Currency;
    if (!CURRENCIES.includes(currency)) continue;
    const value = moneyValue(txn.amount);
    if (value === null) continue;
    const field = orderChargeField(txn);
    if (field === "shipping_cost") continue;
    if (field === "platform_fee" && credit) continue;
    const byCurrency = acc.get(orderId) ?? new Map<string, Acc>();
    const a = byCurrency.get(currency) ?? { platform: 0, hasPlatform: false, adCharges: 0, hasAd: false, adCredits: 0 };
    if (field === "platform_fee") { a.platform += value; a.hasPlatform = true; }
    else if (credit) a.adCredits += value;
    else { a.adCharges += value; a.hasAd = true; }
    byCurrency.set(currency, a);
    acc.set(orderId, byCurrency);
  }
  const out = new Map<string, Map<string, OrderNetFees>>();
  for (const [orderId, byCurrency] of acc) {
    const fees = new Map<string, OrderNetFees>();
    for (const [currency, a] of byCurrency) {
      const f: OrderNetFees = {};
      if (a.hasPlatform) f.platform_fee = round2(a.platform);
      const net = round2(a.adCharges - a.adCredits);
      if (a.hasAd && net >= 0) f.advertising_fee = net;
      if (Object.keys(f).length > 0) fees.set(currency, f);
    }
    if (fees.size > 0) out.set(orderId, fees);
  }
  return out;
}

/**
 * Adds order-linked ad fee charges to the per-line fees. eBay books the Promoted
 * Listings fee as a NON_SALE_CHARGE referencing the order, not inside the SALE's
 * marketplaceFees, so feesByLineItem alone never sees it. Reuses chargeSync's
 * orderLinkedChargeFees so Review and sync agree: credits are not applied, only the
 * order's currency counts, and the fee goes on the order's first line (sorted, like
 * findOrderSale — code-unit order matches Postgres here because eBay line item ids
 * are fixed-length digit strings under one order prefix). A SALE-reported ad fee is
 * kept (fill-only-NULL) — on any line of the order, not just the first — and an
 * order with any line already imported is skipped:
 * sync puts the charge on its first *imported* line, so a second import would double-count.
 */
export function withOrderLinkedAdFees(
  fees: Map<string, LineItemFees>,
  orders: readonly { external_order_id: string; currency: string; imported: boolean }[],
  txns: EbayFinanceTransaction[]
): Map<string, LineItemFees> {
  const firstLine = new Map<string, { key: string; currency: string }>();
  const partlyImported = new Set<string>();
  const saleAd = new Set<string>(); // orders with a SALE ad fee (in the order's currency) on any line
  for (const o of orders) {
    const sep = o.external_order_id.indexOf(":");
    if (sep <= 0) continue;
    const orderId = o.external_order_id.slice(0, sep);
    if (o.imported) partlyImported.add(orderId);
    const lineFees = fees.get(o.external_order_id);
    if (lineFees?.advertisingFee != null && lineFees.currency === o.currency) saleAd.add(orderId);
    const cur = firstLine.get(orderId);
    if (cur === undefined || o.external_order_id < cur.key) firstLine.set(orderId, { key: o.external_order_id, currency: o.currency });
  }
  const out = new Map(fees);
  for (const [orderId, byCurrency] of orderLinkedChargeFees(txns).fees) {
    const line = firstLine.get(orderId);
    if (!line || partlyImported.has(orderId) || saleAd.has(orderId)) continue;
    const ad = byCurrency.get(line.currency)?.fields.advertising_fee;
    const existing = out.get(line.key);
    if (ad === undefined || existing?.mixedCurrency) continue;
    if (existing?.currency != null && existing.currency !== line.currency) continue;
    out.set(line.key, { platformFee: existing?.platformFee ?? null, advertisingFee: ad, currency: line.currency, mixedCurrency: false });
  }
  return out;
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
