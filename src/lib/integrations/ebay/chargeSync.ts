import type { IntegrationsClient } from "../types";
import {
  CHARGE_TRANSACTION_TYPES, chargeToExpenseRow, feeFieldFills, feesByLineItem, orderIdOf, orderLinkedChargeFees,
  type ChargeExpenseRow, type EbayFinanceTransaction, type FeeField,
} from "./financesMap";

const IN_CHUNK = 200; // Supabase .in() chunk size (same as ImportSalesModal)

export interface ChargeSyncResult {
  chargesImported: number; chargesAlreadyImported: number; skippedCurrency: number;
  /** Sales that had at least one fee written. */
  ordersFeesFilled: number;
  /** Guarded fee updates that matched no row (no Orders edit access, or filled meanwhile). */
  ordersFeesNotWritten: number;
  /** Order-linked credits are not applied to the order. */
  orderLinkedCreditsSkipped: number;
  /** Order-linked charges whose order isn't in the dashboard yet. */
  orderLinkedUnmatched: number;
}
/** RLS refused the write (Expenses or Orders below Edit). */
export class ChargeSyncPermissionError extends Error {}
/** The tenant schema predates migration 058 (expenses.external_ref / connection_id missing). */
export class ChargeSyncSchemaError extends Error {}

type SaleFeeRow = { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null; shipping_cost: number | null };
const SALE_COLS = "id, external_order_id, platform_fee, advertising_fee, shipping_cost";

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function applyFinanceTransactions(
  client: IntegrationsClient,
  txns: EbayFinanceTransaction[],
  ctx: { createdBy: string; connectionId: string; accountLabel: string }
): Promise<ChargeSyncResult> {
  const result: ChargeSyncResult = {
    chargesImported: 0, chargesAlreadyImported: 0, skippedCurrency: 0, ordersFeesFilled: 0,
    ordersFeesNotWritten: 0, orderLinkedCreditsSkipped: 0, orderLinkedUnmatched: 0,
  };
  const filledSales = new Set<string>();

  /** One guarded update per field: never overwrites a value that appeared since we read the row. */
  async function writeFills(sale: SaleFeeRow, fees: Partial<Record<FeeField, number | null>>) {
    for (const [field, value] of feeFieldFills(sale, fees)) {
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
      if ((data?.length ?? 0) > 0) filledSales.add(sale.id); else result.ordersFeesNotWritten++;
    }
  }

  // 1. Account charges (not tied to an order) → expenses, deduped on external_ref.
  const rows: ChargeExpenseRow[] = [];
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
    if (orderIdOf(txn)) continue; // order-linked: handled in step 3
    const row = chargeToExpenseRow(txn, ctx);
    if (row) rows.push(row); else result.skippedCurrency++;
  }
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
    const inserted = data?.length ?? 0;
    result.chargesImported += inserted;
    result.chargesAlreadyImported += batch.length - inserted;
  }

  // 2. Per-order fees → fill still-empty fees on already-imported sales.
  const fees = feesByLineItem(txns);
  for (const ids of chunks([...fees.keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales") // verifier:allow unpaginated-collection-read — bounded: at most IN_CHUNK (200) ids per query, one sale per external_order_id
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const sale of (data ?? []) as SaleFeeRow[]) {
      const f = fees.get(sale.external_order_id)!;
      await writeFills(sale, { platform_fee: f.platformFee, advertising_fee: f.advertisingFee });
    }
  }

  // 3. Order-linked charges → fill the order's first line item (never multiplied across line items).
  const linked = orderLinkedChargeFees(txns);
  result.orderLinkedCreditsSkipped = linked.creditsSkipped;
  result.skippedCurrency += linked.skippedCurrency;
  for (const [orderId, orderFees] of linked.fees) {
    const { data, error } = await client
      .from("sales")
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .like("external_order_id", `${orderId}:%`)
      .order("external_order_id")
      .limit(1); // bounded: one row per order
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    const sale = ((data ?? []) as SaleFeeRow[])[0];
    if (!sale) { result.orderLinkedUnmatched++; continue; }
    await writeFills(sale, orderFees);
  }

  result.ordersFeesFilled = filledSales.size;
  return result;
}
