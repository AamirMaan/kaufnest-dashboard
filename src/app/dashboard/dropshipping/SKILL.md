# Dropshipping — Agent Playbook

## Minimal file set per change type

| Change | Files to touch |
|---|---|
| Add a column to `dropship_listings` | `supabase/009_dropship_listings.sql` (new migration), `src/types/index.ts` (`DropshipListing`), `_store/dropshippingSlice.ts` (if reducer needs updating), API routes that upsert |
| Change source platform detection logic | `src/lib/utils/detectPlatform.ts` + its test |
| Add a new column to the listings table | `_components/ListingsTable.tsx` — add `TableHead` + `TableCell` |
| Change eBay listing fields fetched | `src/lib/integrations/ebay/listings.ts` → update `EbayOffer`/`EbayInventoryItem` interfaces and mapping |
| Add an action to the Redux slice | `_store/dropshippingSlice.ts` + `_store/dropshippingSlice.test.ts` |
| Change refresh logic | `src/app/api/dropshipping/listings/refresh/route.ts` |
| Change source URL editing | `_components/EditSourceModal.tsx` + PATCH route |
| Update docs | `CLAUDE.md` (file map / data flow), `SKILL.md` (this file) |

## Gotchas

- **`source_url`/`source_platform` preservation on refresh:** `upsertListings` Redux action
  deliberately preserves existing `source_url`/`source_platform` from the current state when
  the same `ebay_listing_id` is re-fetched. The DB upsert does NOT include those columns in the
  upserted payload, so the DB also preserves them. Both layers independently protect supplier links.

- **eBay scope re-authorization:** The `sell.inventory.readonly` scope was added after some
  connections were created. If `fetchActiveListings` throws "eBay returned 403 Forbidden",
  the user must disconnect and reconnect eBay in `/dashboard/integrations` to get the new scope.

- **Button.tsx naming conflict:** macOS case-insensitive filesystem means `Button.tsx` and
  `button.tsx` resolve to the same file. **Never run `npx shadcn add button`** — it will
  overwrite the custom Button with a different variant API. Use `@/components/ui/Button`
  (variants: `"primary"/"secondary"/"danger"/"ghost"`).

- **Refresh is admin/super_admin only:** The "Refresh from eBay" button is hidden from
  accountants in the UI via `hasPermission(role, "manage_integrations")`. The
  `POST /api/dropshipping/listings/refresh` route uses `requireIntegrationAdmin()` which
  enforces the same check at the API level.

- **No pagination in Phase 1:** `fetchActiveListings` fetches up to 200 offers and 200
  inventory items. Sellers with > 200 active listings will not see all of them. Pagination
  is a Phase 2 concern.

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
