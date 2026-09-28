import { marketplaceLabel } from "@/lib/utils/marketplace";
import type { MarketplaceRow } from "./overviewTypes";

export interface MarketplaceShare extends MarketplaceRow {
  label: string;
  /** Share of the positive revenue total, 0–100. */
  sharePct: number;
}

/**
 * Shapes get_sales_by_marketplace rows for MarketplaceCard: revenue desc,
 * Unknown (null) last on ties, share % of the POSITIVE total (a refund-heavy
 * market can net negative — same rule as platformShare.ts).
 */
export function marketplaceShares(rows: MarketplaceRow[]): { total: number; rows: MarketplaceShare[] } {
  const total = rows.reduce((acc, r) => acc + Math.max(0, r.revenue), 0);
  const sorted = [...rows].sort(
    (a, b) => b.revenue - a.revenue || Number(a.marketplace === null) - Number(b.marketplace === null),
  );
  return {
    total,
    rows: sorted.map((r) => ({
      ...r,
      label: marketplaceLabel(r.marketplace),
      sharePct: total > 0 ? Math.round((Math.max(0, r.revenue) / total) * 1000) / 10 : 0,
    })),
  };
}
