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
