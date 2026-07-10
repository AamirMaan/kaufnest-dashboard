// Fetches the seller's active eBay listings via the Trading API (GetMyeBaySelling).
//
// Why Trading API instead of the Inventory API: the Inventory API's /offer and
// /inventory_item endpoints fail account-wide (errorId 25707) when ANY listing in
// the account is missing a SKU or has a SKU with special characters — including
// old, inactive listings that eBay no longer allows editing. GetMyeBaySelling has
// no such restriction and returns every active listing regardless of SKU.
//
// Auth: uses the same OAuth user access token, passed via the X-EBAY-API-IAF-TOKEN
// header. Requires the sell.inventory OAuth scope (readonly is NOT sufficient for
// Trading API calls) — existing connections must be re-authorised after the scope
// change in src/lib/integrations/ebay.ts.

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const TRADING_API_URL = SANDBOX
  ? "https://api.sandbox.ebay.com/ws/api.dll"
  : "https://api.ebay.com/ws/api.dll";
const COMPATIBILITY_LEVEL = "1193";
const ENTRIES_PER_PAGE = 200;
const MAX_PAGES = 10; // safety cap: 2000 listings

export interface EbayListing {
  ebayListingId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  currentPrice: number;
  currency: string;
  sku: string | null;
}

/** Extracts the text content of the first occurrence of <tag> in the given XML fragment. */
function tagText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

/** Decodes the five predefined XML entities eBay uses in text fields. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function tradingApiCall(
  callName: string,
  requestXml: string,
  token: string
): Promise<string> {
  const res = await fetch(TRADING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: requestXml,
  });

  const xml = await res.text();

  if (!res.ok) {
    throw new Error(`eBay Trading API request failed: ${res.status} ${xml.slice(0, 500)}`);
  }

  const ack = tagText(xml, "Ack");
  if (ack === "Failure") {
    const message = tagText(xml, "LongMessage") ?? tagText(xml, "ShortMessage") ?? "Unknown error";
    const errorCode = tagText(xml, "ErrorCode") ?? "";

    // 21916984 = token scope insufficient; 21917053 / 931 = invalid/hard-expired IAF token.
    if (["21916984", "21917053", "931", "932"].includes(errorCode)) {
      throw new Error(
        "eBay rejected the access token — your eBay connection needs re-authorization. " +
        "Go to Integrations, disconnect eBay, and reconnect to grant the required permissions."
      );
    }

    throw new Error(`eBay Trading API error ${errorCode}: ${decodeXml(message)}`);
  }

  return xml;
}

function buildGetMyeBaySellingRequest(pageNumber: number): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<ActiveList>" +
    "<Include>true</Include>" +
    "<Pagination>" +
    `<EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage>` +
    `<PageNumber>${pageNumber}</PageNumber>` +
    "</Pagination>" +
    "</ActiveList>" +
    "<DetailLevel>ReturnAll</DetailLevel>" +
    "</GetMyeBaySellingRequest>"
  );
}

function parseItem(itemXml: string): EbayListing | null {
  const itemId = tagText(itemXml, "ItemID");
  if (!itemId) return null;

  const title = tagText(itemXml, "Title");
  const sku = tagText(itemXml, "SKU");
  const galleryUrl = tagText(itemXml, "GalleryURL");
  const viewItemUrl = tagText(itemXml, "ViewItemURL");

  // <CurrentPrice currencyID="EUR">12.99</CurrentPrice> inside <SellingStatus>
  const priceMatch = itemXml.match(
    /<CurrentPrice currencyID="([A-Z]{3})">([\d.]+)<\/CurrentPrice>/
  );

  return {
    ebayListingId: itemId,
    title: title ? decodeXml(title) : itemId,
    imageUrl: galleryUrl ? decodeXml(galleryUrl) : null,
    ebayUrl: viewItemUrl ? decodeXml(viewItemUrl) : `https://www.ebay.com/itm/${itemId}`,
    currentPrice: priceMatch ? Number(priceMatch[2]) : 0,
    currency: priceMatch ? priceMatch[1] : "EUR",
    sku: sku ? decodeXml(sku) : null,
  };
}

export async function fetchActiveListings(accessToken: string): Promise<EbayListing[]> {
  const listings: EbayListing[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const xml = await tradingApiCall(
      "GetMyeBaySelling",
      buildGetMyeBaySellingRequest(page),
      accessToken
    );

    // Scope parsing to the ActiveList block so Sold/Unsold items are never included.
    const activeList = tagText(xml, "ActiveList") ?? "";
    const itemBlocks = activeList.match(/<Item>[\s\S]*?<\/Item>/g) ?? [];

    for (const block of itemBlocks) {
      const listing = parseItem(block);
      if (listing) listings.push(listing);
    }

    const totalPages = Number(tagText(activeList, "TotalNumberOfPages") ?? "1");
    if (page >= totalPages) break;
  }

  return listings;
}
