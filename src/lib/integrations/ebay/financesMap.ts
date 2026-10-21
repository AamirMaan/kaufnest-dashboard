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
        const v = Math.abs(Number(fee.amount?.value ?? 0));
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
  const sign = txn.bookingEntry === "CREDIT" ? -1 : 1;
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
