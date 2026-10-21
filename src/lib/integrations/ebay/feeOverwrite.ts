import type { IntegrationsClient } from "../types";
import { feesByLineItem, orderLinkedNetFees, type EbayFinanceTransaction } from "./financesMap";
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
  /** SALE lines and order-linked fee groups whose currency differs from the sale's (or mixes currencies). */
  currencyMismatch: number;
  /** Orders eBay has a fee for that aren't imported as sales of this account. */
  notImported: number;
}
export interface ApplyChange { saleId: string; field: OverwriteField; from: number | null; to: number }
export interface ApplyResult {
  applied: ApplyChange[];
  /** Matched no row: the fee changed since the preview, or RLS hid the row (no Orders edit access). */
  stale: ApplyChange[];
  /** Errored writes (not attempted again); applied ones stay applied. */
  failed: number;
  /** At least one write was refused with 42501. */
  permissionDenied: boolean;
}

const SALE_COLS = "id, external_order_id, currency, date, platform_fee, advertising_fee";

/** Rows of this account, plus legacy rows that predate sales.connection_id (056). */
export function accountScope(connectionId: string): string {
  return `connection_id.is.null,connection_id.eq.${connectionId}`;
}

function orderOf(externalOrderId: string): string {
  const sep = externalOrderId.indexOf(":");
  return sep > 0 ? externalOrderId.slice(0, sep) : externalOrderId;
}
const cents = (n: number) => Math.round(n * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What eBay says each imported sale's Platform/Ad fee should be, where that differs
 * from what is stored. A null from eBay is never proposed: this never clears.
 * - Platform fee: the line's SALE marketplace fees; the order's FIRST line also gets
 *   the order-linked non-ad charges (net of fee credits) — but only when that line's
 *   SALE fees are in the window, otherwise the total is unknown and nothing is proposed.
 * - Ad fee: a SALE ad fee on any line wins (per line); otherwise the order-linked
 *   AD_FEE charges net of AD_FEE credits go on the first line (clamped at 0).
 */
export function computeFeeOverwrites(sales: OverwriteSaleRow[], txns: EbayFinanceTransaction[]): FeeOverwritePreview {
  const lineFees = feesByLineItem(txns);
  const linked = orderLinkedNetFees(txns);
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
    const first = lines[0];
    let orderNet: { platform_fee?: number; advertising_fee?: number } = {};
    for (const [currency, fees] of linked.get(orderId) ?? []) {
      if (currency === first.currency) orderNet = fees;
      else currencyMismatch++;
    }

    let saleAd = false;
    for (const s of lines) {
      const f = lineFees.get(s.external_order_id);
      if (!f) continue;
      if (f.mixedCurrency || (f.currency !== null && f.currency !== s.currency)) { currencyMismatch++; continue; }
      if (f.platformFee !== null) {
        const extra = s === first ? (orderNet.platform_fee ?? 0) : 0;
        emit(s, "platform_fee", Math.max(0, round2(f.platformFee + extra)));
      }
      if (f.advertisingFee !== null) { saleAd = true; emit(s, "advertising_fee", f.advertisingFee); }
    }
    if (!saleAd && orderNet.advertising_fee !== undefined) emit(first, "advertising_fee", Math.max(0, orderNet.advertising_fee));
  }

  const withFees = new Set<string>();
  for (const [key, f] of lineFees) if (f.platformFee !== null || f.advertisingFee !== null) withFees.add(orderOf(key));
  // Same rule as loadOverwriteSales: an order with only order-linked platform charges in
  // the window is never loaded (its SALE fees are unknown), so it isn't "not imported".
  for (const [orderId, byCurrency] of linked) {
    if ([...byCurrency.values()].some((f) => f.advertising_fee !== undefined)) withFees.add(orderId);
  }
  let notImported = 0;
  for (const o of withFees) if (!byOrder.has(o)) notImported++;

  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.externalOrderId.localeCompare(b.externalOrderId)));
  return { changes, currencyMismatch, notImported };
}

/**
 * The imported eBay sales of this account (or legacy, unassigned) the transactions
 * touch: every SALE line by external_order_id (IN_CHUNK batches), plus the first line
 * of each order whose only fee in the window is an order-linked AD_FEE — the only
 * thing computeFeeOverwrites can propose without the order's SALE fees.
 */
export async function loadOverwriteSales(
  client: IntegrationsClient, txns: EbayFinanceTransaction[], connectionId: string
): Promise<OverwriteSaleRow[]> {
  const rows = new Map<string, OverwriteSaleRow>();
  for (const ids of chunks([...feesByLineItem(txns).keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales") // verifier:allow unpaginated-collection-read — bounded: at most IN_CHUNK (200) ids per query, one sale per external_order_id
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .or(accountScope(connectionId))
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const r of (data ?? []) as OverwriteSaleRow[]) rows.set(r.id, r);
  }
  const covered = new Set([...rows.values()].map((r) => orderOf(r.external_order_id)));
  const missing = [...orderLinkedNetFees(txns)]
    .filter(([orderId, byCurrency]) => !covered.has(orderId) && [...byCurrency.values()].some((f) => f.advertising_fee !== undefined))
    .map(([orderId]) => orderId);
  const firsts = await mapLimit(missing, WRITE_CONCURRENCY, async (orderId) => {
    const { data, error } = await client
      .from("sales")
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .or(accountScope(connectionId))
      .like("external_order_id", `${orderId}:%`)
      .order("external_order_id")
      .limit(1); // bounded: one row per order
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    return ((data ?? []) as OverwriteSaleRow[])[0];
  });
  for (const r of firsts) if (r) rows.set(r.id, r);
  return [...rows.values()];
}

type Outcome = "applied" | "stale" | "failed" | "denied";

/**
 * Compare-and-set: each change writes only while the field still holds `from` (what
 * the user saw in the preview), and only on this account's (or a legacy unassigned)
 * eBay sale. Never stops midway: every change gets an outcome, so the caller can audit
 * exactly what was written even when some writes error.
 */
export async function applyFeeOverwrites(
  client: IntegrationsClient, changes: ApplyChange[], connectionId: string
): Promise<ApplyResult> {
  const outcomes = await mapLimit(changes, WRITE_CONCURRENCY, async (c): Promise<Outcome> => {
    try {
      const base = client.from("sales").update({ [c.field]: c.to })
        .eq("id", c.saleId).eq("platform", "ebay").or(accountScope(connectionId));
      const { data, error } = await (c.from === null ? base.is(c.field, null) : base.eq(c.field, c.from)).select("id");
      if (error) {
        if (error.code === "42501") return "denied";
        console.error("[feeOverwrite] sales fee overwrite failed:", error.message);
        return "failed";
      }
      return (data?.length ?? 0) > 0 ? "applied" : "stale";
    } catch (err) {
      console.error("[feeOverwrite] sales fee overwrite threw:", err instanceof Error ? err.message : err);
      return "failed";
    }
  });
  return {
    applied: changes.filter((_, i) => outcomes[i] === "applied"),
    stale: changes.filter((_, i) => outcomes[i] === "stale"),
    failed: outcomes.filter((o) => o === "failed" || o === "denied").length,
    permissionDenied: outcomes.includes("denied"),
  };
}

/**
 * Apply response counts: `applied` = order lines (sales) with at least one fee written;
 * `stale` and `failed` = individual fee writes, so a line with one fee written and the
 * other skipped/failed still reports the skip.
 */
export function applyCounts(r: ApplyResult): { applied: number; stale: number; failed: number } {
  return { applied: new Set(r.applied.map((c) => c.saleId)).size, stale: r.stale.length, failed: r.failed };
}
