import type { PlatformPayout } from "@/types";

/**
 * Subtracts recorded payouts from a pre-computed platform balance.
 * Caller passes payouts already filtered by date range and platform.
 */
export function computePending(
  balance: number,
  periodPlatformPayouts: PlatformPayout[]
): number {
  const transferred = periodPlatformPayouts.reduce((acc, p) => acc + p.amount, 0);
  return balance - transferred;
}
