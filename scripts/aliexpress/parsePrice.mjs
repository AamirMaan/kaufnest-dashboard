// Pure price/stock parsing helpers for the local AliExpress scrape script.
// Kept dependency-free so they can be unit-tested in isolation.

const CURRENCY_BY_SYMBOL = { "€": "EUR", $: "USD", "£": "GBP" };

/**
 * Normalizes a localized price token to a Number.
 * Handles EU ("1.234,56" / "2,85") and US ("1,234.56" / "3.20") groupings.
 * Returns null when no plausible number is present.
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  const token = String(raw).replace(/[^\d.,]/g, "");
  if (!token) return null;

  const hasComma = token.includes(",");
  const hasDot = token.includes(".");

  let normalized;
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal point; the other groups thousands.
    const decimalSep = token.lastIndexOf(",") > token.lastIndexOf(".") ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = token.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (hasComma) {
    // Lone comma: decimal separator ("2,85") unless it looks like thousands ("1,234").
    normalized = /,\d{3}$/.test(token) ? token.replace(/,/g, "") : token.replace(",", ".");
  } else {
    // Lone dot (or none): treat as decimal unless it looks like thousands ("1.234").
    normalized = /\.\d{3}$/.test(token) && !/\.\d{1,2}$/.test(token)
      ? token.replace(/\./g, "")
      : token;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Maps a currency symbol or ISO code found in text to an ISO-4217 code. */
export function detectCurrency(text, fallback = "EUR") {
  if (!text) return fallback;
  const iso = text.match(/\b(EUR|USD|GBP|PLN|CHF|CZK|SEK|DKK|NOK)\b/);
  if (iso) return iso[1];
  for (const [symbol, code] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (text.includes(symbol)) return code;
  }
  return fallback;
}

/**
 * Extracts { price, currency } from a price string like "€2,85", "2,85 €",
 * "EUR 2,85", "US $3.20". Returns null when no price is found.
 */
export function parsePriceString(text, fallbackCurrency = "EUR") {
  const price = parseAmount(text);
  if (price == null) return null;
  return { price, currency: detectCurrency(text, fallbackCurrency) };
}

/**
 * Pulls an available-stock count from typical AliExpress phrasings:
 * "1000+ available", "Nur noch 3 übrig", "5 verfügbar". Returns null if none.
 */
export function parseStock(text) {
  if (!text) return null;
  const patterns = [
    /(\d[\d.,]*)\s*\+?\s*(?:pieces?\s+)?available/i,
    /(\d[\d.,]*)\s*\+?\s*(?:st(?:ü|u)ck\s+)?verf(?:ü|u)gbar/i,
    /nur\s+noch\s+(\d[\d.,]*)\s+(?:st(?:ü|u)ck\s+)?übrig/i,
    /only\s+(\d[\d.,]*)\s+left/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** True when the SKU looks like an AliExpress item ID (mirrors detectPlatform.ts). */
export function isAliExpressSku(sku) {
  return !!sku && /^\d{6,20}$/.test(String(sku));
}

/** Resolves the AliExpress URL to scrape for a listing (mirrors scrape.ts resolveSupplierUrl). */
export function resolveSupplierUrl(sourceUrl, sourcePlatform, sku) {
  if (sourceUrl && sourcePlatform === "aliexpress") return sourceUrl;
  if (isAliExpressSku(sku)) return `https://de.aliexpress.com/item/${sku}.html`;
  return null;
}
