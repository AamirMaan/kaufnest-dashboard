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
  gated on `manage_listings`. Also gates the whole page behind
  `hasPlatformIntegrations(tenantPlan)` with an upgrade prompt when the plan
  doesn't include it.
- `new/page.tsx` / `[id]/page.tsx` — thin client-component wrappers around
  `_components/ListingWizard.tsx` (draftId `null` vs the route param, read via
  React's `use(params)`).
- `_components/ListingWizard.tsx` — the wizard shell. Owns `draft`
  (`DraftFormState`, all-string controlled-input state) and `step` state,
  loads an existing draft row when `draftId` is set, renders the current
  step, and handles Save Draft (direct Supabase insert/update via `toPayload()`
  + audit log) and Publish (saves, then `POST /api/listings/[id]/publish`).
  `toPayload()` builds the DB row shape shared by insert/update; `created_by`
  is set only on the insert path (`{ ...toPayload(), created_by: user.id }`),
  never on update — this file previously had a bug where update also
  overwrote `created_by`, since fixed.
- `_components/{Source,Details,Category,Images,Policies,Review}Step.tsx` —
  one component per wizard step, each taking `{ draft, setDraft }` (Images
  also takes `draftId`, since uploads need a storage path). `PoliciesStep`
  fetches `/api/listings/ebay/policies` on mount; `CategoryStep` hits
  `/api/listings/ebay/categories?q=` on explicit Search-button/Enter (not
  live-as-you-type) and lets the user pick a suggestion.
- `_components/ListingsTable.tsx` — the table on `page.tsx`, via the shared
  `DataTable`. Shows image thumbnail, title (links to `[id]`), source badge
  (Inventory vs. dropship platform), price, status badge, and an action link
  that's "View on eBay →" for published rows or "Edit"/"Retry" (failed) for
  everything else.
- `_lib/wizardValidation.ts` — pure per-step validators + `DraftFormState`
  type, colocated test. These validators only run when the wizard's own
  "Next" button is clicked — see the SKILL.md gotcha on Save Draft/Publish
  skipping them.
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
flow (`src/lib/integrations/ebay/publish.ts`'s `publishListing`):
`createOrReplaceInventoryItem` (idempotent by SKU, via `PUT`) →
`createOffer`/`updateOffer` (depending on whether `ebay_offer_id` already
exists) → `publishOffer`. `status` moves `draft → publishing → published`, or
`→ failed` with `publish_error` set on any error — the draft stays editable
and re-publishable after a failure. The SKU is generated once
(`generateListingSku()`, `KN` + 12 random alphanumeric chars) and persisted
to `ebay_sku` before the first eBay call, then reused on every retry. See
`src/lib/integrations/SKILL.md`'s equivalent section for the eBay OAuth
scope/token-refresh mechanics this reuses (`sell.inventory`, already granted).

## Shared dependencies

- `components/ui/{Modal is NOT used — dedicated pages instead, FormFields,
  Button, DataTable, Badge, Pagination, Toast}`
- `components/layout/PageHeader`
- `store/slices/{auditLogsSlice,currentUserSlice,companyProfileSlice}`
- `app/dashboard/inventory/_store/inventorySlice` — read-only, `selectorItems`
  for the Source step's Inventory picker
- `lib/utils/{audit,currency,detectPlatform,permissions,planGating,pagedQuery}`
- `lib/integrations/{authGuard,tokenStore,ebay}` — server-only, used by the
  three API routes, never imported client-side
- `lib/integrations/ebay/{generateSku,publishPayloads,publish}` — SKU
  generation, pure payload builders, and the actual eBay HTTP calls
  (`searchCategories`, `fetchBusinessPolicies`, `publishListing`).
  `searchCategories` uses `lib/integrations/ebay/appToken.ts`'s application
  token internally, not the tenant's connection token — see SKILL.md's
  gotcha. Note: `lib/integrations/ebay/listings.ts` (Trading API
  `fetchActiveListings`) is a pre-existing file used by the Dropshipping
  feature, not this one — only referenced here in a comment in
  `generateSku.ts` explaining the SKU charset choice.
- Supabase Storage bucket `listing-images` (new — see `supabase/SKILL.md`)
- `types` (`EbayListingDraft`, `ListingSourceType`, `ListingCondition`,
  `ListingStatus`)

## Tests

`npx jest dashboard/listings` runs `_store/listingsSlice.test.ts` and
`_lib/wizardValidation.test.ts`.
