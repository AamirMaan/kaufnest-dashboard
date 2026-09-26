---
name: inventory-feature
description: Work on the Inventory dashboard feature (product catalog, stock levels, reorder thresholds) at src/app/dashboard/inventory — use when the task mentions inventory, products, stock, SKUs, reorder thresholds, or the /dashboard/inventory route.
---

# Working on the Inventory feature

This feature is fully colocated under `src/app/dashboard/inventory/`. Read
`CLAUDE.md` in this folder first — especially the split-selector section,
since modal dropdowns use a different state key than the table.

## Minimal file set for common changes

- **Add/change a catalog field** (name, SKU, reorder threshold, etc.):
  `_components/AddProductModal.tsx` (create form),
  `_components/EditProductModal.tsx` (edit form + before/after audit diff),
  `_store/inventorySlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Product` type. Also check
  `_components/ProductsTab.tsx` if the field needs to render in the table.
  If the new field is needed in Sales/
  Purchases dropdowns, also add it to `ProductSelector` in `inventorySlice.ts`
  and update the selector query in `layout.tsx`.
- **Change how stock is calculated**: don't touch this folder — edit the
  trigger functions (`apply_purchase_stock_change`/`apply_sale_stock_change`)
  in `supabase/migrations/002_inventory_and_vat.sql`. Stock math lives in the
  database so the client never has to reconcile it.
- **Change which records can link to a product**: that UI lives in the
  Purchases/Sales `Add`/`Edit` modals (`product_id` `Select`), not here.
  Those modals now read from `s.inventory.selectorItems` (not `.items`).
- **Change list/table behavior or search**: `_components/ProductsTab.tsx`
  only (moved out of `page.tsx` in Phase 2 Task 3 — `page.tsx` is now just
  the shell: header, "+ Add Product" open state, and the advanced-inventory
  upsell/loading/error banners).
- **Change reducer logic**: `_store/inventorySlice.ts` + its test.
- **Change pagination**: `_store/inventorySlice.ts` (`fetchInventoryPage` thunk),
  `_components/ProductsTab.tsx` (`<Pagination>` wiring),
  `src/app/dashboard/layout.tsx` (initial paginated fetch),
  `src/store/StoreProvider.tsx` (`hydrateProducts` call).
- **Change selector list fields**: `_store/inventorySlice.ts` (`ProductSelector`
  type + `fetchInventorySelectors` select clause), `layout.tsx` (selector
  query columns), `src/app/dashboard/sales/_components/productOptions.ts`
  (`SelectorProduct` interface).
- **Change advanced-inventory stock/cost behaviour** (FIFO, landed cost,
  shortfall, transfers): `supabase/migrations/047_advanced_inventory.sql`
  (installer) + `supabase/tests/advanced_inventory.test.sql`; if the landed-cost
  formula changes, also `_lib/landedCost.ts` + its test. Re-run the installer on
  all tenants (see `supabase/SKILL.md`).
- **Change the enable flow** (the one-way "Batches & locations" confirm
  card): `_components/EnableAdvancedCard.tsx` only — `page.tsx` just decides
  when to render it (`view === "enable"`) and passes `isAdmin`. The route it
  calls (`POST /api/inventory/enable-advanced`) is Phase 1 (Task 1) and out
  of scope here unless the request/response contract itself changes.
- **Change the Locations tab** (list, add/edit, deactivate/reactivate,
  delete): `_components/LocationsTab.tsx` (list + row actions + the shared
  `DeleteConfirmModal`), `_components/LocationModal.tsx` (add/edit form),
  `_lib/advancedInventory.ts` (`sortLocations`, `LOCATION_TYPE_LABELS`,
  `locationDeactivationBlocker`, `isLocationNameTaken`), and
  `_store/advancedInventorySlice.ts` (`locationSaved`/`locationRemoved`).
  `page.tsx` only owns which tab is active and the "+ Add Location" button's
  open state — see the `InventoryTabs` gotcha below.
- **Change fulfillment defaults** (the tenant's default location + per-platform
  default fulfillment location, Task 7, 2026-09-26):
  `_components/FulfillmentDefaultsCard.tsx` (the form itself),
  `_lib/advancedInventory.ts` (`fulfillmentDraftFrom`, `platformDefaultChanges`,
  `isFulfillmentDraftValid`, `isFulfillmentDraftDirty`, `defaultLocationOptions`,
  `platformLocationOptions`, `INVENTORY_PLATFORMS`, `PLATFORM_LABELS`), and
  `_store/advancedInventorySlice.ts` (`settingsSet`, `platformDefaultsMerged`).
  Mounted by `_components/LocationsTab.tsx` after its `DataTable`, remounted
  via a `defaultsKey` built from `settings`/`locations`/`platformDefaults` so
  its internal draft always starts from the current saved values.

## Test command

`npx jest dashboard/inventory`

## Gotchas

- **`page.tsx` is a shell, not the list view (Phase 2 Task 3, 2026-09-26)** —
  the products table/search/pagination/modals live in
  `_components/ProductsTab.tsx`, which takes `{ addOpen, onAddClose }` (the
  "+ Add Product" button and its `useState` stay in `page.tsx`'s
  `<PageHeader>` since the tab doesn't own the header). `page.tsx` itself
  only decides which of `upsell`/`loading`/`error` banners to show above
  `<ProductsTab>`, via `advancedInventoryView(plan, advanced)`. Don't add
  table/search logic back into `page.tsx` — it belongs in `ProductsTab`.
- **`InventoryTabs` is wired into `page.tsx` (Task 6, 2026-09-26)**, but only
  when `view === "active"` — the tab strip only ever appears once advanced
  inventory is actually on, never above the upsell/loading/error/enable
  states. `page.tsx` owns `tab`/`addLocationOpen` state and the "+ Add
  Location" vs "+ Add Product" `PageHeader` action switch
  (`showLocations = view === "active" && tab === "locations"`); the tab's
  own component (`LocationsTab`) only owns its modals, not the header.
- **Both tab panels stay mounted; only `hidden` toggles (fix round 1,
  2026-09-26).** `page.tsx` renders `<ProductsTab>` and `<LocationsTab>`
  unconditionally once `view === "active"` and flips the native `hidden`
  attribute on each one's wrapper instead of conditionally rendering one or
  the other. Do not go back to `showLocations ? <LocationsTab/> :
  <ProductsTab/>` — that was tried and reverted because it unmounted
  whichever tab wasn't active, resetting `ProductsTab`'s local search state
  and discarding any in-progress `LocationsTab`/`LocationModal` state
  (an open Add/Edit form, a typed name) on every tab switch. If you add a
  third tab or new per-tab local state, keep this "always mounted, hidden
  toggles visibility" pattern rather than reintroducing conditional
  mounting.
- **Two separate Redux keys**: `state.inventory.items` = paginated table data;
  `state.inventory.selectorItems` = full list for modal dropdowns. Never use
  `items` in Sales/Purchases modals — it is page-limited and will show only
  the first N products.
- `inventorySlice` is registered centrally in `src/store/store.ts` and hydrated
  in `src/store/StoreProvider.tsx` (and fetched in `dashboard/layout.tsx`) —
  those import it via the `@/app/dashboard/inventory/_store/inventorySlice`
  alias. If you rename the slice file, update those imports too.
- `hydrateProducts` is a legacy alias for `hydratePage` — `StoreProvider` calls
  it with `{ data, count, page, pageSize }` (not a bare array). If you see
  `hydrateProducts(array)`, that is the old signature and will break.
- `layout.tsx` issues **two** products queries in the `Promise.all`:
  1. Paginated (`select("*", { count: "exact" })` + `.range(...)`) → `productsPage` / `productsCount`
  2. Selector (`select("id, name, current_stock, sku")`, no `.range()`) → `productSelectors`
  Both are passed to `<StoreProvider products={...} productSelectors={...} />`.
- `current_stock` is **derived**, not directly editable from the UI — the
  Add/Edit modals deliberately don't expose it. Resist the urge to add a
  manual override field; if the user wants manual stock adjustments, that's a
  deliberate scope decision, not a quick addition (it would need to coexist
  with the trigger-driven math without double-counting).
- Deleting a product sets `product_id` to `null` on any purchases/sales that
  referenced it (the FK is `on delete set null`) — those records keep their
  history but stop affecting stock. `DeleteConfirmModal`'s description should
  keep mentioning this so users aren't surprised.
- Every create/update/delete must call `writeAuditLog` with
  `entityType: "product"` + `dispatch(addAuditLog(...))` — same compliance
  trail every other CRUD feature follows.
- `productOptions.ts` defines `SelectorProduct` (minimal interface). Both
  `Product` and `ProductSelector` satisfy it structurally, so helpers remain
  pure and testable without coupling to either full type.
- The inventory page search is name-only (`ilike`). There is no category
  filter — the `Product` type has no `category` field. Do not add a category
  filter without first adding the column to the DB and the type.
- **Low stock is NOT a database trigger** — there is no `notify_low_stock`
  function. It was deliberately removed before shipping: `sales` UPDATEs go
  through `apply_sale_stock_change`'s revert-then-reapply pattern, which
  transiently pushes `current_stock` back above `reorder_threshold` before
  reapplying the edit, so a stored crossing trigger double-fired on every
  edit to an unrelated field of a sale. Low stock is instead a **state**,
  evaluated on read: `synthesizeLowStock()` (`src/lib/utils/notifications.ts`)
  takes the full `products` list (fetched by `notificationsSlice` with
  `reorder_threshold is not null`, since PostgREST can't compare two columns
  in a filter) and computes `current_stock <= reorder_threshold` itself,
  producing synthetic `Notification`-shaped objects with **stable** ids
  prefixed `low-stock:${product.id}` (a colocated test asserts the same id
  comes back across repeated calls, so polling doesn't duplicate entries).
  Those ids are never written to `notification_reads` (its FK to
  `notifications.id` would reject them) and the feed must never be sorted by
  `created_at`, since — unlike the id — that field IS regenerated
  (`new Date().toISOString()`) on every call; sorting by it would churn
  low-stock items to the top of the feed on every 60s poll. If you change
  how/when `current_stock` is written, this is still correct as-is — it
  re-derives from whatever the trigger-driven arithmetic leaves behind.
- **`sales.cogs_amount` is trigger-owned.** `inv_sale_before_write` discards
  any client-supplied value; only `inv_set_cogs`/`inv_recompute_cogs` (which set
  the transaction-local GUC `inv.writing_cogs`) can write it. Never send it.
- **Rows created before `enabled_at` are outside the ledger — except a
  return flip.** Editing or deleting a pre-enable purchase/sale adjusts legacy
  `current_stock` only, so lot totals can drift from `current_stock` by exactly
  those edits. By design ("start clean"). The one exception is a pre-enable
  sale whose consumption rule flips (`inv_sale_after_write`, only when it has
  a product and its location — own, else platform default, else
  `default_location_id` — holds stock; the BEFORE trigger still does NOT fill
  the location on these rows):
  - into returned + restocked → the units come back as a new zero-cost
    `opening` lot (`received_at` 1970) at that location, settling any
    shortfall there; `cogs_amount` untouched. If the sale already has
    movements (from an earlier un-restock) those are reverted instead and COGS
    set to 0 — never both, or the units would be counted twice. That revert
    runs before the product/location checks, so it happens even if the
    platform default now points somewhere else (e.g. a dropship location).
  - out of it (restock undone) → FIFO consumes the units back (usually the
    zero-cost opening lot) and COGS is recomputed from those movements.
  A later DELETE reverts any such movements (the BEFORE DELETE revert has no
  `created_at` check).
- **Sales with no product are ignored by the ledger.** Whether the sale
  never had a product or its product was deleted (FK nulls `product_id`), a
  later edit does nothing to lots and keeps any booked `cogs_amount`.
- **Only stock-relevant sale edits re-run FIFO** (product, location, quantity,
  or the consumes/doesn't-consume result). A stock-relevant edit may land on
  different lots than before if other sales consumed in between, changing that
  order's COGS.
- **Dropship purchases + dropship-fulfilled sales cancel out** in legacy
  `current_stock` and never touch lots, so `current_stock` equals the lot total
  for tenants that only ever used the ledger.
- **`enable_advanced_inventory()` is service_role-only** because the plan lives
  in the control plane; the route guard is the enforcement point.
- **Deleting a product skips the purchase-lot drop, keeps sales' booked COGS,
  and skips the transfer restore.** `purchases.product_id` and
  `sales.product_id` are both `ON DELETE SET NULL`, which fires
  `inv_purchase_after_write`/`inv_sale_after_write` before the `stock_lots`
  product cascade; both triggers return early when the product row no longer
  exists, so the delete isn't blocked by `INV_CONSUMED`, a sale's
  `cogs_amount` isn't wiped by the revert-then-NULL path, and lots/movements
  cascade away with the product on their own. `inv_transfer_before_delete`
  has the same guard as its first statement, so a pending transfer on a
  deleted product returns `OLD` immediately instead of trying to restore
  units to lots that are about to cascade away.
- **Transfer deletes lock before they check.** `inv_transfer_before_delete`
  takes both (product, location) advisory locks, then checks the destination
  lots are untouched (`FOR UPDATE`), so a concurrent sale can't be cascaded
  away.
- **No bulk sale deletes while advanced inventory is on.** The BEFORE DELETE
  revert can recompute a sibling sale's COGS; if that sibling is in the same
  multi-row DELETE, Postgres raises "tuple to be deleted was already
  modified". The app deletes one sale at a time.
- **`EnableAdvancedCard` has no local "success" state.** After a successful
  `POST /api/inventory/enable-advanced`, it dispatches
  `fetchAdvancedInventory()` and relies entirely on the reloaded
  `inventory_settings.advanced_enabled` flipping `advancedInventoryView`'s
  result from `"enable"` to `"active"` in `page.tsx` — that's what makes the
  card disappear (its own `open`/`enabling` state only controls the confirm
  modal, not whether the card itself renders). If you ever change
  `fetchAdvancedInventory` to skip refetching `inventory_settings`, this
  card will keep showing "Enable" after a successful enable.
- **`EnableAdvancedCard.handleEnable` deliberately has two separate
  try/catches, not one wrapping everything (fix round 1, 2026-09-26).** The
  outer one only covers the `fetch` + JSON parse + `!res.ok` check, and is
  the only place that shows the "Could not enable batches & locations"
  toast. Once the route returns 200, the switch is already flipped
  server-side, so nothing after that point may report a failure: the audit
  write runs in its own try/catch that silently swallows errors (it's
  best-effort — `writeAuditLog` already returns `null` on its own DB
  errors), and `fetchAdvancedInventory()`/`setConfirmOpen(false)`/the
  success toast always run unconditionally after it. Don't merge these back
  into one try/catch — a network blip on `auth.getUser()` after a
  successful enable must not make the user think the enable failed, leave
  the modal open, or skip the state refresh that flips `page.tsx`'s view to
  `"active"`.
- **`LocationModal.handleSubmit` wraps the whole body in try/catch/finally
  (fix round 1, 2026-09-26)**, not just the DB-error branch. A *thrown* error
  (network failure, `createTenantClient`/`auth.getUser` rejecting) is
  different from a *returned* `dbError` — without the wrapper it left
  `saving` stuck `true`, which disables Cancel and gates `onClose` (Escape/
  backdrop check `!saving`), stranding the user in the modal with no way out.
  `finally { setSaving(false) }` is the only place `saving` is reset now — do
  not add back a `setSaving(false)` before an early `return`. The audit write
  after a successful save is in its own inner try/catch that swallows errors
  (mirrors `EnableAdvancedCard`, commit a826115) — a failure there must not
  turn an already-saved location into an error toast.
- **`DeleteConfirmModal.handleConfirm` only resets its own `deleting`/`reason`
  state on the line *after* `await onConfirm(reason)` returns** (Task 6,
  2026-09-26) — it does not wrap that await in try/catch itself. So if the
  `onConfirm` handler you pass in ever lets a rejection escape,
  `DeleteConfirmModal` gets stuck showing "Deleting…" forever with Cancel
  disabled, and there is no way out short of a page refresh. Any
  `onConfirm` passed to this shared modal (see `LocationsTab.handleDelete`)
  must therefore catch everything itself and resolve normally — never
  `throw`/reject — even on failure, so the shared modal's own cleanup runs.
  On failure, leave the caller-owned target state (e.g. `deleteTarget`) set
  so the modal (whose `open` prop is driven by that state) stays open for
  retry — `DeleteConfirmModal` still clears the typed reason text on every
  settle, success or failure, which is existing shared behavior, not
  something this feature works around.
- **`FulfillmentDefaultsCard` (Task 7, 2026-09-26) writes through two
  different paths in one submit** — `set_default_location` RPC for the
  tenant default, a plain `.upsert(..., { onConflict: "platform" })` on
  `platform_location_defaults` for the per-platform rows — and only when
  each actually changed (`platformDefaultChanges` diffs against the store,
  not against the initial draft, so a value changed then changed back is
  correctly seen as "no change"). The whole submit body is one
  try/catch/finally: a *thrown* error (network/auth) shows the generic
  "Please check your connection and try again." and `finally` always resets
  `saving`; a *returned* Supabase/RPC `error` shows
  `inventoryErrorMessage(error, …)` instead. **Partial-success honesty**: if
  the RPC succeeds (dispatches `settingsSet` immediately) but the platform
  upsert then fails, the toast title/copy switches to "Platform defaults not
  saved" / "The default location was saved, but the platform defaults could
  not be saved." — the store is never rolled back to match a misleading
  all-or-nothing failure toast, because the RPC's effect was already
  dispatched and is genuinely saved. The post-success audit write
  (`entityType: "inventory_settings"`, `metadata.event:
  "fulfillment_defaults_changed"`) is in its own inner try/catch that
  swallows errors, same pattern as every other mutation in this folder — see
  `EnableAdvancedCard`'s entry above for why.
- **`Row` (`components/ui/FormFields.tsx`) is just a 2-column CSS grid, not a
  2-child-only layout primitive** — `grid grid-cols-1 sm:grid-cols-2 gap-4`
  wraps any number of children, so `FulfillmentDefaultsCard` uses it directly
  for all 5 platform `Field`s (the last one sits alone on its own row) rather
  than hand-rolling a separate grid div.
