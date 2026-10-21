import type { IntegrationsClient } from "../types";
import { feesByLineItem, orderLinkedChargeFees, type EbayFinanceTransaction } from "./financesMap";
import { chunks, IN_CHUNK, mapLimit, WRITE_CONCURRENCY } from "./chargeSync";

export type OverwriteField = "platform_fee" | "advertising_fee";
export const OVERWRITE_FIELDS: readonly OverwriteField[] = ["platform_fee", "advertising_fee"];

export interface OverwriteSaleRow {
  id: string; external_order_id: string; currency: string; date: string;
  platform_fee: number | null; advertising_fee: number | null;
}
export interface FeeChange {
  saleId: string; externalOrderId: string; currency: string; date: string;
  field: OverwriteField; from: number | null; to: number;
}
export interface FeeOverwritePreview {
  changes: FeeChange[];
  /** SALE lines and order-linked ad-fee groups whose currency differs from the sale's (or mixes currencies). */
  currencyMismatch: number;
  /** Orders eBay has a fee for that aren't imported as sales. */
  notImported: number;
}
export interface ApplyChange { saleId: string; field: OverwriteField; from: number | null; to: number }
export interface ApplyResult { applied: ApplyChange[]; staleSkipped: number }

/** RLS refused the write (Orders below Edit). */
export class FeeOverwritePermissionError extends Error {}

const SALE_COLS = "id, external_order_id, currency, date, platform_fee, advertising_fee";

function orderOf(externalOrderId: string): string {
  const sep = externalOrderId.indexOf(":");
  return sep > 0 ? externalOrderId.slice(0, sep) : externalOrderId;
}
const cents = (n: number) => Math.round(n * 100);

/**
 * What eBay says each imported sale's Platform/Ad fee should be, where that differs
 * from what is stored. Same derivations as "Sync eBay charges" (feesByLineItem per
 * line; order-linked AD_FEE charges on the order's first line unless any line has a
 * SALE ad fee — never summed). A null from eBay is never proposed: this never clears.
 */
export function computeFeeOverwrites(sales: OverwriteSaleRow[], txns: EbayFinanceTransaction[]): FeeOverwritePreview {
  const lineFees = feesByLineItem(txns);
  const linked = orderLinkedChargeFees(txns).fees;
  const byOrder = new Map<string, OverwriteSaleRow[]>();
  for (const s of sales) {
    const id = orderOf(s.external_order_id);
    byOrder.set(id, [...(byOrder.get(id) ?? []), s]);
  }

  const changes: FeeChange[] = [];
  let currencyMismatch = 0;
  const emit = (s: OverwriteSaleRow, field: OverwriteField, to: number | null | undefined) => {
    if (to === null || to === undefined) return;
    const from = s[field];
    if (from !== null && cents(from) === cents(to)) return;
    changes.push({ saleId: s.id, externalOrderId: s.external_order_id, currency: s.currency, date: s.date, field, from, to });
  };

  for (const [orderId, lines] of byOrder) {
    // Code-unit order matches findOrderSale's Postgres ORDER BY for eBay's fixed-length line ids.
    lines.sort((a, b) => (a.external_order_id < b.external_order_id ? -1 : a.external_order_id > b.external_order_id ? 1 : 0));
    let saleAd = false;
    for (const s of lines) {
      const f = lineFees.get(s.external_order_id);
      if (!f) continue;
      if (f.mixedCurrency || (f.currency !== null && f.currency !== s.currency)) { currencyMismatch++; continue; }
      emit(s, "platform_fee", f.platformFee);
      if (f.advertisingFee !== null) { saleAd = true; emit(s, "advertising_fee", f.advertisingFee); }
    }
    if (saleAd) continue;
    const first = lines[0];
    for (const [currency, group] of linked.get(orderId) ?? []) {
      if (group.fields.advertising_fee === undefined) continue;
      if (currency !== first.currency) { currencyMismatch++; continue; }
      emit(first, "advertising_fee", group.fields.advertising_fee);
    }
  }

  const withFees = new Set<string>();
  for (const [key, f] of lineFees) if (f.platformFee !== null || f.advertisingFee !== null) withFees.add(orderOf(key));
  for (const [orderId, byCurrency] of linked) {
    for (const g of byCurrency.values()) if (g.fields.advertising_fee !== undefined) withFees.add(orderId);
  }
  let notImported = 0;
  for (const o of withFees) if (!byOrder.has(o)) notImported++;

  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.externalOrderId.localeCompare(b.externalOrderId)));
  return { changes, currencyMismatch, notImported };
}

/**
 * The imported eBay sales the transactions touch: every SALE line by external_order_id
 * (IN_CHUNK batches), plus the first line of each order that only has order-linked
 * charges in the window (one bounded lookup per order, like chargeSync's findOrderSale).
 */
export async function loadOverwriteSales(client: IntegrationsClient, txns: EbayFinanceTransaction[]): Promise<OverwriteSaleRow[]> {
  const rows = new Map<string, OverwriteSaleRow>();
  for (const ids of chunks([...feesByLineItem(txns).keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales") // verifier:allow unpaginated-collection-read — bounded: at most IN_CHUNK (200) ids per query, one sale per external_order_id
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const r of (data ?? []) as OverwriteSaleRow[]) rows.set(r.id, r);
  }
  const covered = new Set([...rows.values()].map((r) => orderOf(r.external_order_id)));
  const missing = [...orderLinkedChargeFees(txns).fees.keys()].filter((o) => !covered.has(o));
  const firsts = await mapLimit(missing, WRITE_CONCURRENCY, async (orderId) => {
    const { data, error } = await client
      .from("sales")
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .like("external_order_id", `${orderId}:%`)
      .order("external_order_id")
      .limit(1); // bounded: one row per order
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    return ((data ?? []) as OverwriteSaleRow[])[0];
  });
  for (const r of firsts) if (r) rows.set(r.id, r);
  return [...rows.values()];
}

/**
 * Compare-and-set: each change writes only while the field still holds `from`
 * (what the user saw in the preview). 0 rows → staleSkipped (changed meanwhile, or
 * RLS USING hid the row).
 */
export async function applyFeeOverwrites(client: IntegrationsClient, changes: ApplyChange[]): Promise<ApplyResult> {
  const outcomes = await mapLimit(changes, WRITE_CONCURRENCY, async (c) => {
    const base = client.from("sales").update({ [c.field]: c.to }).eq("id", c.saleId).eq("platform", "ebay");
    const { data, error } = await (c.from === null ? base.is(c.field, null) : base.eq(c.field, c.from)).select("id");
    if (error) {
      if (error.code === "42501") throw new FeeOverwritePermissionError(error.message);
      throw new Error(`sales fee overwrite failed: ${error.message}`);
    }
    return (data?.length ?? 0) > 0;
  });
  const applied = changes.filter((_, i) => outcomes[i]);
  return { applied, staleSkipped: changes.length - applied.length };
}
