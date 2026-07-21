# eBay Listing Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin/super_admin build an eBay listing from an Inventory item or a third-party (dropship) source, save it as an editable draft, and publish it to eBay via eBay's Inventory API.

**Architecture:** A new tenant-scoped table (`ebay_listing_drafts`, provisioned to every tenant schema) backs a new feature folder `src/app/dashboard/listings/`. Draft CRUD goes straight to Supabase from Redux thunks (RLS-protected), matching every other feature in this codebase. Only the eBay-specific calls (category search, business-policy fetch, and the actual publish) go through server API routes, since only those need the tenant's stored OAuth token. Publish runs a 3-step, resumable eBay Inventory API flow: `createOrReplaceInventoryItem` → `createOffer`/`updateOffer` → `publishOffer`.

**Tech Stack:** Next.js App Router, Redux Toolkit, Supabase (Postgres + Storage), eBay REST APIs (Inventory, Taxonomy, Account), Jest.

**Spec:** `docs/superpowers/specs/2026-07-20-ebay-listing-creation-design.md`

## Global Constraints

- Never query `public.*` — tenant data lives in `tenant_<slug>` schemas, resolved from `user.app_metadata.tenant_schema`. (`AGENTS.md`)
- Never hardcode a tenant schema name in a new migration — use `run_on_all_tenant_schemas`, and mirror the same DDL in `provision_tenant_schema()` (`005_tenant_provisioning.sql`) so new tenants get it too. This is the project's "2 places" rule. (`supabase/SKILL.md`)
- Migrations in this repo are **not auto-applied** — every new migration file must be pasted into the Supabase SQL editor (Project B) by a human after this plan's code is written. Each DB task below ends with an explicit "apply manually" note instead of a runnable test. (`supabase/SKILL.md`)
- Every `CREATE POLICY`/`CREATE TABLE`/`CREATE INDEX` statement must be idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`) — migrations must be safely re-runnable. (`supabase/SKILL.md`)
- Write/extend colocated unit tests for new utility functions, Redux slice actions, and data-transformation logic; don't write tests for API routes or React components — this codebase's existing convention (`ebay.ts`/`amazon.ts`, every `*Slice.test.ts`) is pure-logic-tested, UI/route manually verified. (`AGENTS.md`, working agreement)
- Do not run `npm test`, `npx tsc --noEmit`, `npm run lint`, or start the dev server mid-task. Run only the scoped `npx jest <path>` command called out in each task's own steps, then hand off to the user for full verification and manual browser testing. (working agreement)
- After every feature edit, update the affected `CLAUDE.md`/`SKILL.md` in the **same commit** as the code change — this is enforced by working agreement, not optional cleanup.
- **Branch check before Task 1:** this plan must be executed on a feature branch, never on `main` (branch protection rejects direct pushes, and this repo has already had one accidental direct-to-main commit this session). Before starting, run `git branch --show-current`; if it prints `main`, run `git checkout -b feat/ebay-listing-creation` first. If a branch from this feature's earlier spec work already exists (e.g. `feat/ebay-listing-creation-spec`), reuse it instead of creating a new one.

---

## File Structure

```
supabase/migrations/
  021_ebay_listing_drafts.sql          (new) — ebay_listing_drafts table, all tenants
  022_listing_images_bucket.sql        (new) — Storage bucket + tenant-aware RLS
  005_tenant_provisioning.sql          (modify) — provision_tenant_schema() gains the table

src/types/index.ts                     (modify) — ListingSourceType/ListingCondition/ListingStatus/EbayListingDraft
src/lib/utils/permissions.ts           (modify) — manage_listings permission
src/lib/utils/permissions.test.ts      (modify) — coverage for manage_listings

src/lib/integrations/ebay/
  generateSku.ts                       (new) — pure SKU generator + test
  generateSku.test.ts                  (new)
  publishPayloads.ts                   (new) — pure draft→eBay-payload mappers + test
  publishPayloads.test.ts              (new)
  publish.ts                           (new) — searchCategories/fetchBusinessPolicies/publishListing (HTTP, untested)

src/app/api/listings/
  ebay/categories/route.ts             (new) — GET category search
  ebay/policies/route.ts               (new) — GET business policies
  [id]/publish/route.ts                (new) — POST resumable publish

src/app/dashboard/listings/
  page.tsx                             (new) — listings table
  new/page.tsx                         (new) — create-draft wizard entry
  [id]/page.tsx                        (new) — edit-draft / resume-publish wizard entry
  _components/
    ListingsTable.tsx                  (new)
    ListingWizard.tsx                  (new) — wizard shell + step state + save/publish
    SourceStep.tsx                     (new)
    DetailsStep.tsx                    (new)
    CategoryStep.tsx                   (new)
    ImagesStep.tsx                     (new)
    PoliciesStep.tsx                   (new)
    ReviewStep.tsx                     (new)
  _lib/
    wizardValidation.ts                (new) — pure per-step validators + test
    wizardValidation.test.ts           (new)
  _store/
    listingsSlice.ts                   (new)
    listingsSlice.test.ts              (new)
  CLAUDE.md                            (new)
  SKILL.md                             (new)

src/store/store.ts                     (modify) — register listingsSlice
src/store/StoreProvider.tsx            (modify) — hydrate first page
src/app/dashboard/layout.tsx           (modify) — fetch first page of ebay_listing_drafts
src/components/layout/Sidebar.tsx      (modify) — "Listings" nav link
src/app/dashboard/CLAUDE.md            (modify) — feature-folder table row
supabase/SKILL.md                      (modify) — file map entries for 021/022
supabase/CLAUDE.md                     (modify) — file map entries for 021/022
```

---

### Task 1: Types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `ListingSourceType`, `ListingCondition`, `ListingStatus`, `EbayListingDraft` — consumed by every later task.

- [ ] **Step 1: Add the new types**

Add this block at the end of `src/types/index.ts` (after the `DropshipListing` interface, i.e. after line 240):

```ts
// ─── eBay Listing Drafts ──────────────────────────────────────────────────────

export type ListingSourceType = "inventory" | "dropship";
export type ListingCondition = "new" | "used" | "refurbished";
export type ListingStatus = "draft" | "publishing" | "published" | "failed";

export interface EbayListingDraft {
  id: string;
  source_type: ListingSourceType;
  product_id: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  title: string;
  description: string | null;
  price: number;
  currency: Currency;
  quantity: number;
  condition: ListingCondition;
  category_id: string | null;
  category_name: string | null;
  image_urls: string[];
  fulfillment_policy_id: string | null;
  payment_policy_id: string | null;
  return_policy_id: string | null;
  ebay_sku: string | null;
  status: ListingStatus;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  publish_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Commit**

There's no runnable test for a type-only change — it's verified by every later task's code compiling against it.

```bash
git add src/types/index.ts
git commit -m "feat: add EbayListingDraft types"
```

---

### Task 2: `manage_listings` permission

**Files:**
- Modify: `src/lib/utils/permissions.ts`
- Modify: `src/lib/utils/permissions.test.ts`

**Interfaces:**
- Produces: `Permission` gains `"manage_listings"`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/utils/permissions.test.ts`, inside the existing `describe("hasPermission", ...)` block (after the `"allows admin and super_admin to view analytics"` test, around line 56):

```ts
  it("restricts manage_listings to admin and super_admin", () => {
    expect(hasPermission("super_admin", "manage_listings")).toBe(true);
    expect(hasPermission("admin", "manage_listings")).toBe(true);
    expect(hasPermission("accountant", "manage_listings")).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/utils/permissions.test.ts -t "manage_listings"`
Expected: FAIL — `"manage_listings"` is not assignable to type `Permission`, or the test fails because the permission doesn't exist yet.

- [ ] **Step 3: Add the permission**

In `src/lib/utils/permissions.ts`, add a new line to the `PERMISSIONS` object (after `manage_integrations: [...]`, i.e. after line 25):

```ts
  // eBay listing creation/publishing
  manage_listings: ["super_admin", "admin"],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/utils/permissions.test.ts -t "manage_listings"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/permissions.ts src/lib/utils/permissions.test.ts
git commit -m "feat: add manage_listings permission"
```

---

### Task 3: SKU generator

**Files:**
- Create: `src/lib/integrations/ebay/generateSku.ts`
- Create: `src/lib/integrations/ebay/generateSku.test.ts`

**Interfaces:**
- Produces: `generateListingSku(): string` — consumed by Task 12 (publish route).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/integrations/ebay/generateSku.test.ts
import { generateListingSku } from "./generateSku";

describe("generateListingSku", () => {
  it("starts with KN followed by 12 alphanumeric characters", () => {
    const sku = generateListingSku();
    expect(sku).toMatch(/^KN[A-Za-z0-9]{12}$/);
  });

  it("contains no hyphens or special characters", () => {
    const sku = generateListingSku();
    expect(sku).not.toMatch(/[^A-Za-z0-9]/);
  });

  it("generates distinct SKUs across many calls", () => {
    const skus = new Set(Array.from({ length: 500 }, () => generateListingSku()));
    expect(skus.size).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/integrations/ebay/generateSku.test.ts`
Expected: FAIL with "Cannot find module './generateSku'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/integrations/ebay/generateSku.ts
// Alphanumeric-only, no hyphens or other special characters — this codebase
// has already hit a real eBay account-wide failure (errorId 25707) caused by
// a single invalid SKU among existing listings breaking bulk reads for the
// whole account (see fetchActiveListings in ./listings.ts). Since SKU
// generation is fully under our control here, strict formatting avoids
// re-triggering that class of failure.
const SKU_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 12;

export function generateListingSku(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SKU_CHARS[Math.floor(Math.random() * SKU_CHARS.length)];
  }
  return `KN${suffix}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/integrations/ebay/generateSku.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay/generateSku.ts src/lib/integrations/ebay/generateSku.test.ts
git commit -m "feat: add eBay listing SKU generator"
```

---

### Task 4: Wizard step validators

**Files:**
- Create: `src/app/dashboard/listings/_lib/wizardValidation.ts`
- Create: `src/app/dashboard/listings/_lib/wizardValidation.test.ts`

**Interfaces:**
- Consumes: `ListingSourceType`, `ListingCondition` (Task 1).
- Produces: `DraftFormState` interface, `validateSourceStep`, `validateDetailsStep`, `validateCategoryStep`, `validateImagesStep`, `validatePoliciesStep` — each `(draft: DraftFormState) => string | null` (`null` = valid). Consumed by Task 14–17 (wizard step components and shell).

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/dashboard/listings/_lib/wizardValidation.test.ts
import {
  validateSourceStep,
  validateDetailsStep,
  validateCategoryStep,
  validateImagesStep,
  validatePoliciesStep,
  type DraftFormState,
} from "./wizardValidation";

function makeDraft(overrides: Partial<DraftFormState> = {}): DraftFormState {
  return {
    source_type: "inventory",
    product_id: "product-1",
    source_url: "",
    title: "Wireless Mouse",
    description: "",
    price: "19.99",
    currency: "EUR",
    quantity: "5",
    condition: "new",
    category_id: "9355",
    category_name: "Cell Phones",
    image_urls: ["https://example.com/img.jpg"],
    fulfillment_policy_id: "fp-1",
    payment_policy_id: "pp-1",
    return_policy_id: "rp-1",
    ...overrides,
  };
}

describe("validateSourceStep", () => {
  it("passes when source_type is inventory and product_id is set", () => {
    expect(validateSourceStep(makeDraft())).toBeNull();
  });

  it("fails when source_type is inventory and product_id is empty", () => {
    expect(validateSourceStep(makeDraft({ product_id: "" }))).toBe(
      "Select an Inventory product."
    );
  });

  it("passes when source_type is dropship and source_url is a valid URL", () => {
    const draft = makeDraft({
      source_type: "dropship",
      product_id: "",
      source_url: "https://de.aliexpress.com/item/123.html",
    });
    expect(validateSourceStep(draft)).toBeNull();
  });

  it("fails when source_type is dropship and source_url is empty", () => {
    const draft = makeDraft({ source_type: "dropship", product_id: "", source_url: "" });
    expect(validateSourceStep(draft)).toBe("Enter a supplier URL.");
  });

  it("fails when source_type is dropship and source_url is not a valid URL", () => {
    const draft = makeDraft({ source_type: "dropship", product_id: "", source_url: "not-a-url" });
    expect(validateSourceStep(draft)).toBe("Enter a valid URL.");
  });
});

describe("validateDetailsStep", () => {
  it("passes with valid title/price/quantity", () => {
    expect(validateDetailsStep(makeDraft())).toBeNull();
  });

  it("fails when title is blank", () => {
    expect(validateDetailsStep(makeDraft({ title: "  " }))).toBe("Title is required.");
  });

  it("fails when price is not a positive number", () => {
    expect(validateDetailsStep(makeDraft({ price: "0" }))).toBe("Price must be greater than 0.");
    expect(validateDetailsStep(makeDraft({ price: "abc" }))).toBe("Price must be greater than 0.");
  });

  it("fails when quantity is not a positive integer", () => {
    expect(validateDetailsStep(makeDraft({ quantity: "0" }))).toBe(
      "Quantity must be at least 1."
    );
    expect(validateDetailsStep(makeDraft({ quantity: "1.5" }))).toBe(
      "Quantity must be at least 1."
    );
  });
});

describe("validateCategoryStep", () => {
  it("passes when category_id is set", () => {
    expect(validateCategoryStep(makeDraft())).toBeNull();
  });

  it("fails when category_id is empty", () => {
    expect(validateCategoryStep(makeDraft({ category_id: "" }))).toBe(
      "Select a category."
    );
  });
});

describe("validateImagesStep", () => {
  it("passes with at least one image", () => {
    expect(validateImagesStep(makeDraft())).toBeNull();
  });

  it("fails with no images", () => {
    expect(validateImagesStep(makeDraft({ image_urls: [] }))).toBe(
      "Add at least one image."
    );
  });
});

describe("validatePoliciesStep", () => {
  it("passes when all three policies are set", () => {
    expect(validatePoliciesStep(makeDraft())).toBeNull();
  });

  it("fails when fulfillment_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ fulfillment_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });

  it("fails when payment_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ payment_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });

  it("fails when return_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ return_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/app/dashboard/listings/_lib/wizardValidation.test.ts`
Expected: FAIL with "Cannot find module './wizardValidation'"

- [ ] **Step 3: Write the implementation**

```ts
// src/app/dashboard/listings/_lib/wizardValidation.ts
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
  fulfillment_policy_id: string;
  payment_policy_id: string;
  return_policy_id: string;
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

export function validatePoliciesStep(draft: DraftFormState): string | null {
  const { fulfillment_policy_id, payment_policy_id, return_policy_id } = draft;
  if (!fulfillment_policy_id || !payment_policy_id || !return_policy_id) {
    return "Select a fulfillment, payment, and return policy.";
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/app/dashboard/listings/_lib/wizardValidation.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_lib/wizardValidation.ts src/app/dashboard/listings/_lib/wizardValidation.test.ts
git commit -m "feat: add listing wizard step validators"
```

---

### Task 5: eBay payload builders

**Files:**
- Create: `src/lib/integrations/ebay/publishPayloads.ts`
- Create: `src/lib/integrations/ebay/publishPayloads.test.ts`

**Interfaces:**
- Consumes: `EbayListingDraft` (Task 1).
- Produces: `buildInventoryItemPayload(draft)`, `buildOfferPayload(draft, marketplaceId)` — consumed by Task 10 (`publish.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/integrations/ebay/publishPayloads.test.ts
import { buildInventoryItemPayload, buildOfferPayload } from "./publishPayloads";
import type { EbayListingDraft } from "@/types";

function makeDraft(overrides: Partial<EbayListingDraft> = {}): EbayListingDraft {
  return {
    id: "draft-1",
    source_type: "inventory",
    product_id: "product-1",
    source_url: null,
    source_platform: null,
    title: "Wireless Mouse",
    description: "A great mouse.",
    price: 19.99,
    currency: "EUR",
    quantity: 5,
    condition: "new",
    category_id: "9355",
    category_name: "Cell Phones",
    image_urls: ["https://example.com/img.jpg"],
    fulfillment_policy_id: "fp-1",
    payment_policy_id: "pp-1",
    return_policy_id: "rp-1",
    ebay_sku: "KNabc123def456",
    status: "draft",
    ebay_offer_id: null,
    ebay_listing_id: null,
    publish_error: null,
    created_by: "user-1",
    created_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildInventoryItemPayload", () => {
  it("maps a new-condition draft to the eBay InventoryItem shape", () => {
    const payload = buildInventoryItemPayload(makeDraft());
    expect(payload).toEqual({
      availability: { shipToLocationAvailability: { quantity: 5 } },
      condition: "NEW",
      product: {
        title: "Wireless Mouse",
        description: "A great mouse.",
        imageUrls: ["https://example.com/img.jpg"],
      },
    });
  });

  it("maps used and refurbished conditions to their eBay enum values", () => {
    expect(buildInventoryItemPayload(makeDraft({ condition: "used" })).condition).toBe(
      "USED_EXCELLENT"
    );
    expect(
      buildInventoryItemPayload(makeDraft({ condition: "refurbished" })).condition
    ).toBe("CERTIFIED_REFURBISHED");
  });

  it("defaults description to an empty string when null", () => {
    const payload = buildInventoryItemPayload(makeDraft({ description: null }));
    expect(payload.product.description).toBe("");
  });
});

describe("buildOfferPayload", () => {
  it("maps a draft to the eBay Offer shape", () => {
    const payload = buildOfferPayload(makeDraft(), "EBAY_DE");
    expect(payload).toEqual({
      sku: "KNabc123def456",
      marketplaceId: "EBAY_DE",
      format: "FIXED_PRICE",
      availableQuantity: 5,
      categoryId: "9355",
      listingDescription: "A great mouse.",
      pricingSummary: { price: { value: "19.99", currency: "EUR" } },
      listingPolicies: {
        fulfillmentPolicyId: "fp-1",
        paymentPolicyId: "pp-1",
        returnPolicyId: "rp-1",
      },
    });
  });

  it("falls back to title as the listing description when description is null", () => {
    const payload = buildOfferPayload(makeDraft({ description: null }), "EBAY_DE");
    expect(payload.listingDescription).toBe("Wireless Mouse");
  });

  it("formats price with exactly two decimal places", () => {
    const payload = buildOfferPayload(makeDraft({ price: 20 }), "EBAY_DE");
    expect(payload.pricingSummary.price.value).toBe("20.00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: FAIL with "Cannot find module './publishPayloads'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/integrations/ebay/publishPayloads.ts
import type { EbayListingDraft, ListingCondition } from "@/types";

const CONDITION_ENUM: Record<ListingCondition, string> = {
  new: "NEW",
  used: "USED_EXCELLENT",
  refurbished: "CERTIFIED_REFURBISHED",
};

export interface InventoryItemPayload {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: string;
  product: { title: string; description: string; imageUrls: string[] };
}

export function buildInventoryItemPayload(draft: EbayListingDraft): InventoryItemPayload {
  return {
    availability: { shipToLocationAvailability: { quantity: draft.quantity } },
    condition: CONDITION_ENUM[draft.condition],
    product: {
      title: draft.title,
      description: draft.description ?? "",
      imageUrls: draft.image_urls,
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
}

export function buildOfferPayload(draft: EbayListingDraft, marketplaceId: string): OfferPayload {
  return {
    sku: draft.ebay_sku ?? "",
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: draft.quantity,
    categoryId: draft.category_id ?? "",
    listingDescription: draft.description ?? draft.title,
    pricingSummary: { price: { value: draft.price.toFixed(2), currency: draft.currency } },
    listingPolicies: {
      fulfillmentPolicyId: draft.fulfillment_policy_id ?? "",
      paymentPolicyId: draft.payment_policy_id ?? "",
      returnPolicyId: draft.return_policy_id ?? "",
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay/publishPayloads.ts src/lib/integrations/ebay/publishPayloads.test.ts
git commit -m "feat: add eBay InventoryItem/Offer payload builders"
```

---

### Task 6: `ebay_listing_drafts` migration + `provision_tenant_schema()` update

**Files:**
- Create: `supabase/migrations/021_ebay_listing_drafts.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`

**Interfaces:**
- Produces: `{{schema}}.ebay_listing_drafts` table (every tenant schema) — consumed by Task 8 (`listingsSlice.ts`) and Task 12 (publish route).

- [ ] **Step 1: Write the new-tenant migration**

```sql
-- supabase/migrations/021_ebay_listing_drafts.sql
-- ============================================================
-- eBay listing drafts — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- A draft can be sourced from an Inventory product OR a third-party
-- (dropship) supplier URL — exactly one of product_id/source_url is set,
-- enforced at the application layer (see wizardValidation.ts), not a DB
-- CHECK, to keep the migration simple and match how product_id nullability
-- already works on sales/purchases.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets this table from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.ebay_listing_drafts (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type            text NOT NULL CHECK (source_type IN ('inventory', 'dropship')),
    product_id             uuid REFERENCES {{schema}}.products(id),
    source_url             text,
    source_platform        text,
    title                  text NOT NULL,
    description            text,
    price                  numeric(12,2) NOT NULL CHECK (price >= 0),
    currency               text NOT NULL DEFAULT 'EUR',
    quantity               integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    condition              text NOT NULL CHECK (condition IN ('new', 'used', 'refurbished')),
    category_id            text,
    category_name          text,
    image_urls             text[] NOT NULL DEFAULT '{}',
    fulfillment_policy_id  text,
    payment_policy_id      text,
    return_policy_id       text,
    ebay_sku               text,
    status                 text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
    ebay_offer_id          text,
    ebay_listing_id        text,
    publish_error          text,
    created_by             uuid NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
  );

  CREATE OR REPLACE TRIGGER set_ebay_listing_drafts_updated_at
    BEFORE UPDATE ON {{schema}}.ebay_listing_drafts
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

  CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_status
    ON {{schema}}.ebay_listing_drafts (status);
  CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_created_by
    ON {{schema}}.ebay_listing_drafts (created_by);

  ALTER TABLE {{schema}}.ebay_listing_drafts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "ebay_listing_drafts_all_admin" ON {{schema}}.ebay_listing_drafts;
  CREATE POLICY "ebay_listing_drafts_all_admin" ON {{schema}}.ebay_listing_drafts
    FOR ALL
    USING ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'))
    WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));
$$);
```

- [ ] **Step 2: Update `provision_tenant_schema()` — table (section 1)**

In `supabase/migrations/005_tenant_provisioning.sql`, insert this block immediately after the `platform_payouts` table's closing `$sql$, schema_name);` (currently ends at line 254, right before the `-- ── 2. updated_at triggers` comment on line 256):

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_listing_drafts (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_type            text NOT NULL CHECK (source_type IN ('inventory', 'dropship')),
      product_id             uuid REFERENCES %1$I.products(id),
      source_url             text,
      source_platform        text,
      title                  text NOT NULL,
      description            text,
      price                  numeric(12,2) NOT NULL CHECK (price >= 0),
      currency               text NOT NULL DEFAULT 'EUR',
      quantity               integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
      condition              text NOT NULL CHECK (condition IN ('new', 'used', 'refurbished')),
      category_id            text,
      category_name          text,
      image_urls             text[] NOT NULL DEFAULT '{}',
      fulfillment_policy_id  text,
      payment_policy_id      text,
      return_policy_id       text,
      ebay_sku               text,
      status                 text NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
      ebay_offer_id          text,
      ebay_listing_id        text,
      publish_error          text,
      created_by             uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

```

- [ ] **Step 3: Update `provision_tenant_schema()` — trigger (section 2)**

Append this line right after the `set_platform_connections_updated_at` trigger line (line 262):

```sql
  EXECUTE format('CREATE OR REPLACE TRIGGER set_ebay_listing_drafts_updated_at BEFORE UPDATE ON %1$I.ebay_listing_drafts FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
```

- [ ] **Step 4: Update `provision_tenant_schema()` — RLS (section 5)**

Change the `FOREACH tbl IN ARRAY [...]` line (line 386) to include the new table:

```sql
  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections', 'platform_payouts', 'ebay_listing_drafts']
```

Then add its policy right after the `platform_payouts_delete` policy line (line 446):

```sql

  -- ebay_listing_drafts — admin/super_admin only, all operations (mirrors platform_connections)
  EXECUTE format('CREATE POLICY "ebay_listing_drafts_all_admin" ON %1$I.ebay_listing_drafts FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin'')) WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
```

- [ ] **Step 5: Update `provision_tenant_schema()` — indexes (section 6)**

Append after the `idx_platform_payouts_platform_date` line (line 484):

```sql

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_status ON %1$I.ebay_listing_drafts (status)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_created_by ON %1$I.ebay_listing_drafts (created_by)', schema_name);
```

- [ ] **Step 6: No jest test — apply manually**

This is SQL, not covered by `npx jest`. After committing, tell the user:
> "Migration `021_ebay_listing_drafts.sql` and the `provision_tenant_schema()` update in `005_tenant_provisioning.sql` need to be applied manually in the Project B Supabase SQL editor before this feature works end-to-end — paste `021_ebay_listing_drafts.sql` first, then re-run the full (updated) `005_tenant_provisioning.sql` so future tenants get the table too."

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/021_ebay_listing_drafts.sql supabase/migrations/005_tenant_provisioning.sql
git commit -m "feat: add ebay_listing_drafts table to all tenant schemas"
```

---

### Task 7: Listing images Storage bucket

**Files:**
- Create: `supabase/migrations/022_listing_images_bucket.sql`

**Interfaces:**
- Produces: Storage bucket `listing-images`, `public.current_tenant_role()` — consumed by Task 15 (`ImagesStep.tsx`).

- [ ] **Step 1: Write the migration**

This is new ground for the codebase — no Storage bucket exists yet. Path convention: `{tenant_schema}/{draft_id}/{filename}`, so a tenant-scoped RLS policy can check the first path segment against the caller's JWT `tenant_schema` claim. Role (admin/super_admin) can't be read directly from the JWT (role lives in each tenant schema's own `profiles` table), so this migration adds one small schema-agnostic helper function that looks it up dynamically — the same dynamic-schema-name technique `provision_tenant_schema()` already uses throughout.

```sql
-- supabase/migrations/022_listing_images_bucket.sql
-- ============================================================
-- Storage bucket for eBay listing images.
-- Run this in the Supabase SQL editor for Project B.
--
-- Public read (eBay must be able to fetch the image URLs), write/delete
-- restricted to authenticated admin/super_admin of the tenant that owns the
-- path prefix. Path convention: {tenant_schema}/{draft_id}/{filename}.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

-- Schema-agnostic role lookup: reads the caller's tenant_schema from their
-- JWT, then dynamically queries that schema's profiles table. Distinct from
-- each tenant schema's own current_user_role() (defined inside
-- provision_tenant_schema()), which only works when already connected with
-- that schema set via db.schema — storage policies have no such context.
CREATE OR REPLACE FUNCTION public.current_tenant_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schema_name text;
  role_value text;
BEGIN
  schema_name := auth.jwt() -> 'app_metadata' ->> 'tenant_schema';
  IF schema_name IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT role FROM %I.profiles WHERE id = auth.uid()', schema_name)
    INTO role_value;
  RETURN role_value;
END;
$$;

DROP POLICY IF EXISTS "listing_images_public_read" ON storage.objects;
CREATE POLICY "listing_images_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'listing-images');

DROP POLICY IF EXISTS "listing_images_tenant_admin_write" ON storage.objects;
CREATE POLICY "listing_images_tenant_admin_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "listing_images_tenant_admin_delete" ON storage.objects;
CREATE POLICY "listing_images_tenant_admin_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IN ('admin', 'super_admin')
  );
```

- [ ] **Step 2: No jest test — apply manually**

After committing, tell the user:
> "Migration `022_listing_images_bucket.sql` needs to be applied manually in the Project B Supabase SQL editor — it creates the `listing-images` Storage bucket and its RLS policies, which don't exist yet."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_listing_images_bucket.sql
git commit -m "feat: add listing-images Storage bucket + tenant-aware RLS"
```

---

### Task 8: `listingsSlice.ts`

**Files:**
- Create: `src/app/dashboard/listings/_store/listingsSlice.ts`
- Create: `src/app/dashboard/listings/_store/listingsSlice.test.ts`

**Interfaces:**
- Consumes: `EbayListingDraft` (Task 1), `createTenantClient` (`@/lib/supabase/client`), `rangeFor`/`DEFAULT_PAGE_SIZE` (`@/lib/utils/pagedQuery`).
- Produces: `listingsSlice`, `hydratePage` (aliased `hydrateListingDrafts`), `addListingDraft`, `updateListingDraft`, `removeListingDraft`, `setFetching`, `fetchListingsPage({ page, pageSize })` thunk — consumed by Task 9 (wiring), Task 13 (table), and Task 17 (wizard shell save/publish).

This mirrors `purchasesSlice.ts` exactly (same `applyHydratePage` helper, same action names pattern), with no filters for v1 (YAGNI — a search/filter bar can be added later the same way Purchases/Sales already show, once there's a real need).

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/dashboard/listings/_store/listingsSlice.test.ts
import {
  listingsSlice,
  hydrateListingDrafts,
  addListingDraft,
  updateListingDraft,
  removeListingDraft,
  fetchListingsPage,
} from "./listingsSlice";
import type { EbayListingDraft } from "@/types";

const makeDraft = (overrides: Partial<EbayListingDraft> = {}): EbayListingDraft => ({
  id: "draft-1",
  source_type: "inventory",
  product_id: "product-1",
  source_url: null,
  source_platform: null,
  title: "Wireless Mouse",
  description: null,
  price: 19.99,
  currency: "EUR",
  quantity: 5,
  condition: "new",
  category_id: null,
  category_name: null,
  image_urls: [],
  fulfillment_policy_id: null,
  payment_policy_id: null,
  return_policy_id: null,
  ebay_sku: null,
  status: "draft",
  ebay_offer_id: null,
  ebay_listing_id: null,
  publish_error: null,
  created_by: "user-1",
  created_at: "2026-07-20T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
  ...overrides,
});

describe("listingsSlice", () => {
  const { reducer } = listingsSlice;

  it("starts empty with loaded=false and pagination defaults", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
  });

  it("hydrates listings via hydrateListingDrafts (hydratePage alias)", () => {
    const state = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(1);
  });

  it("prepends a new draft via addListingDraft and increments total", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(base, addListingDraft(makeDraft({ id: "draft-new" })));
    expect(state.items[0].id).toBe("draft-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("updates an existing draft", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(base, updateListingDraft(makeDraft({ status: "published" })));
    expect(state.items[0].status).toBe("published");
  });

  it("removes a draft by id and decrements total", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({
        data: [makeDraft({ id: "d1" }), makeDraft({ id: "d2" })],
        count: 2,
        page: 1,
        pageSize: 50,
      })
    );
    const state = reducer(base, removeListingDraft("d1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("d2");
    expect(state.total).toBe(1);
  });

  it("sets isFetching=true on fetchListingsPage.pending", () => {
    const state = reducer(
      undefined,
      fetchListingsPage.pending("req-id", { page: 1, pageSize: 50 })
    );
    expect(state.isFetching).toBe(true);
  });

  it("applies page data on fetchListingsPage.fulfilled", () => {
    const payload = { data: [makeDraft({ id: "d3" })], count: 4, page: 2, pageSize: 50 };
    const state = reducer(
      undefined,
      fetchListingsPage.fulfilled(payload, "req-id", { page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(4);
    expect(state.page).toBe(2);
    expect(state.isFetching).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("clears isFetching on fetchListingsPage.rejected", () => {
    const pending = reducer(
      undefined,
      fetchListingsPage.pending("req-id", { page: 1, pageSize: 50 })
    );
    const state = reducer(
      pending,
      fetchListingsPage.rejected(new Error("fail"), "req-id", { page: 1, pageSize: 50 })
    );
    expect(state.isFetching).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/app/dashboard/listings/_store/listingsSlice.test.ts`
Expected: FAIL with "Cannot find module './listingsSlice'"

- [ ] **Step 3: Write the implementation**

```ts
// src/app/dashboard/listings/_store/listingsSlice.ts
import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { EbayListingDraft } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { rangeFor, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

interface ListingsState {
  items: EbayListingDraft[];
  loaded: boolean;
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
}

const initialState: ListingsState = {
  items: [],
  loaded: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  isFetching: false,
};

// ─── Thunk ────────────────────────────────────────────────────────────────────

export const fetchListingsPage = createAsyncThunk(
  "listings/fetchPage",
  async (params: { page: number; pageSize: number }) => {
    const { page, pageSize } = params;

    const supabase = await createTenantClient();
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await supabase
      .from("ebay_listing_drafts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    return { data: (data ?? []) as EbayListingDraft[], count: count ?? 0, page, pageSize };
  }
);

// ─── Shared page-hydration helper ─────────────────────────────────────────────

function applyHydratePage(
  state: ListingsState,
  payload: { data: EbayListingDraft[]; count: number; page: number; pageSize: number }
) {
  state.items = payload.data;
  state.page = payload.page;
  state.pageSize = payload.pageSize;
  state.total = payload.count;
  state.isFetching = false;
  state.loaded = true;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const listingsSlice = createSlice({
  name: "listings",
  initialState,
  reducers: {
    setFetching(state, action: PayloadAction<boolean>) {
      state.isFetching = action.payload;
    },
    hydratePage(
      state,
      action: PayloadAction<{ data: EbayListingDraft[]; count: number; page: number; pageSize: number }>
    ) {
      applyHydratePage(state, action.payload);
    },
    addListingDraft(state, action: PayloadAction<EbayListingDraft>) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
    updateListingDraft(state, action: PayloadAction<EbayListingDraft>) {
      const idx = state.items.findIndex((d) => d.id === action.payload.id);
      if (idx !== -1) state.items[idx] = action.payload;
    },
    removeListingDraft(state, action: PayloadAction<string>) {
      const before = state.items.length;
      state.items = state.items.filter((d) => d.id !== action.payload);
      if (state.items.length < before) state.total -= 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchListingsPage.pending, (state) => {
        state.isFetching = true;
      })
      .addCase(fetchListingsPage.fulfilled, (state, action) => {
        applyHydratePage(state, action.payload);
      })
      .addCase(fetchListingsPage.rejected, (state) => {
        state.isFetching = false;
      });
  },
});

export const { setFetching, hydratePage, addListingDraft, updateListingDraft, removeListingDraft } =
  listingsSlice.actions;

/** Legacy alias kept so StoreProvider can call `hydrateListingDrafts` by name. */
export const hydrateListingDrafts = hydratePage;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/app/dashboard/listings/_store/listingsSlice.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_store/listingsSlice.ts src/app/dashboard/listings/_store/listingsSlice.test.ts
git commit -m "feat: add listingsSlice"
```

---

### Task 9: Wire `listingsSlice` into store, StoreProvider, and layout

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/store/StoreProvider.tsx`
- Modify: `src/app/dashboard/layout.tsx`

**Interfaces:**
- Consumes: `listingsSlice`, `hydrateListingDrafts` (Task 8).
- Produces: `state.listings` available to every component.

- [ ] **Step 1: Register the reducer**

In `src/store/store.ts`, add the import (after the `platformPayoutsSlice` import, line 12):

```ts
import { listingsSlice } from "@/app/dashboard/listings/_store/listingsSlice";
```

And add to the `reducer` object (after `platformPayouts: platformPayoutsSlice.reducer,`, line 27):

```ts
      listings: listingsSlice.reducer,
```

- [ ] **Step 2: Hydrate from StoreProvider**

In `src/store/StoreProvider.tsx`, add the import (after `hydratePayouts`, line 21):

```ts
import { hydrateListingDrafts } from "@/app/dashboard/listings/_store/listingsSlice";
```

Add `EbayListingDraft` to the type import (line 22-34 block), and add a new prop:

```ts
  listingDrafts?: { data: EbayListingDraft[]; count: number };
```

(placed after `platformPayouts?: PlatformPayout[];`, line 52), destructure it in the function signature (after `platformPayouts`, line 69), and dispatch it in the `useState` initializer (after `if (platformPayouts) ...`, line 85):

```ts
    if (listingDrafts) store.dispatch(hydrateListingDrafts({ data: listingDrafts.data, count: listingDrafts.count, page: 1, pageSize: DEFAULT_PAGE_SIZE }));
```

- [ ] **Step 3: Fetch first page in the layout**

In `src/app/dashboard/layout.tsx`, add `EbayListingDraft` to the type import (line 9-21 block).

Add a new query to the `Promise.all` array (after the `platform_payouts` query, before the closing `]);` on line 143):

```ts
    supabase
      .from("ebay_listing_drafts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<EbayListingDraft[]>(),
```

Add the matching destructured variable to the array-destructuring on the left side (after `{ data: platformPayoutsData }`, line 76):

```ts
    { data: listingDraftsData, count: listingDraftsCount },
```

And pass it to `<StoreProvider>` (after `platformPayouts={...}`, line 179):

```ts
      listingDrafts={{ data: listingDraftsData ?? [], count: listingDraftsCount ?? 0 }}
```

- [ ] **Step 4: No jest test — this is wiring, not logic**

Task 8's slice tests already cover the reducer behavior this wiring depends on. Verified by every later UI task actually rendering `state.listings` data.

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/StoreProvider.tsx src/app/dashboard/layout.tsx
git commit -m "feat: wire listingsSlice into store/layout hydration"
```

---

### Task 10: `publish.ts` — eBay Inventory/Taxonomy/Account API calls

**Files:**
- Create: `src/lib/integrations/ebay/publish.ts`

**Interfaces:**
- Consumes: `buildInventoryItemPayload`, `buildOfferPayload` (Task 5), `EbayListingDraft` (Task 1).
- Produces: `searchCategories(accessToken, query)`, `fetchBusinessPolicies(accessToken)`, `publishListing(accessToken, draft, sku, existingOfferId)` — consumed by Task 11 (categories/policies routes) and Task 12 (publish route).

This mirrors `ebay.ts`'s fetch pattern (Bearer token, JSON), not `listings.ts`'s XML Trading API pattern — the Inventory/Taxonomy/Account APIs are all REST/JSON. Not unit tested, matching the project's convention that raw-HTTP adapter code (`ebay.ts`, `amazon.ts`) has no colocated test — only the pure payload builders it calls (Task 5) are tested.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/integrations/ebay/publish.ts
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
```

- [ ] **Step 2: No jest test — matches `ebay.ts`/`amazon.ts` convention**

`publish.ts` is raw HTTP-calling adapter code, same category as `ebay.ts`/`amazon.ts`/`listings.ts` — none of those have colocated tests in this codebase. The logic worth testing (payload shape) is already covered by Task 5's `publishPayloads.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ebay/publish.ts
git commit -m "feat: add eBay category search, business policy, and publish calls"
```

---

### Task 11: API routes — category search + business policies

**Files:**
- Create: `src/app/api/listings/ebay/categories/route.ts`
- Create: `src/app/api/listings/ebay/policies/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin` (`@/lib/integrations/authGuard`), `getConnection`/`ensureValidAccessToken` (`@/lib/integrations/tokenStore`), `ebayAdapter` (`@/lib/integrations/ebay`), `searchCategories`/`fetchBusinessPolicies` (Task 10).
- Produces: `GET /api/listings/ebay/categories?q=`, `GET /api/listings/ebay/policies` — consumed by Task 15/16 (`CategoryStep.tsx`, `PoliciesStep.tsx`).

- [ ] **Step 1: Write the categories route**

```ts
// src/app/api/listings/ebay/categories/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { searchCategories } from "@/lib/integrations/ebay/publish";

export async function GET(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  try {
    const categories = await searchCategories(accessToken, query);
    return NextResponse.json({ categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Category search failed" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Write the policies route**

```ts
// src/app/api/listings/ebay/policies/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchBusinessPolicies } from "@/lib/integrations/ebay/publish";

export async function GET() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  try {
    const policies = await fetchBusinessPolicies(accessToken);
    return NextResponse.json(policies);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch business policies" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 3: No jest test — matches the existing `/api/integrations/*`/`/api/dropshipping/*` route convention**

None of those routes have colocated tests in this codebase either — verified manually (Task 15/16's UI, then the user exercising it in the browser).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/listings/ebay/categories/route.ts src/app/api/listings/ebay/policies/route.ts
git commit -m "feat: add eBay category search and business policy API routes"
```

---

### Task 12: API route — resumable publish

**Files:**
- Create: `src/app/api/listings/[id]/publish/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin`, `getConnection`/`ensureValidAccessToken`, `ebayAdapter`, `publishListing` (Task 10), `generateListingSku` (Task 3), `hasPermission` (Task 2).
- Produces: `POST /api/listings/[id]/publish` — consumed by Task 17 (`ListingWizard.tsx`'s `handlePublish`).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/listings/[id]/publish/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { hasPermission } from "@/lib/utils/permissions";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { publishListing } from "@/lib/integrations/ebay/publish";
import { generateListingSku } from "@/lib/integrations/ebay/generateSku";
import type { EbayListingDraft, Profile } from "@/types";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<Pick<Profile, "role">>();
  if (!profile?.role || !hasPermission(profile.role, "manage_listings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const { data: draft, error: fetchError } = await client
    .from("ebay_listing_drafts")
    .select("*")
    .eq("id", id)
    .single<EbayListingDraft>();

  if (fetchError || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  // Step 1: assign a SKU on first publish attempt, persist before calling eBay.
  let sku = draft.ebay_sku;
  if (!sku) {
    sku = generateListingSku();
    await client.from("ebay_listing_drafts").update({ ebay_sku: sku }).eq("id", id);
  }

  await client.from("ebay_listing_drafts").update({ status: "publishing" }).eq("id", id);

  try {
    const result = await publishListing(accessToken, draft, sku, draft.ebay_offer_id);

    const { data: updated, error: updateError } = await client
      .from("ebay_listing_drafts")
      .update({
        status: "published",
        ebay_sku: sku,
        ebay_offer_id: result.offerId,
        ebay_listing_id: result.listingId,
        publish_error: null,
      })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";

    // Best-effort: persist whatever offerId was captured before the failure
    // (publishListing throws after createOffer but before publishOffer, for
    // example) so a retry resumes with updateOffer instead of createOffer.
    const { data: failed } = await client
      .from("ebay_listing_drafts")
      .update({ status: "failed", ebay_sku: sku, publish_error: message })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    return NextResponse.json(
      { error: message, draft: failed ?? null },
      { status: 502 }
    );
  }
}
```

**Note on the offerId-resume gap:** `publishListing` (Task 10) returns `{offerId, listingId}` only on full success — if it throws between `createOffer` succeeding and `publishOffer` completing, the created `offerId` is lost from this route's perspective (it's inside `publishListing`'s try, not surfaced on throw). This is a known v1 limitation consistent with the spec's resumability intent but not perfectly achieving it for that one failure window — a retry in that specific case calls `createOffer` again. eBay's `createOffer` is not idempotent by SKU (unlike `createOrReplaceInventoryItem`), so a repeated failure in that exact window could accumulate orphaned offers on eBay's side. Documented as a gotcha in Task 18's `SKILL.md` rather than solved here — solving it cleanly means changing `publishListing`'s signature to report partial progress via a callback or thrown-with-context error, which is more machinery than this v1 needs given the failure window is narrow (one HTTP call wide).

- [ ] **Step 2: No jest test — matches the `/api/integrations/*` route convention**

Verified manually once Task 17 wires up the "Publish" button.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listings/[id]/publish/route.ts
git commit -m "feat: add resumable eBay listing publish route"
```

---

### Task 13: Sidebar link + listings table page

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `src/app/dashboard/listings/page.tsx`
- Create: `src/app/dashboard/listings/_components/ListingsTable.tsx`

**Interfaces:**
- Consumes: `state.listings` (Task 8/9), `hasPlatformIntegrations` (`@/lib/utils/planGating`), `hasPermission` (Task 2), `fetchListingsPage` (Task 8).
- Produces: `/dashboard/listings` route, `<ListingsTable>`.

- [ ] **Step 1: Add the Sidebar nav item**

In `src/components/layout/Sidebar.tsx`, add `Tag` to the `lucide-react` import (line 5-21 block, alongside `Package`), then add a new entry to `NAV_ITEMS` (after the `"Integrations"` entry, i.e. after line 85):

```ts
  {
    label: "Listings",
    href: "/dashboard/listings",
    Icon: Tag,
    roles: ["super_admin", "admin", "accountant"],
  },
```

(Role-gating here is intentionally permissive — same as Integrations' nav entry — the actual create/publish actions are gated by `manage_listings` inside the page itself, matching how Dropshipping's "Refresh from eBay" button is role-gated inline rather than hidden from the nav.)

- [ ] **Step 2: Write `ListingsTable.tsx`**

```tsx
// src/app/dashboard/listings/_components/ListingsTable.tsx
"use client";

import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import type { EbayListingDraft, ListingStatus } from "@/types";

const STATUS_VARIANTS: Record<ListingStatus, "default" | "success" | "warning" | "danger" | "info"> = {
  draft: "default",
  publishing: "info",
  published: "success",
  failed: "danger",
};

interface Props {
  listings: EbayListingDraft[];
}

export function ListingsTable({ listings }: Props) {
  return (
    <DataTable<EbayListingDraft>
      keyField="id"
      rows={listings}
      emptyMessage="No listings yet. Click “New Listing” to create one."
      columns={[
        {
          header: "Image",
          render: (row) =>
            row.image_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.image_urls[0]} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-(--color-surface-subtle)">
                <ImageIcon size={16} className="text-(--color-text-faint)" />
              </div>
            ),
        },
        {
          header: "Title",
          render: (row) => (
            <Link href={`/dashboard/listings/${row.id}`} className="font-medium text-(--color-primary) hover:underline">
              {row.title}
            </Link>
          ),
        },
        {
          header: "Source",
          render: (row) =>
            row.source_type === "inventory" ? (
              <Badge label="Inventory" variant="info" />
            ) : (
              <Badge label={row.source_platform ?? "Dropship"} variant="default" />
            ),
        },
        {
          header: "Price",
          render: (row) => formatCurrency(row.price, row.currency),
          sortValue: (row) => row.price,
        },
        {
          header: "Status",
          render: (row) => <Badge label={row.status} variant={STATUS_VARIANTS[row.status]} />,
        },
        {
          header: "Actions",
          render: (row) =>
            row.status === "published" && row.ebay_listing_id ? (
              <a
                href={`https://www.ebay.com/itm/${row.ebay_listing_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--color-primary) hover:underline"
              >
                View on eBay →
              </a>
            ) : (
              <Link href={`/dashboard/listings/${row.id}`} className="text-sm text-(--color-primary) hover:underline">
                {row.status === "failed" ? "Retry" : "Edit"} →
              </Link>
            ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 3: Write `page.tsx`**

```tsx
// src/app/dashboard/listings/page.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchListingsPage } from "./_store/listingsSlice";
import { ListingsTable } from "./_components/ListingsTable";

export default function ListingsPage() {
  const dispatch = useAppDispatch();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const { items, page, pageSize, total, isFetching } = useAppSelector((s) => s.listings);

  const canManage = role && hasPermission(role, "manage_listings");

  function goToPage(nextPage: number) {
    dispatch(fetchListingsPage({ page: nextPage, pageSize }));
  }

  useEffect(() => {}, []);

  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader title="Listings" description="Publish products to eBay from your dashboard" />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            Upgrade to unlock Listings
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            eBay listing creation is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-(--color-primary) hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Listings"
        description="Publish products to eBay from Inventory or a dropship source"
        action={
          canManage && (
            <Link href="/dashboard/listings/new">
              <Button size="sm">
                <Plus size={14} />
                New Listing
              </Button>
            </Link>
          )
        }
      />

      {isFetching && (
        <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>
      )}

      <ListingsTable listings={items} />

      <div className="mt-3">
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: No jest test — matches every other feature `page.tsx`'s convention**

None of `sales/page.tsx`, `purchases/page.tsx`, `dropshipping/page.tsx`, etc. have colocated tests — verified manually.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/app/dashboard/listings/page.tsx src/app/dashboard/listings/_components/ListingsTable.tsx
git commit -m "feat: add listings table page and sidebar link"
```

---

### Task 14: Source step + Details step

**Files:**
- Create: `src/app/dashboard/listings/_components/SourceStep.tsx`
- Create: `src/app/dashboard/listings/_components/DetailsStep.tsx`

**Interfaces:**
- Consumes: `DraftFormState` (Task 4), `state.inventory.selectorItems` (`ProductSelector`), `detectPlatform` (`@/lib/utils/detectPlatform`).
- Produces: `<SourceStep>`, `<DetailsStep>`, each taking `{ draft, setDraft }` — plugged into `ListingWizard.tsx`'s step switch in Task 17, once all six step components exist.

Grouped with Task 15 (Category/Images) and Task 16 (Policies/Review) as three pairs of standalone, self-contained step components — each takes only `{ draft, setDraft }` (Images also `draftId`) and has no dependency on the wizard shell or on each other. Building all six before the shell means every task in this run leaves the repo in a compiling state — the shell (Task 17) is the only place that imports all six at once, and it's built last, once everything it needs already exists.

- [ ] **Step 1: Write `SourceStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/SourceStep.tsx
"use client";

import { Field, Input, Select } from "@/components/ui/FormFields";
import { useAppSelector } from "@/store/hooks";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function SourceStep({ draft, setDraft }: Props) {
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const detected = draft.source_url ? detectPlatform(draft.source_url) : null;

  return (
    <div className="space-y-4">
      <Field label="Source" required>
        <Select
          value={draft.source_type}
          onChange={(e) =>
            setDraft({
              source_type: e.target.value as DraftFormState["source_type"],
              product_id: "",
              source_url: "",
            })
          }
        >
          <option value="inventory">Inventory product</option>
          <option value="dropship">Third-party (dropship) source</option>
        </Select>
      </Field>

      {draft.source_type === "inventory" ? (
        <Field label="Inventory Product" required>
          <Select
            value={draft.product_id}
            onChange={(e) => setDraft({ product_id: e.target.value })}
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.sku ? `(${p.sku})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Supplier URL" required>
          <Input
            value={draft.source_url}
            onChange={(e) => setDraft({ source_url: e.target.value })}
            placeholder="https://de.aliexpress.com/item/…"
          />
          {detected && (
            <p className="mt-1 text-xs text-(--color-text-muted)">Detected: {detected}</p>
          )}
        </Field>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `DetailsStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/DetailsStep.tsx
"use client";

import { Field, Input, Select, Row, Textarea } from "@/components/ui/FormFields";
import type { DraftFormState } from "../_lib/wizardValidation";
import type { Currency } from "@/types";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function DetailsStep({ draft, setDraft }: Props) {
  return (
    <div className="space-y-4">
      <Field label="Title" required>
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ title: e.target.value })}
          placeholder="e.g. Wireless Mouse, 2.4GHz, Black"
          maxLength={80}
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft({ description: e.target.value })}
          placeholder="Item details buyers will see on eBay"
        />
      </Field>

      <Row>
        <Field label="Price" required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            onChange={(e) => setDraft({ price: e.target.value })}
          />
        </Field>
        <Field label="Currency">
          <Select
            value={draft.currency}
            onChange={(e) => setDraft({ currency: e.target.value as Currency })}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </Select>
        </Field>
      </Row>

      <Row>
        <Field label="Quantity" required>
          <Input
            type="number"
            min="1"
            step="1"
            value={draft.quantity}
            onChange={(e) => setDraft({ quantity: e.target.value })}
          />
        </Field>
        <Field label="Condition" required>
          <Select
            value={draft.condition}
            onChange={(e) => setDraft({ condition: e.target.value as DraftFormState["condition"] })}
          >
            <option value="new">New</option>
            <option value="used">Used</option>
            <option value="refurbished">Refurbished</option>
          </Select>
        </Field>
      </Row>
    </div>
  );
}
```

- [ ] **Step 3: No jest test — matches every other step component in this feature**

Neither component has logic of its own beyond what `wizardValidation.ts` (Task 4, already tested) already covers — they're controlled-input forms, same category as `AddProductModal.tsx` etc., which also have no colocated test in this codebase.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/listings/_components/SourceStep.tsx src/app/dashboard/listings/_components/DetailsStep.tsx
git commit -m "feat: add listing wizard Source and Details steps"
```

---

### Task 15: Category step + Images step

**Files:**
- Create: `src/app/dashboard/listings/_components/CategoryStep.tsx`
- Create: `src/app/dashboard/listings/_components/ImagesStep.tsx`

**Interfaces:**
- Consumes: `DraftFormState` (Task 4), `GET /api/listings/ebay/categories` (Task 11).
- Produces: `<CategoryStep>`, `<ImagesStep>` — plugged into `ListingWizard.tsx`'s switch (Task 17).

- [ ] **Step 1: Write `CategoryStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/CategoryStep.tsx
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Field, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { DraftFormState } from "../_lib/wizardValidation";

interface CategorySuggestion {
  id: string;
  name: string;
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function CategoryStep({ draft, setDraft }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CategorySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/listings/ebay/categories?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Category search failed");
      setResults(json.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Category search failed");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Search eBay categories" required>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. wireless mouse"
          />
          <Button type="button" variant="secondary" onClick={handleSearch} disabled={searching}>
            <Search size={14} />
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </Field>

      {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}

      {draft.category_id && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-(--color-text-muted)">Selected:</span>
          <Badge label={draft.category_name || draft.category_id} variant="success" />
        </div>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-(--color-border) rounded-(--radius-card) border border-(--color-border)">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setDraft({ category_id: r.id, category_name: r.name })}
                className="w-full px-4 py-2 text-left text-sm hover:bg-(--color-surface-subtle) transition-colors"
              >
                {r.name} <span className="text-(--color-text-faint)">({r.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `ImagesStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/ImagesStep.tsx
"use client";

import { useState } from "react";
import { X, ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  /** Null until the draft has been saved at least once — images upload under
   * its id, so an unsaved new draft uses a temporary folder that gets
   * orphaned if the user never saves (acceptable v1 tradeoff, cleaned up
   * manually — see Task 18's SKILL.md gotcha). */
  draftId: string | null;
}

export function ImagesStep({ draft, setDraft, draftId }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const tenantSchema = (session?.user.app_metadata?.tenant_schema as string | undefined) ?? "public";
      const folder = draftId ?? "unsaved";

      const uploadedUrls: string[] = [];
      for (const file of Array.from(files)) {
        const path = `${tenantSchema}/${folder}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-images")
          .upload(path, file);
        if (uploadError) throw uploadError;

        const { data: publicUrl } = supabase.storage.from("listing-images").getPublicUrl(path);
        uploadedUrls.push(publicUrl.publicUrl);
      }

      setDraft({ image_urls: [...draft.image_urls, ...uploadedUrls] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setDraft({ image_urls: draft.image_urls.filter((u) => u !== url) });
  }

  return (
    <div className="space-y-4">
      <label className="flex flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed border-(--color-border) p-8 text-center cursor-pointer hover:border-(--color-primary) transition-colors">
        <Upload size={20} className="text-(--color-text-faint)" />
        <span className="text-sm text-(--color-text-muted)">
          {uploading ? "Uploading…" : "Click to upload images"}
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}

      {draft.image_urls.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {draft.image_urls.map((url) => (
            <div key={url} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
              <button
                type="button"
                onClick={() => removeImage(url)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-(--color-danger-text) text-white p-0.5"
                aria-label="Remove image"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft.image_urls.length === 0 && !uploading && (
        <div className="flex items-center gap-2 text-xs text-(--color-text-faint)">
          <ImageIcon size={14} />
          At least one image is required.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: No jest test — file upload UI, matches project convention**

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/listings/_components/CategoryStep.tsx src/app/dashboard/listings/_components/ImagesStep.tsx
git commit -m "feat: add listing wizard Category and Images steps"
```

---

### Task 16: Policies step + Review step

**Files:**
- Create: `src/app/dashboard/listings/_components/PoliciesStep.tsx`
- Create: `src/app/dashboard/listings/_components/ReviewStep.tsx`

**Interfaces:**
- Consumes: `DraftFormState` (Task 4), `GET /api/listings/ebay/policies` (Task 11).
- Produces: `<PoliciesStep>`, `<ReviewStep>` — plugged into `ListingWizard.tsx`'s switch (Task 17). This is the last of the three step-component pairs — once this lands, all six step components exist and Task 17 can assemble them.

- [ ] **Step 1: Write `PoliciesStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/PoliciesStep.tsx
"use client";

import { useEffect, useState } from "react";
import { Field, Select } from "@/components/ui/FormFields";
import type { DraftFormState } from "../_lib/wizardValidation";

interface PolicySummary {
  id: string;
  name: string;
}
interface BusinessPolicies {
  fulfillment: PolicySummary[];
  payment: PolicySummary[];
  return: PolicySummary[];
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function PoliciesStep({ draft, setDraft }: Props) {
  const [policies, setPolicies] = useState<BusinessPolicies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/listings/ebay/policies");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load business policies");
        setPolicies(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load business policies");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-(--color-text-muted)">Loading business policies…</p>;
  if (error) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!policies) return null;

  return (
    <div className="space-y-4">
      <Field label="Fulfillment Policy" required>
        <Select
          value={draft.fulfillment_policy_id}
          onChange={(e) => setDraft({ fulfillment_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.fulfillment.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Payment Policy" required>
        <Select
          value={draft.payment_policy_id}
          onChange={(e) => setDraft({ payment_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.payment.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Return Policy" required>
        <Select
          value={draft.return_policy_id}
          onChange={(e) => setDraft({ return_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.return.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
```

- [ ] **Step 2: Write `ReviewStep.tsx`**

```tsx
// src/app/dashboard/listings/_components/ReviewStep.tsx
"use client";

import { formatCurrency } from "@/lib/utils/currency";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-(--color-text-muted)">{label}</span>
      <span className="text-(--color-text-strong) font-medium">{value}</span>
    </div>
  );
}

export function ReviewStep({ draft }: Props) {
  const price = Number(draft.price) || 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">
        Review the listing before publishing. You can still go back and change anything.
      </p>

      {draft.image_urls[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.image_urls[0]} alt="" className="h-24 w-24 rounded object-cover" />
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) divide-y divide-(--color-border-subtle) px-4">
        <Row label="Source" value={draft.source_type === "inventory" ? "Inventory product" : "Dropship"} />
        <Row label="Title" value={draft.title} />
        <Row label="Price" value={formatCurrency(price, draft.currency)} />
        <Row label="Quantity" value={draft.quantity} />
        <Row label="Condition" value={draft.condition} />
        <Row label="Category" value={draft.category_name || draft.category_id} />
        <Row label="Images" value={`${draft.image_urls.length} uploaded`} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: No jest test — pure presentation, matches project convention**

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/listings/_components/PoliciesStep.tsx src/app/dashboard/listings/_components/ReviewStep.tsx
git commit -m "feat: add listing wizard Policies and Review steps"
```

---

### Task 17: Wizard shell assembly

**Files:**
- Create: `src/app/dashboard/listings/_components/ListingWizard.tsx`
- Create: `src/app/dashboard/listings/new/page.tsx`
- Create: `src/app/dashboard/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `DraftFormState`, `validateSourceStep`, `validateDetailsStep`, `validateCategoryStep`, `validateImagesStep`, `validatePoliciesStep` (Task 4), `<SourceStep>`/`<DetailsStep>` (Task 14), `<CategoryStep>`/`<ImagesStep>` (Task 15), `<PoliciesStep>`/`<ReviewStep>` (Task 16), `addListingDraft`/`updateListingDraft` (Task 8), `POST /api/listings/[id]/publish` (Task 12), `detectPlatform`, `writeAuditLog`, `addAuditLog`.
- Produces: `<ListingWizard draftId={string | null} />` — consumed by `new/page.tsx` and `[id]/page.tsx`.

All six step components already exist (Tasks 14–16), so this task is pure assembly: the shell owns `draft`/`step` state, loads an existing draft when `draftId` is set, renders the current step, and handles Save Draft (direct Supabase insert/update + audit log) and Publish (saves, then calls the publish route).

- [ ] **Step 1: Write `ListingWizard.tsx`**

```tsx
// src/app/dashboard/listings/_components/ListingWizard.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { addListingDraft, updateListingDraft } from "../_store/listingsSlice";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import {
  validateSourceStep,
  validateDetailsStep,
  validateCategoryStep,
  validateImagesStep,
  validatePoliciesStep,
  type DraftFormState,
} from "../_lib/wizardValidation";
import { SourceStep } from "./SourceStep";
import { DetailsStep } from "./DetailsStep";
import { CategoryStep } from "./CategoryStep";
import { ImagesStep } from "./ImagesStep";
import { PoliciesStep } from "./PoliciesStep";
import { ReviewStep } from "./ReviewStep";
import type { EbayListingDraft } from "@/types";

const STEPS = ["source", "details", "category", "images", "policies", "review"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  source: "Source",
  details: "Details",
  category: "Category",
  images: "Images",
  policies: "Policies",
  review: "Review",
};

const VALIDATORS: Record<Exclude<Step, "review">, (draft: DraftFormState) => string | null> = {
  source: validateSourceStep,
  details: validateDetailsStep,
  category: validateCategoryStep,
  images: validateImagesStep,
  policies: validatePoliciesStep,
};

const EMPTY_DRAFT: DraftFormState = {
  source_type: "inventory",
  product_id: "",
  source_url: "",
  title: "",
  description: "",
  price: "",
  currency: "EUR",
  quantity: "1",
  condition: "new",
  category_id: "",
  category_name: "",
  image_urls: [],
  fulfillment_policy_id: "",
  payment_policy_id: "",
  return_policy_id: "",
};

function toFormState(row: EbayListingDraft): DraftFormState {
  return {
    source_type: row.source_type,
    product_id: row.product_id ?? "",
    source_url: row.source_url ?? "",
    title: row.title,
    description: row.description ?? "",
    price: String(row.price),
    currency: row.currency,
    quantity: String(row.quantity),
    condition: row.condition,
    category_id: row.category_id ?? "",
    category_name: row.category_name ?? "",
    image_urls: row.image_urls,
    fulfillment_policy_id: row.fulfillment_policy_id ?? "",
    payment_policy_id: row.payment_policy_id ?? "",
    return_policy_id: row.return_policy_id ?? "",
  };
}

interface Props {
  draftId: string | null;
}

export function ListingWizard({ draftId }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const companyCurrency = useAppSelector((s) => s.companyProfile.profile?.currency);

  const [step, setStep] = useState<Step>("source");
  const [draft, setDraftState] = useState<DraftFormState>(
    companyCurrency ? { ...EMPTY_DRAFT, currency: companyCurrency } : EMPTY_DRAFT
  );
  const [existingRow, setExistingRow] = useState<EbayListingDraft | null>(null);
  const [loading, setLoading] = useState(!!draftId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const supabase = await createTenantClient();
      const { data, error: fetchError } = await supabase
        .from("ebay_listing_drafts")
        .select("*")
        .eq("id", draftId)
        .single<EbayListingDraft>();
      if (fetchError || !data) {
        toastError("Could not load this listing.");
        router.push("/dashboard/listings");
        return;
      }
      setExistingRow(data);
      setDraftState(toFormState(data));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  function setDraft(patch: Partial<DraftFormState>) {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }

  function goNext() {
    if (step === "review") return;
    const validator = VALIDATORS[step];
    const message = validator(draft);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  }

  function goBack() {
    if (step === "source") return;
    setError(null);
    setStep(STEPS[STEPS.indexOf(step) - 1]);
  }

  function toInsertPayload(userId: string) {
    return {
      source_type: draft.source_type,
      product_id: draft.source_type === "inventory" ? draft.product_id || null : null,
      source_url: draft.source_type === "dropship" ? draft.source_url || null : null,
      source_platform:
        draft.source_type === "dropship" ? detectPlatform(draft.source_url) : null,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      price: Number(draft.price),
      currency: draft.currency,
      quantity: Number(draft.quantity),
      condition: draft.condition,
      category_id: draft.category_id || null,
      category_name: draft.category_name || null,
      image_urls: draft.image_urls,
      fulfillment_policy_id: draft.fulfillment_policy_id || null,
      payment_policy_id: draft.payment_policy_id || null,
      return_policy_id: draft.return_policy_id || null,
      created_by: userId,
    };
  }

  async function saveDraft(): Promise<EbayListingDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      if (existingRow) {
        const { data, error: updateError } = await supabase
          .from("ebay_listing_drafts")
          .update(toInsertPayload(user.id))
          .eq("id", existingRow.id)
          .select()
          .single<EbayListingDraft>();
        if (updateError) throw updateError;
        dispatch(updateListingDraft(data));
        setExistingRow(data);
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "update",
          entityType: "sale", // closest existing AuditEntity; see Task 18 SKILL.md note
          entityId: data.id,
          metadata: { title: data.title, status: data.status },
        }).then((log) => log && dispatch(addAuditLog(log)));
        return data;
      }

      const { data, error: insertError } = await supabase
        .from("ebay_listing_drafts")
        .insert(toInsertPayload(user.id))
        .select()
        .single<EbayListingDraft>();
      if (insertError) throw insertError;
      dispatch(addListingDraft(data));
      setExistingRow(data);
      await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "create",
        entityType: "sale",
        entityId: data.id,
        metadata: { title: data.title },
      }).then((log) => log && dispatch(addAuditLog(log)));
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    const saved = await saveDraft();
    if (saved) {
      success("Draft saved.");
      router.push(`/dashboard/listings/${saved.id}`);
    }
  }

  async function handlePublish() {
    const saved = await saveDraft();
    if (!saved) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/listings/${saved.id}/publish`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (json.draft) dispatch(updateListingDraft(json.draft));
        throw new Error(json.error ?? "Publish failed");
      }
      dispatch(updateListingDraft(json));
      success("Published to eBay.");
      router.push("/dashboard/listings");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-(--color-text-muted)">Loading…</div>;
  }

  return (
    <div>
      <PageHeader
        title={existingRow ? "Edit Listing" : "New Listing"}
        description={`Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}: ${STEP_LABELS[step]}`}
      />

      {error && (
        <div className="mb-4 rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-4 py-3 text-sm text-(--color-danger-text)">
          {error}
        </div>
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
        {step === "source" && <SourceStep draft={draft} setDraft={setDraft} />}
        {step === "details" && <DetailsStep draft={draft} setDraft={setDraft} />}
        {step === "category" && <CategoryStep draft={draft} setDraft={setDraft} />}
        {step === "images" && <ImagesStep draft={draft} setDraft={setDraft} draftId={existingRow?.id ?? null} />}
        {step === "policies" && <PoliciesStep draft={draft} setDraft={setDraft} />}
        {step === "review" && <ReviewStep draft={draft} />}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="secondary" onClick={goBack} disabled={step === "source" || saving || publishing}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleSaveDraft} disabled={saving || publishing}>
              {saving ? "Saving…" : "Save Draft"}
            </Button>
            {step === "review" ? (
              <Button onClick={handlePublish} disabled={saving || publishing}>
                {publishing ? "Publishing…" : "Publish to eBay"}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={saving || publishing}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `new/page.tsx`**

```tsx
// src/app/dashboard/listings/new/page.tsx
"use client";

import { ListingWizard } from "../_components/ListingWizard";

export default function NewListingPage() {
  return <ListingWizard draftId={null} />;
}
```

- [ ] **Step 3: Write `[id]/page.tsx`**

```tsx
// src/app/dashboard/listings/[id]/page.tsx
"use client";

import { use } from "react";
import { ListingWizard } from "../_components/ListingWizard";

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ListingWizard draftId={id} />;
}
```

- [ ] **Step 4: No jest test — this task is UI wiring**

The logic it depends on is already tested in Task 4 (validators) and Task 8 (slice reducers). `ListingWizard.tsx` is the first file that imports all six step components together — since Tasks 14–16 already built and committed every one of them, this compiles cleanly. This is the task where "ask the user to manually exercise the feature in the browser" (per working agreement) actually becomes meaningful for the first time: the full flow — connect eBay if needed, create a listing from an Inventory item, create one from a dropship URL, save a draft and resume it, publish one — is only end-to-end testable once this task lands.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_components/ListingWizard.tsx src/app/dashboard/listings/new/page.tsx src/app/dashboard/listings/\[id\]/page.tsx
git commit -m "feat: assemble listing wizard shell — feature complete end-to-end"
```

At this point the full feature is wired end-to-end: `/dashboard/listings` lists drafts, "New Listing" walks through all 6 steps, "Save Draft" persists without publishing, "Publish to eBay" calls the resumable publish route.

---

### Task 18: Feature docs

**Files:**
- Create: `src/app/dashboard/listings/CLAUDE.md`
- Create: `src/app/dashboard/listings/SKILL.md`
- Modify: `src/app/dashboard/CLAUDE.md`
- Modify: `supabase/SKILL.md`
- Modify: `supabase/CLAUDE.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write `src/app/dashboard/listings/CLAUDE.md`**

```markdown
# Listings feature

Route: `/dashboard/listings`, `/dashboard/listings/new`, `/dashboard/listings/[id]`.
Lets an admin/super_admin build an eBay listing from an Inventory item or a
third-party (dropship) source, save it as a draft, and publish it to eBay via
the eBay Inventory API. Gated the same way as Integrations
(`hasPlatformIntegrations`) plus a dedicated `manage_listings` permission
(admin/super_admin only — nav entry is visible to all roles, but Save
Draft/Publish/category-search/policy-fetch all require the permission).

Sub-project 1 of a two-part feature — editing/ending/relisting *published*
listings is a separate, not-yet-built follow-up (see
`docs/superpowers/specs/2026-07-20-ebay-listing-creation-design.md`).

## Files in this folder

- `page.tsx` — paginated listings table (`fetchListingsPage` thunk, same
  pagination architecture as Sales/Purchases/Expenses). "New Listing" button
  gated on `manage_listings`.
- `new/page.tsx` / `[id]/page.tsx` — thin wrappers around
  `_components/ListingWizard.tsx` (draftId `null` vs the route param).
- `_components/ListingWizard.tsx` — the wizard shell. Owns `draft`
  (`DraftFormState`, all-string controlled-input state) and `step` state,
  loads an existing draft row when `draftId` is set, renders the current
  step, and handles Save Draft (direct Supabase insert/update + audit log)
  and Publish (saves, then `POST /api/listings/[id]/publish`).
- `_components/{Source,Details,Category,Images,Policies,Review}Step.tsx` —
  one component per wizard step, each taking `{ draft, setDraft }` (Images
  also takes `draftId`, since uploads need a storage path).
- `_components/ListingsTable.tsx` — the table on `page.tsx`, shadcn-style via
  the shared `DataTable`.
- `_lib/wizardValidation.ts` — pure per-step validators + `DraftFormState`
  type, colocated test.
- `_store/listingsSlice.ts` — `state.listings` (`items`, `loaded`, `page`,
  `pageSize`, `total`, `isFetching`). Actions: `hydratePage` (aliased
  `hydrateListingDrafts`), `addListingDraft`, `updateListingDraft`,
  `removeListingDraft`, `setFetching`. Thunk: `fetchListingsPage({ page,
  pageSize })`. No filters in v1 (YAGNI).

## Data flow

Same pattern as every other CRUD feature: `dashboard/layout.tsx` fetches page
1 of `ebay_listing_drafts`, `StoreProvider` hydrates `state.listings`. Draft
CRUD writes go straight to Supabase from `ListingWizard.tsx` (RLS-protected),
then dispatch the local slice action — no refetch. The two eBay-read calls
(category search, business policies) and the publish action are the only
server round-trips, via `src/app/api/listings/`, since only those need the
tenant's stored eBay OAuth token (`src/lib/integrations/ebay/publish.ts`).

## Publish flow

`POST /api/listings/[id]/publish` runs a resumable 3-step eBay Inventory API
flow: `createOrReplaceInventoryItem` (idempotent by SKU) →
`createOffer`/`updateOffer` → `publishOffer`. `status` moves
`draft → publishing → published`, or `→ failed` with `publish_error` set on
any error — the draft stays editable and re-publishable after a failure.
See `src/lib/integrations/SKILL.md`'s equivalent section for the eBay OAuth
scope/token-refresh mechanics this reuses (`sell.inventory`, already granted).

## Shared dependencies

- `components/ui/{Modal is NOT used — dedicated pages instead, FormFields,
  Button,DataTable,Badge,Pagination,Toast}`
- `components/layout/PageHeader`
- `store/slices/{auditLogsSlice,currentUserSlice,companyProfileSlice}`
- `app/dashboard/inventory/_store/inventorySlice` — read-only, `selectorItems`
  for the Source step's Inventory picker
- `lib/utils/{audit,currency,detectPlatform,permissions,planGating,pagedQuery}`
- `lib/integrations/{authGuard,tokenStore,ebay}` — server-only, used by the
  three API routes, never imported client-side
- `lib/integrations/ebay/{generateSku,publishPayloads,publish}` — SKU
  generation, pure payload builders, and the actual eBay HTTP calls
- Supabase Storage bucket `listing-images` (new — see `supabase/SKILL.md`)
- `types` (`EbayListingDraft`, `ListingSourceType`, `ListingCondition`,
  `ListingStatus`)

## Tests

`npx jest dashboard/listings` runs `_store/listingsSlice.test.ts` and
`_lib/wizardValidation.test.ts`.
```

- [ ] **Step 2: Write `src/app/dashboard/listings/SKILL.md`**

```markdown
---
name: listings-feature
description: Agent playbook for the eBay listing creation feature (src/app/dashboard/listings) — minimal file set per change type, gotchas around SKU/offer resumability, Storage bucket RLS, and the AuditEntity type gap.
---

# Listings feature playbook

## Minimal file set per change type

- **New wizard field** (e.g. an "item specifics" step): add it to
  `DraftFormState` in `_lib/wizardValidation.ts`, add a validator if it's
  required, add/extend a step component, wire it into `ListingWizard.tsx`'s
  `STEPS`/`VALIDATORS`/switch, add the DB column via the "2 places" rule
  (`supabase/SKILL.md`) — `021_ebay_listing_drafts.sql`-style new migration
  using `run_on_all_tenant_schemas` PLUS `provision_tenant_schema()` — and
  add it to `buildInventoryItemPayload`/`buildOfferPayload` in
  `lib/integrations/ebay/publishPayloads.ts` if eBay needs it at publish
  time.
- **New eBay-read call** (e.g. shipping rate tables): add the function to
  `lib/integrations/ebay/publish.ts` (unauthenticated by jest, matches
  `ebay.ts`/`amazon.ts`), add a `GET /api/listings/ebay/<thing>/route.ts`
  following `categories`/`policies`'s shape exactly (guard, connection check,
  token refresh, try/catch → 502).
- **Changing the publish flow itself**: `publishListing` in
  `lib/integrations/ebay/publish.ts` + the resumability logic in
  `app/api/listings/[id]/publish/route.ts` — read both together, the route
  owns the `status`/`ebay_sku`/`ebay_offer_id` persistence, `publishListing`
  owns the actual eBay calls.

## Gotchas

- **`AuditEntity` has no `"listing"` value.** `types/index.ts`'s
  `AuditEntity` is `"expense" | "purchase" | "sale" | "user" | "product"` —
  adding a 6th value is a one-line, low-risk change but wasn't done for v1 to
  keep this feature's diff self-contained from a type other features also
  consume. `ListingWizard.tsx` currently logs listing create/update audit
  entries with `entityType: "sale"` as the closest existing category — **fix
  this** by adding `"listing"` to `AuditEntity` and updating
  `ListingWizard.tsx`'s two `writeAuditLog` calls the next time this file is
  touched for an unrelated reason (small enough to bundle, not urgent enough
  to justify its own PR).
- **Offer-creation resume gap**: if `publishListing` throws between
  `createOffer` succeeding and `publishOffer` completing, the created
  `offerId` is NOT surfaced back to the publish route (it's local to
  `publishListing`'s try block) — a retry in that exact failure window calls
  `createOffer` again rather than `updateOffer`, and eBay's `createOffer` is
  not idempotent by SKU, so repeated failures right there could accumulate
  orphaned unpublished offers on eBay's side. Narrow window (one HTTP call),
  not fixed in v1 — see Task 12 of the implementation plan for the reasoning.
  If this becomes a real problem, the fix is having `publishListing` report
  the offerId via a thrown error's `cause` (or a callback) instead of only on
  full success.
- **Storage bucket path convention is load-bearing for RLS**: images MUST
  upload to `{tenant_schema}/{draftId}/{filename}` — the `listing-images`
  bucket's RLS policies (`022_listing_images_bucket.sql`) check
  `(storage.foldername(name))[1]` against the caller's JWT `tenant_schema`
  claim. Uploading anywhere else silently fails the RLS check (403).
- **Unsaved-draft image orphaning**: `ImagesStep.tsx` uploads under a
  `"unsaved"` folder when `draftId` is null (new draft, not yet saved). If
  the user uploads images then abandons the wizard without ever clicking
  Save Draft/Publish, those files are never cleaned up. No cleanup job
  exists for this in v1 — acceptable given Storage cost is low, flagged here
  so it isn't mistaken for an oversight.
- **eBay Inventory API needs Business Policies pre-configured on the
  tenant's real eBay seller account** — `PoliciesStep.tsx` will show empty
  dropdowns (not an error) if the connected eBay account has none. There's
  no in-app guidance for setting these up on eBay's side; the design spec's
  "Approach" section explains why this was assumed rather than solved for.
- **Single marketplace, hardcoded via `EBAY_MARKETPLACE_ID` env var**
  (`lib/integrations/ebay/publish.ts`, defaults `"EBAY_DE"`) — every draft
  publishes to the same marketplace regardless of `draft.currency`. Setting
  `currency: "USD"` on a draft does NOT change which eBay site it lists on.
- **`EBAY_CATEGORY_TREE_ID` env var** (defaults `"77"`, eBay's ID for the
  Germany category tree) must match whichever marketplace
  `EBAY_MARKETPLACE_ID` points at — mismatched tree/marketplace IDs return
  category suggestions that `createOffer` then rejects as invalid for that
  marketplace.

## Tests

`npx jest dashboard/listings`
```

- [ ] **Step 3: Update `src/app/dashboard/CLAUDE.md`**

Add a row to the feature-folder table (after the `integrations/` row):

```markdown
| `listings/` | `/dashboard/listings` | eBay listing creation (draft → publish), `listingsSlice` (Pro/Business plans only, `manage_listings` permission) |
```

- [ ] **Step 4: Update `supabase/SKILL.md`**

Add two rows to the file map table (after the `020_dropship_customs_tax.sql` row):

```markdown
| `migrations/021_ebay_listing_drafts.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `ebay_listing_drafts` table (draft eBay listings, sourced from Inventory or a third-party URL) via `run_on_all_tenant_schemas`; also baked into `provision_tenant_schema()`. Backs `src/app/dashboard/listings/` |
| `migrations/022_listing_images_bucket.sql` | Storage (Project B) | ⏳ **pending** — creates the `listing-images` Storage bucket + `public.current_tenant_role()` helper + tenant-path-scoped RLS policies (public read, admin/super_admin write/delete by tenant) |
```

- [ ] **Step 5: Update `supabase/CLAUDE.md`**

Add matching entries to its file list (after the `020_dropship_customs_tax.sql` entry):

```markdown
- `migrations/021_ebay_listing_drafts.sql` — creates `ebay_listing_drafts` in
  every tenant schema via `run_on_all_tenant_schemas` (also baked into
  `provision_tenant_schema()`). Backs the Listings feature
  (`src/app/dashboard/listings/`, `src/lib/integrations/ebay/publish.ts`).
- `migrations/022_listing_images_bucket.sql` — creates the `listing-images`
  Storage bucket and its tenant-path-scoped RLS policies (first Storage
  bucket in this codebase — see its own header comment for the
  `current_tenant_role()` helper it introduces).
```

- [ ] **Step 6: No jest test — documentation only**

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/listings/CLAUDE.md src/app/dashboard/listings/SKILL.md src/app/dashboard/CLAUDE.md supabase/SKILL.md supabase/CLAUDE.md
git commit -m "docs: add Listings feature CLAUDE.md/SKILL.md, update shared docs"
```

---

## After all tasks land

Tell the user, explicitly:
1. Two migrations need manual application in the Supabase SQL editor (Project B), in this order: `021_ebay_listing_drafts.sql`, then re-run the full updated `005_tenant_provisioning.sql`, then `022_listing_images_bucket.sql`.
2. `EBAY_MARKETPLACE_ID` and `EBAY_CATEGORY_TREE_ID` are new optional env vars (default to `EBAY_DE`/`77`) — add to `.env.local.example` if this tenant's marketplace isn't Germany.
3. Existing eBay connections need the `sell.inventory` (full) scope, already granted since the Dropshipping feature — no reconnect needed unless a connection predates that scope change.
4. Ask the user to manually exercise the full wizard in the browser (per working agreement — this plan does not run the dev server itself): connect eBay in Integrations if not already connected, create a listing from an Inventory item, create one from a dropship URL, save a draft and resume editing it, and publish one (ideally against `EBAY_SANDBOX=true` first).
5. Run `npx jest dashboard/listings src/lib/integrations/ebay src/lib/utils/permissions` for the full scoped test suite this plan added, then `npx tsc --noEmit` and `npm run lint` for full verification — the user should run these, not the agent, per working agreement.
