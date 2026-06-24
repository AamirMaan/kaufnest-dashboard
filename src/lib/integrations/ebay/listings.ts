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
    headers: { Authorization: `Bearer ${token}` },
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
  // Fetch published offers and inventory items in parallel — 2 API calls, no N+1.
  const [offersBody, itemsBody] = await Promise.all([
    inventoryGet<{ offers?: EbayOffer[] }>("/offer?limit=200", accessToken),
    inventoryGet<{ inventoryItems?: EbayInventoryItem[] }>("/inventory_item?limit=200", accessToken),
  ]);

  const publishedOffers = (offersBody.offers ?? []).filter(
    (o) => o.status === "PUBLISHED" && o.listing?.listingId
  );

  if (publishedOffers.length === 0) return [];

  const itemsBySku = new Map<string, EbayInventoryItem>(
    (itemsBody.inventoryItems ?? []).map((item) => [item.sku, item])
  );

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
