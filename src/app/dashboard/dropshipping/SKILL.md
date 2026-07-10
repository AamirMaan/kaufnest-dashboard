# Dropshipping — Agent Playbook

## Minimal file set per change type

| Change | Files to touch |
|---|---|
| Add a column to `dropship_listings` | new file in `supabase/migrations/` using `run_on_all_tenant_schemas` (table lives in each tenant schema, NOT public) + same column in `provision_tenant_schema()` in `005_tenant_provisioning.sql`, `src/types/index.ts` (`DropshipListing`), `_store/dropshippingSlice.ts` (if reducer needs updating), API routes that upsert |
| Change AliExpress price scraping | `src/lib/integrations/aliexpress/scrape.ts` (URL derivation + HTML parsing), `src/app/api/dropshipping/listings/check-prices/route.ts` (orchestration/storage) |
| Change source platform detection logic | `src/lib/utils/detectPlatform.ts` + its test |
| Add a new column to the listings table | `_components/ListingsTable.tsx` — add `TableHead` + `TableCell` |
| Change eBay listing fields fetched | `src/lib/integrations/ebay/listings.ts` → update `EbayOffer`/`EbayInventoryItem` interfaces and mapping |
| Add an action to the Redux slice | `_store/dropshippingSlice.ts` + `_store/dropshippingSlice.test.ts` |
| Change refresh logic | `src/app/api/dropshipping/listings/refresh/route.ts` |
| Change source URL editing | `_components/EditSourceModal.tsx` + PATCH route |
| Update docs | `CLAUDE.md` (file map / data flow), `SKILL.md` (this file) |
| Add a new platform-admin-only route | new route file + add `verifyPlatformAdmin` guard — also update `proxy.ts` matcher and `Sidebar.tsx` if it has a new nav entry |
| Pagination (client-side) | `_components/ListingsTable.tsx` only — `page`/`pageSize` local state, `pagedListings` useMemo slice, `<Pagination>` component |

## Gotchas

- **AliExpress scraping is best-effort:** AliExpress serves captcha/"punish" pages to bots.
  `scrapeAliExpressPrice` tries JSON-LD → og:price meta → `runParams` regex, throws a
  user-readable error otherwise. The check-prices route runs sequentially with a 1.5s delay
  and caps at 50 listings per run — do NOT parallelize, it triggers rate limiting. On
  serverless hosting the bulk run must fit the function timeout (~50 listings ≈ 2+ min:
  raise `maxDuration` or lower the cap if needed).

- **SKU = AliExpress item ID convention:** the seller stores the AliExpress item ID as the
  eBay Custom Label. A numeric SKU (6–20 digits) is treated as an AliExpress item ID and the
  supplier URL is derived from it. This rule exists in two places that must stay in sync:
  `resolveSupplierUrl`/`isAliExpressSku` (server, scrape.ts) and `canCheckSupplierPrice`
  (client, ListingsTable.tsx).

- **Supplier snapshot preservation:** like `source_url`, the `supplier_price*` columns are
  excluded from the eBay refresh upsert payload and preserved in `upsertListings` (Redux),
  so an eBay refresh never wipes scraped prices.

- **`source_url`/`source_platform` preservation on refresh:** `upsertListings` Redux action
  deliberately preserves existing `source_url`/`source_platform` from the current state when
  the same `ebay_listing_id` is re-fetched. The DB upsert does NOT include those columns in the
  upserted payload, so the DB also preserves them. Both layers independently protect supplier links.

- **eBay scope re-authorization:** The `sell.inventory.readonly` scope was added after some
  connections were created. If `fetchActiveListings` throws "eBay returned 403 Forbidden",
  the user must disconnect and reconnect eBay in `/dashboard/integrations` to get the new scope.

- **eBay errorId 25707 — missing or non-alphanumeric SKUs on `/offer`:** The Inventory API's
  `/offer?limit=200` endpoint rejects the **entire request** with errorId 25707 when any
  listing in the seller's account has a missing or non-alphanumeric SKU (Custom Label).
  This happens with listings created via the older Trading API without a Custom Label — eBay's
  Inventory API requires all listings to have a valid alphanumeric SKU. This is NOT a SKU we
  send; eBay validates the stored SKUs of all the seller's offers server-side. The `/offer`
  call is the primary data source so this error is re-thrown with a message directing the user
  to eBay Seller Hub → Active Listings → add an alphanumeric Custom Label to every listing.
  The `/inventory_item` call has the same failure mode but is non-fatal (wrapped in its own
  `try/catch`), since it only enriches title/image.

- **Button.tsx naming conflict:** macOS case-insensitive filesystem means `Button.tsx` and
  `button.tsx` resolve to the same file. **Never run `npx shadcn add button`** — it will
  overwrite the custom Button with a different variant API. Use `@/components/ui/Button`
  (variants: `"primary"/"secondary"/"danger"/"ghost"`).

- **Platform-admin-only feature (four-layer gate):** Dropshipping is not visible to any
  regular tenant. Gate is enforced at: (1) `Sidebar.tsx` — `showDropshippingLink = isPlatformAdmin`,
  rendered in the same section as Admin Panel; (2) `proxy.ts` — `/dashboard/dropshipping`
  redirects non-platform-admins to `/dashboard`; (3) all four `/api/dropshipping/*` routes —
  gated with `verifyPlatformAdmin(user.email)` from `@/lib/supabase/control`; (4)
  `dashboard/layout.tsx` — `dropshipListings` hydrated into Redux only when `isAdmin` is true.
  `verifyPlatformAdmin` is a thin wrapper around `isPlatformAdmin` that returns a `NextResponse`
  (403) or `null`. Use `const forbidden = await verifyPlatformAdmin(user.email); if (forbidden) return forbidden;`.

- **Refresh is admin/super_admin only (within platform admin):** The "Refresh from eBay"
  button is hidden from accountants via `hasPermission(role, "manage_integrations")`. The
  `POST /api/dropshipping/listings/refresh` route uses `requireIntegrationAdmin()` in addition
  to `verifyPlatformAdmin()` — both must pass.

- **Client-side pagination (Phase 2):** `ListingsTable` now paginates the passed `listings`
  array locally (default 25/page). The fetch cap is still 200 listings per refresh. If the
  cap needs lifting (server-side cursor pagination on the eBay API side), that belongs in
  `fetchActiveListings` + the refresh route, not in `ListingsTable`.

- **`formatCurrency` currency arg:** `formatCurrency(price, currency)` — always pass the
  `currency` field from the listing row (not hardcoded EUR), since sellers may list in GBP,
  USD, etc. Example: `formatCurrency(listing.current_price, listing.currency as Currency)`.

- **`PageHeader` action prop (singular):** Use `action` not `actions` when passing the refresh
  button to `PageHeader`. A single node is expected, not an array.

- **Toast API:** `useToast()` returns `{ toast, success, warning, error, info }`. Use `success(message)`
  and `error(message)` for async operations. Do not destructure as `{ addToast }` — that's from the
  old API.

- **State reset pattern:** `EditSourceModal` uses `key={editTarget?.id ?? "none"}` to remount
  the modal when the edit target changes. This resets internal state (URL input) without explicit
  `useEffect` cleanup.

- **shadcn `dark:` variants don't work:** The project uses `[data-theme="dark"]` on `<html>`,
  not a `.dark` class. Any `dark:` Tailwind variants in shadcn components will not respond
  to the theme toggle. Use `var(--color-*)` CSS variables or the mapped shadcn tokens
  (`bg-card`, `text-muted-foreground`, etc.) which cascade correctly.
