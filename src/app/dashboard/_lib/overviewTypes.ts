/**
 * Response shapes of the Overview page's RPCs — the four 045 aggregates
 * (get_sales_overview / get_expenses_overview / get_purchases_overview /
 * get_payouts_overview), 051's get_overview_timeseries, and 052's
 * get_sales_by_marketplace. Page-only data, so these live with the page
 * rather than in src/types.
 */
import type { ExpenseCategory } from "@/types";

export interface MonthlyBucket {
  month: string;
  revenue?: number;
  amount?: number;
}

export interface SalesOverview {
  orderCount: number;
  effectiveOrderCount: number;
  unitsSold: number;
  revenue: number;
  fees: number;
  vatCollected: number;
  revenueByPlatform: { platform: string; value: number }[];
  topProducts: { name: string; revenue: number; units: number }[];
  monthlyRevenue: MonthlyBucket[];
  platformBalance: {
    platform: string;
    /** Items + buyer-paid shipping (053; items only before). */
    sales: number;
    adFees: number;
    shippingFees: number;
    /** Sum of per-order `platform_fee` (053). Absent from a pre-053 RPC — read with `?? 0`. */
    platformFees?: number;
    count: number;
  }[];
}

export interface ExpensesOverview {
  total: number;
  vatPaid: number;
  byCategory: { category: ExpenseCategory; amount: number }[];
  monthlyExpenses: MonthlyBucket[];
  platformSubtotal: { platform: string; amount: number }[];
}

export interface PurchasesOverview {
  total: number;
  vatPaid: number;
  monthlyPurchases: MonthlyBucket[];
}

export interface PayoutsOverview {
  transferred: { platform: string; amount: number }[];
}

/** One zero-filled month from get_overview_timeseries. */
export interface OverviewMonth {
  /** `YYYY-MM` */
  month: string;
  /** Effective (not returned/cancelled) revenue incl. shipping charged, per platform. */
  revenue_by_platform: Record<string, number>;
  /** Every order, including returned/cancelled. */
  orders: number;
  returned_cancelled: number;
  /** Shipping cost + advertising fee + platform fee of effective orders. */
  fees: number;
  expenses_by_category: Record<string, number>;
  expenses: number;
  purchases: number;
  /** Units bought (purchases.quantity). */
  units: number;
  vat_collected: number;
  vat_paid: number;
}

export interface OverviewTimeseries {
  months: OverviewMonth[];
  /**
   * The period right before the selected range; null for open ranges. Since
   * 054 a range of whole calendar months (every preset) compares against the
   * same number of preceding months; other ranges use the equal-length window.
   */
  previous: {
    revenue: number;
    expenses: number;
    purchases: number;
    /** All orders, incl. returned/cancelled. */
    orders: number;
    /** Orders excluding returned/cancelled (054; absent before). */
    effective_orders?: number;
    fees: number;
  } | null;
  top_vendor: { name: string; amount: number } | null;
}

/**
 * One row per eBay/Amazon from get_platform_running_balance (054): totals
 * from the first record through the range end (all time when open), so
 * "still in account" is a real running balance, not a single period's.
 */
export interface RunningPlatformBalance {
  platform: string;
  /** Sales + buyer-paid shipping − ad fees − shipping cost − platform fees. */
  earned: number;
  /** Expense records whose vendor/title names the platform. */
  expenses: number;
  /** Recorded payouts. */
  transferred: number;
}

export interface PlatformBalance {
  balance: number;
  sales: number;
  adFees: number;
  shippingFees: number;
  /** Per-order platform fees (`sales.platform_fee`) — distinct from `expenses`. */
  platformFees: number;
  /** Expense records whose vendor/title names the platform (045's platformSubtotal). */
  expenses: number;
  transferred: number;
  /** Still in the platform account: the running balance to the range end when available, else balance − transferred for the period. */
  pending: number;
  /** True when `pending` is the running balance (get_platform_running_balance succeeded). */
  pendingIsRunning: boolean;
  count: number;
}

/** One row per marketplace from get_sales_by_marketplace (052). marketplace null = unknown. */
export interface MarketplaceRow {
  marketplace: string | null;
  order_count: number;
  revenue: number;
  vat: number;
  vat_base: number;
}
