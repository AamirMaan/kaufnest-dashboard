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
