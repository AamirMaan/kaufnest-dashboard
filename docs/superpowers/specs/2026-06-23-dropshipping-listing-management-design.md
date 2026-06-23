# Dropshipping — Listing Management Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Branch:** `feat/dropshipping-listing-management`
**Route:** `/dashboard/dropshipping`

## Overview

A listing management page for drop shippers. Fetches the user's active eBay listings
via the existing eBay OAuth connection and stores them in a tenant DB table. Each
listing can be linked to a single Amazon or AliExpress source product URL (the supplier).
The platform is auto-detected from the URL hostname. Listings refresh on demand via a
"Refresh from eBay" button. Source URLs can be edited per listing. No delete — listings
are managed entirely through eBay.

Available on **Pro and Business plans only**. Accessible to all roles
(`super_admin`, `admin`, `accountant`). Requires an active eBay connection in
Integrations; if not connected, the page shows a redirect card.

This is Phase 1 of the Dropshipping feature. Phase 2 (price/availability/delivery
monitoring via scraping) will be built on top of this foundation once listing
management is shipped.

---

## Architecture

Follows the established feature pattern: API routes own DB access and external calls,
a Redux slice holds client state, `dashboard/layout.tsx` hydrates on mount.
All components use shadcn UI. `cn()` from `@/lib/utils` for class merging.

### File structure

```
src/app/dashboard/dropshipping/
  page.tsx                        — plan gate + connection guard + listings table shell
  _components/
    ListingsTable.tsx             — shadcn Table: image, title, price, SKU, source, actions
    EditSourceModal.tsx           — shadcn Dialog: paste URL, auto-detect platform, save
  _store/
    dropshippingSlice.ts          — listings state + hydrateListings / upsertListings /
                                     updateListingSource actions
    dropshippingSlice.test.ts     — reducer unit tests
  CLAUDE.md
  SKILL.md

src/app/api/dropshipping/
  listings/
    route.ts                      — GET: read all rows from DB ordered by created_at DESC
    refresh/
      route.ts                    — POST: fetch from eBay, upsert to DB
    [id]/
      route.ts                    — PATCH: update source_url + source_platform

src/lib/integrations/ebay/
  listings.ts                     — fetchActiveListings(): calls eBay REST API,
                                     returns normalised EbayListing[]

src/lib/utils/
  detectPlatform.ts               — pure: detectPlatform(url: string): 'amazon' | 'aliexpress' | null
  detectPlatform.test.ts          — unit tests

supabase/
  009_dropship_listings.sql       — tenant-schema table + RLS + provision_tenant_schema() update
```

### Sidebar change

New entry in `src/components/layout/Sidebar.tsx` `NAV_ITEMS`, inserted between
Integrations and Planner:

```ts
{
  label: "Dropshipping",
  href: "/dashboard/dropshipping",
  Icon: Package,        // from lucide-react
  roles: ["super_admin", "admin", "accountant"],
}
```

Plan gate and connection guard are handled inside `page.tsx`, not at nav level.

### Dashboard layout hydration

`dashboard/layout.tsx` fetches the first page of `dropship_listings` from Supabase
and passes it to `<StoreProvider>` for hydration into `dropshippingSlice` — same
pattern as `platform_connections`, `sales`, etc.

Required wiring:
- `dropshippingSlice` registered in `src/store/store.ts`
- `StoreProvider` accepts a new `dropshipListings?: DropshipListing[]` prop and
  dispatches `hydrateListings` on mount

---

## Data Model

### `dropship_listings` table (tenant schema)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `ebay_listing_id` | `text` | UNIQUE NOT NULL | eBay item ID — upsert key |
| `title` | `text` | NOT NULL | listing title |
| `image_url` | `text` | nullable | thumbnail URL from eBay |
| `ebay_url` | `text` | NOT NULL | link to live eBay listing page |
| `current_price` | `numeric(10,2)` | NOT NULL | listed price |
| `currency` | `text` | NOT NULL DEFAULT `'EUR'` | currency code |
| `sku` | `text` | nullable | eBay seller SKU (not all listings have one) |
| `source_url` | `text` | nullable | Amazon or AliExpress product URL |
| `source_platform` | `text` | nullable, CHECK `IN ('amazon','aliexpress')` | auto-detected from `source_url` |
| `last_synced_at` | `timestamptz` | NOT NULL DEFAULT `now()` | updated on every refresh |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` | |

**RLS:** tenant users read/write their own rows only (same policy pattern as other
tenant tables). No OAuth tokens stored in this table.

**Upsert behaviour on refresh:** conflict on `ebay_listing_id` updates `title`,
`image_url`, `ebay_url`, `current_price`, `currency`, `sku`, `last_synced_at`.
`source_url` and `source_platform` are **preserved** — existing source links are
never overwritten by a refresh.

### TypeScript type (added to `src/types/index.ts`)

```ts
export type SourcePlatform = "amazon" | "aliexpress";

export interface DropshipListing {
  id: string;
  ebay_listing_id: string;
  title: string;
  image_url: string | null;
  ebay_url: string;
  current_price: number;
  currency: string;
  sku: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  last_synced_at: string;
  created_at: string;
}
```

---

## Platform Detection

Pure utility in `src/lib/utils/detectPlatform.ts`:

```
hostname includes "amazon"      → 'amazon'
hostname includes "aliexpress"  → 'aliexpress'
anything else / invalid URL     → null
```

This function is used in two places:
1. `PATCH /api/dropshipping/listings/[id]` — server-side, before writing to DB
2. `EditSourceModal.tsx` — client-side, for the live preview badge as user types

---

## API Routes

### `GET /api/dropshipping/listings`

Reads all rows from `dropship_listings` ordered by `created_at DESC`. Returns
`DropshipListing[]`. Used by `dashboard/layout.tsx` for initial hydration.

### `POST /api/dropshipping/listings/refresh`

1. Reads `tenant_schema` from `user.app_metadata`
2. Reads the eBay `platform_connections` row — returns 400 if not connected
3. Calls `fetchActiveListings(accessToken)` from `src/lib/integrations/ebay/listings.ts`
4. Upserts all returned listings into `dropship_listings` (conflict on `ebay_listing_id`,
   preserving `source_url` / `source_platform`)
5. Returns `{ synced: number }`

### `PATCH /api/dropshipping/listings/[id]`

Accepts `{ sourceUrl: string }`. Validates non-empty string. Calls `detectPlatform(sourceUrl)`.
Updates `source_url` and `source_platform` for the given row. Returns the updated
`DropshipListing`.

### `fetchActiveListings()` in `src/lib/integrations/ebay/listings.ts`

Calls the eBay REST Sell Inventory API using the stored OAuth access token (same auth
pattern as the existing order-fetch adapter). Returns normalised:

```ts
interface EbayListing {
  ebayListingId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  currentPrice: number;
  currency: string;
  sku: string | null;
}
```

---

## Redux Slice

**State:** `state.dropshipping.listings: DropshipListing[]`

**Actions:**

| Action | Behaviour |
|---|---|
| `hydrateListings(listings: DropshipListing[])` | Full replace — used by `dashboard/layout.tsx` on mount |
| `upsertListings(listings: DropshipListing[])` | Replace-or-append by `ebay_listing_id` — used after refresh |
| `updateListingSource({ id, sourceUrl, sourcePlatform })` | Update `source_url` + `source_platform` on the matching row by `id` |

---

## UI

### `page.tsx` render order

```
1. !tenantPlan || !hasPlatformIntegrations(tenantPlan)
   → upgrade prompt card (link to /dashboard/settings)

2. eBay not connected (no connection row with status "connected")
   → connection required card (link to /dashboard/integrations)

3. Otherwise
   → PageHeader "Dropshipping Listings" + "Refresh from eBay" button
   → <ListingsTable />
```

### `ListingsTable.tsx` — shadcn Table

| Column | Content |
|---|---|
| Image | 48×48 `<img>` rounded; fallback placeholder icon if no `image_url` |
| Title | Linked to `ebay_url`, opens in new tab; truncated at ~60 chars |
| Price | `formatCurrency(current_price, currency)` |
| SKU | Plain text; `—` (muted) if null |
| Source | Platform badge (`Amazon` blue / `AliExpress` orange / `Unlinked` grey) + truncated `source_url` linked to source page |
| Actions | shadcn `Button` variant `outline` size `sm` — "Edit" — opens `EditSourceModal` |

"Refresh from eBay" button in page header: disabled + spinner during fetch; toasts
`{ synced: N }` on success; toasts error message on failure.

Empty state: if `listings.length === 0` and not loading, show a card — "No listings
found. Click 'Refresh from eBay' to import your active listings."

### `EditSourceModal.tsx` — shadcn Dialog

```
Title:   "Link Source Product"
Body:
  Label:   "Source product URL"
  shadcn Input — full URL paste field (type="url")
  Live preview badge (updates as user types):
    → "Amazon"     (green)   — hostname contains "amazon"
    → "AliExpress" (orange)  — hostname contains "aliexpress"
    → "Unknown"    (grey)    — anything else / invalid

Footer:
  "Cancel" (ghost button) | "Save" (primary, disabled until input non-empty)
```

On Save:
1. Calls `PATCH /api/dropshipping/listings/[id]`
2. Dispatches `updateListingSource` to Redux slice
3. Closes modal
4. Toasts success

---

## Testing

### `_store/dropshippingSlice.test.ts`
- `hydrateListings` replaces state with new array
- `upsertListings` appends new listings (matched by `ebay_listing_id`)
- `upsertListings` updates existing listings without touching `source_url`/`source_platform`
- `updateListingSource` updates correct row by `id`; leaves other rows unchanged

### `src/lib/utils/detectPlatform.test.ts`
- `amazon.com` → `'amazon'`
- `amazon.de` → `'amazon'`
- `amazon.co.uk` → `'amazon'`
- `aliexpress.com` → `'aliexpress'`
- `example.com` → `null`
- empty string → `null`
- malformed URL → `null`

Run: `npx jest dashboard/dropshipping detectPlatform`

---

## Constraints & Non-Goals

- **No delete** — listings are managed entirely through eBay; refresh upserts, never deletes
- **One source URL per listing** — no multi-supplier support in Phase 1
- **No scraping in Phase 1** — monitoring price/availability/delivery is Phase 2
- **eBay only** — only eBay listings are fetched; Amazon seller listings are out of scope
- **Source platform is auto-detected** — users cannot manually override the detected platform
- **No pagination in Phase 1** — all listings loaded at once; add if volume requires it
