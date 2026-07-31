// Fetches the seller's active eBay listings via the Trading API (GetMyeBaySelling).
//
// Why Trading API instead of the Inventory API: the Inventory API's /offer and
// /inventory_item endpoints fail account-wide (errorId 25707) when ANY listing in
// the account is missing a SKU or has a SKU with special characters — including
// old, inactive listings that eBay no longer allows editing. GetMyeBaySelling has
// no such restriction and returns every active listing regardless of SKU.
//
// Auth/error-handling shared with messages.ts via ./tradingApi.

import { tradingApiCall, tagText, decodeXml } from "./tradingApi";

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
