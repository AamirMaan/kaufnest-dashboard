import type { Sale } from "@/types";

export interface FeeBreakdown {
  lines: { label: string; amount: number | null }[];
  total: number;
}

/**
 * Seller-cost fee lines for the Orders expanded row. Same sum as the old
 * "Fees" column (shipping_cost + advertising_fee + platform_fee);
 * shipping_charged is buyer-facing and deliberately excluded.
 * Null when no fee is recorded.
 */
export function feeBreakdown(
  sale: Pick<Sale, "shipping_cost" | "advertising_fee" | "platform_fee">,
): FeeBreakdown | null {
  const lines = [
    { label: "Shipping", amount: sale.shipping_cost },
    { label: "Advertising", amount: sale.advertising_fee },
    { label: "Platform fee", amount: sale.platform_fee },
  ];
  if (lines.every((l) => l.amount == null)) return null;
  const total = Math.round(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0) * 100) / 100;
  return { lines, total };
}
