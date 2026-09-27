/**
 * Response shapes of the Overview page's RPCs — the four 045 aggregates
 * (get_sales_overview / get_expenses_overview / get_purchases_overview /
 * get_payouts_overview) and 051's get_overview_timeseries. Page-only data,
 * so these live with the page rather than in src/types.
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
    sales: number;
    adFees: number;
    shippingFees: number;
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
  /** Equal-length window right before the selected range; null for open ranges. */
  previous: {
    revenue: number;
    expenses: number;
    purchases: number;
    orders: number;
    fees: number;
  } | null;
  top_vendor: { name: string; amount: number } | null;
}

export interface PlatformBalance {
  balance: number;
  sales: number;
  adFees: number;
  shippingFees: number;
  expenses: number;
  transferred: number;
  pending: number;
  count: number;
}
