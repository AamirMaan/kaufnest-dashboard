# Integration Order Review — Design Spec

**Date:** 2026-06-19
**Scope:** Replace the auto-sync flow for eBay and Amazon with a manual order review page. Users fetch platform orders on demand, review them, and selectively import chosen orders as `sales` rows.

---

## Problem

The current eBay/Amazon integration auto-imports all orders on sync (manual "Sync now" button + daily cron). There is no way to review orders before they land in the dashboard, and high-volume sellers (especially Amazon) cannot selectively import only relevant orders.

eBay buyer purchases (items the merchant bought on eBay) are out of scope — eBay's REST API does not expose buyer purchase history. Those continue to be entered manually as expenses.

---

## Solution Overview

- Remove the cron job and "Sync now" button for both platforms.
- Add a dedicated review page at `/dashboard/integrations/review` that fetches orders live from connected platform APIs, shows them in a filterable table with already-imported indicators, and lets the user select and import chosen orders.
- Two new API routes: `GET /api/integrations/review` (fetch + diff) and `POST /api/integrations/review/import` (import selected).
- Amazon keeps its existing OAuth connection; eBay keeps its existing OAuth connection. Only the sync mechanism changes.

---

## Architecture

### Removed

- `vercel.json` `crons` array — removed entirely (both eBay and Amazon move to manual review).
- `ConnectionCard` "Sync now" button for connected platforms — replaced with "Review orders" link.

### Added

| File | Purpose |
|------|---------|
| `src/app/dashboard/integrations/review/page.tsx` | New review page |
| `src/app/api/integrations/review/route.ts` | GET — fetch + diff orders from platform APIs |
| `src/app/api/integrations/review/import/route.ts` | POST — import selected orders into `sales` |

### Modified

| File | Change |
|------|--------|
| `src/app/dashboard/integrations/_components/ConnectionCard.tsx` | Replace "Sync now" button with "Review orders" link |
| `vercel.json` | Remove `crons` array |
| `src/app/dashboard/integrations/CLAUDE.md` | Update file map |
| `src/app/dashboard/integrations/SKILL.md` | Add gotchas + minimal-file-set entry |

---

## API

### `GET /api/integrations/review`

**Auth:** `requireIntegrationAdmin()` + `hasPlatformIntegrations(tenantPlan)` (403 if plan doesn't include integrations).

**Behaviour:**
1. Load all `connected` platform connections for the tenant via the tenant-scoped client.
2. For each connected platform, call `ensureValidAccessToken` then `adapter.fetchOrders(token, since90days, marketplaceId)` where `since90days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()`.
3. Query `sales` for all `external_order_id` values where `platform IN (<connected platforms>)` to build an imported-ID set.
4. Attach `imported: boolean` to each `NormalizedOrder` by checking against the set.
5. Return:

```ts
{
  ebay?:   { orders: ReviewOrder[] },
  amazon?: { orders: ReviewOrder[] }
}
```

where `ReviewOrder = NormalizedOrder & { imported: boolean }`.

Platforms with no connected connection are omitted from the response. If no platforms are connected, returns `{}`.

**Error:** 500 with `{ error, detail }` if a platform API call fails — the response still includes results from platforms that succeeded.

### `POST /api/integrations/review/import`

**Auth:** `requireIntegrationAdmin()` + `hasPlatformIntegrations(tenantPlan)`.

**Request body:**
```ts
{ items: { platform: IntegrationPlatform; order: NormalizedOrder }[] }
```

Only the orders the user explicitly selected.

**Behaviour:**
1. Map each item to a sale row via `normalizedOrderToSaleRow(order, platform, userId)`.
2. Upsert all rows into `sales` with `onConflict: "platform,external_order_id"` — idempotent; re-importing updates rather than duplicates.
3. For each platform that had items, call `upsertConnection` to set `last_synced_at = now()`.
4. Return `{ imported: number }`.

**Error shape:** `{ error: string, detail?: string }` on failure.

---

## UI

### Review page — `src/app/dashboard/integrations/review/page.tsx`

- `"use client"`. Applies same plan/role guards as `integrations/page.tsx` (redirects to `/dashboard/integrations` if not eligible).
- On mount: fetches `GET /api/integrations/review`, shows skeleton while loading.
- **Platform tabs** (eBay / Amazon): only tabs for connected platforms are shown. Each tab label includes the count of unimported orders, e.g. "eBay (12)".
- **Table columns:** Platform badge, Date, Order ID, Product, Qty, Amount, Status.
- **Already-imported rows** are greyed out with a ✓ badge and non-selectable checkbox.
- **Unimported rows** have a selectable checkbox.
- **"Select all" checkbox** in the header selects all unimported rows on the active tab.
- **"Import selected (N)"** button — disabled when `N = 0`, shows spinner during POST. On success: `useToast().success(...)`, imported rows flip to greyed-out, `router.refresh()` re-hydrates the sales slice. On failure: inline red banner with `data.detail ?? data.error`.
- **Back link** at top: `← Integrations` → `/dashboard/integrations`.

### ConnectionCard change

For connected platforms, replace:
```tsx
<Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
  Sync now
</Button>
```
with:
```tsx
<Button size="sm" variant="secondary" asChild>
  <Link href="/dashboard/integrations/review">Review orders</Link>
</Button>
```

The `handleSync` function and `syncing` state are removed entirely. `useRouter` import in `ConnectionCard` is also removed if no longer needed after the sync removal.

---

## Data flow

```
User opens /dashboard/integrations/review
  → GET /api/integrations/review
    → fetchOrders (eBay + Amazon APIs, 90-day window)
    → query sales for existing external_order_ids
    → return orders with imported: boolean
  ← ReviewOrder[][] grouped by platform

User selects orders → clicks "Import selected"
  → POST /api/integrations/review/import
    → normalizedOrderToSaleRow per item
    → upsert into sales
    → upsertConnection(last_synced_at)
  ← { imported: N }
  → router.refresh() re-hydrates salesSlice
```

---

## Out of scope

- eBay buyer purchase history — eBay REST API does not expose this. Merchants enter eBay purchases manually as expenses.
- Pagination across multiple API pages — the 90-day window with eBay's 50-item and Amazon's default limits is acceptable for the first iteration. Pagination can be added later if needed.
- Filtering/sorting beyond platform tabs — keep it simple for now.
- Amazon-only: `marketplace_id` is read from the stored connection row; no marketplace-selection UI is added.
