export const DEFAULT_PAGE_SIZE = 50;

export interface PageRequest {
  page: number;     // 1-indexed
  pageSize: number;
}

/**
 * Returns the [from, to] range (both inclusive) for a Supabase `.range(from, to)` call.
 * page is 1-indexed.
 *
 * Example: page=1, pageSize=50 → [0, 49]
 */
export function rangeFor({ page, pageSize }: PageRequest): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/**
 * The page to reload after deleting one row from `page`, given the total
 * BEFORE the delete — steps back when the deleted row was the only one on the
 * last page. Shared by Inventory's Transfers tab and the Payouts page.
 */
export function pageAfterRemoval(page: number, pageSize: number, totalBefore: number): number {
  const lastPage = Math.ceil(Math.max(0, totalBefore - 1) / pageSize);
  return Math.max(1, Math.min(page, lastPage));
}
