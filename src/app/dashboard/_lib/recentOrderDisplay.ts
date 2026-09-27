/** Display helpers for Home's Recent Orders card. */

/** Structural bound for the Recent Orders query — a fixed card size, not business growth. */
export const RECENT_ORDERS_LIMIT = 5;

const PLATFORM_LABELS: Record<string, string> = {
  ebay: "eBay",
  amazon: "Amazon",
  etsy: "Etsy",
  shopify: "Shopify",
  other: "Other",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Buyer name when captured (eBay sync / manual entry), else the platform. */
export function buyerLabel(sale: { buyer_name: string | null; platform: string }): string {
  const name = sale.buyer_name?.trim();
  return name ? name : platformLabel(sale.platform);
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
