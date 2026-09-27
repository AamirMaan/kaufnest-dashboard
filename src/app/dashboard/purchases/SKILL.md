---
name: purchases-feature
description: Work on the Purchases dashboard feature (list, add/edit/delete inventory purchase records, invoices) at src/app/dashboard/purchases — use when the task mentions purchases, inventory buys, vendors, or the /dashboard/purchases route.
---

# Working on the Purchases feature

This feature is fully colocated under `src/app/dashboard/purchases/`. Read
`CLAUDE.md` in this folder first — it explains the file map, the server-side
pagination data flow, and the Supabase-write → slice-update → audit-log pattern
every mutation follows.

## Minimal file set for common changes

- **Add/change a field on a purchase**: `_components/AddPurchaseModal.tsx`
  (create form), `_components/EditPurchaseModal.tsx` (edit form + before/after
  audit diff), `_store/purchasesSlice.ts` only if the shape stored in Redux
  changes, and `src/types/index.ts` for the `Purchase` type. Also check
  `page.tsx` if the field needs to render in the table or be filterable
  (`lib/utils/filters.ts`). **Also update `ImportPurchasesModal.tsx`** if the
  field needs import support.
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change server-side filter pushdown**: `_store/purchasesSlice.ts`
  (`fetchPurchasesPage` thunk) + `page.tsx` (`handleExport` must mirror the same
  predicates).
- **Change reducer logic**: `_store/purchasesSlice.ts` + its test.
- **Change export columns**: `handleExport()` in `page.tsx`.
- **Change import validation / accepted columns**: `validateRow()` in
  `_components/ImportPurchasesModal.tsx` only.
- **Change the advanced-inventory location/landed-cost fields** (Business
  plan): `_lib/purchaseInventoryFields.ts` (+ test) for the pure
  state/validation/payload shape, `_components/PurchaseInventoryFields.tsx`
  for the UI, and both `AddPurchaseModal.tsx`/`EditPurchaseModal.tsx` for the
  `tracksStock` gating + payload spread + audit diff. Don't touch
  `inventory/_lib/landedCost.ts` here — it must stay byte-identical to the
  SQL formula; see its own file comment.
- **Change the filtered summary tiles**: `_lib/purchasesSummaryTiles.ts` (+
  its test) for tile content/order; `_store/purchasesSlice.ts`'s
  `fetchPurchasesSummary` or `_store/purchasesFilterParams.ts` only if the
  underlying filter/RPC shape changes.

## Test command

`npx jest dashboard/purchases`

## Gotchas — "Specific period" date filter

`page.tsx`'s `FilterBar` gets `earliestYear`/`onPeriodChange` props, which
enable a "Specific Period" option (any month/quarter/full year) on top of the
existing date presets. `setPeriod` (the combined preset+dateFrom+dateTo
setter passed as `onPeriodChange`) MUST update all three fields in one atomic
call — see `components/ui/SKILL.md`'s FilterBar entry for why (closure
staleness in the `setFilter(key, value)` pattern this page already uses).

## Gotchas — filtered-summary state (2026-09-26)

- **`fetchPurchasesSummary` follows the exact same shape as Sales'
  `fetchSalesSummary`** — `summaryRequestId` stale-response guard,
  `summaryVersion` bumped by `addPurchase`/`updatePurchase`/`removePurchase`,
  reuses `purchasesFilterParams` (the same mapper `fetchPurchasesPage` uses),
  and never forwards a raw Postgres error (throws
  `new Error("purchases_summary_failed")` instead). See the Sales feature's
  SKILL.md gotcha for the full reasoning — it applies here unchanged.
- `summaryVersion` also bumps on hydration-only `addPurchase` dispatches
  (e.g. the order-detail page hydrating a linked purchase); harmless,
  because the refetch effect only runs while the list page is mounted.
- **Wired into `page.tsx`** (Task 6, 2026-09-26): the filtered summary tiles
  above the Purchases table (Purchases/Units bought/Gross/VAT/Net) are built
  by `_lib/purchasesSummaryTiles.ts`'s `buildPurchasesTiles(summaryRows)` —
  mirrors Sales' `buildSalesTiles` exactly (`compactTiles`/`countTile`/
  `moneyTile` from `@/components/ui/summaryTileHelpers`), VAT and Net hidden
  together when VAT is all-zero.

## Gotchas

- `purchasesSlice` is registered centrally in `src/store/store.ts` and hydrated
  in `src/store/StoreProvider.tsx` — those two files import it via the
  `@/app/dashboard/purchases/_store/purchasesSlice` alias. If you rename the
  slice file, update those imports too.
- `hydratePurchases` is a re-export alias for `hydratePage` — `StoreProvider`
  calls `hydratePurchases({ data, count, page: 1, pageSize: DEFAULT_PAGE_SIZE })`.
  The old `hydrate(Purchase[])` signature is gone; always pass the full
  `{ data, count, page, pageSize }` shape.
- Summary tiles in `page.tsx` come from `fetchPurchasesSummary` (ALL matching
  rows, not just the current page) — see "Gotchas — filtered-summary state"
  above. They are no longer computed from `state.purchases.items`.
- The Export button queries Supabase directly with **no `.range()`** (capped at
  5 000 rows) so it always covers all matching records regardless of which page
  is shown. Mirror filter predicates from `fetchPurchasesPage` exactly.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Sales and Expenses
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Purchase.product_id` is optional and FK's to `products` (Inventory feature) —
  the modals just set it via a `Select`; a DB trigger keeps `current_stock` in
  sync (purchases *increment* stock, sales decrement). Never write to
  `products.current_stock` from here.
- `Purchase.vat_rate`/`vat_amount` are populated only when "Total includes VAT"
  is checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when
  it's off — see `CLAUDE.md` → "Inventory link + VAT" for the full pattern,
  which is identical across Purchases/Sales/Expenses modals.
- `writeAuditLog` `entityId` is `string | undefined` — omit it for bulk-import
  batch entries rather than passing `null` (which is a TypeScript error).
- There is no standalone vendor filter (removed — the general "Search" box
  covers it). Search matches `product_name`, `vendor`, and `description` via
  `.or()`/`ilike` (see `fetchPurchasesPage`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`). `handleExport` mirrors
  the same predicate — keep both in sync if the column set ever changes.
- `<PurchaseInventoryFields>` (location + landed costs) only renders when a
  local `tracksStock` boolean is true — it's computed differently in each
  modal (Add also covers the "create a new inventory product and link it"
  path; Edit checks the current `form.product_id` AND
  `isTrackedByLedger(purchase.created_at, advanced.settings)` — pre-enable
  purchases get a "predates batch tracking" note instead), so don't assume
  the two modals' `tracksStock` expressions are copy-pasteable. When
  `tracksStock` is false the insert/update payload spreads in `{}` — the
  four new columns (`location_id`/`freight_cost`/`customs_cost`/
  `other_cost`) are never sent, so a Starter/Pro tenant's payload is
  byte-for-byte what it was before this feature existed.
- An empty `locationId` (`""`) means "use the tenant's default location" —
  never treat `""` as invalid or coerce it to a specific id client-side;
  `purchaseInventoryPayload` turns it into `location_id: null` and the DB
  fills in `inventory_settings.default_location_id`.
- The landed-cost figure shown while typing is **display-only** —
  `landedUnitCost()` (`inventory/_lib/landedCost.ts`) mirrors the SQL
  formula but the database is what actually costs the stock lot. Don't wire
  this preview value into the insert/update payload.
- `EditPurchaseModal`'s `inv` state only re-initializes correctly because
  `page.tsx` renders it with `key={editTarget?.id ?? "edit-purchase"}` —
  if you ever lift this component to a call site without that key, add an
  effect to re-sync `inv` when `purchase` changes, or editing purchase B
  right after purchase A will show purchase A's stale landed-cost fields.
- Both modals now wrap their entire `handleSubmit` body in
  `try/catch/finally` (`finally` resets `saving`) so a *thrown* error
  (network/auth failure, not just a returned `{ error }`) can't leave the
  Save button stuck on "Saving…" forever — and the `writeAuditLog` call
  specifically has its own **inner** try/catch, so an audit-log failure
  after a successful purchase write can't retroactively turn that save into
  a failure toast.
