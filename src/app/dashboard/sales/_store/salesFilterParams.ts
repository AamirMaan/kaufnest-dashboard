import { ilikePattern, resolveDateBounds, type SalesFilters } from "@/lib/utils/filters";

/**
 * Arg names match `get_sales_summary` in 050_table_summary_functions.sql,
 * extended by 052_sales_marketplace.sql (trailing `p_marketplace`, plus the
 * `vat_base` output column that param feeds — see below).
 */
export interface SalesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_platform: string | null;
  p_currency: string | null;
  p_status: string | null;
  p_pattern: string | null;
  /** Arg name matches get_sales_summary in 052. */
  p_marketplace: string | null;
  /** Arg name matches get_sales_summary in 056; UNASSIGNED_ACCOUNT = connection_id IS NULL. */
  p_connection_id: string | null;
  /** Arg name matches get_sales_summary in 057; fulfillment_location_id. */
  p_location_id: string | null;
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
    p_marketplace: f.marketplace === "all" ? null : f.marketplace,
    p_connection_id: f.account === "all" ? null : f.account,
    p_location_id: f.location === "all" ? null : f.location,
  };
}

/**
 * `get_sales_summary` RPC args. `p_connection_id` (056) and `p_location_id`
 * (057) are sent only when their filter is set: each has a DEFAULT, and
 * leaving it out keeps the call resolvable against a tenant still on the
 * older function (PostgREST matches functions by named args, so an extra key
 * would 404 with PGRST202).
 */
export function salesSummaryRpcArgs(f: SalesFilters): Omit<SalesSummaryParams, "p_connection_id" | "p_location_id"> & {
  p_connection_id?: string;
  p_location_id?: string;
} {
  const { p_connection_id, p_location_id, ...rest } = salesFilterParams(f);
  return {
    ...rest,
    ...(p_connection_id ? { p_connection_id } : {}),
    ...(p_location_id ? { p_location_id } : {}),
  };
}
