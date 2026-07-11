// Best-effort AliExpress price scraper (server-only).
//
// The seller stores the AliExpress item ID as the eBay SKU (Custom Label), so the
// product URL can be derived directly from a numeric SKU (see
// `isAliExpressSku`/`aliExpressUrlFromSku` in `@/lib/utils/detectPlatform`, shared
// with the client-side table/modal). Scraping parses the price from the page's
// embedded data. AliExpress uses aggressive bot protection (captcha / "punish"
// pages), so every parse path is best-effort and failures surface as a readable
// error, never a crash.

import { isAliExpressSku, aliExpressUrlFromSku } from "@/lib/utils/detectPlatform";
import {
  buildCookieHeader,
  pickBrowserIdentity,
  sessionHeaders,
  toMobileUrl,
  type ScrapeSession,
} from "./session";

export type { ScrapeSession } from "./session";

export interface SupplierPrice {
  price: number;
  currency: string;
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
 * Warms up a scrape session: one homepage request to collect AliExpress's
 * anti-bot cookies, reused for every item-page fetch in the batch so the run
 * looks like a single browsing session. Best-effort — a failed warm-up
 * returns a cookieless session rather than throwing.
 */
export async function createScrapeSession(): Promise<ScrapeSession> {
  const identity = pickBrowserIdentity();
  try {
    const res = await fetch("https://de.aliexpress.com/", {
      redirect: "follow",
      headers: {
        "User-Agent": identity.userAgent,
        ...(identity.clientHints ?? {}),
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
      cache: "no-store",
    });
    return { cookie: buildCookieHeader(res.headers.getSetCookie()), identity };
  } catch {
    return { cookie: "", identity };
  }
}

/** Thrown when AliExpress serves a bot-protection response (punish/captcha/403/429). */
class BlockedError extends Error {}

async function fetchAndParse(url: string, session: ScrapeSession): Promise<SupplierPrice> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: sessionHeaders(session),
      // Never cache supplier prices at the framework level
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach AliExpress. Try again later.");
  }

  if (res.url.includes("punish") || res.status === 403 || res.status === 429) {
    throw new BlockedError(
      "AliExpress blocked the price check (bot protection). Wait a few minutes and try again."
    );
  }

  if (!res.ok) {
    throw new Error(`AliExpress returned ${res.status} — the item may no longer exist.`);
  }

  const html = await res.text();

  if (html.includes("captcha") && html.length < 20000) {
    throw new BlockedError(
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

/**
 * Fetches an AliExpress product page and extracts the (minimum) sale price.
 * When the desktop host blocks the request, retries once via m.aliexpress.com
 * (often less strict). Throws with a user-readable message when both are
 * blocked or when no price is found.
 *
 * Pass a shared session from `createScrapeSession()` for batch runs; omitting
 * it creates a throwaway cookieless session for one-off calls.
 */
export async function scrapeAliExpressPrice(
  url: string,
  session?: ScrapeSession
): Promise<SupplierPrice> {
  const sess = session ?? { cookie: "", identity: pickBrowserIdentity() };
  try {
    return await fetchAndParse(url, sess);
  } catch (err) {
    const mobileUrl = err instanceof BlockedError ? toMobileUrl(url) : null;
    if (!mobileUrl) throw err;
    return fetchAndParse(mobileUrl, sess);
  }
}
