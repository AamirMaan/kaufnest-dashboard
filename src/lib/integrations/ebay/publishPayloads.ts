import type { EbayListingDraft, ListingCondition } from "@/types";
import { sanitizeListingHtml } from "@/lib/utils/sanitizeListingHtml";

const CONDITION_ENUM: Record<ListingCondition, string> = {
  new: "NEW",
  used: "USED_EXCELLENT",
  refurbished: "CERTIFIED_REFURBISHED",
};

export interface InventoryItemPayload {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: string;
  product: {
    title: string;
    description: string;
    imageUrls: string[];
    aspects: Record<string, string[]>;
  };
}

export function buildInventoryItemPayload(draft: EbayListingDraft): InventoryItemPayload {
  const aspects: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(draft.aspects ?? {})) {
    if (value) aspects[name] = [value];
  }

  return {
    availability: { shipToLocationAvailability: { quantity: draft.quantity } },
    condition: CONDITION_ENUM[draft.condition],
    product: {
      title: draft.title,
      description: sanitizeListingHtml(draft.description ?? ""),
      imageUrls: draft.image_urls,
      aspects,
    },
  };
}

export interface Amount {
  value: string;
  currency: string;
}

export interface BestOfferTerms {
  bestOfferEnabled: true;
  autoAcceptPrice?: Amount;
  autoDeclinePrice?: Amount;
}

export interface OfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  pricingSummary: { price: Amount };
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    bestOfferTerms?: BestOfferTerms;
  };
  tax?: { vatPercentage: number; applyTax: true };
  merchantLocationKey: string;
}

function amount(value: number, currency: string): Amount {
  return { value: value.toFixed(2), currency };
}

// Thresholds are only meaningful while Best Offer is on — a row can still
// hold them after the seller switched Best Offer off, and sending them then
// would re-enable nothing but could still fail eBay's validation.
function buildBestOfferTerms(draft: EbayListingDraft): BestOfferTerms | undefined {
  if (!draft.best_offer_enabled) return undefined;
  const terms: BestOfferTerms = { bestOfferEnabled: true };
  if (draft.best_offer_auto_accept != null) {
    terms.autoAcceptPrice = amount(draft.best_offer_auto_accept, draft.currency);
  }
  if (draft.best_offer_auto_decline != null) {
    terms.autoDeclinePrice = amount(draft.best_offer_auto_decline, draft.currency);
  }
  return terms;
}

export function buildOfferPayload(
  draft: EbayListingDraft,
  marketplaceId: string,
  merchantLocationKey: string
): OfferPayload {
  const bestOfferTerms = buildBestOfferTerms(draft);
  return {
    sku: draft.ebay_sku ?? "",
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: draft.quantity,
    categoryId: draft.category_id ?? "",
    listingDescription: draft.description
      ? sanitizeListingHtml(draft.description)
      : draft.title,
    pricingSummary: { price: amount(draft.price, draft.currency) },
    listingPolicies: {
      fulfillmentPolicyId: draft.fulfillment_policy_id ?? "",
      paymentPolicyId: draft.payment_policy_id ?? "",
      returnPolicyId: draft.return_policy_id ?? "",
      ...(bestOfferTerms ? { bestOfferTerms } : {}),
    },
    // `!= null`, not truthiness: 0% VAT is a real rate and must be sent.
    ...(draft.vat_percentage != null
      ? { tax: { vatPercentage: draft.vat_percentage, applyTax: true as const } }
      : {}),
    merchantLocationKey,
  };
}
