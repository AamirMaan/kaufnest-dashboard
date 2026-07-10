// Best-effort AliExpress price scraper (server-only).
//
// The seller stores the AliExpress item ID as the eBay SKU (Custom Label), so the
// product URL can be derived directly from a numeric SKU. Scraping parses the
// price from the page's embedded data. AliExpress uses aggressive bot protection
// (captcha / "punish" pages), so every parse path is best-effort and failures
// surface as a readable error, never a crash.

const ALIEXPRESS_DOMAIN = "de.aliexpress.com";

export interface SupplierPrice {
  price: number;
  currency: string;
}

/** True when the SKU looks like an AliExpress item ID (all digits, plausible length). */
export function isAliExpressSku(sku: string | null): sku is string {
  return !!sku && /^\d{6,20}$/.test(sku);
}

/** Builds the product URL from a numeric SKU (AliExpress item ID). */
export function aliExpressUrlFromSku(sku: string): string {
  return `https://${ALIEXPRESS_DOMAIN}/item/${sku}.html`;
}

/**
 * Resolves the URL to scrape for a listing: an explicitly linked AliExpress
 * source_url wins; otherwise fall back to deriving it from a numeric SKU.
 */
export function resolveSupplierUrl(
  sourceUrl: string | null,
  sourcePlatform: string | null,
  sku: string | null
): string | null {
  if (sourceUrl && sourcePlatform === "aliexpress") return sourceUrl;
  if (isAliExpressSku(sku)) return aliExpressUrlFromSku(sku);
  return null;
}

function parseJsonLd(html: string): SupplierPrice | null {
  const blocks = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  if (!blocks) return null;

  for (const block of blocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ""));
      const products = Array.isArray(json) ? json : [json];
      for (const product of products) {
        if (product["@type"] !== "Product" || !product.offers) continue;
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        const price = Number(offers?.price ?? offers?.lowPrice);
        if (Number.isFinite(price) && price > 0) {
          return { price, currency: String(offers.priceCurrency ?? "EUR") };
        }
      }
    } catch {
      // malformed block — try the next one
    }
  }
  return null;
}

function parseOgMeta(html: string): SupplierPrice | null {
  const amount = html.match(/property="og:price:amount"\s+content="([\d.]+)"/);
  if (!amount) return null;
  const currency = html.match(/property="og:price:currency"\s+content="([A-Z]{3})"/);
  return { price: Number(amount[1]), currency: currency?.[1] ?? "EUR" };
}

function parseRunParams(html: string): SupplierPrice | null {
  // e.g. "minAmount":{"currency":"EUR","formatedAmount":"4,99 €","value":4.99}
  const match = html.match(
    /"(?:minAmount|minActivityAmount|salePrice)"\s*:\s*\{[^{}]*"currency"\s*:\s*"([A-Z]{3})"[^{}]*"value"\s*:\s*([\d.]+)/
  );
  if (!match) return null;
  return { price: Number(match[2]), currency: match[1] };
}

/**
 * Fetches an AliExpress product page and extracts the (minimum) sale price.
 * Throws with a user-readable message when blocked or when no price is found.
 */
export async function scrapeAliExpressPrice(url: string): Promise<SupplierPrice> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
      // Never cache supplier prices at the framework level
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach AliExpress. Try again later.");
  }

  if (res.url.includes("punish") || res.status === 403 || res.status === 429) {
    throw new Error(
      "AliExpress blocked the price check (bot protection). Wait a few minutes and try again."
    );
  }

  if (!res.ok) {
    throw new Error(`AliExpress returned ${res.status} — the item may no longer exist.`);
  }

  const html = await res.text();

  if (html.includes("captcha") && html.length < 20000) {
    throw new Error(
      "AliExpress blocked the price check (captcha). Wait a few minutes and try again."
    );
  }

  const price = parseJsonLd(html) ?? parseOgMeta(html) ?? parseRunParams(html);
  if (!price) {
    throw new Error(
      "Could not find a price on the AliExpress page — the item may be unavailable in this region."
    );
  }

  return price;
}
