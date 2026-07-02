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
}

export interface ExpenseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  category: string;
  currency: string;
}

export interface PurchaseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  vendor: string;
  currency: string;
}

export const DEFAULT_SALES_FILTERS: SalesFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  platform: "all",
  currency: "all",
  status: "all",
};

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  category: "all",
  currency: "all",
};

export const DEFAULT_PURCHASE_FILTERS: PurchaseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  vendor: "",
  currency: "all",
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

export function filterSales(sales: Sale[], f: SalesFilters): Sale[] {
  let result = sales;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((s) => s.date >= range.from && s.date <= range.to);
  if (f.platform !== "all") result = result.filter((s) => s.platform === f.platform);
  if (f.currency !== "all") result = result.filter((s) => s.currency === f.currency);
  if (f.status !== "all") result = result.filter((s) => s.status === f.status);
  return result;
}

export function filterExpenses(expenses: Expense[], f: ExpenseFilters): Expense[] {
  let result = expenses;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((e) => e.date >= range.from && e.date <= range.to);
  if (f.category !== "all") result = result.filter((e) => e.category === f.category);
  if (f.currency !== "all") result = result.filter((e) => e.currency === f.currency);
  return result;
}

export function filterPurchases(purchases: Purchase[], f: PurchaseFilters): Purchase[] {
  let result = purchases;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((p) => p.date >= range.from && p.date <= range.to);
  if (f.vendor.trim())
    result = result.filter((p) =>
      p.vendor?.toLowerCase().includes(f.vendor.toLowerCase())
    );
  if (f.currency !== "all") result = result.filter((p) => p.currency === f.currency);
  return result;
}

export function isDefaultFilters(f: SalesFilters | ExpenseFilters | PurchaseFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.currency === "all" &&
    ("platform" in f ? f.platform === "all" : true) &&
    ("status" in f ? f.status === "all" : true) &&
    ("category" in f ? f.category === "all" : true) &&
    ("vendor" in f ? f.vendor === "" : true)
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
