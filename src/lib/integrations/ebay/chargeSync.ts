import type { IntegrationsClient } from "../types";
import {
  CHARGE_TRANSACTION_TYPES, chargeToExpenseRow, feesByLineItem, fillEmptyFees,
  type ChargeExpenseRow, type EbayFinanceTransaction,
} from "./financesMap";

const IN_CHUNK = 200; // Supabase .in() chunk size (same as ImportSalesModal)

export interface ChargeSyncResult { chargesImported: number; chargesAlreadyImported: number; skippedCurrency: number; ordersFeesFilled: number }
/** RLS refused the write (Expenses or Orders below Edit). */
export class ChargeSyncPermissionError extends Error {}

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
  const result: ChargeSyncResult = { chargesImported: 0, chargesAlreadyImported: 0, skippedCurrency: 0, ordersFeesFilled: 0 };

  // 1. Account charges → expenses, deduped on external_ref.
  const rows: ChargeExpenseRow[] = [];
  for (const txn of txns) {
    if (!(CHARGE_TRANSACTION_TYPES as readonly string[]).includes(txn.transactionType)) continue;
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
      .select("id, external_order_id, platform_fee, advertising_fee")
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const sale of (data ?? []) as { id: string; external_order_id: string; platform_fee: number | null; advertising_fee: number | null }[]) {
      const patch = fillEmptyFees(sale, fees.get(sale.external_order_id)!);
      if (!patch) continue;
      const { error: upErr } = await client.from("sales").update(patch).eq("id", sale.id);
      if (upErr) {
        if (upErr.code === "42501") throw new ChargeSyncPermissionError(upErr.message);
        throw new Error(`sales fee update failed: ${upErr.message}`);
      }
      result.ordersFeesFilled++;
    }
  }
  return result;
}
