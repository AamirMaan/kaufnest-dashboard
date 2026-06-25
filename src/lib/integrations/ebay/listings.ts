// Fetches the seller's active eBay listings via the Inventory REST API.
// Requires the sell.inventory.readonly OAuth scope — existing connections
// authorised before this scope was added must be re-authorised.

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const INVENTORY_BASE = `${EBAY_BASE}/sell/inventory/v1`;

export interface EbayListing {
  ebayListingId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  currentPrice: number;
  currency: string;
  sku: string | null;
}

interface EbayOffer {
  offerId: string;
  sku?: string;
  status: string;
  marketplaceId?: string;
  listing?: { listingId?: string };
  pricingSummary?: { price?: { value?: string; currency?: string } };
}

interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    imageUrls?: string[];
  };
}

function ebayDomain(marketplaceId?: string): string {
  switch (marketplaceId) {
    case "EBAY_GB": return "co.uk";
    case "EBAY_DE": return "de";
    case "EBAY_FR": return "fr";
    case "EBAY_IT": return "it";
    case "EBAY_ES": return "es";
    case "EBAY_AU": return "com.au";
    default:        return "com";
  }
}

async function inventoryGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${INVENTORY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // eBay Inventory API rejects multi-value Accept-Language strings (e.g.
      // "en-GB,en;q=0.9") that Next.js may forward from the browser request.
      "Accept-Language": "en-US",
    },
  });

  if (res.status === 403) {
    throw new Error(
      "eBay returned 403 Forbidden — your eBay connection needs re-authorization. " +
      "Go to Integrations, disconnect eBay, and reconnect to grant the required permissions."
    );
  }

  if (!res.ok) {
    throw new Error(`eBay inventory request failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchActiveListings(accessToken: string): Promise<EbayListing[]> {
  // The Inventory API rejects /offer when ANY listing in the account has a SKU
  // with special characters (created via the older Trading API — errorId 25707).
  // Re-throw with an actionable message so the UI can surface it.
  let offersBody: { offers?: EbayOffer[] };
  try {
    offersBody = await inventoryGet<{ offers?: EbayOffer[] }>("/offer?limit=200", accessToken);
  } catch (err) {
    if (err instanceof Error && err.message.includes("25707")) {
      throw new Error(
        "eBay cannot list your offers because one or more listings is missing a SKU or " +
        "has a SKU with special characters (hyphens, spaces, etc.). These listings were " +
        "likely created without a Custom Label via the older Trading API. To fix this, " +
        "go to eBay Seller Hub → Active Listings, add a unique alphanumeric-only Custom " +
        "Label (SKU) to each listing, then sync again."
      );
    }
    throw err;
  }

  const publishedOffers = (offersBody.offers ?? []).filter(
    (o) => o.status === "PUBLISHED" && o.listing?.listingId
  );

  if (publishedOffers.length === 0) return [];

  // Inventory items enrich offers with title/image. If eBay rejects this request
  // (e.g. errorId 25707 — seller has items with non-alphanumeric SKUs created via
  // the older Trading API), fall back to offer.sku/listingId and no image. The
  // existing fallbacks in the map below already handle a missing item gracefully.
  let itemsBySku = new Map<string, EbayInventoryItem>();
  try {
    const itemsBody = await inventoryGet<{ inventoryItems?: EbayInventoryItem[] }>(
      "/inventory_item?limit=200",
      accessToken
    );
    itemsBySku = new Map((itemsBody.inventoryItems ?? []).map((item) => [item.sku, item]));
  } catch {
    // Non-fatal — listings will render with sku/listingId as title, no image.
  }

  return publishedOffers.map((offer) => {
    const listingId = offer.listing!.listingId!;
    const domain = ebayDomain(offer.marketplaceId);
    const item = offer.sku ? itemsBySku.get(offer.sku) : undefined;

    return {
      ebayListingId: listingId,
      title: item?.product?.title ?? offer.sku ?? listingId,
      imageUrl: item?.product?.imageUrls?.[0] ?? null,
      ebayUrl: `https://www.ebay.${domain}/itm/${listingId}`,
      currentPrice: Number(offer.pricingSummary?.price?.value ?? 0),
      currency: offer.pricingSummary?.price?.currency ?? "EUR",
      sku: offer.sku ?? null,
    };
  });
}
