import type { EbayListingDraft } from "@/types";
import { buildInventoryItemPayload, buildOfferPayload } from "./publishPayloads";
import { getApplicationToken } from "./appToken";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_DE";

async function ebayFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${EBAY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
      ...init?.headers,
    },
  });
}

async function throwIfNotOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay ${action} failed: ${res.status} ${body.slice(0, 500)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eBay's Inventory API can take a few seconds to index a freshly PUT/replaced
// inventory item before POST /offer can reference it by SKU. Confirmed
// against a real failure 2026-08-28: createOrReplaceInventoryItem returned
// 2xx, then the immediately-following createOffer call failed with errorId
// 25751 ("<SKU> could not be found or is not available in the system for
// the marketplace <X>") — eBay's documented signal for exactly this lag, not
// a real payload/data problem. Retries a couple of times with a short delay
// before giving up; any other createOffer failure (bad payload, missing
// category aspects, etc.) still fails on the first attempt.
const OFFER_INDEXING_RETRY_DELAYS_MS = [2000, 4000];

async function createOfferWithRetry(
  path: string,
  accessToken: string,
  body: string
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await ebayFetch(path, accessToken, { method: "POST", body });
    if (res.ok) return res;

    const bodyText = await res.text();
    const isIndexingLag = res.status === 400 && bodyText.includes('"errorId":25751');
    if (!isIndexingLag || attempt >= OFFER_INDEXING_RETRY_DELAYS_MS.length) {
      throw new Error(`eBay createOffer failed: ${res.status} ${bodyText.slice(0, 500)}`);
    }
    await sleep(OFFER_INDEXING_RETRY_DELAYS_MS[attempt]);
  }
}

// ─── Category search (Taxonomy API) ────────────────────────────────────────────

export interface CategorySuggestion {
  id: string;
  name: string;
}

interface TaxonomyCategoryNode {
  category: { categoryId: string; categoryName: string };
}
interface TaxonomySuggestionsResponse {
  categorySuggestions?: TaxonomyCategoryNode[];
}

// Category tree "77" (EBAY_DE's default tree) is queried directly — this
// codebase only supports a single marketplace for v1 (see design spec's
// "out of scope"), so there's no per-request tree lookup.
const CATEGORY_TREE_ID = process.env.EBAY_CATEGORY_TREE_ID || "77";

// No sensible cross-tenant default exists — this is seller-account-specific
// (must already exist as an inventory location in the tenant's eBay Seller
// Hub). Read from env with an empty-string fallback, same as other
// required-but-unvalidated eBay fields in this file.
const MERCHANT_LOCATION_KEY = process.env.EBAY_MERCHANT_LOCATION_KEY || "";

// Taxonomy API category trees are global eBay catalog data, not scoped to
// any seller — uses an application token (getApplicationToken()), not the
// tenant's user token, which lacks the base https://api.ebay.com/oauth/api_scope
// this endpoint requires (a user token here 403s with errorId 1100
// "Insufficient permissions").
export async function searchCategories(query: string): Promise<CategorySuggestion[]> {
  const accessToken = await getApplicationToken();
  const params = new URLSearchParams({ q: query });
  const res = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?${params.toString()}`,
    accessToken
  );
  await throwIfNotOk(res, "category search");

  const json = (await res.json()) as TaxonomySuggestionsResponse;
  return (json.categorySuggestions ?? []).map((s) => ({
    id: s.category.categoryId,
    name: s.category.categoryName,
  }));
}

// ─── Business policies (Account API) ───────────────────────────────────────────

export interface BusinessPolicySummary {
  id: string;
  name: string;
}

export interface BusinessPolicies {
  fulfillment: BusinessPolicySummary[];
  payment: BusinessPolicySummary[];
  return: BusinessPolicySummary[];
}

async function fetchPolicyList(
  accessToken: string,
  path: string,
  listKey: string,
  idKey: string,
  nameKey: string
): Promise<BusinessPolicySummary[]> {
  const params = new URLSearchParams({ marketplace_id: MARKETPLACE_ID });
  const res = await ebayFetch(`/sell/account/v1/${path}?${params.toString()}`, accessToken);
  await throwIfNotOk(res, `${path} fetch`);

  const json = (await res.json()) as Record<string, unknown>;
  const list = (json[listKey] as Record<string, unknown>[] | undefined) ?? [];
  return list.map((item) => ({
    id: String(item[idKey]),
    name: String(item[nameKey]),
  }));
}

export async function fetchBusinessPolicies(accessToken: string): Promise<BusinessPolicies> {
  const [fulfillment, payment, returnPolicies] = await Promise.all([
    fetchPolicyList(
      accessToken,
      "fulfillment_policy",
      "fulfillmentPolicies",
      "fulfillmentPolicyId",
      "name"
    ),
    fetchPolicyList(accessToken, "payment_policy", "paymentPolicies", "paymentPolicyId", "name"),
    fetchPolicyList(accessToken, "return_policy", "returnPolicies", "returnPolicyId", "name"),
  ]);

  return { fulfillment, payment, return: returnPolicies };
}

// ─── Publish flow (Inventory API) ──────────────────────────────────────────────

export interface PublishResult {
  offerId: string;
  listingId: string;
}

/**
 * Runs the 3-step eBay Inventory API publish flow for one draft. Resumable:
 * pass `existingOfferId` when a prior attempt already created (but didn't
 * publish) an offer, and this calls updateOffer instead of createOffer.
 * createOrReplaceInventoryItem always runs — it's idempotent by SKU.
 */
export async function publishListing(
  accessToken: string,
  draft: EbayListingDraft,
  sku: string,
  existingOfferId: string | null,
  onOfferCreated?: (offerId: string) => Promise<void>
): Promise<PublishResult> {
  const inventoryItemPayload = buildInventoryItemPayload(draft);
  const putInventoryRes = await ebayFetch(
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    accessToken,
    { method: "PUT", body: JSON.stringify(inventoryItemPayload) }
  );
  await throwIfNotOk(putInventoryRes, "createOrReplaceInventoryItem");

  const offerPayload = buildOfferPayload(
    { ...draft, ebay_sku: sku },
    MARKETPLACE_ID,
    MERCHANT_LOCATION_KEY
  );

  let offerId = existingOfferId;
  if (offerId) {
    const updateRes = await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, accessToken, {
      method: "PUT",
      body: JSON.stringify(offerPayload),
    });
    await throwIfNotOk(updateRes, "updateOffer");
  } else {
    const createRes = await createOfferWithRetry(
      "/sell/inventory/v1/offer",
      accessToken,
      JSON.stringify(offerPayload)
    );
    const created = (await createRes.json()) as { offerId: string };
    offerId = created.offerId;
    if (onOfferCreated) await onOfferCreated(offerId);
  }

  const publishRes = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, accessToken, {
    method: "POST",
  });
  await throwIfNotOk(publishRes, "publishOffer");
  const published = (await publishRes.json()) as { listingId: string };

  return { offerId, listingId: published.listingId };
}
