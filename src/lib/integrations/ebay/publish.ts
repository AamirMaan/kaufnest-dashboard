import type { EbayListingDraft } from "@/types";
import { buildInventoryItemPayload, buildOfferPayload } from "./publishPayloads";
import { getApplicationToken } from "./appToken";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_DE";

// eBay's Inventory API requires Content-Language to be one of the target
// marketplace's actual supported locales — an inventory item written with a
// mismatched language (e.g. en-US content for EBAY_DE) can't be associated
// with that marketplace by createOffer at all, regardless of how long you
// wait or retry. This previously hardcoded "en-US" while defaulting to
// EBAY_DE, which requires "de-DE" — a deterministic mismatch, not the
// propagation race createOfferWithPropagationRetry guards against.
const MARKETPLACE_LANGUAGE: Record<string, string> = {
  EBAY_DE: "de-DE",
  EBAY_AT: "de-AT",
  EBAY_US: "en-US",
  EBAY_GB: "en-GB",
  EBAY_CA: "en-CA",
  EBAY_AU: "en-AU",
  EBAY_FR: "fr-FR",
  EBAY_IT: "it-IT",
  EBAY_ES: "es-ES",
};
const CONTENT_LANGUAGE = MARKETPLACE_LANGUAGE[MARKETPLACE_ID] ?? "en-US";

async function ebayFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${EBAY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept-Language": CONTENT_LANGUAGE,
      "Content-Language": CONTENT_LANGUAGE,
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

// eBay's Inventory API has a documented eventual-consistency gap: a
// successful createOrReplaceInventoryItem PUT doesn't guarantee the SKU is
// immediately queryable by createOffer — a same-second createOffer call can
// 400 with errorId 25751 ("{sku} could not be found or is not available in
// the system for the marketplace") purely because the write hasn't
// propagated yet, not because anything is actually wrong. Retrying a few
// times with a short delay is eBay's own recommended workaround; anything
// else in the 400 body (bad category/policy IDs, etc.) fails immediately
// instead of wasting the retry budget on a request that will never succeed.
const INVENTORY_PROPAGATION_ERROR_ID = 25751;
const INVENTORY_PROPAGATION_RETRY_DELAYS_MS = [1000, 2000, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createOfferWithPropagationRetry(
  accessToken: string,
  body: string
): Promise<Response> {
  let res = await ebayFetch("/sell/inventory/v1/offer", accessToken, { method: "POST", body });

  for (const delay of INVENTORY_PROPAGATION_RETRY_DELAYS_MS) {
    if (res.ok) return res;

    const bodyText = await res.text();
    let isPropagationError = false;
    try {
      const parsed = JSON.parse(bodyText) as { errors?: { errorId?: number }[] };
      isPropagationError =
        parsed.errors?.some((e) => e.errorId === INVENTORY_PROPAGATION_ERROR_ID) ?? false;
    } catch {
      // Not JSON — not the propagation error, fall through to fail below.
    }

    if (!isPropagationError) {
      throw new Error(`eBay createOffer failed: ${res.status} ${bodyText.slice(0, 500)}`);
    }

    await sleep(delay);
    res = await ebayFetch("/sell/inventory/v1/offer", accessToken, { method: "POST", body });
  }

  return res;
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

// ─── Inventory locations (Inventory API) ───────────────────────────────────────

export interface InventoryLocationSummary {
  key: string;
  name: string;
  hasCountry: boolean;
}

interface InventoryLocationResponse {
  merchantLocationKey: string;
  merchantLocationStatus?: string;
  name?: string;
  location?: { address?: { country?: string } };
}
interface InventoryLocationsListResponse {
  locations?: InventoryLocationResponse[];
}

// Seller-account-specific, same as business policies below — fetched live
// per-tenant via the tenant's own connection token (sell.inventory scope,
// already granted, no new OAuth consent needed) rather than configured once
// globally. `hasCountry` lets the caller warn about/exclude a location
// that's missing a country, since offering one would just reproduce the
// "no Item.Country exists" publishOffer failure this replaces.
export async function fetchInventoryLocations(
  accessToken: string
): Promise<InventoryLocationSummary[]> {
  const res = await ebayFetch("/sell/inventory/v1/location", accessToken);
  await throwIfNotOk(res, "getInventoryLocations");

  const json = (await res.json()) as InventoryLocationsListResponse;
  return (json.locations ?? [])
    .filter((loc) => (loc.merchantLocationStatus ?? "ENABLED") === "ENABLED")
    .map((loc) => ({
      key: loc.merchantLocationKey,
      name: loc.name ?? loc.merchantLocationKey,
      hasCountry: Boolean(loc.location?.address?.country),
    }));
}

export interface CreateInventoryLocationInput {
  name: string;
  addressLine1?: string;
  city: string;
  stateOrProvince?: string;
  postalCode: string;
  country: string;
}

// Same alphanumeric-only rationale as generateListingSku (see
// generateSku.ts) — merchantLocationKey is fully under our control here, so
// keep it simple and safe rather than risk a format eBay's account-wide
// reads choke on.
const LOCATION_KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateLocationKey(): string {
  let suffix = "";
  for (let i = 0; i < 12; i++) {
    suffix += LOCATION_KEY_CHARS[Math.floor(Math.random() * LOCATION_KEY_CHARS.length)];
  }
  return `LOC${suffix}`;
}

// Lets a tenant create a real eBay inventory location without leaving the
// wizard, instead of being sent to Seller Hub. Deliberately does NOT guess
// `country` from anything already on file (company_profile.address is
// freeform text, no structured country field) — the tenant types it
// themselves here, since a silently-wrong guess would recreate the exact
// "no Item.Country exists" bug this whole feature exists to prevent, just
// one step removed. `locationTypes: ["WAREHOUSE"]` needs city + country
// (no full street address required) per eBay's own location-type rules.
export async function createInventoryLocation(
  accessToken: string,
  input: CreateInventoryLocationInput
): Promise<InventoryLocationSummary> {
  const key = generateLocationKey();
  const res = await ebayFetch(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      location: {
        address: {
          addressLine1: input.addressLine1 || undefined,
          city: input.city,
          stateOrProvince: input.stateOrProvince || undefined,
          postalCode: input.postalCode,
          country: input.country,
        },
      },
      name: input.name,
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
    }),
  });
  await throwIfNotOk(res, "createInventoryLocation");
  return { key, name: input.name, hasCountry: true };
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
    draft.merchant_location_key ?? ""
  );

  let offerId = existingOfferId;
  if (offerId) {
    const updateRes = await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, accessToken, {
      method: "PUT",
      body: JSON.stringify(offerPayload),
    });
    await throwIfNotOk(updateRes, "updateOffer");
  } else {
    const createRes = await createOfferWithPropagationRetry(
      accessToken,
      JSON.stringify(offerPayload)
    );
    await throwIfNotOk(createRes, "createOffer");
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
