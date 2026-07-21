# eBay Listing Creation — Design Spec

**Date:** 2026-07-20
**Status:** Approved

## Problem

Sellers currently have no way to publish a product to eBay from the KaufNest
dashboard. The existing eBay integration is one-directional — it only *reads*
from eBay (order sync via `fetchOrders`, and the platform-admin-only
Dropshipping feature's `fetchActiveListings` pull of existing listings for
price-matching). Sellers who want to list an Inventory item, or a
dropshipped/third-party-sourced product, on eBay have to do it manually on
eBay's own site.

This is Sub-project 1 of a two-part feature. Sub-project 2 (editing/ending/
relisting listings that already exist, syncing price/quantity back from
eBay) is a separate follow-up spec, built on the data model introduced here.

## Solution

A new tenant-facing feature, `src/app/dashboard/listings/`
(`/dashboard/listings`), that lets an admin/super_admin build an eBay
listing from either an Inventory item or a third-party (dropship) source URL,
save it as an editable draft, and publish it to eBay via eBay's Inventory API
(`createOrReplaceInventoryItem` → `createOffer`/`updateOffer` →
`publishOffer`).

Gated the same way as Integrations: visible only on plans where
`hasPlatformIntegrations(tenantPlan)` is true, and restricted to
admin/super_admin via a new `manage_listings` permission
(`src/lib/utils/permissions.ts`, alongside the existing `manage_integrations`
— same rationale: this is a business-critical, money-affecting action).

---

## Data model

New migration `supabase/migrations/021_ebay_listing_drafts.sql`, applied to
**every** tenant schema via `run_on_all_tenant_schemas` (this is a regular
per-tenant feature, unlike the KaufNest-only `dropship_listings` table):

```sql
SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.ebay_listing_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL CHECK (source_type IN ('inventory', 'dropship')),
    product_id UUID REFERENCES {{schema}}.products(id),
    source_url TEXT,
    source_platform TEXT,
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC(12,2) NOT NULL,
    currency TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    condition TEXT NOT NULL,
    category_id TEXT,
    category_name TEXT,
    image_urls TEXT[] NOT NULL DEFAULT '{}',
    fulfillment_policy_id TEXT,
    payment_policy_id TEXT,
    return_policy_id TEXT,
    ebay_sku TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
    ebay_offer_id TEXT,
    ebay_listing_id TEXT,
    publish_error TEXT,
    created_by UUID NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
$$);
```

`product_id` set only when `source_type = 'inventory'`; `source_url`/
`source_platform` set only when `source_type = 'dropship'` (`detectPlatform`,
reused from `src/lib/utils/detectPlatform`, the same helper Dropshipping
uses). `ebay_sku` is assigned once, on first save, and never changes
afterward (see "SKU generation" below).

Per the project's "2 places" rule for tenant DDL, `provision_tenant_schema()`
in `005_tenant_provisioning.sql` also gains this table's `CREATE TABLE` for
new tenants.

`src/types/index.ts` gains:
```ts
export type ListingSourceType = "inventory" | "dropship";
export type ListingCondition = "new" | "used" | "refurbished"; // maps to eBay ConditionEnum
export type ListingStatus = "draft" | "publishing" | "published" | "failed";

export interface EbayListingDraft {
  id: string;
  source_type: ListingSourceType;
  product_id: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null; // reuse existing type
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

### Storage

New Supabase Storage bucket `listing-images` (new infrastructure — no bucket
exists in this codebase today). Tenant-scoped path prefix
(`{tenant_schema}/{draft_id}/{filename}`), public read (listing images must
be publicly fetchable by eBay), write restricted to authenticated
admin/super_admin of that tenant via a Storage RLS policy mirroring the
`manage_listings` permission check.

---

## eBay API integration

New file `src/lib/integrations/ebay/publish.ts` (sibling to the existing
`listings.ts`), server-only, not part of the `PlatformAdapter` interface
(that interface is specifically for the order-sync flow in `registry.ts`;
publishing is a distinct concern, same "one file per concern" precedent as
`listings.ts` alongside `ebay.ts`):

- `searchCategories(accessToken, query): Promise<{id: string; name: string}[]>`
  — wraps eBay Taxonomy API `getCategorySuggestions`.
- `fetchBusinessPolicies(accessToken): Promise<{fulfillment, payment, return: {id, name}[]}>`
  — wraps the Account API's `getFulfillmentPolicies`/`getPaymentPolicies`/
  `getReturnPolicies`.
- `publishListing(accessToken, draft: EbayListingDraft): Promise<{offerId: string; listingId: string}>`
  — runs the 3-step Inventory API flow (see "Publish flow" below).

No scope changes needed — `sell.inventory` (full) is already granted in
`EBAY_SCOPE` (`src/lib/integrations/ebay.ts`), and grants both read and write
access to the Inventory API.

### SKU generation

`ebay_sku` is generated once, when a draft is first saved (before any eBay
call): `KN` + a 12-character alphanumeric id (no hyphens or other special
characters). This codebase has already hit a real eBay account-wide failure
(errorId 25707, documented in `dropshipping/CLAUDE.md`) caused by a single
invalid SKU among *existing* listings breaking bulk reads for the whole
account. Since SKU generation is fully under our control here, strict
alphanumeric formatting is a deliberate guard against re-triggering that
class of failure — not a hypothetical concern.

### Publish flow (resumable)

`POST /api/listings/[id]/publish` (server-only route, `requireIntegrationAdmin`
+ `manage_listings` permission check):

1. Load the draft. If `ebay_sku` is null, generate and persist it immediately.
2. Set `status = 'publishing'`.
3. `createOrReplaceInventoryItem(ebay_sku, ...)` — idempotent by SKU, always
   run regardless of prior attempts.
4. If `ebay_offer_id` is already set (from a prior partial failure),
   `updateOffer(ebay_offer_id, ...)`; otherwise `createOffer(...)` and persist
   the returned `ebay_offer_id` immediately.
5. `publishOffer(ebay_offer_id)` → returns `listingId`.
6. On success: `status = 'published'`, persist `ebay_listing_id`, clear
   `publish_error`.
7. On failure at any step: `status = 'failed'`, persist the eBay error
   message to `publish_error`, keep whatever `ebay_sku`/`ebay_offer_id` were
   already persisted so a retry resumes rather than restarts. The draft stays
   editable and re-publishable.

Token refresh: `ensureValidAccessToken` is called once at the top of the
route, same pattern as every other integration route — no special handling
needed here.

---

## UI / feature folder

```
src/app/dashboard/listings/
  page.tsx                    # paginated table of drafts + published listings
  new/page.tsx                # wizard: create a new draft
  [id]/page.tsx                # wizard: edit an existing draft / retry publish
  _components/
    SourceStep.tsx             # Inventory picker or dropship URL input
    DetailsStep.tsx             # title/description/price/currency/qty/condition
    CategoryStep.tsx           # type-ahead search, calls GET /api/listings/ebay/categories
    ImagesStep.tsx              # upload to Supabase Storage `listing-images`
    PoliciesStep.tsx            # 3 dropdowns, calls GET /api/listings/ebay/policies
    ReviewStep.tsx               # summary + Save Draft / Publish
    ListingsTable.tsx            # page.tsx's table (status badge, actions)
  _store/
    listingsSlice.ts             # paginated slice, draft CRUD (direct Supabase calls)
    listingsSlice.test.ts
  CLAUDE.md
  SKILL.md
```

- `page.tsx` — same pagination architecture as Sales/Purchases/Expenses:
  `hydratePage` reducer hydrated from `dashboard/layout.tsx`'s page-1 fetch,
  `fetchListingsPage` thunk for subsequent pages/filters, `DEFAULT_PAGE_SIZE`/
  `rangeFor` from `src/lib/utils/pagedQuery.ts`. Table columns: image
  thumbnail, title, source (Inventory link, or dropship URL + platform
  badge), price, status badge, actions (Edit if `draft`/`failed`, Publish,
  "View on eBay" link if `published`, Delete if `draft`).
- `new/page.tsx` / `[id]/page.tsx` — the 6-step wizard (Source → Details →
  Category → Images → Policies → Review), mirroring the existing
  `sales/[id]` dedicated-page precedent rather than a modal, since a 6-step
  form doesn't fit the project's existing "Add\*Modal" single-form pattern.
  "Save Draft" writes the row via a direct Supabase call and stays on
  `status = draft`; "Publish" saves then calls
  `POST /api/listings/[id]/publish`.
- Draft CRUD (create/update/delete/list) — direct Supabase client calls from
  `listingsSlice` thunks, RLS-protected, same as Sales/Purchases/Expenses.
  Only the eBay-specific reads (category search, business policies) and the
  publish action go through server API routes, since only those need the
  stored OAuth token:
  - `GET /api/listings/ebay/categories?q=`
  - `GET /api/listings/ebay/policies`
  - `POST /api/listings/[id]/publish`

`dashboard/layout.tsx` hydrates page 1 of `ebay_listing_drafts` the same way
it hydrates every other collection.

Sidebar gains a "Listings" link (`src/components/layout/Sidebar.tsx`), visible
under the same plan-gate as Integrations/Dropshipping.

---

## Error handling & retry

- Each wizard step validates its own fields before allowing "Next" — pure,
  colocated, unit-tested validators (e.g. `validateDetailsStep(draft)`).
- Publish is resumable, not all-or-nothing — see "Publish flow" above.
  `status = 'failed'` is a normal, recoverable state, not a dead end.
- Deleting a draft that has already been partially or fully published on
  eBay's side (`ebay_offer_id`/`ebay_listing_id` set) only deletes the local
  row — it does **not** end the eBay listing. That's explicitly Sub-project
  2's territory (ending/relisting). The Delete action is only enabled for
  `draft`/`failed` status in the UI to avoid the confusing appearance of
  deleting a live listing.

---

## Testing

Following the project's existing convention (pure logic gets colocated unit
tests; raw HTTP-calling adapter code does not — same as `ebay.ts`/`amazon.ts`
today):

- SKU generation, per-step validators, and the draft→eBay-payload mapping
  functions (`buildInventoryItemPayload(draft)`, `buildOfferPayload(draft)`)
  are pure functions with colocated `*.test.ts`.
- `listingsSlice.test.ts` — pagination/hydrate/CRUD reducers, same shape as
  every other feature slice's test.

Run: `npx jest dashboard/listings`

---

## Files changed/added

| File | Change |
|---|---|
| `supabase/migrations/021_ebay_listing_drafts.sql` (new) | `CREATE TABLE ebay_listing_drafts` via `run_on_all_tenant_schemas` |
| `supabase/migrations/005_tenant_provisioning.sql` | `provision_tenant_schema()` gains the same `CREATE TABLE` for new tenants |
| New Supabase Storage bucket `listing-images` | Public-read, admin/super_admin write RLS |
| `src/types/index.ts` | Add `ListingSourceType`, `ListingCondition`, `ListingStatus`, `EbayListingDraft` |
| `src/lib/utils/permissions.ts` | Add `manage_listings: ["super_admin", "admin"]` |
| `src/lib/integrations/ebay/publish.ts` (new) | `searchCategories`, `fetchBusinessPolicies`, `publishListing` |
| `src/app/api/listings/ebay/categories/route.ts` (new) | Category search, server-only |
| `src/app/api/listings/ebay/policies/route.ts` (new) | Business policy fetch, server-only |
| `src/app/api/listings/[id]/publish/route.ts` (new) | Resumable 3-step publish flow |
| `src/app/dashboard/listings/` (new feature folder) | `page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `_components/*`, `_store/listingsSlice.ts` + test, `CLAUDE.md`, `SKILL.md` |
| `src/app/dashboard/layout.tsx` | Hydrate page 1 of `ebay_listing_drafts` |
| `src/components/layout/Sidebar.tsx` | Add "Listings" nav link, plan-gated |
| `src/app/dashboard/CLAUDE.md` | Add `listings/` row to the feature-folder table |

---

## Out of scope (this spec)

- Editing/ending/relisting *published* listings, syncing price/quantity back
  from eBay — Sub-project 2, built on this data model.
- Live price scraping for dropship-sourced drafts — price is a manual field;
  the existing AliExpress scraper is not reused here (already fragile/broken
  for its current purpose, per `dropshipping/SKILL.md`'s CSR gotcha).
- Auction-format listings — fixed-price only.
- Multi-marketplace selection — single eBay marketplace, no per-listing
  marketplace picker (same precedent as the Amazon adapter's single-default
  marketplace).
- Automatic Inventory `current_stock` sync/reservation when a listing is
  created, published, or sells.
