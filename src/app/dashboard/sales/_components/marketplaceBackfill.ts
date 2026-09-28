import type { ParsedRow } from "./importFormats";

/** What the duplicate pre-check reads back for each matched existing sale. */
export interface ExistingSaleRef {
  id: string;
  marketplace: string | null;
}

/**
 * Pure half of ImportSalesModal's duplicate pre-check. Rows matching an
 * existing sale (key `${platform}:${external_order_id}`) are skipped as
 * "order already exists" — never overwritten — EXCEPT that when the stored
 * sale has no marketplace and this row does, a `backfill` is planned so a
 * re-import of an old report fills in the marketplace (migration 052).
 * A stored non-null marketplace is never changed.
 *
 * REFUND rows pass through untouched: they carry the id of an existing sale
 * by definition, and must reach the refund matcher.
 */
export function markExistingOrders(rows: ParsedRow[], existing: Map<string, ExistingSaleRef>): ParsedRow[] {
  return rows.map((r) => {
    if (r.isRefund || r.skipped || !r.data?.external_order_id) return r;
    const match = existing.get(`${r.data.platform}:${r.data.external_order_id}`);
    if (!match) return r;
    const incoming = r.data.marketplace ?? null;
    const backfill = match.marketplace === null && incoming ? { saleId: match.id, marketplace: incoming } : undefined;
    return backfill ? { ...r, skipped: "order already exists", backfill } : { ...r, skipped: "order already exists" };
  });
}

/** marketplace → sale ids, so the modal issues one UPDATE per distinct value. */
export function groupBackfills(rows: ParsedRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.backfill) continue;
    const ids = out.get(r.backfill.marketplace) ?? [];
    ids.push(r.backfill.saleId);
    out.set(r.backfill.marketplace, ids);
  }
  return out;
}
