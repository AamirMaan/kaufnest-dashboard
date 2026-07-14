# Dropshipping feature

Route: `/dashboard/dropshipping`. Shows the platform admin's active eBay listings fetched via
their eBay OAuth connection, stored in `tenant_kaufnest.dropship_listings` ONLY — the table
exists in no other tenant schema and is deliberately excluded from `provision_tenant_schema()`
(see `supabase/migrations/019_dropship_supplier_price.sql`). Each listing can be linked to an
Amazon or AliExpress supplier URL. Listings refresh on demand via "Refresh from eBay".

**Platform-admin only** — this feature is hidden from all regular tenants and only accessible
to the KaufNest platform admin (verified via `control.admin_users`). Four layers of protection:
1. `Sidebar.tsx` — Dropshipping link only renders when `isPlatformAdmin` is true.
2. `proxy.ts` — `/dashboard/dropshipping` routes redirect to `/dashboard` for non-admins.
3. All `/api/dropshipping/*` routes — gated with `verifyPlatformAdmin()`.
4. `dashboard/layout.tsx` — `dropshipListings` hydrated into Redux only for platform admins.

## Files in this folder

- `page.tsx` — `"use client"`. Three render branches: plan gate → eBay connection guard → listings page.
  Plan gate links to `/dashboard/settings`. Connection guard links to `/dashboard/integrations`.
  "Refresh from eBay" button visible only to admin/super_admin (checks `hasPermission(role, "manage_integrations")`).
  Uses `action` prop (singular, not `actions`) on `PageHeader` to render the refresh button.
  After refresh: re-fetches full listing list via `GET /api/dropshipping/listings` and dispatches `upsertListings`.
- `_components/ListingsTable.tsx` — shadcn `Table`. Columns: image (48×48 with fallback ImageIcon),
  title (linked to eBay listing, new tab), eBay price (`formatCurrency` with currency arg from listing),
  AliExpress price (`SupplierPriceCell`: supplier price + flat customs fee
  (always shown, defaults to €3) + a color-coded margin badge (`danger`
  <10%, `warning` <25%, `success` >=25%, via `computeMarginPct`/
  `marginBadgeVariant` in `_components/marginMath.ts`) when currencies match +
  checked date), SKU (dash if null), source (platform badge + truncated URL — see `SourceBadge`
  below), actions (per-row AliExpress price-check icon button — shown when
  `canCheckSupplierPrice(listing)` — and Edit button opening `EditSourceModal`). Exports
  `canCheckSupplierPrice` (AliExpress source_url or numeric SKU, via shared `isAliExpressSku`),
  used by `page.tsx` for the bulk button count.
  `SourceBadge`: when `source_url` is empty but the SKU is a numeric AliExpress item ID
  (`isAliExpressSku`), shows the *derived* AliExpress URL/badge as a display-time fallback
  (labelled "detected from SKU — not saved") — nothing is written to the DB until the admin
  opens the edit modal and clicks Save.
  Empty state card when `listings.length === 0`.
  Client-side pagination via local `page`/`pageSize` state (default 25 rows/page) slicing the
  passed `listings` prop; renders `<Pagination>` (`@/components/ui/Pagination`) below the table.
  Renders `<EditSourceModal key={editTarget?.id ?? "none"} ... />` to remount the modal when edit target changes (state-reset pattern).
  **Filtering + sorting (client-side)**: a filter row above the table offers
  Margin Health (`all`/`danger`/`warning`/`success`, via `matchesMarginFilter`
  in `_components/listingFilters.ts`) and a Search box (title/SKU substring,
  via `matchesListingSearch`) — both pure, unit-tested helpers. The table
  body uses the shared `DataTable` component (not raw shadcn `Table`
  primitives) for column sorting: eBay Price (by price), AliExpress Price
  (by computed margin %, via `computeMarginPct`), and a dedicated "Last
  Checked" column (by `supplier_price_checked_at`) — split out from the
  AliExpress Price cell specifically because `DataTable` only supports one
  `sortValue` per column header. Filtering happens before pagination;
  sorting happens only within the current page (same limitation as Sales/
  Purchases/Expenses' `DataTable` usage).
- `_components/EditSourceModal.tsx` — shadcn `Dialog`. URL input with live `PlatformBadge`
  (Amazon/AliExpress/Unknown based on `detectPlatform`), shown inline next to the field label.
  Initial input value comes from `resolveInitialSourceUrl(listing)` — prefills the derived
  AliExpress URL when `source_url` is empty but the SKU qualifies, so the admin usually just
  has to click Save instead of pasting the link. On save: `PATCH /api/dropshipping/listings/[id]`,
  dispatches `updateListingSource`, toasts success. Uses `{ success, error }` destructured from `useToast()`.
- `_components/resolveInitialSourceUrl.ts` — pure helper (+ colocated test) extracted out of
  `EditSourceModal.tsx` so the source_url-vs-derived-SKU precedence logic is unit-testable
  without importing the client component tree.
- `_store/dropshippingSlice.ts` — `state.dropshipping.listings: DropshipListing[]`.
  Actions: `hydrateListings` (full replace), `upsertListings` (replace-or-append by
  `ebay_listing_id`, preserves `source_url`/`source_platform`/`supplier_price`
  family/`customs_tax_amount`), `updateListingSource` (updates `source_url`/
  `source_platform` by `id`), `updateSupplierPrices` (updates the price
  snapshot by `id`, never touches `customs_tax_amount`), `updateCustomsTax`
  (updates `customs_tax_amount` by `id`).
- `_store/dropshippingSlice.test.ts` — covers all four reducers, including
  refresh-preservation and the customs-fee/price-update independence.

## API routes

- `GET /api/dropshipping/listings` — platform admin only (`verifyPlatformAdmin`); reads all
  rows ordered by `created_at DESC`. Used by `dashboard/layout.tsx` for hydration and by
  `page.tsx` after refresh.
- `POST /api/dropshipping/listings/refresh` — `requireIntegrationAdmin` + `verifyPlatformAdmin`
  guards; fetches from eBay via `fetchActiveListings(accessToken)` (Trading API GetMyeBaySelling,
  paginated); upserts to `dropship_listings` with `onConflict: "ebay_listing_id"` (never
  overwrites `source_url`/`source_platform`). Returns `{ synced: number }`.
- `PATCH /api/dropshipping/listings/[id]` — platform admin only (`verifyPlatformAdmin`);
  validates `sourceUrl`, calls `detectPlatform`, updates row. Returns updated `DropshipListing`.
- `POST /api/dropshipping/listings/check-prices` — **⚠ effectively broken since AliExpress moved
  product pages to client-side rendering (see SKILL.md's CSR gotcha): the HTML has no price, so
  this route now always returns "Could not find a price". Prices are populated by the LOCAL
  Playwright script `scripts/aliexpress/scrape-prices.mjs` (`npm run scrape:aliexpress`) instead.**
  Original behaviour: platform admin only (`verifyPlatformAdmin`). Body `{ id }`
  checks one listing; empty body checks all (cap 50, sequential with a randomized 2.5–5s
  delay, one warmed-up scrape session per run, `maxDuration = 300` — all to dodge
  AliExpress bot protection). Scrapes the AliExpress price via
  `src/lib/integrations/aliexpress/scrape.ts` (pure session/header helpers + tests in
  `.../aliexpress/session.ts`) and stores the snapshot in
  `supplier_price`/`supplier_currency`/`supplier_price_checked_at`. If a listing has no
  `source_url` but a numeric SKU (= AliExpress item ID), the URL is derived as
  `https://de.aliexpress.com/item/{sku}.html` and persisted with `source_platform`
  `aliexpress`. Returns `{ checked, failed, results }` (per-listing ok/error).

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

## Margin calculation (customs_tax_amount)

`DropshipListing.customs_tax_amount` is a flat EU customs handling fee, in
`supplier_currency`, **not derived from price** — it's a plain per-listing
number (DB column `NOT NULL DEFAULT 3`, so every listing has a value from
creation; the €3 default represents the typical flat fee for low-value
parcels since the EU removed the duty-free de minimis threshold). Feeds
into the margin shown in `SupplierPriceCell`:
`effective_cost = supplier_price + customs_tax_amount`,
`margin_pct = (current_price - effective_cost) / current_price * 100`, only
computed when `supplier_currency === currency` (same gate as the old
raw-delta display it replaced). See `_components/marginMath.ts` for the pure
implementation (`computeMarginPct`, `marginBadgeVariant`) and its colocated
tests. Editable via `EditSourceModal.tsx`'s "Customs Fee (€)" field — enter
a higher number to override the €3 default for a specific listing.

**Sync safety**: because it's a flat, independently-set value (not derived
from `supplier_price`), `customs_tax_amount` must survive both an eBay
refresh (never touched — see `refresh/route.ts`'s row mapping, which simply
never includes it as a key) and a fresh AliExpress price check (see
`check-prices/route.ts` and `scripts/aliexpress/scrape-prices.mjs`, neither
of which write this column) — a price update must never overwrite it.

## Shared dependencies

- `src/lib/utils/detectPlatform` — `detectPlatform(url)`, `isAliExpressSku(sku)`,
  `aliExpressUrlFromSku(sku)` (single shared home for the "numeric SKU = AliExpress item ID"
  rule; used by `scrape.ts` server-side and by `ListingsTable.tsx`/`resolveInitialSourceUrl.ts`
  client-side)
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
