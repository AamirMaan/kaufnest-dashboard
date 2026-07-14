import type { DropshipListing } from "@/types";

/**
 * Gross margin percentage: (sell − effective cost) / sell × 100, where
 * effective cost includes the flat EU customs fee on top of the supplier
 * price. Returns null when there's no supplier price yet, or when the
 * supplier and selling currencies don't match (comparison would be
 * misleading without a conversion rate).
 */
export function computeMarginPct(listing: DropshipListing): number | null {
  if (listing.supplier_price == null) return null;
  if (listing.supplier_currency !== listing.currency) return null;

  const effectiveCost = listing.supplier_price + listing.customs_tax_amount;
  return ((listing.current_price - effectiveCost) / listing.current_price) * 100;
}

export function marginBadgeVariant(marginPct: number): "success" | "warning" | "danger" {
  if (marginPct < 10) return "danger";
  if (marginPct < 25) return "warning";
  return "success";
}
