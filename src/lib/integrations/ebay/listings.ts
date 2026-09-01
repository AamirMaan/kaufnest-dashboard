// Fetches the seller's active eBay listings via the Trading API (GetMyeBaySelling).
//
// Why Trading API instead of the Inventory API: the Inventory API's /offer and
// /inventory_item endpoints fail account-wide (errorId 25707) when ANY listing in
// the account is missing a SKU or has a SKU with special characters — including
// old, inactive listings that eBay no longer allows editing. GetMyeBaySelling has
// no such restriction and returns every active listing regardless of SKU.
//
// Auth/error-handling shared with messages.ts via ./tradingApi.

import { tradingApiCall, tagText, decodeXml, escapeXml } from "./tradingApi";
import type { ListingCondition } from "@/types";

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

// ─── Condition ID mapping ───────────────────────────────────────────────────
// eBay's ConditionID enum has many more values than this app's 3-way
// ListingCondition (new/used/refurbished). Reading (ConditionID -> our enum)
// is necessarily lossy; writing (our enum -> a ConditionID) picks one
// canonical ID per bucket — editable afterward if wrong, same as the
// aspects-mapping precedent in publishPayloads.ts.
const CONDITION_ID_TO_LISTING_CONDITION: Record<string, ListingCondition> = {
  "1000": "new",
  "1500": "new",
  "2000": "refurbished",
  "2500": "refurbished",
};
const LISTING_CONDITION_TO_CONDITION_ID: Record<ListingCondition, string> = {
  new: "1000",
  refurbished: "2000",
  used: "3000",
};

export function conditionIdToListingCondition(conditionId: string | null): ListingCondition {
  if (conditionId && conditionId in CONDITION_ID_TO_LISTING_CONDITION) {
    return CONDITION_ID_TO_LISTING_CONDITION[conditionId];
  }
  return "used";
}

function stripCdata(raw: string): string {
  const match = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : raw;
}

// ─── GetItem (full listing detail) ──────────────────────────────────────────

export interface EbayListingDetail {
  ebayListingId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  categoryId: string;
  categoryName: string;
  aspects: Record<string, string>;
  // Names of aspects eBay reported with more than one <Value> — v1 only
  // keeps the first (see the loop below), so any name here is a signal
  // that saving ANY change on this listing will silently drop the rest.
  // Surfaced as a UI warning only; not preserved end-to-end (see
  // dashboard/listings/SKILL.md's gotcha).
  multiValueAspectNames: string[];
  // eBay's own ground truth for whether this listing is still live —
  // "Active" | "Completed" | "Ended" | "CustomCode" per ListingStatusCodeType.
  // A non-"Active" value here means the listing already ended on eBay
  // (Seller Hub, expired, or ended via this app already), independent of
  // Sync's own reconciliation — the caller can react immediately instead
  // of waiting for the next Sync click, since this comes from the exact
  // same GetItem call already being made to load the edit form.
  listingStatus: string;
}

function buildGetItemRequest(itemId: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    `<ItemID>${itemId}</ItemID>` +
    "<DetailLevel>ReturnAll</DetailLevel>" +
    "</GetItemRequest>"
  );
}

export async function fetchListingDetail(
  accessToken: string,
  itemId: string
): Promise<EbayListingDetail> {
  const xml = await tradingApiCall("GetItem", buildGetItemRequest(itemId), accessToken);
  const item = tagText(xml, "Item") ?? "";

  const title = tagText(item, "Title");
  const descriptionRaw = tagText(item, "Description") ?? "";
  const primaryCategory = tagText(item, "PrimaryCategory") ?? "";
  const sellingStatus = tagText(item, "SellingStatus") ?? "";
  const pictureDetails = tagText(item, "PictureDetails") ?? "";
  const itemSpecifics = tagText(item, "ItemSpecifics") ?? "";
  const categoryName = tagText(primaryCategory, "CategoryName");

  const priceMatch = sellingStatus.match(
    /<CurrentPrice currencyID="([A-Z]{3})">([\d.]+)<\/CurrentPrice>/
  );

  const imageUrls = (pictureDetails.match(/<PictureURL>([\s\S]*?)<\/PictureURL>/g) ?? []).map(
    (tag) => decodeXml(tag.replace(/<\/?PictureURL>/g, ""))
  );

  const aspects: Record<string, string> = {};
  const multiValueAspectNames: string[] = [];
  const nameValueBlocks = itemSpecifics.match(/<NameValueList>[\s\S]*?<\/NameValueList>/g) ?? [];
  for (const block of nameValueBlocks) {
    const name = tagText(block, "Name");
    const value = tagText(block, "Value");
    if (name && value) {
      aspects[decodeXml(name)] = decodeXml(value);
      const valueTagCount = (block.match(/<Value(?:\s[^>]*)?>/g) ?? []).length;
      if (valueTagCount > 1) multiValueAspectNames.push(decodeXml(name));
    }
  }

  return {
    ebayListingId: itemId,
    title: title ? decodeXml(title) : "",
    description: decodeXml(stripCdata(descriptionRaw)),
    price: priceMatch ? Number(priceMatch[2]) : 0,
    currency: priceMatch ? priceMatch[1] : "EUR",
    quantity: Number(tagText(item, "Quantity") ?? "1"),
    condition: conditionIdToListingCondition(tagText(item, "ConditionID")),
    imageUrls,
    categoryId: tagText(primaryCategory, "CategoryID") ?? "",
    categoryName: categoryName ? decodeXml(categoryName) : "",
    aspects,
    multiValueAspectNames,
    listingStatus: tagText(sellingStatus, "ListingStatus") ?? "Active",
  };
}

// ─── ReviseItem ──────────────────────────────────────────────────────────────

export interface ReviseListingInput {
  title: string;
  description: string;
  price: number;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  // Omitted entirely (not an empty object) means "don't touch ItemSpecifics"
  // — see buildAspectsForRevise. Never send this unconditionally.
  aspects?: Record<string, string>;
}

// Decides whether ItemSpecifics belongs in the ReviseItem call at all.
// Returns undefined when every value matches the original (omit the field,
// per eBay's own guidance that resending item specifics unconditionally
// risks "attribute version problems"), or the submitted map when at least
// one value differs, was added, or was removed.
export function buildAspectsForRevise(
  original: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> | undefined {
  const originalKeys = Object.keys(original);
  const submittedKeys = Object.keys(submitted);
  const sameKeyCount = originalKeys.length === submittedKeys.length;
  const sameKeys = sameKeyCount && originalKeys.every((key) => key in submitted);
  const sameValues = sameKeys && originalKeys.every((key) => original[key] === submitted[key]);

  return sameValues ? undefined : submitted;
}

function buildReviseItemRequest(itemId: string, changes: ReviseListingInput): string {
  const pictureUrlsXml = changes.imageUrls
    .map((url) => `<PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("");

  const itemSpecificsXml =
    changes.aspects !== undefined
      ? "<ItemSpecifics>" +
        Object.entries(changes.aspects)
          .map(
            ([name, value]) =>
              `<NameValueList><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></NameValueList>`
          )
          .join("") +
        "</ItemSpecifics>"
      : "";

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<Item>" +
    `<ItemID>${itemId}</ItemID>` +
    `<Title>${escapeXml(changes.title)}</Title>` +
    `<Description><![CDATA[${changes.description}]]></Description>` +
    `<Quantity>${changes.quantity}</Quantity>` +
    `<ConditionID>${LISTING_CONDITION_TO_CONDITION_ID[changes.condition]}</ConditionID>` +
    `<StartPrice>${changes.price.toFixed(2)}</StartPrice>` +
    `<PictureDetails>${pictureUrlsXml}</PictureDetails>` +
    itemSpecificsXml +
    "</Item>" +
    "</ReviseItemRequest>"
  );
}

export async function reviseListing(
  accessToken: string,
  itemId: string,
  changes: ReviseListingInput
): Promise<void> {
  await tradingApiCall("ReviseItem", buildReviseItemRequest(itemId, changes), accessToken);
}

// ─── EndItem ─────────────────────────────────────────────────────────────────

function buildEndItemRequest(itemId: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    `<ItemID>${itemId}</ItemID>` +
    "<EndingReason>NotAvailable</EndingReason>" +
    "</EndItemRequest>"
  );
}

export async function endListing(accessToken: string, itemId: string): Promise<void> {
  await tradingApiCall("EndItem", buildEndItemRequest(itemId), accessToken);
}
