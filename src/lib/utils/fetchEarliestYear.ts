/**
 * Resolves the earliest year a feature has data for, driven by a
 * caller-provided fetch of the single earliest row's date value — same
 * test-friendly callback-injection shape as `fetchAllRows`, so this stays
 * unit-testable without a live Supabase client. The caller is responsible
 * for the actual query, e.g.:
 *
 * ```ts
 * const year = await fetchEarliestYear(async () => {
 *   const { data } = await supabase
 *     .from("sales")
 *     .select("date")
 *     .order("date", { ascending: true })
 *     .limit(1)
 *     .maybeSingle();
 *   return data?.date ?? null;
 * });
 * ```
 *
 * Used to populate the "Specific period" filter's Year select lower bound
 * (see `components/ui/FilterBar.tsx` and `dashboard/page.tsx`).
 *
 * @param fetchEarliestDate - resolves the earliest row's date/timestamp
 *   string, or `null` when the table has no rows
 * @param fallback - returned when no date is found, it can't be parsed, or
 *   the parsed year is implausible (outside 1970..currentYear+1 — guards
 *   against corrupted date cells, e.g. an Excel import gone wrong, feeding
 *   an unbounded year into the "Specific period" Year select); defaults to
 *   the current year
 */
export async function fetchEarliestYear(
  fetchEarliestDate: () => Promise<string | null>,
  fallback: number = new Date().getFullYear(),
): Promise<number> {
  const value = await fetchEarliestDate();
  if (!value) return fallback;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year >= 1970 && year <= new Date().getFullYear() + 1
    ? year
    : fallback;
}
