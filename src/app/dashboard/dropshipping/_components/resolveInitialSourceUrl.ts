import { isAliExpressSku, aliExpressUrlFromSku } from "@/lib/utils/detectPlatform";
import type { DropshipListing } from "@/types";

/**
 * URL to prefill in the "Link Source Product" modal: an explicitly linked
 * source_url always wins; otherwise falls back to the AliExpress URL derived
 * from a numeric SKU (item ID), so the admin doesn't have to paste it manually.
 */
export function resolveInitialSourceUrl(listing: DropshipListing | null): string {
  if (!listing) return "";
  if (listing.source_url) return listing.source_url;
  return isAliExpressSku(listing.sku) ? aliExpressUrlFromSku(listing.sku) : "";
}
