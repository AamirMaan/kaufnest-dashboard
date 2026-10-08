# Inventory feature

Route: `/dashboard/inventory`. Lists tracked products (name, SKU, current
stock, reorder threshold), with add/edit/delete and name search. Server-side
pagination is active.

## Files in this folder

- `page.tsx` (Phase 2 shell, 2026-09-26; loading moved to
  `useAdvancedInventory()` Task 2, 2026-09-26; Transfers tab wired in Phase 4
  Task 4, 2026-09-26) — thin shell only:
  `<PageHeader>` + "+ Add Product"/"+ Add Location"/"+ Transfer Stock" button
  state (whichever the active tab owns), the advanced-inventory
  `upsell`/`loading`/`error` banners driven entirely by `const advanced =
  useAdvancedInventory()` (`_store/useAdvancedInventory.ts`) — `page.tsx` no
  longer selects `plan`/`state.advancedInventory` or computes `view`/
  dispatches the fetch itself; it just reads `advanced.view`/`advanced.error`
  and wires the error banner's Retry button to `advanced.reload`. Also
  computes `isAdmin` from `state.currentUser.profile?.role`
  (`admin`/`super_admin`) and renders `<EnableAdvancedCard isAdmin={isAdmin}
  />` when `view === "enable"` (Task 4) — enabling advanced inventory itself
  stays role-gated, it isn't one of the grid actions below. **Section
  gating (Task 5, 2026-09-30; transfers raised to `>= 3` in fix round 1,
  2026-09-30 — stock transfers are admin-only, same bar as locations, a
  user ruling):** `const { can } = useAccess()` backs
  `canManageProducts = can("inventory", 2)` ("+ Add Product"),
  `canManageTransfers = can("inventory", 3)` ("+ Transfer Stock", passed
  as `TransfersTab`'s `canManage` prop), and `canManageLocations =
  can("inventory", 3)` ("+ Add Location" and `platform_location_defaults`
  writes, passed as `LocationsTab`'s `canManage` prop — RLS requires
  `inventory >= 3` for `stock_locations`/`platform_location_defaults` AND
  `stock_transfers` writes, migration `055_section_permissions.sql` —
  `055` must be re-applied per tenant for the transfers change, see
  `supabase/SKILL.md`'s row). **When `view === "active"` (Task 6,
  2026-09-26; three tabs as of Task 4, Phase 4)** it renders
  `<InventoryTabs>` (Products/Locations/Transfers) above the active panels;
  `tab` state (`InventoryTabId`) plus `showLocations = view === "active" &&
  tab === "locations"` / `showTransfers = view === "active" && tab ===
  "transfers"` decide which "+ Add …"/"+ Transfer Stock" button
  `PageHeader`'s `action` shows (Locations' Add button and Transfers'
  Transfer Stock button are both hidden entirely for a user below the
  relevant access level, matching `LocationsTab`/`TransfersTab`'s own
  read-only row-actions gate). **All
  three of `<ProductsTab>`, `<LocationsTab>` and `<TransfersTab>` stay
  mounted at all times once `view === "active"`** (fix round 1, 2026-09-26;
  extended to Transfers in Task 4) — only their visibility toggles via the
  native `hidden` attribute (`ProductsTab`'s wrapper div gets `hidden={view
  === "active" && tab !== "products"}`; `LocationsTab`/`TransfersTab` each
  take their own `hidden` prop, applied to their root `tabpanel` div,
  `hidden={tab !== "locations"}` / `hidden={tab !== "transfers"}`).
  Unmounting the inactive tab on every switch was tried first and reverted:
  it reset `ProductsTab`'s local search state and threw away any in-progress
  `LocationsTab`/`LocationModal` state every time the user switched tabs.
  Any other view (`upsell`/`loading`/`error`/`enable`) renders `ProductsTab`
  visible with no `role`/`aria-labelledby` (not a real tabpanel yet) and
  `LocationsTab`/`TransfersTab` aren't rendered at all — `InventoryTabs`,
  `LocationsTab` and `TransfersTab` only ever appear once advanced inventory
  is actually active. No table/search code lives in `page.tsx` — see
  `_components/ProductsTab.tsx` for products, `_components/LocationsTab.tsx`
  for locations, `_components/TransfersTab.tsx` for transfer history.
  **`stockVersion` (Task 4, Phase 4)**: `page.tsx` owns a `stockVersion`
  counter, bumped (`bumpStock`) by `TransfersTab`'s `onStockChanged` after a
  transfer is recorded or deleted, and passed as a prop to both
  `<ProductsTab stockVersion={stockVersion}>` and `<LocationsTab
  stockVersion={stockVersion}>` so their per-location stock caches
  (`ProductsTab`'s `stockRequestKey`, `LocationsTab`'s `onHandKey`) include
  it and re-fetch without a page reload — a transfer moves stock between
  locations, which neither tab's own request key would otherwise notice.
  Modals in all three tabs are portals (`Modal.tsx`), but this is safe with
  all tabs mounted: a modal can only be opened via its own tab's header
  button or an in-panel row action, both of which are covered by the other
  tabs' `hidden` panels (unreachable, not just visually hidden), and any
  already-open modal's backdrop blocks mouse clicks on the tab strip
  underneath it, so a mouse user can't reach a hidden tab's modal that way.
  `Modal.tsx` has no focus trap, though, so keyboard Tab from the header's
  action button can still reach the tab strip and switch tabs while a modal
  is open — since modals render through a portal, the modal itself stays
  open and visible, on top of the now-hidden panel underneath it. Known
  minor/cosmetic gap, not a functional bug; no extra open-state reset was
  added for this.
- `_lib/advancedInventory.ts` (+ test) — pure logic behind the batches &
  locations UI: `advancedInventoryView` (upsell/loading/error/enable/active),
  `sortLocations`/`defaultLocationOptions`/`platformLocationOptions`,
  `isLocationNameTaken`, `locationDeactivationBlocker`,
  `isTrackedByLedger(createdAt, settings)` (does the ledger act on UPDATEs of
  a row created then? — used by both Edit modals), and the fulfillment-
  defaults draft helpers (`fulfillmentDraftFrom`, `platformDefaultChanges`,
  `isFulfillmentDraftValid`, `isFulfillmentDraftDirty`), plus the
  `LOCATION_TYPE_LABELS`/`INVENTORY_PLATFORMS`/`PLATFORM_LABELS` label maps.
- `_store/advancedInventorySlice.ts` (+ test) — `state.advancedInventory`
  (`settings`, `locations`, `platformDefaults`, `loaded`/`loading`/`error`,
  `loadedAt: number | null`). `fetchAdvancedInventory(arg?: { force?:
  boolean })` is the only thunk (loads all three via `Promise.all`;
  locations are paged through `fetchAllRowsOrThrow` — since they're
  user-created and unbounded, an error-reporting page fetch that throws
  instead of returning an empty/partial list, unlike the plain
  `fetchAllRows` other features use). An RTK `condition` skips the thunk
  while a load is already in flight, or while the existing `loadedAt` is
  still fresh (`isAdvancedInventoryFresh`, within `ADVANCED_INVENTORY_STALE_MS`
  = 60s) — pass `{ force: true }` to bypass freshness after a write that
  changes settings/locations outside this slice's own reducers (e.g. the
  enable route). A rejected reload leaves `loaded`/`settings`/`locations`/
  `platformDefaults` untouched, only `loading`/`error` change — so a stale
  view keeps rendering through a failed background refresh.
  `locationSaved`/`locationRemoved`/`settingsSet`/`platformDefaultsMerged`
  are plain reducers, dispatched by the components below once their own
  write succeeds. Loaded via `_store/useAdvancedInventory.ts` (see below) —
  not by `dashboard/layout.tsx` — see `SKILL.md`'s gotcha on why it isn't
  layout-hydrated.
- `_store/useAdvancedInventory.ts` (Task 2, 2026-09-26) — the one entry
  point for advanced-inventory state outside the slice itself:
  `useAdvancedInventory(): { entitled, active, view, settings, locations,
  platformDefaults, loading, error, reload }`. Reads `tenantPlan` +
  `state.advancedInventory`, computes `entitled` (`hasAdvancedInventory`)
  and `view` (`advancedInventoryView`) itself, dispatches
  `fetchAdvancedInventory()` on mount when entitled (a no-op while fresh —
  the thunk's own `condition` decides that, not this hook), and exposes
  `reload` as `fetchAdvancedInventory({ force: true })`. `page.tsx` calls
  this instead of computing `plan`/`view`/the fetch effect itself;
  Purchases/Sales (Phase 3) will call the same hook rather than duplicating
  the load.
- `_components/EnableAdvancedCard.tsx` (Task 4, 2026-09-26) — the "Batches &
  locations" card shown when `advancedInventoryView` returns `"enable"`
  (entitled tenant, `inventory_settings.advanced_enabled` still false).
  Admins see an "Enable" button; non-admins see the same card with "Ask an
  admin to turn it on." instead. Enable opens a one-way confirm `Modal`
  (explicitly states "This can't be turned off again."); confirming calls
  `POST /api/inventory/enable-advanced`, writes an `inventory_settings`
  audit log entry (`writeAuditLog` + `addAuditLog`) on success, then
  dispatches `fetchAdvancedInventory({ force: true })` (Task 2, 2026-09-26 —
  `force` is required here since the page's own load may still be inside
  `ADVANCED_INVENTORY_STALE_MS` and would otherwise no-op) to reload
  settings/locations so `page.tsx`'s `view` flips to `"active"` and the card
  unmounts itself —
  there is no local "enabled" state here, the view transition is entirely
  driven by the reloaded Redux state. Toasts on both outcomes
  (`useToast()`), busy-verb button while `enabling`, disabled Cancel/Enable
  and non-dismissable modal while the request is in flight.
- `_components/ProductsTab.tsx` — the actual list view, moved out of
  `page.tsx` unchanged: name search (`ilike` filter), `<Pagination>`,
  loading overlay, `(this page)` count label, row actions, wires up
  `AddProductModal`/`EditProductModal` and the shared `DeleteConfirmModal`.
  Takes `{ addOpen, onAddClose, stockVersion? }` — the "+ Add Product" button
  and its open state live in `page.tsx` (the header), this component only
  owns the modal. **Row actions gated by `useAccess()` (Task 5):** Edit icon
  needs `can("inventory", 2)`, Delete icon needs `can("inventory", 3)` —
  replaced the previous `isSuperAdmin`-only delete gate; `canManage =
  can("inventory", 3)` gates `ProductLotsModal`'s opening-lot-cost edit
  (final review 2026-10-01 — `set_opening_lot_cost` now checks
  `current_user_access('inventory') >= 3`, no longer the admin role).
  `stockVersion` (Phase 4 Task 4, 2026-09-26) is bumped by
  `page.tsx` after a transfer moves stock between locations, and is folded
  into `stockRequestKey` (below) so the per-location columns re-fetch.
  **(Phase 3 Task 7, 2026-09-26)** When `useAdvancedInventory().active` is
  true, the "Current Stock" column is replaced with one column per
  `stockColumns(advanced.locations)` entry (first 4 active, stock-holding
  locations by name, plus "Other" when more exist), then "Total", then
  "Avg. cost" — Starter/Pro tenants and Business tenants that haven't
  enabled advanced inventory see byte-for-byte the old single "Current
  Stock" column. **Per-page RPC call, not per-product**: an effect keyed by
  `${advanced.active}:${pageIds}` (`pageIds` = the current page's product
  ids joined with `,`) calls `fetchStockByLocation(pageIds.split(","))`
  (`_store/stockByLocation.ts`) once per table page/search/pagination
  change, then pivots the result via `summarizeStock(rows, columnsForStock)`
  (`_lib/stockByLocation.ts`) into `Record<productId, ProductStockSummary>`.
  While the request is pending or failed, every stock cell, Total and
  Avg. cost render a muted "—" (sorting as `-Infinity`), never a made-up 0
  (final-review I1); `stockRefresh` (bumped by `ProductLotsModal`'s
  `onChanged` after an opening-cost save) is part of the request key, so
  Avg. cost re-fetches (F7).
  A load failure renders the mapped `inventoryErrorMessage` text as a small
  red line under the count row (`stockError`) — this is the designed
  generic-error fallback (RPC/network failure, RLS denial, etc.), not an
  error state to "fix". The Status badge is unaffected —
  it still reads legacy `current_stock`/`reorder_threshold`, so it can
  disagree with the new Total column (see SKILL.md gotcha). **(Phase 3 Task
  8, 2026-09-26)** When `advanced.active`, the Product name cell becomes a
  button (`aria-label="Show batches for <name>"`) that opens
  `<ProductLotsModal>` (`_components/ProductLotsModal.tsx`) via
  `lotsProduct` state; non-active views keep the plain name span
  unchanged. `canManage` (`can("inventory", 3)`, `useAccess()`) is passed
  straight through as a prop.
- `_components/ProductLotsModal.tsx` (Phase 3 Task 8, 2026-09-26) —
  `ProductLotsModal({ product, canManage, onClose, onChanged? })`: shows one
  product's open batches (stock lots with `qty_remaining !== 0`) plus every
  opening-balance batch even when used up (final-review I4), oldest-first, via
  `fetchOpenLots` (`_store/productLots.ts`) + `sortLotsFifo` (`_lib/productLots.ts`).
  Columns: Batch (`lotSourceLabel`), Location (name from
  `useAdvancedInventory().locations`), Received (`lotReceivedLabel` — hides
  the 1970 FIFO placeholder date on opening batches), Remaining (a red
  `Badge` for a negative shortfall row, plain tabular text otherwise), Unit
  cost (a pencil `Button` next to it only when `canEditLotCost(lot,
  canManage)` — Inventory ≥ 3 AND `kind === "opening"`). The pencil opens an inline
  `<form id="opening-cost-form">` in the modal body; the footer's Save
  button is `type="submit" form="opening-cost-form"`, disabled while
  `saving` or the parsed cost is invalid, calling the `set_opening_lot_cost`
  RPC (Phase 1) then a best-effort audit log
  (`entityType: "product"`, `metadata.event: "opening_cost_changed"`) and a
  reload of the lot list. Load result and edit target are both **derived**
  rather than reset with a synchronous `setState` in an effect — see the
  file's own doc comment and the SKILL.md gotcha below.
- `_lib/productLots.ts` (+ test, Phase 3 Task 8, 2026-09-26) — pure helpers
  behind the modal: `lotSourceLabel`, `lotReceivedLabel`, `sortLotsFifo`
  (received_at → created_at → id, mirrors the ledger's own FIFO order),
  `canEditLotCost(lot, canManage)` (mirrors the `set_opening_lot_cost` RPC's
  own Inventory ≥ 3 + opening-only guard), `parseUnitCostInput` (trims, rejects
  blank/negative/non-numeric, rounds to 4 decimals).
- `_store/productLots.ts` (Phase 3 Task 8, 2026-09-26; Phase 4 Task 1 fetcher, 2026-09-26) — `PRODUCT_LOTS_CAP`
  (1000) + `fetchOpenLots(productId)`: pages `stock_lots` for one product
  (`qty_remaining <> 0` OR `kind = 'opening'`) via `fetchAllRowsOrThrow`, mapping any thrown/DB
  error through `inventoryErrorMessage`. Phase 4 adds `fetchAvailableLots(productId, locationId)`:
  pages non-shortfall lots with units left at a location in FIFO order, feeds `fifoPreview`.
- `_lib/transfers.ts` (+ test, Phase 4 Task 1, 2026-09-26) — pure transfer preview,
  validation and payload logic: `transferCostAddon(cost, qty)`, `fifoPreview(lots, qty, cost)`,
  `transferLocationOptions(locations)`, `emptyTransferDraft(defaultLocationId, today)`,
  `parseTransferQuantity`, `parseTransferCost`, `transferDraftError(draft, locations, available)`,
  `transferInsertPayload(draft, userId)`.
  Mirrors `inv_transfer_after_insert` (047) FIFO order, shortfall exclusion, and cost add-on formula.
- `_store/transfersSlice.ts` (+ test, Phase 4 Task 2, 2026-09-26) — Redux slice for
  `state.stockTransfers` (paginated `stock_transfers` history). State:
  `{ items: StockTransferRow[], page, pageSize, total, loaded, isFetching, error }`.
  `StockTransferRow` extends `StockTransfer` with `product_name: string | null` (embedded via
  `products(name)` FK). `fetchTransfersPage({ page, pageSize })` pages newest-first via
  `.order("date", { ascending: false }).order("created_at", { ascending: false })`.
- `_components/TransferStockModal.tsx` (Phase 4 Task 3, 2026-09-26) —
  `TransferStockModal({ open, onClose, onSaved })`: product + source location
  pickers drive `fetchAvailableLots` (`_store/productLots.ts`) keyed by
  `"<productId>:<fromLocationId>"` (same keyed-result, derived-at-render
  pattern as `ProductLotsModal.tsx` — never a synchronous effect-body reset);
  the fetched lots feed `fifoPreview` (`_lib/transfers.ts`) to render the live
  "Batches that will move" table (units taken per batch, source vs.
  destination unit cost, available total) as the product/location/quantity/
  cost fields change. Submitting inserts into `stock_transfers`
  (`transferInsertPayload`), writes a best-effort audit log
  (`entityType: "stock_transfer"`, `action: "create"`), toasts, then calls
  `onSaved()` and closes. **(Phase 4 Task 4, 2026-09-26)** Mounted by
  `_components/TransfersTab.tsx`, which renders it only while `addOpen` is
  true (`{canManage && addOpen && <TransferStockModal open onClose={onAddClose}
  onSaved={handleSaved} />}`) instead of always-mounted-with-a-remount-key —
  see `TransfersTab.tsx`'s own entry below for why.
- `_components/InventoryTabs.tsx` — accessible tab strip
  (`role="tablist"`/`role="tab"`, `InventoryTabId = "products" | "locations" |
  "transfers"` as of Phase 4 Task 4). Built in Phase 2 Task 3; wired into
  `page.tsx` in Task 6, rendered only when `view === "active"`.
- `_components/LocationsTab.tsx` (Phase 2 Task 6, 2026-09-26) —
  `LocationsTab({ canManage, addOpen, onAddClose, hidden, stockVersion? })`:
  the Locations list. `hidden` (fix round 1, 2026-09-26) is applied to the
  component's own root `tabpanel` div so `page.tsx` can keep this component
  mounted while another tab is showing — see `page.tsx`'s entry above for
  why. `stockVersion` (Phase 4 Task 4, 2026-09-26) is bumped by `page.tsx`
  after a transfer and folded into `onHandKey` (below) so "On hand" re-fetches.
  `DataTable` columns are Location (name + a "Default" `Badge` when
  `settings.default_location_id === l.id`, sortable), Type
  (`LOCATION_TYPE_LABELS`, sortable), Status (Active/Inactive `Badge`), and
  — admin only — Actions (edit/deactivate-reactivate/delete icon buttons via
  `Button size="icon"`). Rows come from `sortLocations(locations)`
  (`_lib/advancedInventory.ts`, active-first then alphabetical). Renders
  `<LocationModal>` for both add and edit (same `key={editTarget?.id ??
  (addOpen ? "new-location" : "closed")}` remount rule as its own docs) and
  the shared `<DeleteConfirmModal>` for delete. `handleToggleActive` first
  checks `locationDeactivationBlocker` (blocks deactivating the current
  default with a warning toast, no network call) before writing
  `is_active`. Both `handleToggleActive` and `handleDelete` wrap their
  Supabase call in try/catch/finally: a *thrown* error (network/auth
  failure) shows "Please check your connection and try again." and — for
  toggle — always clears `togglingId` via `finally`; a *returned* `error`
  shows `inventoryErrorMessage(error, …)` instead (this is how
  `INV_LOCATION_IN_USE`/`INV_DEFAULT_LOCATION` surface as the "in use" /
  "default location" copy from the DB triggers). The post-success
  `audit(...)` call (writes an `stock_location` audit log entry) is wrapped
  in its own inner try/catch that silently swallows errors — an audit
  failure must never turn an already-successful update/delete into a
  failure toast or skip the success toast/state update, matching
  `LocationModal`'s and `EnableAdvancedCard`'s existing pattern. On delete
  failure, `deleteTarget` is deliberately left set so `DeleteConfirmModal`
  stays open for retry/cancel — `DeleteConfirmModal` clears its own internal
  `deleting` busy state (and the typed reason) once the awaited `onConfirm`
  promise settles either way, so `handleDelete` must never let that promise
  reject or `deleting` gets stuck `true` forever. **(Task 7, 2026-09-26)**
  Also renders `<FulfillmentDefaultsCard key={defaultsKey} canManage={canManage}
  />` after the `<DataTable>` — `defaultsKey` is built from
  `settings.default_location_id`, `locations` (id + active flag), and
  `platformDefaults` (sorted by platform) so the card remounts, and its
  internal draft resets to the saved values, whenever any of those change
  elsewhere (a location edited/deactivated, a reload). **(Task 9,
  2026-09-26)** An "On hand" column sits between Type and Status:
  `fetchLocationStockTotals()` (`_store/stockByLocation.ts`) is called from
  an effect keyed by `onHandKey = \`${locationsKey}|${stockVersion ?? 0}\``
  (Phase 4 Task 4, 2026-09-26 — folds in the `stockVersion` prop, on top of
  the locations-list snapshot `locationsKey = locations.map((l) =>
  l.id).join(",")`, so a transfer's stock move re-fetches this column too);
  the result is stored as `{ key, data }` and only read at render when
  `key === onHandKey` (the same derived-not-reset pattern as
  `ProductsTab.tsx`'s stock effect and `FulfillmentLocationField.tsx`, to
  satisfy `react-hooks/set-state-in-effect`). A dropship location always
  renders "—" (it never holds stock); any other location renders "—" while
  `data` is still `null` — both the initial load and a failed RPC call (the
  generic-error fallback, same as `ProductsTab.tsx`'s `stockError`) — and
  the numeric total, styled with the danger-text color when negative, once
  loaded. The column is sortable (`onHand?.[l.id] ?? 0`, matching the
  render's fallback).
- `_components/TransfersTab.tsx` (Phase 4 Task 4, 2026-09-26) —
  `TransfersTab({ canManage, addOpen, onAddClose, hidden, onStockChanged })`:
  the transfer history list. `state.stockTransfers` (`fetchTransfersPage`)
  hydrates on first mount (`if (!loaded) dispatch(...)`); the `<DataTable>`
  shows Date (`formatDate`), Product (`product_name ?? "Deleted product"`),
  Route (from → to location names, an `ArrowRight` icon with `aria-hidden`
  plus a `<span className="sr-only">to</span>` rather than an `aria-label`
  on the icon itself), Units, Transfer cost, Note, and — admin only — a
  delete icon. There is no edit UI — transfers are immutable
  (`INV_TRANSFER_IMMUTABLE`); a delete undoes a transfer only while its
  destination batches are still untouched, otherwise the DB trigger raises
  `INV_CONSUMED`, shown via `inventoryErrorMessage(deleteError, "Could not
  delete the transfer.")`. Delete goes through the shared
  `<DeleteConfirmModal>` (`.select("id")` so an RLS no-op reads as a
  failure, matching `LocationsTab`'s pattern) and, on success, re-pages to
  `pageAfterRemoval(page, pageSize, total)` (`@/lib/utils/pagedQuery`) so the last
  page never ends up empty. Both a successful transfer (`onSaved`, wired
  from `<TransferStockModal onSaved={handleSaved}>`) and a successful delete
  call `onStockChanged()` — `page.tsx` wires this to `bumpStock`, which
  increments `stockVersion` so `ProductsTab`/`LocationsTab`'s own stock
  caches refetch. **Mounts `<TransferStockModal>` only while `addOpen` is
  true** (`{canManage && addOpen && <TransferStockModal open
  onClose={onAddClose} onSaved={handleSaved} />}`), not
  always-mounted-behind-a-remount-key — see the SKILL.md gotcha for why (the
  modal's draft is seeded once per mount, so mounting it while closed would
  let the default source location/today's date go stale).
- `_components/FulfillmentDefaultsCard.tsx` (Phase 2 Task 7, 2026-09-26) —
  `FulfillmentDefaultsCard({ canManage })`: the tenant's default location plus
  a default fulfillment location per sales platform (`INVENTORY_PLATFORMS` —
  amazon/ebay/etsy/shopify/other). Local draft state seeded via
  `fulfillmentDraftFrom(settings, platformDefaults)`; validity via
  `isFulfillmentDraftValid`, dirty-check via `isFulfillmentDraftDirty` (both
  `_lib/advancedInventory.ts`). Submitting calls the `set_default_location`
  RPC (only if the default location changed) then upserts
  `platform_location_defaults` for whichever platforms changed
  (`platformDefaultChanges`). The two writes' `settingsSet`/
  `platformDefaultsMerged` dispatches are deferred until both writes (and
  the audit log) have settled — the card records what actually saved and
  fires them once, right before the success toast, so the `defaultsKey`
  remount happens after the save is done, not mid-submit. On an
  RPC-ok/upsert-fail partial success it dispatches only `settingsSet`, since
  that write already committed. Writes one `inventory_settings` audit log
  entry (`metadata.event: "fulfillment_defaults_changed"`) on overall
  success. Non-admins see the same form with every `Select` disabled and no
  Save button. See `SKILL.md`'s gotcha for the full two-write
  partial-success handling.
- `_components/AdvancedInventoryUpsellCard.tsx` — Business-plan upsell card
  shown by `page.tsx` when `advancedInventoryView` returns `"upsell"`; pure
  presentational, links to `/dashboard/settings`.
- `_store/inventorySlice.ts` — Redux slice for `state.inventory`.
  **Two data sets:**
  - Table data: `items`, `loaded`, `page`, `pageSize`, `total`, `isFetching` —
    paginated, first page hydrated on layout load, subsequent pages via
    `fetchInventoryPage({ page, pageSize, search? })`.
  - Selector data: `selectorItems`, `selectorsLoaded` — lightweight
    `{ id, name, current_stock, sku }` list, ALL products, never paged.
    Populated by `fetchInventorySelectors()` thunk (no `.range()`).
    Mutations (`addProduct`/`updateProduct`/`removeProduct`) keep both sets in sync.
  Actions: `hydratePage` (exported as `hydrateProducts` for `StoreProvider`),
  `hydrateSelectors`, `addProduct`, `updateProduct`, `removeProduct`, `setFetching`.
  Exported type: `ProductSelector`.
- `_store/inventorySlice.test.ts` — reducer tests covering pagination state,
  selector state, all mutations, and fetchInventoryPage/fetchInventorySelectors
  async cases. Run with `npx jest dashboard/inventory`.
- `_components/AddProductModal.tsx` / `EditProductModal.tsx` — create/edit forms.
- `_components/LocationModal.tsx` (Phase 2 Task 5, 2026-09-26) — add/edit
  `stock_locations` modal. `LocationModal({ open, location, locations,
  onClose })` — `location: StockLocation | null` (null = add); the call site
  (`LocationsTab.tsx`) renders it with
  `key={editTarget?.id ?? (addOpen ? "new-location" : "closed")}` so its
  `name`/`type` state resets per target instead of reusing stale state
  across different rows. Validates
  name non-empty + not already taken (`isLocationNameTaken`, mirrors the DB's
  unique index on `lower(name)` — a `23505` write-time race still shows the
  same message). On success dispatches `locationSaved` and writes an audit
  log (`entityType: "stock_location"`, before/after diff on edit). Wired into
  `_components/LocationsTab.tsx` (Task 6, 2026-09-26) for both add and edit.
- `_lib/landedCost.ts` (+ test) — TS mirror of the SQL landed-unit-cost formula, for the purchase form read-out (Phase 3).
- `_lib/stockByLocation.ts` (+ test, Task 3 Phase 3 2026-09-26) — pure pivot logic: `stockColumns(locations)` shows the first `MAX_STOCK_COLUMNS` active stock-holding locations (alphabetical) plus "Other" when more exist; `summarizeStock(rows, columns)` groups `inventory_stock_by_location` RPC output by product and projects each location to its table column (shown + "Other" for the rest), summing qty/value per cell; `locationTotals(rows)` maps location id to qty for `inventory_stock_by_location_totals` RPC results. Exports types `StockByLocationRow`, `StockColumn`, `ProductStockSummary`, and constants `MAX_STOCK_COLUMNS`, `OTHER_COLUMN_ID`.
- `_store/stockByLocation.ts` (Task 3 Phase 3 2026-09-26) — `fetchStockByLocation(productIds)` pages product ids through the `inventory_stock_by_location` RPC in batches of `STOCK_RPC_MAX_IDS` (200), chunking to avoid the RPC's id-count limit; `fetchLocationStockTotals()` calls the `inventory_stock_by_location_totals` RPC and pivots to a map via `locationTotals()`.

## How stock levels actually update — read this before changing anything here

`current_stock` is **not** edited from this feature's UI. It's maintained by
DB triggers (`apply_purchase_stock_change`/`apply_sale_stock_change` in
`supabase/migrations/002_inventory_and_vat.sql`): every insert/update/delete on
`purchases`/`sales` that has a `product_id` adjusts the linked product's
`current_stock` automatically (purchases add, sales subtract). This folder only
manages the product *catalog* (name/SKU/reorder threshold) — the linkage itself
lives in the Purchases/Sales Add/Edit modals (`product_id` select), and the
arithmetic lives entirely in the database so client and server can never drift.
If you need to change how stock is calculated, edit the migration triggers, not
this slice.

## Advanced inventory ledger (Business plan) — all 4 phases shipped

Batches, locations and FIFO cost of goods live entirely in Postgres
(`supabase/migrations/047_advanced_inventory.sql`, installer
`install_advanced_inventory`). Inert until a tenant admin calls
`POST /api/inventory/enable-advanced` (`src/lib/inventory/authGuard.ts`,
Business/trial + admin only), which creates "Main", maps every platform to
it, and turns today's `current_stock` into one opening lot per product at
cost 0. From then on:

- purchases create **lots** at landed cost (`_lib/landedCost.ts` mirrors the
  SQL formula); sales consume lots **FIFO** at their `fulfillment_location_id`
  (default per platform) and get `sales.cogs_amount`; missing stock goes to a
  **shortfall** lot that the next receipt settles and re-costs;
- `stock_transfers` move lots between locations (immutable — no edit UI,
  `INV_TRANSFER_IMMUTABLE`; delete only while the destination batches are
  untouched, else `INV_CONSUMED`); dropship-type locations never hold stock;
- the legacy `current_stock` triggers keep running unchanged for every plan.

Tables: `stock_locations`, `inventory_settings`, `platform_location_defaults`,
`stock_lots`, `stock_transfers`, `stock_movements`. Client-writable: locations,
platform defaults (admin), transfers. Everything else is trigger/RPC-owned.
Trigger errors are `INV_*: detail` — show them with
`inventoryErrorMessage()` (`src/lib/inventory/inventoryErrors.ts`).
Phase 2 shipped the enable flow and the Locations tab. Phase 3 shipped
purchase location + landed costs, sale "Fulfilled from" with a shortage
warning, FIFO cost of goods on the order page, per-location stock columns on
the Products tab, on-hand units on the Locations tab, and the product
batches drawer — see the Purchases/Sales `CLAUDE.md`s for those details.
Phase 4 shipped the Transfers tab: transfer-stock modal with a live FIFO
preview, paginated transfer history, and delete-to-undo — see this file's
`TransfersTab.tsx`/`TransferStockModal.tsx` entries above and SKILL.md's
gotchas for the details.
Transfer creation and deletion in the UI are **admin-only** (the header's
"+ Transfer Stock" button and each row's delete icon are hidden for anyone
below `inventory >= 3`, who see read-only history). This used to be a
UI-only rule — RLS on `stock_transfers` originally allowed any tenant
member with `inventory >= 2` — but a user ruling (Task 5 review, fix round
1, 2026-09-30) raised the RLS bar to `inventory >= 3` to match, same as
`stock_locations`/`platform_location_defaults`; see `TransfersTab.tsx`'s
entry above and `supabase/SKILL.md`'s 055 row (re-apply needed per tenant).

## Pagination data flow

Server-side pagination is active. The flow for a search change or page navigation is:

1. User types in the search box or clicks Prev/Next in `<Pagination>`.
2. `_components/ProductsTab.tsx` dispatches `fetchInventoryPage({ page, pageSize, search })`.
3. The thunk builds a Supabase query with optional `.ilike("name", ...)` +
   `.select("*", { count: "exact" })` + `.range(from, to)`, then dispatches
   `hydratePage` on success.
4. `state.inventory.items` is replaced with the new page; `total` holds the
   full matching count; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydrateProducts` (alias for
   `hydratePage`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

## Split selector fetch (critical constraint)

Product-link dropdowns in **AddSaleModal, EditSaleModal, AddPurchaseModal,
EditPurchaseModal** must NOT be page-limited. They read from
`state.inventory.selectorItems` (the full list). The layout fetches this
separately via a lightweight query (`select("id, name, current_stock, sku")`,
no `.range()`). `StoreProvider` dispatches `hydrateSelectors(productSelectors)`.

`productOptions.ts` (in `src/app/dashboard/sales/_components/`) defines
`SelectorProduct` (the minimal interface both `Product` and `ProductSelector`
satisfy) so the helper functions remain pure and testable.

Mutations keep both sets in sync:
- `addProduct` — appends to `selectorItems` (sorted by name) + increments `total`.
- `updateProduct` — patches both `items` and `selectorItems`.
- `removeProduct` — filters both `items` and `selectorItems`, decrements `total`.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`await createTenantClient()` from `@/lib/supabase/client`, table `products`).
2. On success, dispatch the local slice action (`addProduct`/`updateProduct`/`removeProduct`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) with `entityType: "product"`, then
   dispatch `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it
   immediately in the shared audit log state.

`EditProductModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/{Modal,Button,FormFields,DataTable,Badge,Toast,Pagination}`
- `components/modals/DeleteConfirmModal` — shared with Sales, Expenses, Purchases
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `lib/utils/audit`
- `lib/utils/pagedQuery` — `rangeFor`, `DEFAULT_PAGE_SIZE`
- `types` (`Product`)
- `lib/inventory/{inventoryErrors,access,authGuard}` — advanced-inventory error copy, enable rule, route guard

## Tests

`npx jest dashboard/inventory` runs the slice and `_lib/landedCost` tests; SQL trigger tests: `supabase/tests/advanced_inventory.test.sql` (see `supabase/SKILL.md`).
