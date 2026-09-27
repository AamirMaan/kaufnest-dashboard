import { ilikePattern, resolveDateBounds, type ExpenseFilters } from "@/lib/utils/filters";

/** Arg names match `get_expenses_summary` in 050_table_summary_functions.sql exactly. */
export interface ExpensesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_category: string | null;
  p_currency: string | null;
  p_pattern: string | null;
}

/** Shared by `fetchExpensesPage` and `fetchExpensesSummary`; `"all"`/blank → `null`. */
export function expensesFilterParams(f: ExpenseFilters): ExpensesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_category: f.category === "all" ? null : f.category,
    p_currency: f.currency === "all" ? null : f.currency,
    p_pattern: ilikePattern(f.search),
  };
}
