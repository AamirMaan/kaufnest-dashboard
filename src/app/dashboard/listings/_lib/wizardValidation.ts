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

export function validateImagesStep(draft: DraftFormState): string | null {
  return draft.image_urls.length > 0 ? null : "Add at least one image.";
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
