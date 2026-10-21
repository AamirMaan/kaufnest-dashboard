/**
 * Client side of the eBay fee overwrite (FeeOverwriteModal). Mirrors the response
 * shapes of src/lib/integrations/ebay/feeOverwrite.ts without importing that
 * server-only module. Pure.
 */
export type OverwriteFeeField = "platform_fee" | "advertising_fee";
export interface FeeChangeDto {
  saleId: string; externalOrderId: string; currency: string; date: string;
  field: OverwriteFeeField; from: number | null; to: number;
}
export interface FeeOverwritePreviewDto { changes: FeeChangeDto[]; currencyMismatch: number; notImported: number }
export interface FeeCell { from: number | null; to: number }
export interface OverwriteRow {
  saleId: string; externalOrderId: string; currency: string; date: string;
  platform_fee?: FeeCell; advertising_fee?: FeeCell;
}

const FIELDS: OverwriteFeeField[] = ["platform_fee", "advertising_fee"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One row per sale (order line), both fee cells merged; first-seen order. */
export function groupOverwriteRows(changes: FeeChangeDto[]): OverwriteRow[] {
  const rows = new Map<string, OverwriteRow>();
  for (const ch of changes) {
    const r = rows.get(ch.saleId) ?? { saleId: ch.saleId, externalOrderId: ch.externalOrderId, currency: ch.currency, date: ch.date };
    r[ch.field] = { from: ch.from, to: ch.to };
    rows.set(ch.saleId, r);
  }
  return [...rows.values()];
}

/** The apply request body for the ticked rows. */
export function applyPayload(connectionId: string, rows: OverwriteRow[], selected: Set<string>) {
  const changes = rows
    .filter((r) => selected.has(r.saleId))
    .flatMap((r) => FIELDS.flatMap((field) => {
      const cell = r[field];
      return cell ? [{ saleId: r.saleId, field, from: cell.from, to: cell.to }] : [];
    }));
  return { connectionId, changes };
}

export function previewSkipNote(p: { currencyMismatch: number; notImported: number }): string | null {
  const parts: string[] = [];
  if (p.notImported > 0) parts.push(plural(p.notImported, "order not imported yet", "orders not imported yet"));
  if (p.currencyMismatch > 0) parts.push(plural(p.currencyMismatch, "fee in a different currency from its order", "fees in a different currency from their orders"));
  return parts.length ? `Not shown: ${parts.join(", ")}.` : null;
}

export function applySummary(r: { applied: number; staleSkipped: number }): string {
  const head = `Updated ${plural(r.applied, "fee", "fees")}.`;
  return r.staleSkipped > 0 ? `${head} ${r.staleSkipped} skipped because they changed since the preview.` : head;
}
