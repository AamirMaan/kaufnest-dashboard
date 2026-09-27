/**
 * Concrete hex colors for the Overview charts. recharts props are SVG
 * attributes, where CSS custom properties don't resolve reliably, so the
 * theme tokens are mirrored here as hex values per light/dark theme.
 */

export const PLATFORM_COLORS: Record<string, string> = {
  amazon: "#F59E0B",
  ebay: "#3B82F6",
  etsy: "#EF4444",
  shopify: "#10B981",
  other: "#8B5CF6",
};

export const CATEGORY_COLORS: Record<string, string> = {
  shipping: "#3B82F6",
  advertising: "#EC4899",
  software: "#8B5CF6",
  office: "#14B8A6",
  inventory: "#F59E0B",
  tax: "#EF4444",
  salary: "#10B981",
  other: "#64748B",
};

const FALLBACK_COLORS = ["#6366F1", "#EC4899", "#14B8A6", "#F97316", "#84CC16"];

/** Named color for a known platform/category, else a fallback picked by series index. */
export function seriesColor(key: string, index: number): string {
  const k = key.toLowerCase();
  return PLATFORM_COLORS[k] ?? CATEGORY_COLORS[k] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export interface ChartTheme {
  grid: string;
  tick: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipLabel: string;
  /** Revenue, sales, gains — mirrors --color-primary/--color-success. */
  positive: string;
  /** Costs — mirrors --color-danger. */
  negative: string;
  /** Neutral series (transfers, purchases, order counts). */
  neutral: string;
  /** Pending balance — mirrors --color-warning. */
  pending: string;
}

export function chartTheme(isDark: boolean): ChartTheme {
  return {
    grid: isDark ? "#334155" : "#e2e8f0",
    tick: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#1e293b" : "#ffffff",
    tooltipBorder: isDark ? "#334155" : "#e2e8f0",
    tooltipLabel: isDark ? "#cbd5e1" : "#334155",
    positive: "#059669",
    negative: "#dc2626",
    neutral: isDark ? "#60a5fa" : "#3b82f6",
    pending: "#d97706",
  };
}

/** Short axis label: `€1.2K`, `$350`, `-€4K`. */
export function compactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
