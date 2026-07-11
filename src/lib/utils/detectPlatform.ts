import type { SourcePlatform } from "@/types";

export function detectPlatform(url: string): SourcePlatform | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname.includes("amazon")) return "amazon";
  if (hostname.includes("aliexpress")) return "aliexpress";
  return null;
}

const ALIEXPRESS_DOMAIN = "de.aliexpress.com";

/**
 * The seller stores the AliExpress item ID as the eBay SKU (Custom Label).
 * True when the SKU looks like one (all digits, plausible length).
 */
export function isAliExpressSku(sku: string | null | undefined): sku is string {
  return !!sku && /^\d{6,20}$/.test(sku);
}

/** Builds the AliExpress product URL from a numeric SKU (item ID). */
export function aliExpressUrlFromSku(sku: string): string {
  return `https://${ALIEXPRESS_DOMAIN}/item/${sku}.html`;
}
