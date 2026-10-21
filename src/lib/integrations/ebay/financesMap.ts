import type { Currency, ExpenseCategory } from "@/types";

export interface EbayFinanceMoney { value: string; currency: string }
export interface EbayMarketplaceFee { feeType?: string; amount?: EbayFinanceMoney; feeMemo?: string }
export interface EbayFinanceTransaction {
  transactionId: string;
  transactionType: string;          // SALE | NON_SALE_CHARGE | SHIPPING_LABEL | CREDIT | …
  transactionDate: string;          // ISO timestamp
  bookingEntry?: "CREDIT" | "DEBIT";
  amount?: EbayFinanceMoney;
  orderId?: string;
  feeType?: string;                 // set on NON_SALE_CHARGE
  transactionMemo?: string;
  orderLineItems?: { lineItemId: string; marketplaceFees?: EbayMarketplaceFee[] }[];
  references?: { referenceId: string; referenceType: string }[];
}
export interface LineItemFees { platformFee: number | null; advertisingFee: number | null }
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

/** Per-line-item fees from SALE transactions, keyed like sales.external_order_id. */
export function feesByLineItem(txns: EbayFinanceTransaction[]): Map<string, LineItemFees> {
  const out = new Map<string, LineItemFees>();
  for (const txn of txns) {
    if (txn.transactionType !== "SALE" || !txn.orderId) continue;
    for (const line of txn.orderLineItems ?? []) {
      let platform = 0, ad = 0, hasPlatform = false, hasAd = false;
      for (const fee of line.marketplaceFees ?? []) {
        // A missing amount is "unknown", not a 0 fee — a stored 0 would be sticky under fill-only-NULL.
        if (fee.amount?.value === undefined || fee.amount.value === null || fee.amount.value === "") continue;
        const v = Math.abs(Number(fee.amount.value));
        if (!Number.isFinite(v)) continue;
        if (isAdFeeType(fee.feeType)) { ad += v; hasAd = true; } else { platform += v; hasPlatform = true; }
      }
      out.set(`${txn.orderId}:${line.lineItemId}`, {
        platformFee: hasPlatform ? round2(platform) : null,
        advertisingFee: hasAd ? round2(ad) : null,
      });
    }
  }
  return out;
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

/** Order-linked charges summed per order+field; order-linked credits are counted, not applied. */
export function orderLinkedChargeFees(txns: EbayFinanceTransaction[]): {
  fees: Map<string, Partial<Record<FeeField, number>>>; creditsSkipped: number; skippedCurrency: number;
} {
  const fees = new Map<string, Partial<Record<FeeField, number>>>();
  let creditsSkipped = 0, skippedCurrency = 0;
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    const orderId = orderIdOf(txn);
    if (!orderId) continue;
    if (isCreditTxn(txn)) { creditsSkipped++; continue; }
    const currency = txn.amount?.currency as Currency | undefined;
    const value = Math.abs(Number(txn.amount?.value));
    if (!currency || !CURRENCIES.includes(currency)) { if (txn.amount) skippedCurrency++; continue; }
    if (!Number.isFinite(value)) continue;
    const field = orderChargeField(txn);
    const entry = fees.get(orderId) ?? {};
    entry[field] = round2((entry[field] ?? 0) + value);
    fees.set(orderId, entry);
  }
  return { fees, creditsSkipped, skippedCurrency };
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
  if (txn.feeType) return `eBay ${txn.feeType.toLowerCase().replace(/_/g, " ")}`;
  if (txn.transactionType === "SHIPPING_LABEL") return "eBay shipping label";
  if (txn.transactionType === "CREDIT") return "eBay credit";
  return `eBay ${txn.transactionType.toLowerCase().replace(/_/g, " ")}`;
}

/** One account charge → an expenses insert row; null when it can't be stored. */
export function chargeToExpenseRow(
  txn: EbayFinanceTransaction,
  ctx: { createdBy: string; connectionId: string | null; accountLabel: string }
): ChargeExpenseRow | null {
  const currency = txn.amount?.currency as Currency | undefined;
  const value = Math.abs(Number(txn.amount?.value));
  if (!currency || !CURRENCIES.includes(currency) || !Number.isFinite(value)) return null;
  const sign = isCreditTxn(txn) ? -1 : 1;
  const memo = txn.transactionMemo ?? txn.references?.[0]?.referenceId ?? null;
  return {
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
  };
}

/** The patch that fills a sale's still-empty fees from eBay; null if nothing to change. */
export function fillEmptyFees(
  existing: { platform_fee: number | null; advertising_fee: number | null },
  fees: LineItemFees
): { platform_fee?: number; advertising_fee?: number } | null {
  const patch: { platform_fee?: number; advertising_fee?: number } = {};
  if (existing.platform_fee === null && fees.platformFee !== null) patch.platform_fee = fees.platformFee;
  if (existing.advertising_fee === null && fees.advertisingFee !== null) patch.advertising_fee = fees.advertisingFee;
  return Object.keys(patch).length ? patch : null;
}
