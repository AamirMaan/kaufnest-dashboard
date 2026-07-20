import type { EbayListingDraft } from "@/types";
import { buildInventoryItemPayload, buildOfferPayload } from "./publishPayloads";

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

// Category tree "0" (EBAY_DE's default tree) is queried directly — this
// codebase only supports a single marketplace for v1 (see design spec's
// "out of scope"), so there's no per-request tree lookup.
const CATEGORY_TREE_ID = process.env.EBAY_CATEGORY_TREE_ID || "77";

export async function searchCategories(
  accessToken: string,
  query: string
): Promise<CategorySuggestion[]> {
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
  existingOfferId: string | null
): Promise<PublishResult> {
  const inventoryItemPayload = buildInventoryItemPayload(draft);
  const putInventoryRes = await ebayFetch(
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    accessToken,
    { method: "PUT", body: JSON.stringify(inventoryItemPayload) }
  );
  await throwIfNotOk(putInventoryRes, "createOrReplaceInventoryItem");

  const offerPayload = buildOfferPayload({ ...draft, ebay_sku: sku }, MARKETPLACE_ID);

  let offerId = existingOfferId;
  if (offerId) {
    const updateRes = await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, accessToken, {
      method: "PUT",
      body: JSON.stringify(offerPayload),
    });
    await throwIfNotOk(updateRes, "updateOffer");
  } else {
    const createRes = await ebayFetch("/sell/inventory/v1/offer", accessToken, {
      method: "POST",
      body: JSON.stringify(offerPayload),
    });
    await throwIfNotOk(createRes, "createOffer");
    const created = (await createRes.json()) as { offerId: string };
    offerId = created.offerId;
  }

  const publishRes = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, accessToken, {
    method: "POST",
  });
  await throwIfNotOk(publishRes, "publishOffer");
  const published = (await publishRes.json()) as { listingId: string };

  return { offerId, listingId: published.listingId };
}
