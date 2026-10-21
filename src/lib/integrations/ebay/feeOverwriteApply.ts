import { FEE_OVERWRITE_MAX_CHANGES } from "@/lib/utils/feeOverwriteAccess";
import { OVERWRITE_FIELDS, type ApplyChange, type OverwriteField } from "./feeOverwrite";

/** Upper bound on one apply request; the modal batches by the same shared constant. */
export const MAX_APPLY_CHANGES = FEE_OVERWRITE_MAX_CHANGES;

export type ParsedFeeOverwriteApply =
  | { ok: true; connectionId: string; changes: ApplyChange[] }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Validates POST /api/integrations/ebay/fees/apply's body. Pure. */
export function parseFeeOverwriteApply(body: unknown): ParsedFeeOverwriteApply {
  const b = (body ?? {}) as { connectionId?: unknown; changes?: unknown };
  if (typeof b.connectionId !== "string" || !b.connectionId) return { ok: false, error: "connectionId is required" };
  if (!Array.isArray(b.changes) || b.changes.length === 0) return { ok: false, error: "No changes to apply" };
  if (b.changes.length > MAX_APPLY_CHANGES) return { ok: false, error: `At most ${MAX_APPLY_CHANGES} changes per request` };
  const seen = new Set<string>();
  const changes: ApplyChange[] = [];
  for (const raw of b.changes) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c.saleId !== "string" || !UUID.test(c.saleId)) return { ok: false, error: "Invalid change" };
    if (!OVERWRITE_FIELDS.includes(c.field as OverwriteField)) return { ok: false, error: "Invalid change" };
    if (!isMoney(c.to) || !(c.from === null || isMoney(c.from))) return { ok: false, error: "Invalid change" };
    const key = `${c.saleId}:${c.field}`;
    if (seen.has(key)) return { ok: false, error: "Duplicate change" };
    seen.add(key);
    changes.push({ saleId: c.saleId, field: c.field as OverwriteField, from: c.from, to: c.to });
  }
  return { ok: true, connectionId: b.connectionId, changes };
}
