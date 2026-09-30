/**
 * Home's per-platform stat cards: one entry per platform with sales in the
 * period, largest revenue first. eBay/Amazon also carry the balance figures
 * (045's `platformBalance` only buckets those two), other platforms show
 * revenue and share only.
 */
import { computePlatformBalance } from "./platformBalance";
import type {
  ExpensesOverview, PayoutsOverview, PlatformBalance, RunningPlatformBalance, SalesOverview,
} from "./overviewTypes";

export interface PlatformStat {
  platform: string;
  /** Effective revenue from `revenueByPlatform`. */
  revenue: number;
  /** Share of positive total revenue, 0–100; 0 when the platform nets ≤ 0. */
  sharePct: number;
  /** Balance breakdown — eBay/Amazon only, null otherwise. */
  balance: PlatformBalance | null;
}

export function buildPlatformStats(
  sales: SalesOverview | null,
  expenses: ExpensesOverview | null,
  payouts: PayoutsOverview | null,
  running?: RunningPlatformBalance[] | null
): PlatformStat[] {
  const rows = sales?.revenueByPlatform ?? [];
  const positiveTotal = rows.reduce((a, r) => a + Math.max(r.value, 0), 0);
  return rows
    .map((r) => ({
      platform: r.platform,
      revenue: r.value,
      sharePct: positiveTotal > 0 && r.value > 0 ? (r.value / positiveTotal) * 100 : 0,
      balance:
        r.platform === "ebay" || r.platform === "amazon"
          ? computePlatformBalance(r.platform, sales, expenses, payouts, running)
          : null,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.platform.localeCompare(b.platform));
}
