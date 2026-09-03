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

export interface OfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  pricingSummary: { price: { value: string; currency: string } };
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
  merchantLocationKey: string;
}

export function buildOfferPayload(
  draft: EbayListingDraft,
  marketplaceId: string,
  merchantLocationKey: string
): OfferPayload {
  return {
    sku: draft.ebay_sku ?? "",
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: draft.quantity,
    categoryId: draft.category_id ?? "",
    listingDescription: draft.description
      ? sanitizeListingHtml(draft.description)
      : draft.title,
    pricingSummary: { price: { value: draft.price.toFixed(2), currency: draft.currency } },
    listingPolicies: {
      fulfillmentPolicyId: draft.fulfillment_policy_id ?? "",
      paymentPolicyId: draft.payment_policy_id ?? "",
      returnPolicyId: draft.return_policy_id ?? "",
    },
    merchantLocationKey,
  };
}
