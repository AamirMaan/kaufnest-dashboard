# Order status pull-sync (eBay/Amazon → app)

**Date:** 2026-09-07
**Status:** Design approved by user (in conversation). Ready for an implementation plan.

## Problem

Order status only flows into the app **once**, at first import. `review/page.tsx`
replaces an already-imported order's checkbox with a static "✓" once
`order.imported` is true, so it can never be re-selected and re-submitted to
`POST /api/integrations/review/import` — the only route that writes
`sales.status`. If a buyer's order ships, gets delivered, or gets cancelled
on eBay/Amazon *after* you've imported it, the app's copy of that order sits
stale forever. This is the mirror-image gap to the eBay status **push**
feature already shipped (PR #89, app → eBay) — this piece closes the same
gap in the read direction (platform → app).

## Scope

**In scope:** a "Sync Statuses" button on the Review Orders page
(`/dashboard/integrations/review`) that re-fetches current order data from
every connected platform and re-submits every **already-imported** order
through the existing import pipeline, refreshing `status` (and the other
fields `mergeImportedSale.ts` already classifies as platform-owned:
`total_amount`, `unit_price`, `quantity`, `product_name`, `date`,
`description`) while preserving every user-owned field exactly as re-imports
already do today. Works identically for eBay and Amazon — both already flow
through the same generic `NormalizedOrder`/`mergeImportedSale` pipeline, so
there is no platform-specific code to write.

**Explicitly out of scope:** a new API route (the existing
`POST /api/integrations/review/import` already does exactly the merge this
needs — see "Why no new route" below), any change to `mergeImportedSale.ts`'s
field classification (status already overwrites on re-import; this piece
only makes that reachable for already-imported orders), tracking
number/carrier sync (that's the separate, already-scoped
`sales.tracking_number`/`shipping_carrier` fields from the status **push**
feature — this piece touches `status` and the other existing platform-owned
fields only, nothing new), any automatic/scheduled sync (matches this
feature's 100%-manual-click precedent — no cron infra in this app), orders
older than the existing 90-day review lookback window (same limitation the
Review page already has for *any* order — a sync button can't surface what
the review fetch itself doesn't return).

## Why no new API route

`POST /api/integrations/review/import` already:
1. Accepts `{ items: { platform, order }[] }`.
2. Fetches existing `sales` rows by `external_order_id` and runs each
   incoming row through `mergeImportedSale(existing, incoming)`, which
   overwrites only the platform-owned field list and preserves everything
   else.
3. Upserts on `(platform, external_order_id)` — for an already-imported
   order this is an **update**, not an insert.
4. Updates `last_synced_at`/`last_sync_status` per platform.

The only reason this path never runs for already-imported orders today is
that `review/page.tsx`'s UI never lets one be selected. Reusing this route
for the sync button (with `purchaseCosts`/`orderFees` omitted) means zero
new backend code and zero risk of the sync path drifting from the
already-tested import path.

## UI — Review Orders page

`src/app/dashboard/integrations/review/page.tsx`:

- New `syncing` boolean state and a new `handleSyncStatuses` function.
- New "Sync Statuses" `Button` (`variant="secondary"`, matches the existing
  "Import selected" button's row), placed to the left of the Import button.
  **Enabled whenever at least one order across *either* platform tab is
  already imported** (`platforms.some((p) => data?.[p]?.orders.some((o) =>
  o.imported))`) — not scoped to the active tab, since the point is a
  one-click refresh of everything currently visible, not per-tab busywork.
  Disabled while `syncing` or `importing` (never let both run at once — they
  hit the same import route). Label swaps to "Syncing…" while in flight,
  per this repo's mutating-button convention.
- `handleSyncStatuses`:
  1. Re-fetches `GET /api/integrations/review` (fresh platform data — not
     the page's possibly-stale `data` state from mount time) into a local
     variable, `setData(fresh)` to keep the table in sync with what's about
     to be submitted.
  2. Builds `items` from every order in the fresh response where
     `imported === true`, across all platforms in `fresh` — same shape as
     `handleImport`'s existing `items` construction.
  3. If `items.length === 0`, show an info toast ("Nothing to sync — no
     previously-imported orders found.") and return early — don't POST an
     empty batch.
  4. `POST /api/integrations/review/import` with `{ items }` — **no**
     `purchaseCosts`/`orderFees` keys (omitted entirely, not empty objects —
     matches the type's optional fields, and guarantees the route's
     purchase-insert branch never fires for a sync).
  5. On success: toast `"${result.imported} order(s) synced from
     eBay/Amazon."`, `router.refresh()` (same pattern `handleImport` already
     uses to bring `salesSlice` up to date via the layout's re-hydration).
  6. On failure: same `importError`/toast.error pattern `handleImport`
     already uses.

No changes to `handleImport`, `toggleOrder`, `toggleSelectAll`, or any
existing state — the sync button is fully additive and operates on its own
transient `items` list, never touching `selected`.

## Blast radius

One new button, one new handler function, zero new files, zero backend
changes, zero migration. A tenant with no already-imported orders sees the
button permanently disabled. A tenant who never clicks it sees no behavior
change at all.

## Testing

Per `AGENTS.md`: no dev server, no curl, no `npm test` mid-task by the
implementer. This page has no colocated test file today (`review/page.tsx`
is 100% network/Redux orchestration, matching the existing
`dashboard/integrations/CLAUDE.md` testing note that only the slice is
tested) — no new test file is expected for the button/handler itself,
consistent with that precedent.

Manual verification (ask the user to exercise in browser, per working
agreement): import an eBay sandbox order, mark it delivered/cancelled on the
eBay sandbox seller side directly (outside the app), return to Review
Orders, click "Sync Statuses", confirm the order's badge in the review table
already showed the new status (it's always been live-fetched) and — the
actual fix — that the Sales/Orders page now shows the updated status too
after the sync + refresh. Also confirm a manually-set VAT rate or linked
inventory product on that same order survives the sync unchanged.

## Docs to update alongside implementation

- `src/app/dashboard/integrations/CLAUDE.md` — extend the `review/page.tsx`
  bullet with the new button + `handleSyncStatuses`, and add a short note to
  the "Data flow" section explaining that already-imported orders can now be
  refreshed via this route too, not just newly-seen ones.
