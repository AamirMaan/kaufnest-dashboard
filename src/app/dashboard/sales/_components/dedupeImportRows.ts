import type { ParsedRow } from "./importFormats";

/**
 * In-file dedupe + composite-key disambiguation for a parsed import batch.
 *
 * The DB enforces a NON-PARTIAL unique index on sales(platform,
 * external_order_id) (migration 008) — the same index the eBay platform
 * sync upsert relies on as its ON CONFLICT target, so it cannot be widened
 * to include `sku` without breaking that unrelated feature. A multi-line
 * Amazon order (one sheet row per SKU) shares one order_id across all its
 * lines, so inserting more than one of them under the bare order_id would
 * violate that index and fail the WHOLE insert batch — worse than the
 * original bug, which at least let the rest of the file through.
 *
 * Fix: when a row carries a `sku`, its `external_order_id` is rewritten to
 * the composite form `${orderId}:${sku}` — the same disambiguation eBay
 * sync already uses (`"12-34567-89012:001"`, order id + line item id) — so
 * distinct-SKU lines of one order become distinct, insertable rows. This
 * is applied to EVERY sku-carrying row, not just ones that collide in this
 * file, so a later refund against the same order (in a different import,
 * a different month) can deterministically reconstruct the identical key
 * from its own `sku` field without needing to know anything about the
 * original import batch (see `ImportSalesModal.tsx`'s refund matcher).
 *
 * Two lines sharing BOTH order id and sku are genuinely the same product
 * line split across two sheet rows (confirmed live: 4 of 1012 lines in a
 * real May 2026 report) and are MERGED — quantity/total_amount/vat_amount
 * summed — rather than composed into two rows, since they'd otherwise
 * collide on the identical composite key anyway.
 *
 * Scoped to `platform === "amazon"` ONLY — not merely "this row came from
 * the amazon-format parser" (a generic-format row can carry any typed
 * platform value). `lib/utils/filters.ts`'s `isEbayIntegrationSyncedSale`
 * tests `external_order_id?.includes(":")` as its ENTIRE test for "this is
 * a real eBay-platform-synced order, eligible for the order-status
 * push-back to eBay's API" — a composited eBay row would satisfy that
 * check despite never having gone through the Integrations sync pipeline,
 * wrongly making it eligible for a push-back that can only ever fail (see
 * that function's doc comment). Amazon has no such identifier collision to
 * protect, and it's the only platform this bug was ever confirmed on.
 *
 * A row with no sku that collides on order_id with another row cannot be
 * disambiguated this way — it falls back to the pre-existing behavior
 * (first survives, the rest marked "duplicate in file"). The same fallback
 * applies to every non-Amazon row, sku or not.
 *
 * KNOWN TRANSITIONAL CAVEAT: a multi-line order whose extra lines were
 * already dropped by the OLD (pre-fix) behavior has its one surviving line
 * stored under the bare order_id in the DB today. Re-importing that same
 * historical file after this fix composes BOTH lines' keys, neither of
 * which matches the old bare-keyed row already in the DB — so both would
 * be inserted as "new" rather than recognized as one already-imported
 * line plus one genuinely new one. This only affects a re-import of an
 * already-processed multi-line-order file from before this fix; every
 * multi-line order imported from now on is stored consistently under
 * composite keys and dedupes correctly on any later re-import.
 */
export function dedupeImportRows(rows: ParsedRow[]): ParsedRow[] {
  const merged = new Map<string, ParsedRow>();
  const passthrough: ParsedRow[] = [];
  const order: string[] = [];
  // Fallback collision tracking for rows with no sku to disambiguate with —
  // keyed the same (old, bare) way this dedupe worked before this fix.
  const noSkuSeen = new Set<string>();

  for (const row of rows) {
    if (row.isRefund || !row.data?.external_order_id) {
      passthrough.push(row);
      continue;
    }
    const orderId = row.data.external_order_id;
    const sku = row.data.platform === "amazon" ? row.sku?.trim() || null : null;

    if (!sku) {
      const bareKey = `${row.data.platform}:${orderId}`;
      if (noSkuSeen.has(bareKey)) {
        passthrough.push({ ...row, skipped: "duplicate in file" });
        continue;
      }
      noSkuSeen.add(bareKey);
      passthrough.push(row);
      continue;
    }

    const composedOrderId = `${orderId}:${sku}`;
    const key = `${row.data.platform}:${composedOrderId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, data: { ...row.data, external_order_id: composedOrderId } });
      order.push(key);
      continue;
    }
    if (!existing.data || !row.data) continue; // type guard; both are non-null per the checks above
    existing.data = {
      ...existing.data,
      quantity: existing.data.quantity + row.data.quantity,
      total_amount: existing.data.total_amount + row.data.total_amount,
      vat_amount:
        existing.data.vat_amount === null && row.data.vat_amount === null
          ? null
          : (existing.data.vat_amount ?? 0) + (row.data.vat_amount ?? 0),
      // Summed like the other money fields — keeping only the first line's
      // shipping silently dropped the second line's.
      shipping_charged:
        existing.data.shipping_charged == null && row.data.shipping_charged == null
          ? null
          : round2((existing.data.shipping_charged ?? 0) + (row.data.shipping_charged ?? 0)),
    };
  }

  return [...order.map((k) => merged.get(k)!), ...passthrough];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Collapses REFUND rows that target the same order line (platform + order id
 * + sku) into ONE refund carrying the summed amounts.
 *
 * Amazon writes one REFUND row per refunded unit: order
 * 303-6005161-3164360 (16 units of one SKU) has 13 separate REFUND rows
 * worth €350.86 in its September 2026 report. The refund matcher treats a
 * sale's `refunded_amount` as its "already refunded" marker, so before this
 * the first row was applied (€26.99) and the other twelve were reported as
 * "already applied" and dropped. Merging in-file first means the whole
 * month's refund for that line lands in one deduction.
 *
 * Refunds for the same line in a LATER file are still skipped by that
 * marker — this only covers rows that arrive together.
 *
 * Non-refund rows, and refunds that are skipped or errored, pass through
 * untouched and in their original order; a merged refund keeps the position
 * (and rowNum) of its first row.
 */
export function mergeRefundRows(rows: ParsedRow[]): ParsedRow[] {
  const byKey = new Map<string, ParsedRow>();
  const out: ParsedRow[] = [];
  for (const row of rows) {
    const r = row.refund;
    if (!row.isRefund || !r || row.skipped || row.error) {
      out.push(row);
      continue;
    }
    const key = `${r.platform}:${r.externalOrderId}:${row.sku?.trim().toLowerCase() ?? ""}:${r.currency ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      const copy: ParsedRow = { ...row, refund: { ...r } };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    const e = existing.refund!;
    existing.refund = {
      ...e,
      amount: round2(e.amount + r.amount),
      itemAmount: round2(e.itemAmount + r.itemAmount),
      shippingAmount: round2(e.shippingAmount + r.shippingAmount),
      vatAmount:
        e.vatAmount === null && r.vatAmount === null ? null : round2((e.vatAmount ?? 0) + (r.vatAmount ?? 0)),
    };
  }
  return out;
}
