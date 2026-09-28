/**
 * Marketplace = the regional storefront an order was sold on (amazon.de,
 * ebay.co.uk, …) — finer than `Sale.platform` ("amazon"). Stored on
 * `sales.marketplace` (migration 052) as a lower-case domain; null means
 * unknown. Pure and dependency-free: used by the Sales CSV importer, the
 * server-side eBay/Amazon adapters, and the Add/Edit Sale modals.
 */

/** Filter-bar / RPC sentinel for "orders with no marketplace". Must match 052's SQL. */
export const UNKNOWN_MARKETPLACE = "__unknown__";

/** eBay API site ids whose domain suffix isn't simply the lower-cased country code. */
const EBAY_SITE_DOMAINS: Record<string, string> = {
  GB: "ebay.co.uk",
  UK: "ebay.co.uk",
  US: "ebay.com",
  MOTORS_US: "ebay.com",
  AU: "ebay.com.au",
};

/** Bare platform names say nothing about the market. */
const NO_MARKET = new Set(["amazon", "ebay", "etsy", "shopify", "other"]);

export function normalizeMarketplace(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;

  const ebayId = /^ebay_(.+)$/i.exec(s);
  if (ebayId) {
    const site = ebayId[1].toUpperCase();
    return EBAY_SITE_DOMAINS[site] ?? `ebay.${site.toLowerCase()}`;
  }

  const lower = s.toLowerCase().replace(/^www\./, "");
  return NO_MARKET.has(lower) ? null : lower;
}

export function marketplaceLabel(m: string | null | undefined): string {
  return m ? m : "Unknown";
}
