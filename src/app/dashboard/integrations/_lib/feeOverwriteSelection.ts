/**
 * Client side of the eBay fee overwrite (FeeOverwriteModal). Mirrors the response
 * shapes of src/lib/integrations/ebay/feeOverwrite.ts without importing that
 * server-only module. Pure.
 */
import { FEE_OVERWRITE_MAX_CHANGES } from "@/lib/utils/feeOverwriteAccess";

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

/**
 * Rows per apply request. A row carries at most 2 fee changes, so this keeps every
 * request within the route's FEE_OVERWRITE_MAX_CHANGES, and a line's two fees always
 * travel in the same request (so the line counts add up across batches).
 */
export const APPLY_BATCH_ROWS = Math.floor(FEE_OVERWRITE_MAX_CHANGES / 2);

/** Splits rows into request-sized batches. */
export function batchRows<T>(rows: T[], size = APPLY_BATCH_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Apply route counts: `applied`/`stale` are order lines (sales), `failed` is fee writes. */
export interface ApplyCounts { applied: number; stale: number; failed: number }

export function addApplyCounts(a: ApplyCounts, b: Partial<ApplyCounts>): ApplyCounts {
  return { applied: a.applied + (b.applied ?? 0), stale: a.stale + (b.stale ?? 0), failed: a.failed + (b.failed ?? 0) };
}

export function applySummary(r: Pick<ApplyCounts, "applied" | "stale">): string {
  const head = `Updated fees on ${plural(r.applied, "order line", "order lines")}.`;
  return r.stale > 0
    ? `${head} ${plural(r.stale, "order line was", "order lines were")} skipped — changed since the preview, or you can't edit orders.`
    : head;
}
