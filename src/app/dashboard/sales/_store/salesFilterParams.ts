import { ilikePattern, resolveDateBounds, type SalesFilters } from "@/lib/utils/filters";

/** Arg names match `get_sales_summary` in 050_table_summary_functions.sql exactly. */
export interface SalesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_platform: string | null;
  p_currency: string | null;
  p_status: string | null;
  p_pattern: string | null;
}

/**
 * Single source of truth for how the Orders filter bar narrows rows — used by
 * both `fetchSalesPage` (PostgREST filters) and `fetchSalesSummary` (RPC args).
 * `"all"` / blank → `null` = filter not applied.
 */
export function salesFilterParams(f: SalesFilters): SalesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_platform: f.platform === "all" ? null : f.platform,
    p_currency: f.currency === "all" ? null : f.currency,
    p_status: f.status === "all" ? null : f.status,
    p_pattern: ilikePattern(f.search),
  };
}
