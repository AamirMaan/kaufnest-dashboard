import type { IntegrationsClient } from "../types";
import type { Currency } from "@/types";
import {
  CHARGE_TRANSACTION_TYPES, chargeToExpenseRow, feeFieldFills, feesByLineItem, orderIdOf, orderLinkedChargeFees,
  refundCreditToExpenseRow, refundFeeCredits,
  type ChargeExpenseRow, type EbayFinanceTransaction, type FeeField,
} from "./financesMap";

export const IN_CHUNK = 200; // Supabase .in() chunk size (same as ImportSalesModal)
/** Max sales lookups/updates in flight at once inside one IN_CHUNK batch. */
export const WRITE_CONCURRENCY = 10;
/** A sale in one of these states has its fees excluded by get_platform_running_balance/overview already. */
const FEES_EXCLUDED_STATUSES = new Set(["returned", "cancelled"]);

export interface ChargeSyncResult {
  chargesImported: number;
  /** Expense rows (account charges and refund fee credits) whose external_ref already existed. */
  chargesAlreadyImported: number;
  /** Charges in a currency other than EUR/USD/GBP. */
  skippedCurrency: number;
  /** Charges with a missing, non-numeric or 0 amount — never stored (a stored 0 fee is sticky). */
  skippedInvalid: number;
  /** CREDIT transactions without a feeType: not a fee refund, so not an expense. */
  nonFeeCreditsSkipped: number;
  /** Sales that had at least one fee written. */
  ordersFeesFilled: number;
  /** Guarded fee updates that matched no row (no Orders edit access, or filled meanwhile). */
  ordersFeesNotWritten: number;
  /**
   * Fees/credits skipped because their currency differs from the sale's: SALE-fee lines (one per sale),
   * order-linked charges (one per charge) and refund fee credits (one per refund).
   */
  currencyMismatch: number;
  /** Order-linked credits are not applied to the order. */
  orderLinkedCreditsSkipped: number;
  /** Order-linked charges' orders that aren't in the dashboard yet (counted per order). */
  orderLinkedUnmatched: number;
  /** Order-linked fee FIELDS (not charges) not written because the sale already had a value there. */
  orderLinkedAlreadyFilled: number;
  /** Refund fee credits stored as negative platform_fees expenses. */
  refundCreditsImported: number;
  /** Refund fee credits whose sale isn't imported, is returned/cancelled (its fees already excluded), or has no recorded platform_fee. */
  refundCreditsSkipped: number;
}
/** RLS refused the write (Expenses or Orders below Edit). */
export class ChargeSyncPermissionError extends Error {}
/** The tenant schema predates migration 058 (expenses.external_ref / connection_id missing). */
export class ChargeSyncSchemaError extends Error {}

type SaleFeeRow = {
  id: string; external_order_id: string; currency: Currency; status: string;
  platform_fee: number | null; advertising_fee: number | null; shipping_cost: number | null;
};
const SALE_COLS = "id, external_order_id, currency, status, platform_fee, advertising_fee, shipping_cost";

export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Map with at most `limit` calls of `fn` in flight; results keep input order. Rejects on the first error and starts no new item after it. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type FillOutcome = { filled: boolean; notWritten: number };

export async function applyFinanceTransactions(
  client: IntegrationsClient,
  txns: EbayFinanceTransaction[],
  ctx: { createdBy: string; connectionId: string; accountLabel: string }
): Promise<ChargeSyncResult> {
  const result: ChargeSyncResult = {
    chargesImported: 0, chargesAlreadyImported: 0, skippedCurrency: 0, skippedInvalid: 0, nonFeeCreditsSkipped: 0,
    ordersFeesFilled: 0, ordersFeesNotWritten: 0, currencyMismatch: 0, orderLinkedCreditsSkipped: 0,
    orderLinkedUnmatched: 0, orderLinkedAlreadyFilled: 0, refundCreditsImported: 0, refundCreditsSkipped: 0,
  };
  const filledSales = new Set<string>();

  /** One guarded update per field: never overwrites a value that appeared since we read the row. */
  async function writeFills(sale: SaleFeeRow, fills: [FeeField, number][]): Promise<FillOutcome> {
    let filled = false, notWritten = 0;
    for (const [field, value] of fills) {
      const { data, error } = await client
        .from("sales")
        .update({ [field]: value })
        .eq("id", sale.id)
        .is(field, null)
        .select("id");
      if (error) {
        if (error.code === "42501") throw new ChargeSyncPermissionError(error.message);
        throw new Error(`sales fee update failed: ${error.message}`);
      }
      // RLS USING makes an unauthorised UPDATE match 0 rows rather than raise 42501.
      if ((data?.length ?? 0) > 0) filled = true; else notWritten++;
    }
    return { filled, notWritten };
  }

  function tallyFill(saleId: string, o: FillOutcome) {
    if (o.filled) filledSales.add(saleId);
    result.ordersFeesNotWritten += o.notWritten;
  }

  /** The order's first line item on eBay (bounded: one row). */
  async function findOrderSale(orderId: string): Promise<SaleFeeRow | undefined> {
    const { data, error } = await client
      .from("sales")
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .like("external_order_id", `${orderId}:%`)
      .order("external_order_id")
      .limit(1); // bounded: one row per order
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    return ((data ?? []) as SaleFeeRow[])[0];
  }

  /** Upsert expense rows deduped on external_ref; returns [inserted, alreadyThere]. */
  async function upsertExpenses(rows: ChargeExpenseRow[]): Promise<[number, number]> {
    let inserted = 0, existing = 0;
    for (const batch of chunks(rows, IN_CHUNK)) {
      const { data, error } = await client
        .from("expenses")
        .upsert(batch, { onConflict: "external_ref", ignoreDuplicates: true })
        .select("id");
      if (error) {
        if (error.code === "42501") throw new ChargeSyncPermissionError(error.message);
        if (error.code === "PGRST204" || error.code === "42703") throw new ChargeSyncSchemaError(error.message);
        throw new Error(`expenses upsert failed: ${error.message}`);
      }
      const n = data?.length ?? 0;
      inserted += n;
      existing += batch.length - n;
    }
    return [inserted, existing];
  }

  // 1. Account charges (not tied to an order) → expenses, deduped on external_ref.
  const rows: ChargeExpenseRow[] = [];
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    if (orderIdOf(txn)) continue; // order-linked: handled in step 3
    const r = chargeToExpenseRow(txn, ctx);
    if (r.ok) rows.push(r.row);
    else if (r.reason === "currency") result.skippedCurrency++;
    else if (r.reason === "invalid") result.skippedInvalid++;
    else result.nonFeeCreditsSkipped++;
  }
  {
    const [inserted, existing] = await upsertExpenses(rows);
    result.chargesImported += inserted;
    result.chargesAlreadyImported += existing;
  }

  // 2. Per-order fees → fill still-empty fees on already-imported sales in the same currency.
  const fees = feesByLineItem(txns);
  for (const ids of chunks([...fees.keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales") // verifier:allow unpaginated-collection-read — bounded: at most IN_CHUNK (200) ids per query, one sale per external_order_id
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    const outcomes = await mapLimit((data ?? []) as SaleFeeRow[], WRITE_CONCURRENCY, async (sale) => {
      const f = fees.get(sale.external_order_id);
      if (!f) return { sale, mismatch: false, fill: null };
      if (f.mixedCurrency) return { sale, mismatch: true, fill: null };
      if (f.platformFee === null && f.advertisingFee === null) return { sale, mismatch: false, fill: null };
      if (f.currency !== sale.currency) return { sale, mismatch: true, fill: null };
      const fills = feeFieldFills(sale, { platform_fee: f.platformFee, advertising_fee: f.advertisingFee });
      return { sale, mismatch: false, fill: await writeFills(sale, fills) };
    });
    for (const o of outcomes) {
      if (o.mismatch) result.currencyMismatch++;
      if (o.fill) tallyFill(o.sale.id, o.fill);
    }
  }

  // 3. Order-linked charges → fill the order's first line item (never multiplied across line items),
  //    only with the charges in the sale's currency.
  const linked = orderLinkedChargeFees(txns);
  result.orderLinkedCreditsSkipped = linked.creditsSkipped;
  result.skippedCurrency += linked.skippedCurrency;
  result.skippedInvalid += linked.skippedInvalid;
  for (const batch of chunks([...linked.fees], IN_CHUNK)) {
    const outcomes = await mapLimit(batch, WRITE_CONCURRENCY, async ([orderId, byCurrency]) => {
      const sale = await findOrderSale(orderId);
      if (!sale) return { sale: null, mismatch: 0, alreadyFilled: 0, fill: null };
      let mismatch = 0;
      for (const [currency, group] of byCurrency) if (currency !== sale.currency) mismatch += group.charges;
      const fields = byCurrency.get(sale.currency)?.fields ?? {};
      const fills = feeFieldFills(sale, fields);
      const alreadyFilled = Object.keys(fields).length - fills.length;
      return { sale, mismatch, alreadyFilled, fill: fills.length ? await writeFills(sale, fills) : null };
    });
    for (const o of outcomes) {
      if (!o.sale) { result.orderLinkedUnmatched++; continue; }
      result.currencyMismatch += o.mismatch;
      result.orderLinkedAlreadyFilled += o.alreadyFilled;
      if (o.fill) tallyFill(o.sale.id, o.fill);
    }
  }

  // 4. REFUND fee credits → negative platform_fees expenses, only for a live sale in the same currency.
  const refundRows: ChargeExpenseRow[] = [];
  for (const batch of chunks(refundFeeCredits(txns), IN_CHUNK)) {
    const outcomes = await mapLimit(batch, WRITE_CONCURRENCY, async (credit) => {
      const sale = await findOrderSale(credit.orderId);
      // A refund credits a fee that was booked; with no recorded platform_fee there is nothing to credit.
      if (!sale || FEES_EXCLUDED_STATUSES.has(sale.status) || sale.platform_fee === null) return "skipped" as const;
      if (credit.currency !== sale.currency) return "mismatch" as const;
      return refundCreditToExpenseRow(credit, sale.currency, ctx);
    });
    for (const o of outcomes) {
      if (o === "skipped") result.refundCreditsSkipped++;
      else if (o === "mismatch") result.currencyMismatch++;
      else refundRows.push(o);
    }
  }
  {
    const [inserted, existing] = await upsertExpenses(refundRows);
    result.refundCreditsImported += inserted;
    result.chargesAlreadyImported += existing;
  }

  result.ordersFeesFilled = filledSales.size;
  return result;
}
