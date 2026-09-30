import type {
  ExpensesOverview,
  PayoutsOverview,
  PlatformBalance,
  RunningPlatformBalance,
  SalesOverview,
} from "./overviewTypes";


/**
 * Subtracts the amount already transferred to a platform from a
 * pre-computed balance. The caller is responsible for pre-summing
 * transferred amounts by date range and platform first (the
 * get_payouts_overview RPC does this server-side).
 *
 * @param balance - pre-computed balance for the platform
 * @param transferred - total amount already paid out for the platform in the period
 * @returns balance minus transferred
 */
export function computePending(balance: number, transferred: number): number {
  return balance - transferred;
}

/**
 * eBay/Amazon balance card figures: gross sales (items + buyer-paid
 * shipping) minus ad fees, outbound shipping, per-order platform fees
 * (`sales.platform_fee`, migration 053) and the platform-tagged expense subtotal (045's
 * get_expenses_overview matches "ebay"/"amazon" in vendor/title), plus
 * recorded payouts. Null when the platform had no sales in the period —
 * the card is hidden then.
 */
export function computePlatformBalance(
  platform: "ebay" | "amazon",
  salesOverview: SalesOverview | null,
  expensesOverview: ExpensesOverview | null,
  payoutsOverview: PayoutsOverview | null,
  running?: RunningPlatformBalance[] | null
): PlatformBalance | null {
  const bucket = salesOverview?.platformBalance.find((p) => p.platform === platform);
  if (!bucket) return null;
  const expenses = expensesOverview?.platformSubtotal.find((p) => p.platform === platform)?.amount ?? 0;
  // `?? 0`: a tenant whose RPC predates migration 053 doesn't return it yet.
  const platformFees = bucket.platformFees ?? 0;
  const balance = bucket.sales - bucket.adFees - bucket.shippingFees - platformFees - expenses;
  const transferred = payoutsOverview?.transferred.find((p) => p.platform === platform)?.amount ?? 0;
  // Money stays in the platform account across periods, so "still in
  // account" needs everything earned/transferred up to the range end — a
  // July payout for June sales must not vanish when "This month" is picked.
  const run = running?.find((r) => r.platform === platform);
  return {
    balance,
    sales: bucket.sales,
    adFees: bucket.adFees,
    shippingFees: bucket.shippingFees,
    platformFees,
    expenses,
    transferred,
    pending: run ? computePending(run.earned - run.expenses, run.transferred) : computePending(balance, transferred),
    pendingIsRunning: !!run,
    count: bucket.count,
  };
}

/**
 * Cut-off date for the running "still in account" balance: the picked
 * range's end, capped at today (a "This year" range ends 31 Dec, but the
 * balance can only be known up to now); today for an open range.
 */
export function runningBalanceAsOf(to: string | null, today: Date): string {
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${mm}-${dd}`;
  return to && to < todayIso ? to : todayIso;
}
