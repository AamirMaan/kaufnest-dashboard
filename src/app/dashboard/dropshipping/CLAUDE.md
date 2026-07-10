# Dropshipping feature

Route: `/dashboard/dropshipping`. Shows a tenant's active eBay listings fetched via their
existing eBay OAuth connection, stored in `public.dropship_listings`. Each listing can be
linked to an Amazon or AliExpress supplier URL. Listings refresh on demand via "Refresh
from eBay" (admin/super_admin only). Available on Pro/Business plans only.

## Files in this folder

- `page.tsx` — `"use client"`. Three render branches: plan gate → eBay connection guard → listings page.
  Plan gate links to `/dashboard/settings`. Connection guard links to `/dashboard/integrations`.
  "Refresh from eBay" button visible only to admin/super_admin (checks `hasPermission(role, "manage_integrations")`).
  Uses `action` prop (singular, not `actions`) on `PageHeader` to render the refresh button.
  After refresh: re-fetches full listing list via `GET /api/dropshipping/listings` and dispatches `upsertListings`.
- `_components/ListingsTable.tsx` — shadcn `Table`. Columns: image (48×48 with fallback ImageIcon),
  title (linked to eBay listing, new tab), price (`formatCurrency` with currency arg from listing),
  SKU (dash if null), source (platform badge + truncated URL), Edit button (opens `EditSourceModal`).
  Empty state card when `listings.length === 0`.
  Client-side pagination via local `page`/`pageSize` state (default 25 rows/page) slicing the
  passed `listings` prop; renders `<Pagination>` (`@/components/ui/Pagination`) below the table.
  Renders `<EditSourceModal key={editTarget?.id ?? "none"} ... />` to remount the modal when edit target changes (state-reset pattern).
- `_components/EditSourceModal.tsx` — shadcn `Dialog`. URL input with live `PlatformBadge`
  (Amazon/AliExpress/Unknown based on `detectPlatform`). On save: `PATCH /api/dropshipping/listings/[id]`,
  dispatches `updateListingSource`, toasts success. Uses `{ success, error }` destructured from `useToast()`.
- `_store/dropshippingSlice.ts` — `state.dropshipping.listings: DropshipListing[]`.
  Actions: `hydrateListings` (full replace), `upsertListings` (replace-or-append by
  `ebay_listing_id`, preserves `source_url`/`source_platform`), `updateListingSource`
  (updates by `id`).
- `_store/dropshippingSlice.test.ts` — 5 tests covering all three reducers.

## API routes

- `GET /api/dropshipping/listings` — reads all rows ordered by `created_at DESC`. All
  authenticated users. Used by `dashboard/layout.tsx` for hydration and by `page.tsx` after refresh.
- `POST /api/dropshipping/listings/refresh` — `requireIntegrationAdmin` guard; fetches
  from eBay via `fetchActiveListings(accessToken)` (Trading API GetMyeBaySelling, paginated);
  upserts to `dropship_listings` with `onConflict: "ebay_listing_id"` (never overwrites
  `source_url`/`source_platform`). Returns `{ synced: number }`.
- `PATCH /api/dropshipping/listings/[id]` — all authenticated users; validates `sourceUrl`,
  calls `detectPlatform`, updates row. Returns updated `DropshipListing`.

## eBay API notes

- Scope: `sell.inventory` (full, in `EBAY_SCOPE` in `src/lib/integrations/ebay.ts`
  alongside `sell.fulfillment`). Trading API calls do not accept the `.readonly` variant.
  Existing connections authorised with the old readonly scope **must be re-authorised** —
  the refresh route returns a user-readable token error if not.
- `fetchActiveListings` is in `src/lib/integrations/ebay/listings.ts`. It calls the
  Trading API `GetMyeBaySelling` (XML POST to `/ws/api.dll`, OAuth token via
  `X-EBAY-API-IAF-TOKEN` header), paginating the ActiveList (200/page, 10-page cap).
  This replaced the Inventory API (`/offer` + `/inventory_item`), which failed
  account-wide with errorId 25707 when any listing — even inactive, un-editable ones —
  lacked a valid alphanumeric SKU. GetMyeBaySelling has no SKU restriction.
  Token/scope errors (21916984, 21917053, 931, 932) are re-thrown with a user-readable
  reconnect message.

## Data flow

`dashboard/layout.tsx` fetches `dropship_listings` and passes to `StoreProvider` as
`dropshipListings`; `StoreProvider` dispatches `hydrateListings`. `page.tsx` reads from
Redux only — no direct Supabase calls on the client.

## Shared dependencies

- `src/lib/utils/detectPlatform` — `detectPlatform(url)`
- `src/lib/utils/planGating` — `hasPlatformIntegrations`
- `src/lib/utils/permissions` — `hasPermission`, `manage_integrations`
- `src/lib/utils/currency` — `formatCurrency(price, currency)`
- `src/lib/utils` — `cn()`
- `src/lib/integrations/ebay/listings.ts` — `fetchActiveListings` (server-only)
- `src/lib/integrations/authGuard` — `requireIntegrationAdmin`
- `src/lib/integrations/tokenStore` — `getConnection`, `ensureValidAccessToken`
- `src/components/layout/PageHeader`
- `src/components/ui/Button` — existing custom Button (never use shadcn add button)
- shadcn: `table`, `dialog`, `input` (in `src/components/ui/`)
- `src/components/ui/Toast` — `useToast` (exposes `{ toast, success, warning, error, info }`)
- `src/store/hooks` — `useAppSelector`, `useAppDispatch`
- `src/store/slices/currentUserSlice` — `profile.role`, `tenantPlan`
- `src/types` — `DropshipListing`, `SourcePlatform`, `Currency`

## Tests

`npx jest dashboard/dropshipping`
