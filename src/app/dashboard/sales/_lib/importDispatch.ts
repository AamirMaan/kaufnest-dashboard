/**
 * Extra insert fields for CSV-imported sales: CSV imports never notify a
 * location's dispatcher (057's sales_dispatch_flag honours
 * `dispatch_suppressed` on INSERT). Always sent — deciding from client state
 * (e.g. loaded locations) failed open when that state was empty or stale.
 * A pre-057 tenant has no such column and PostgREST rejects the whole insert
 * with PGRST204; the caller then retries once without the key (nothing to
 * suppress there — no dispatch triggers exist).
 */
export const IMPORT_DISPATCH_FIELDS = { dispatch_suppressed: true } as const;

/** True when an insert failed only because `dispatch_suppressed` is unknown (pre-057). */
export function isMissingDispatchColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && error.code === "PGRST204" && (error.message ?? "").includes("dispatch_suppressed");
}

/** The same rows without the 057-only key, for the pre-057 retry. */
export function withoutDispatchFields<T extends { dispatch_suppressed?: boolean }>(
  rows: ReadonlyArray<T>
): Omit<T, "dispatch_suppressed">[] {
  return rows.map((row) => {
    const rest = { ...row };
    delete rest.dispatch_suppressed;
    return rest;
  });
}
