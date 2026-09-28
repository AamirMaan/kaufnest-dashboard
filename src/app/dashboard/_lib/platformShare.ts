/** Donut data for Analytics' "Revenue by Platform": positive shares, largest first. */
export interface PlatformShare {
  platform: string;
  value: number;
  /** Share of `total`, 0–100 (unrounded; round at display time). */
  pct: number;
}

export function platformShares(
  rows: { platform: string; value: number }[]
): { total: number; shares: PlatformShare[] } {
  // A refund-heavy platform can net negative; a donut can't draw that.
  const positive = rows.filter((r) => r.value > 0);
  const total = positive.reduce((a, r) => a + r.value, 0);
  if (total === 0) return { total: 0, shares: [] };
  const shares = positive
    .map((r) => ({ platform: r.platform, value: r.value, pct: (r.value / total) * 100 }))
    .sort((a, b) => b.value - a.value || a.platform.localeCompare(b.platform));
  return { total, shares };
}
