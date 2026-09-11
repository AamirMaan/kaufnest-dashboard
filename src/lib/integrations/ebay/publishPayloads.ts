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

// ─── Marketing API payloads (Promoted Listings + volume discount) ──────────────

export interface MultiBuyTiers {
  buy2: number;
  buy3: number | null;
  buy4: number | null;
}

/** `multibuy_2_pct` is the on/off switch: no Buy 2 tier means no multi-buy. */
export function multiBuyTiersFromDraft(draft: EbayListingDraft): MultiBuyTiers | null {
  if (draft.multibuy_2_pct == null) return null;
  return { buy2: draft.multibuy_2_pct, buy3: draft.multibuy_3_pct, buy4: draft.multibuy_4_pct };
}

export interface CampaignPayload {
  campaignName: string;
  marketplaceId: string;
  startDate: string;
  fundingStrategy: { fundingModel: "COST_PER_SALE"; bidPercentage: string };
}

// eBay campaign names must be unique per seller, so the name carries the
// creation time to the second — the same shape Seller Hub uses for its own
// auto-created campaigns ("Campaign 13.05.2026 17:18:00").
export function buildCampaignPayload(
  marketplaceId: string,
  now: Date,
  rate: number
): CampaignPayload {
  const iso = now.toISOString();
  return {
    campaignName: `Boughtopia listings ${iso.slice(0, 19).replace("T", " ")}`,
    marketplaceId,
    startDate: iso,
    fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: rate.toFixed(1) },
  };
}

export function buildAdPayload(
  listingId: string,
  rate: number
): { listingId: string; bidPercentage: string } {
  return { listingId, bidPercentage: rate.toFixed(1) };
}

interface DiscountRule {
  ruleOrder: number;
  discountSpecifier: { minQuantity: number };
  discountBenefit: { percentageOffItem: string };
}

export interface VolumeDiscountPayload {
  name: string;
  description: string;
  marketplaceId: string;
  promotionType: "VOLUME_DISCOUNT";
  promotionStatus: "SCHEDULED";
  startDate: string;
  inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE"; listingIds: string[] };
  discountRules: DiscountRule[];
}

// eBay volume pricing starts from a mandatory 1-item / 0% rule; the seller's
// tiers follow it in order, and unset optional tiers are simply left out.
export function buildVolumeDiscountPayload(
  listingId: string,
  tiers: MultiBuyTiers,
  marketplaceId: string,
  now: Date
): VolumeDiscountPayload {
  const steps: Array<[number, number | null]> = [
    [1, 0],
    [2, tiers.buy2],
    [3, tiers.buy3],
    [4, tiers.buy4],
  ];
  const discountRules = steps
    .filter((step): step is [number, number] => step[1] != null)
    .map(([minQuantity, pct], index) => ({
      ruleOrder: index + 1,
      discountSpecifier: { minQuantity },
      discountBenefit: { percentageOffItem: String(pct) },
    }));

  return {
    name: `Multi-buy ${listingId}`,
    description: "Buy more, save more",
    marketplaceId,
    promotionType: "VOLUME_DISCOUNT",
    promotionStatus: "SCHEDULED",
    startDate: now.toISOString(),
    inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: [listingId] },
    discountRules,
  };
}
