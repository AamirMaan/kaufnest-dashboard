import type { Sale, Expense, Purchase } from "@/types";
import type { AuditAction } from "@/types";

export type DatePreset =
  | "all"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "custom";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getPresetRange(preset: DatePreset): { from: string; to: string } | null {
  const now = new Date();
  switch (preset) {
    case "this_month":
      return {
        from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "last_month":
      return {
        from: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: fmt(new Date(now.getFullYear(), q * 3, 1)),
        to: fmt(new Date(now.getFullYear(), q * 3 + 3, 0)),
      };
    }
    case "this_year":
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    default:
      return null;
  }
}

/**
 * Resolve a preset (or custom from/to pair) into a concrete date range.
 * Returns null when no filtering should be applied (e.g. "all").
 */
export function resolveDateRange(
  preset: DatePreset,
  dateFrom: string,
  dateTo: string
): { from: string; to: string } | null {
  if (preset === "custom") {
    if (!dateFrom && !dateTo) return null;
    return { from: dateFrom || "0000-00-00", to: dateTo || "9999-99-99" };
  }
  return getPresetRange(preset);
}

export interface SalesFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  platform: string;
  currency: string;
  status: string;
  search: string;
}

export interface ExpenseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  category: string;
  currency: string;
  search: string;
}

export interface PurchaseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  currency: string;
  search: string;
}

export const DEFAULT_SALES_FILTERS: SalesFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  platform: "all",
  currency: "all",
  status: "all",
  search: "",
};

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  category: "all",
  currency: "all",
  search: "",
};

export const DEFAULT_PURCHASE_FILTERS: PurchaseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  currency: "all",
  search: "",
};

export interface AuditLogFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  action: AuditAction | "all";
  user_id: string;
}

export const DEFAULT_AUDIT_LOG_FILTERS: AuditLogFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  action: "all",
  user_id: "all",
};

/**
 * Escapes a user-typed search term for safe embedding in a PostgREST
 * `.or()`/`.ilike()` value that the caller wraps in double quotes
 * (`column.ilike."%${term}%"`). Order matters: backslash first (so later
 * escapes aren't double-escaped), then `"` (PostgREST's quoted-value escape,
 * required because the caller wraps the value in quotes to make reserved
 * characters — `,` `.` `:` `(` `)` — inert without per-character escaping),
 * then `%`/`_` (LIKE wildcards — escaped so literal input doesn't behave as
 * a wildcard).
 */
export function sanitizeIlikeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

// Canonical revenue-eligibility rule — update here to change everywhere.
/** Returns true for sales that count toward revenue (not returned, not cancelled). */
export function isRevenueSale(sale: { status: string | null }): boolean {
  return sale.status !== "returned" && sale.status !== "cancelled";
}

/**
 * Canonical "is this sale an eBay order eligible for status push-back" rule —
 * update here to change everywhere (EditSaleModal + the sync-status route).
 *
 * The `":"` check is load-bearing, not defensive noise. A synced eBay order's
 * `external_order_id` is `"${orderId}:${lineItemId}"` (see
 * `lib/integrations/mapToSale.ts` and `lib/integrations/SKILL.md`'s dedup-key
 * contract), and the sync route splits it on the LAST `":"` to recover both
 * ids. A **CSV-imported** eBay row (`sales/_components/importFormats.ts`) sets
 * `external_order_id` straight from a plain `order_id` column with no
 * line-item suffix — that string has no `":"`, so the split falls back to
 * using the whole value as BOTH `orderId` and `lineItemId`, which eBay's API
 * always rejects. Such a row would be a guaranteed, permanent sync failure, so
 * it must not render the Carrier/Tracking fields or reach the route at all.
 *
 * Lives here (next to `isRevenueSale`) rather than in `lib/integrations/`
 * because `EditSaleModal` is a Client Component and the project verifier
 * blocks `@/lib/integrations/*` imports from `"use client"` files.
 */
export function isEbayIntegrationSyncedSale(sale: {
  platform: string;
  external_order_id: string | null;
}): boolean {
  return (
    sale.platform === "ebay" &&
    !!sale.external_order_id &&
    sale.external_order_id.includes(":")
  );
}

function matchesSearch(term: string, ...fields: (string | null)[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export function filterSales(sales: Sale[], f: SalesFilters): Sale[] {
  let result = sales;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((s) => s.date >= range.from && s.date <= range.to);
  if (f.platform !== "all") result = result.filter((s) => s.platform === f.platform);
  if (f.currency !== "all") result = result.filter((s) => s.currency === f.currency);
  if (f.status !== "all") result = result.filter((s) => s.status === f.status);
  if (f.search.trim())
    result = result.filter((s) =>
      matchesSearch(f.search, s.product_name, s.external_order_id, s.description)
    );
  return result;
}

export function filterExpenses(expenses: Expense[], f: ExpenseFilters): Expense[] {
  let result = expenses;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((e) => e.date >= range.from && e.date <= range.to);
  if (f.category !== "all") result = result.filter((e) => e.category === f.category);
  if (f.currency !== "all") result = result.filter((e) => e.currency === f.currency);
  if (f.search.trim())
    result = result.filter((e) =>
      matchesSearch(f.search, e.title, e.vendor, e.description, e.invoice_number)
    );
  return result;
}

export function filterPurchases(purchases: Purchase[], f: PurchaseFilters): Purchase[] {
  let result = purchases;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((p) => p.date >= range.from && p.date <= range.to);
  if (f.currency !== "all") result = result.filter((p) => p.currency === f.currency);
  if (f.search.trim())
    result = result.filter((p) =>
      matchesSearch(f.search, p.product_name, p.vendor, p.description)
    );
  return result;
}

export function isDefaultFilters(f: SalesFilters | ExpenseFilters | PurchaseFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.currency === "all" &&
    f.search === "" &&
    ("platform" in f ? f.platform === "all" : true) &&
    ("status" in f ? f.status === "all" : true) &&
    ("category" in f ? f.category === "all" : true)
  );
}

export function isDefaultAuditLogFilters(f: AuditLogFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.action === "all" &&
    f.user_id === "all"
  );
}
