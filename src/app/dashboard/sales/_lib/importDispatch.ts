/**
 * Extra insert fields for CSV-imported sales: CSV imports never notify a
 * location's dispatcher (057's sales_dispatch_flag honours
 * `dispatch_suppressed` on INSERT). The key is sent only when some location
 * has a dispatcher — that implies 057 is applied; a pre-057 tenant has no
 * such column and PostgREST would reject the whole insert (PGRST204).
 */
export function importDispatchFields(
  locations: ReadonlyArray<{ dispatcher_id?: string | null }>
): { dispatch_suppressed?: true } {
  return locations.some((l) => l.dispatcher_id != null) ? { dispatch_suppressed: true } : {};
}
