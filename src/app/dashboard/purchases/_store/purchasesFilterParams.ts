import { ilikePattern, resolveDateBounds, type PurchaseFilters } from "@/lib/utils/filters";

/** Arg names match `get_purchases_summary` in 050_table_summary_functions.sql exactly. */
export interface PurchasesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_currency: string | null;
  p_pattern: string | null;
}

/** Shared by `fetchPurchasesPage` and `fetchPurchasesSummary`; `"all"`/blank → `null`. */
export function purchasesFilterParams(f: PurchaseFilters): PurchasesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_currency: f.currency === "all" ? null : f.currency,
    p_pattern: ilikePattern(f.search),
  };
}
