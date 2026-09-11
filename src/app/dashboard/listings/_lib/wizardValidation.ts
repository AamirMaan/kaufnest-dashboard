import type { Currency, ListingCondition, ListingSourceType } from "@/types";

/** Controlled-input form state for the listing wizard — all numeric/select
 * fields are kept as strings until save, matching the Add*Modal convention
 * used elsewhere in this codebase (e.g. AddProductModal's reorder_threshold). */
export interface DraftFormState {
  source_type: ListingSourceType;
  product_id: string;
  source_url: string;
  title: string;
  description: string;
  price: string;
  currency: Currency;
  quantity: string;
  condition: ListingCondition;
  category_id: string;
  category_name: string;
  image_urls: string[];
  aspects: Record<string, string>;
  /** Wizard-only, not persisted: which aspect names AspectsStep fetched as
   * required for the current category, so its validator can check them
   * without re-fetching. Refreshed whenever category_id changes. */
  required_aspect_names: string[];
  fulfillment_policy_id: string;
  payment_policy_id: string;
  return_policy_id: string;
  merchant_location_key: string;
  /** "" = VAT not sent. */
  vat_percentage: string;
  best_offer_enabled: boolean;
  best_offer_auto_accept: string;
  best_offer_auto_decline: string;
  multibuy_enabled: boolean;
  multibuy_2_pct: string;
  multibuy_3_pct: string;
  multibuy_4_pct: string;
  ad_enabled: boolean;
  ad_rate: string;
  /** A campaign id, NEW_CAMPAIGN (create one at publish), or "" (not chosen yet). */
  ad_campaign_id: string;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function validateSourceStep(draft: DraftFormState): string | null {
  if (draft.source_type === "inventory") {
    return draft.product_id ? null : "Select an Inventory product.";
  }
  if (!draft.source_url.trim()) return "Enter a supplier URL.";
  return isValidUrl(draft.source_url.trim()) ? null : "Enter a valid URL.";
}

export function validateDetailsStep(draft: DraftFormState): string | null {
  if (!draft.title.trim()) return "Title is required.";
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price <= 0) return "Price must be greater than 0.";
  const quantity = Number(draft.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return "Quantity must be at least 1.";
  return null;
}

export function validateCategoryStep(draft: DraftFormState): string | null {
  return draft.category_id ? null : "Select a category.";
}

/** eBay's per-listing picture limit. */
export const MAX_LISTING_IMAGES = 24;

export function validateImagesStep(draft: DraftFormState): string | null {
  if (draft.image_urls.length === 0) return "Add at least one image.";
  if (draft.image_urls.length > MAX_LISTING_IMAGES) {
    return `eBay allows at most ${MAX_LISTING_IMAGES} images per listing.`;
  }
  return null;
}

export function validateAspectsStep(draft: DraftFormState): string | null {
  const missing = draft.required_aspect_names.filter((name) => !draft.aspects[name]?.trim());
  if (missing.length > 0) {
    return `Fill in required details: ${missing.join(", ")}.`;
  }
  return null;
}

export function validatePoliciesStep(draft: DraftFormState): string | null {
  const { fulfillment_policy_id, payment_policy_id, return_policy_id, merchant_location_key } =
    draft;
  if (!fulfillment_policy_id || !payment_policy_id || !return_policy_id) {
    return "Select a fulfillment, payment, and return policy.";
  }
  if (!merchant_location_key) {
    return "Select an inventory location.";
  }
  return null;
}

/** Form sentinel for "Create a new campaign automatically" — saved as null. */
export const NEW_CAMPAIGN = "__new__";

export const EMPTY_PRICING_MARKETING = {
  vat_percentage: "",
  best_offer_enabled: false,
  best_offer_auto_accept: "",
  best_offer_auto_decline: "",
  multibuy_enabled: false,
  multibuy_2_pct: "",
  multibuy_3_pct: "",
  multibuy_4_pct: "",
  ad_enabled: false,
  ad_rate: "",
  ad_campaign_id: "",
} satisfies Partial<DraftFormState>;

export const MIN_AD_RATE = 2;
export const MAX_AD_RATE = 100;
export const MULTIBUY_MAX_PCT = 80;
export const MULTIBUY_PERCENT_OPTIONS = Array.from({ length: MULTIBUY_MAX_PCT }, (_, i) => i + 1);

/** Blank → null; anything else → Number (NaN for junk, caught by callers). */
function optionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

export function validatePricingStep(draft: DraftFormState): string | null {
  const vat = optionalNumber(draft.vat_percentage);
  if (vat !== null && (!Number.isFinite(vat) || vat < 0 || vat > 100)) {
    return "VAT must be between 0 and 100%.";
  }

  if (draft.best_offer_enabled) {
    const price = Number(draft.price);
    const accept = optionalNumber(draft.best_offer_auto_accept);
    const decline = optionalNumber(draft.best_offer_auto_decline);
    if (accept !== null && (!Number.isFinite(accept) || accept <= 0 || accept >= price)) {
      return "Auto-accept price must be above 0 and below the listing price.";
    }
    if (decline !== null && (!Number.isFinite(decline) || decline <= 0 || decline >= price)) {
      return "Auto-decline price must be above 0 and below the listing price.";
    }
    if (accept !== null && decline !== null && decline >= accept) {
      return "Auto-decline price must be below the auto-accept price.";
    }
  }

  if (draft.multibuy_enabled) {
    const buy2 = optionalNumber(draft.multibuy_2_pct);
    const buy3 = optionalNumber(draft.multibuy_3_pct);
    const buy4 = optionalNumber(draft.multibuy_4_pct);
    if (buy2 === null) return "Choose a Buy 2 discount.";
    if (buy4 !== null && buy3 === null) return "Set a Buy 3 discount before Buy 4 or more.";
    if (buy3 !== null && buy3 <= buy2) return "The Buy 3 discount must be higher than Buy 2.";
    if (buy4 !== null && buy3 !== null && buy4 <= buy3) {
      return "The Buy 4+ discount must be higher than Buy 3.";
    }
  }

  return null;
}

export function validateAdvertisingStep(draft: DraftFormState): string | null {
  if (!draft.ad_enabled) return null;
  const rate = optionalNumber(draft.ad_rate);
  if (rate === null || !Number.isFinite(rate) || rate < MIN_AD_RATE || rate > MAX_AD_RATE) {
    return `Ad rate must be between ${MIN_AD_RATE} and ${MAX_AD_RATE}%.`;
  }
  // String check, not float maths: 13.25 * 10 isn't reliably non-integer.
  if (!/^\d+(\.\d)?$/.test(draft.ad_rate.trim())) {
    return "Ad rate can have at most one decimal place.";
  }
  if (!draft.ad_campaign_id) return "Choose a campaign for the ad.";
  return null;
}
