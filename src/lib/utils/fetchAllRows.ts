/**
 * Paginates a Supabase query past the PostgREST project's "Max Rows" API
 * setting, which silently truncates any single request — including one with
 * an explicit `.limit()` above that setting — to its configured max (Supabase
 * default: 1000), with no error. Confirmed live on `tenant_k2_textil`: a
 * `.limit(5000)` sales query returned `Content-Range: 0-999/1510`.
 *
 * `fetchPage` is called with successive `[from, to]` ranges; each call's
 * actual returned row count (not the requested range width) drives how far
 * the offset advances, so this self-adapts to whatever the server's true
 * per-request cap is instead of assuming it matches the requested width.
 *
 * When the real row count exceeds `cap`, logs a structured
 * `console.warn("[fetchAllRows] cap reached", { cap, total })` — this is
 * the signal that a table has outgrown client-side aggregation and a
 * caller (e.g. the Overview page) should move to server-side aggregation.
 * See BACKEND_ARCHITECTURE_PRINCIPLES.md section 2.
 *
 * @param fetchPage - given from/to reads one .range(from, to) page
 * @param cap - overall row cap across all pages
 * @returns up to `cap` rows, or fewer accumulated so far if a page errors
 */
export async function fetchAllRows<T>(
  fetchPage: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: unknown; count: number | null }>,
  cap: number
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  let total = cap;

  while (offset < Math.min(total, cap)) {
    const to = Math.min(offset + 999, cap - 1);
    const { data, error, count } = await fetchPage(offset, to);
    if (error || !data || data.length === 0) break;
    if (count != null) total = count;
    results.push(...data);
    offset += data.length;
  }

  if (total > cap) {
    console.warn("[fetchAllRows] cap reached", { cap, total });
  }

  return results;
}
