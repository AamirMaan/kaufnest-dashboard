# eBay Listing Sync, Edit & Delete — Design Spec

**Date:** 2026-08-31
**Feature:** `src/app/dashboard/listings/`
**Status:** Approved for implementation planning

## Problem

The Listings feature currently only knows about listings this app itself
created via its wizard (`ebay_listing_drafts`, published through the
Inventory API). It has no way to see, edit, or end listings that already
exist on a tenant's eBay account — whether created by this app before this
feature existed, created manually in Seller Hub, or created by any other
tool. The user wants the Listings page to show *all* of a tenant's eBay
listings, with the ability to edit or delete any of them from within the
app.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| API for listing creation | Inventory API (unchanged) | Already built, already working — not touched by this feature. |
| API for editing/deleting *any existing* listing | Trading API (`GetItem`/`ReviseItem`/`EndItem`) | Works uniformly across every listing regardless of how it was created; the Inventory API's bulk endpoints fail account-wide (errorId 25707) if *any* listing in the account lacks a SKU — a landmine already documented in this codebase and already why Dropshipping's "Refresh from eBay" avoids it. |
| Storage for imported listings | Merged into `ebay_listing_drafts` (new `origin` column) | One unified, paginated list — matches how the page already works. |
| Editing an *already-published* app-created listing | Also moves to the new Trading API edit page | No real usage yet (only one test listing, already deleted) — no legacy behavior to preserve. The wizard becomes purely a "build + first-publish a new listing" tool; the Inventory API's existing `updateOffer` retry path stays only for resuming a failed *publish attempt*, not for later edits. |
| Category editing | Read-only after publish | eBay heavily restricts category changes on active listings (blocked outright with bids/watchers, item-specifics incompatibility between categories). Not worth the edge cases for a rarely-needed action — end + recreate instead. |
| Sync trigger | Manual "Sync from eBay" button | Matches Dropshipping's proven "Refresh from eBay" pattern exactly; avoids unnecessary Trading API calls on every page load. |
| Re-sync conflict handling | None needed | eBay is always the source of truth for anything already live. Every edit goes through `ReviseItem` first, then updates the local mirror — there's no local-only edit that could conflict with a re-sync overwriting it. |

## Architecture

```
┌─────────────────┐   POST /api/listings/ebay/sync   ┌──────────────────────┐
│  Listings page   │ ────────────────────────────────▶│ fetchActiveListings  │
│  "Sync from eBay"│                                   │ (Trading API,        │
└─────────────────┘◀──── upsert into ebay_listing_drafts  GetMyeBaySelling,   │
                          (origin='ebay_import',         already exists)     │
                           status='published')          └──────────────────────┘

┌─────────────────┐  status='draft'/'failed'   ┌────────────────────┐
│  Listings table  │ ─────────────────────────▶ │ Existing wizard     │  (Inventory API,
│  (row click)     │                             │ (unchanged)         │   unchanged)
│                  │  status='published'        └────────────────────┘
│                  │ ─────────────────────────▶ ┌────────────────────┐
└─────────────────┘                             │ New Edit Listing    │  (Trading API:
                                                  │ page                │   GetItem/ReviseItem)
                                                  └────────────────────┘
                                                            │
                                                    Delete (with confirm)
                                                            ▼
                                                  ┌────────────────────┐
                                                  │ EndItem, then       │
                                                  │ delete local row    │
                                                  └────────────────────┘
```

## Data model

**Migration `038_ebay_listing_drafts_origin.sql`** (via
`run_on_all_tenant_schemas`, also mirrored into `provision_tenant_schema()`
— the 2-places rule):

```sql
alter table {{schema}}.ebay_listing_drafts
  add column if not exists origin text not null default 'app'
    check (origin in ('app', 'ebay_import'));

-- Full (non-partial) unique index — deliberately not partial. A partial
-- index breaks Supabase's .upsert(rows, { onConflict }) inference (Postgres
-- won't infer a partial index for a predicate-less ON CONFLICT), and
-- Postgres treats multiple NULLs as non-conflicting under a plain UNIQUE
-- index anyway (unpublished drafts have ebay_listing_id = NULL), so partial
-- buys nothing here — this is the exact mistake 033_ebay_messages_full_unique_index.sql
-- had to fix for ebay_messages; don't repeat it.
create unique index if not exists idx_ebay_listing_drafts_ebay_listing_id
  on {{schema}}.ebay_listing_drafts (ebay_listing_id);
```

`types/index.ts`'s `EbayListingDraft` gains `origin: "app" | "ebay_import"`.

## New Trading API functions (`src/lib/integrations/ebay/listings.ts`)

This file already owns Trading-API listing concerns (`fetchActiveListings`).
Extend it with:

```ts
export interface EbayListingDetail {
  ebayListingId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  condition: ListingCondition; // mapped from ConditionID, see below
  imageUrls: string[];
  categoryId: string;
  categoryName: string;
  aspects: Record<string, string>; // ItemSpecifics NameValueList
}

export async function fetchListingDetail(
  accessToken: string,
  itemId: string
): Promise<EbayListingDetail>; // GetItem

export interface ReviseListingInput {
  title: string;
  description: string;
  price: number;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  // Omitted entirely (not an empty object) means "don't touch
  // ItemSpecifics" — see buildAspectsForRevise below for why this can't
  // just always be included.
  aspects?: Record<string, string>;
}

export async function reviseListing(
  accessToken: string,
  itemId: string,
  changes: ReviseListingInput
): Promise<void>; // ReviseItem

export async function endListing(accessToken: string, itemId: string): Promise<void>; // EndItem, EndingReason="NotAvailable"

// Pure helper — decides whether ItemSpecifics belongs in the ReviseItem
// call at all. Returns undefined when every value matches the original
// (omit the field, per eBay's own guidance below), or the submitted map
// when at least one value differs. The revise route calls this after
// fetching the CURRENT live detail (a fresh fetchListingDetail, not
// whatever the client claims the original was) — never trust client-
// supplied "original" values for a decision this consequential.
export function buildAspectsForRevise(
  original: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> | undefined;
```

**Condition ID mapping** (eBay `ConditionID` → this app's `ListingCondition`):
`1000`/`1500` → `"new"`; `2000`/`2500` → `"refurbished"`; everything else
(`3000`, `4000`, `5000`, `6000`, `7000`, unmapped/missing) → `"used"` as a
safe default — editable in the form afterward if wrong.

**Multi-value item specifics collapse to one value.** Trading API's
`ItemSpecifics` (`NameValueList`) supports multiple values per name (e.g.
`Color: Red, Blue`); this app's `aspects` model is single-value only,
matching the same v1 limitation already accepted for the Inventory API side
(`ebay_listing_drafts.aspects` is a flat `name -> value` map, not
`name -> value[]`). `fetchListingDetail` takes the *first* value per name
when eBay returns more than one — same "MULTI-cardinality not supported in
v1" limitation, not a new one.

**`ReviseItem`'s two fields that carry existing content behave oppositely —
verified against eBay's own docs, not assumed:**
- **`PictureDetails` is replace-all.** `reviseListing` must always send the
  *complete* current set of image URLs, not just ones that changed — eBay
  drops any picture not included in the call. The edit form's images field
  already holds the full current list (pre-filled from `fetchListingDetail`),
  so this falls out naturally as long as the implementation doesn't
  accidentally send a partial/diffed list.
- **`ItemSpecifics` should NOT be resent unless actually changed** — eBay's
  own guidance warns that resending item specifics unconditionally risks
  "attribute version problems" if the category's aspect metadata has
  changed since the listing was created. `buildAspectsForRevise` (see
  above) makes this decision from a *freshly fetched* original, never a
  client-supplied one.

## New API routes

All follow the exact pattern already established by every route in this
feature: `requireIntegrationAdmin()` guard → `manage_listings` permission
check → eBay connection check → token refresh (500 on failure) → try/catch
around the eBay call → 502 with the error message (logged via
`console.error` first) on failure.

- **`POST /api/listings/ebay/sync`** — calls `fetchActiveListings`, upserts
  each result into `ebay_listing_drafts` (`onConflict: "ebay_listing_id"`,
  `origin: "ebay_import"`, `status: "published"`, `created_by:` the calling
  user). Also **reconciles**: deletes any existing `origin = "ebay_import"`
  row whose `ebay_listing_id` is *not* in the freshly-fetched active list —
  scoped strictly to `ebay_import` rows, never touching `origin = "app"`
  rows (an app-created draft can legitimately be `draft`/`failed` with no
  active eBay listing yet, and must never be pruned by this). This is what
  actually clears a row for a listing that ended outside this app entirely
  (sold out, expired, ended manually in Seller Hub, or ended via this
  app's own Delete action if its local-row cleanup ever fails — see below).
  Returns `{ imported: number, removed: number }`.
- **`GET /api/listings/[id]/ebay-detail`** — looks up the draft row's
  `ebay_listing_id`, calls `fetchListingDetail`. Returns
  `EbayListingDetail`.
- **`POST /api/listings/[id]/revise`** — body is `ReviseListingInput` with
  `aspects` always present (the form's current submitted values). The route
  first calls `fetchListingDetail` for the live current state, runs
  `buildAspectsForRevise(current.aspects, body.aspects)` to decide whether
  `aspects` should even be forwarded, then calls `reviseListing` with the
  result (omitting `aspects` from what's passed through when the helper
  returns `undefined`), then updates the local `ebay_listing_drafts` row to
  match. Returns the updated row.
- **`POST /api/listings/[id]/end`** — calls `endListing`, then deletes the
  local row (no new "ended" status needed — once ended there's nothing left
  to track). If `endListing` succeeds but the local delete fails, log the
  error and still return `{ ok: true }` — the listing is genuinely gone
  from eBay at that point; a stale local row is a display-only
  inconsistency, not a reason to tell the tenant their delete failed. The
  next Sync's reconciliation step (see above) will prune it, since it's no
  longer in eBay's active list.

## Frontend changes

- **`page.tsx`** — a "Sync from eBay" button next to "New Listing" (same
  `manage_listings` gate), posts to `/api/listings/ebay/sync`, shows a
  toast with the import count.
- **`ListingsTable.tsx`** — an "Imported" badge when `origin ===
  "ebay_import"`; the row's link target branches on `status`: `draft`/
  `failed` → `/dashboard/listings/[id]` (existing wizard, unchanged);
  `published` → a new edit route (Trading API).
- **New edit page** (`_components/EditLiveListingPage.tsx` + its route) —
  fetches `GET /api/listings/[id]/ebay-detail` on mount, renders an editable
  form (title, description, price, quantity, condition select, images,
  aspects — reusing `fetchRequiredAspects`/`/api/listings/ebay/aspects` for
  the category's required fields, since aspect requirements are
  category-driven, not creation-method-driven), with category shown
  read-only. Saves via `POST /api/listings/[id]/revise`. A "Delete listing"
  action reuses the existing `DeleteConfirmModal` component, posts to
  `/api/listings/[id]/end` on confirm.

## Error handling

| Failure | Response |
| --- | --- |
| Not connected to eBay | 400, existing "Connect it in Integrations first" message |
| Token refresh fails | 500 |
| `GetMyeBaySelling`/`GetItem`/`ReviseItem`/`EndItem` throws | 502, eBay's error message surfaced as-is (matches every other route in this feature — no special-casing individual eBay rejection reasons) |
| Sync fails partway through pagination | Whole sync fails, error toast — same as Dropshipping's Refresh today; no partial-success handling in v1 |

## Testing

- **New `src/lib/integrations/ebay/listings.test.ts`** (doesn't exist yet,
  despite the sibling `messages.ts` already having one) — `GetItem`
  response parsing, `ReviseItem`/`EndItem` payload building, condition-ID
  mapping, and `buildAspectsForRevise` (returns `undefined` when
  identical — including when both are empty — and returns the submitted
  map when at least one value differs, added, or removed). All pure logic,
  no network mocking needed beyond what `messages.test.ts` already
  demonstrates the pattern for.
- Route handlers stay untested per this project's established convention
  (network-calling; verified manually).
- `wizardValidation.ts` is untouched — the wizard itself doesn't change.

## Out of scope

- Editing an active listing's category (read-only after publish — see Key
  Decisions).
- Bulk edit/delete (one listing at a time).
- Any conflict-resolution UI for concurrent edits (not needed — see Key
  Decisions).
- Auction-style listings' bidding mechanics — this app only creates
  `FIXED_PRICE` listings, but an *imported* listing could be an auction;
  `ReviseItem`'s own restrictions on such listings (e.g. can't lower price
  once a bid exists) surface as eBay's own error message, not specially
  handled.
