import type { DropshipListing } from "@/types";
import { computeMarginPct, marginBadgeVariant } from "./marginMath";

export type MarginFilterBand = "all" | "danger" | "warning" | "success";

/**
 * A listing with no computed margin (no supplier price yet, or a
 * currency mismatch) never matches a specific band — only "all".
 */
export function matchesMarginFilter(listing: DropshipListing, band: MarginFilterBand): boolean {
  if (band === "all") return true;
  const marginPct = computeMarginPct(listing);
  if (marginPct === null) return false;
  return marginBadgeVariant(marginPct) === band;
}

export function matchesListingSearch(listing: DropshipListing, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    listing.title.toLowerCase().includes(needle) ||
    (listing.sku?.toLowerCase().includes(needle) ?? false)
  );
}
