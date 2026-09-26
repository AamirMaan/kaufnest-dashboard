# Inventory feature

Route: `/dashboard/inventory`. Lists tracked products (name, SKU, current
stock, reorder threshold), with add/edit/delete and name search. Server-side
pagination is active.

## Files in this folder

- `page.tsx` (Phase 2 shell, 2026-09-26) — thin shell only: `<PageHeader>` +
  "+ Add Product"/"+ Add Location" button state (whichever the active tab
  owns), the advanced-inventory `upsell`/`loading`/`error` banners driven by
  `advancedInventoryView(plan, advanced)` (`_lib/advancedInventory.ts`) and
  `fetchAdvancedInventory()` (`_store/advancedInventorySlice.ts`, dispatched
  on mount only when `hasAdvancedInventory(plan)` and not yet
  loaded/loading/errored). Also computes `isAdmin` from
  `state.currentUser.profile?.role` (`admin`/`super_admin`) and renders
  `<EnableAdvancedCard isAdmin={isAdmin} />` when `view === "enable"` (Task
  4). **When `view === "active"` (Task 6, 2026-09-26)** it renders
  `<InventoryTabs>` (Products/Locations) above the active panels; `tab`
  state (`InventoryTabId`) plus `showLocations = view === "active" && tab
  === "locations"` decide which "+ Add …" button `PageHeader`'s `action`
  shows (Locations' Add button is hidden entirely for non-admins, matching
  `LocationsTab`'s own read-only row-actions gate). **Both `<ProductsTab>`
  and `<LocationsTab>` stay mounted at all times once `view === "active"`**
  (fix round 1, 2026-09-26) — only their visibility toggles via the native
  `hidden` attribute (`ProductsTab`'s wrapper div gets `hidden={view ===
  "active" && tab !== "products"}`; `LocationsTab` takes its own `hidden`
  prop, applied to its root `tabpanel` div, `hidden={tab !== "locations"}`).
  Unmounting the inactive tab on every switch was tried first and reverted:
  it reset `ProductsTab`'s local search state and threw away any in-progress
  `LocationsTab`/`LocationModal` state every time the user switched tabs.
  Any other view (`upsell`/`loading`/`error`/`enable`) renders `ProductsTab`
  visible with no `role`/`aria-labelledby` (not a real tabpanel yet) and
  `LocationsTab` isn't rendered at all — `InventoryTabs` and `LocationsTab`
  only ever appear once advanced inventory is actually active. No
  table/search code lives in `page.tsx` — see `_components/ProductsTab.tsx`
  for products, `_components/LocationsTab.tsx` for locations. Modals in both
  tabs are portals (`Modal.tsx`), but this is safe with both tabs mounted:
  a modal can only be opened via its own tab's header button or an in-panel
  row action, both of which are covered by the other tab's `hidden` panel
  (unreachable, not just visually hidden), and any already-open modal's
  backdrop blocks mouse clicks on the tab strip underneath it, so a mouse
  user can't reach a hidden tab's modal that way. `Modal.tsx` has no focus
  trap, though, so keyboard Tab from the header's action button can still
  reach the tab strip and switch tabs while a modal is open — since modals
  render through a portal, the modal itself stays open and visible, on top
  of the now-hidden panel underneath it. Known minor/cosmetic gap, not a
  functional bug; no extra open-state reset was added for this.
- `_lib/advancedInventory.ts` (+ test) — pure logic behind the batches &
  locations UI: `advancedInventoryView` (upsell/loading/error/enable/active),
  `sortLocations`/`defaultLocationOptions`/`platformLocationOptions`,
  `isLocationNameTaken`, `locationDeactivationBlocker`, and the fulfillment-
  defaults draft helpers (`fulfillmentDraftFrom`, `platformDefaultChanges`,
  `isFulfillmentDraftValid`, `isFulfillmentDraftDirty`), plus the
  `LOCATION_TYPE_LABELS`/`INVENTORY_PLATFORMS`/`PLATFORM_LABELS` label maps.
- `_store/advancedInventorySlice.ts` (+ test) — `state.advancedInventory`
  (`settings`, `locations`, `platformDefaults`, `loaded`/`loading`/`error`).
  `fetchAdvancedInventory` is the only thunk (loads all three via
  `Promise.all`; locations are paged through `fetchAllRows` since they're
  user-created and unbounded). `locationSaved`/`locationRemoved`/
  `settingsSet`/`platformDefaultsMerged` are plain reducers, dispatched by
  the components below once their own write succeeds. Dispatched only by
  `page.tsx` — see `SKILL.md`'s gotcha on why it isn't layout-hydrated.
- `_components/EnableAdvancedCard.tsx` (Task 4, 2026-09-26) — the "Batches &
  locations" card shown when `advancedInventoryView` returns `"enable"`
  (entitled tenant, `inventory_settings.advanced_enabled` still false).
  Admins see an "Enable" button; non-admins see the same card with "Ask an
  admin to turn it on." instead. Enable opens a one-way confirm `Modal`
  (explicitly states "This can't be turned off again."); confirming calls
  `POST /api/inventory/enable-advanced`, writes an `inventory_settings`
  audit log entry (`writeAuditLog` + `addAuditLog`) on success, then
  dispatches `fetchAdvancedInventory()` to reload settings/locations so
  `page.tsx`'s `view` flips to `"active"` and the card unmounts itself —
  there is no local "enabled" state here, the view transition is entirely
  driven by the reloaded Redux state. Toasts on both outcomes
  (`useToast()`), busy-verb button while `enabling`, disabled Cancel/Enable
  and non-dismissable modal while the request is in flight.
- `_components/ProductsTab.tsx` — the actual list view, moved out of
  `page.tsx` unchanged: name search (`ilike` filter), `<Pagination>`,
  loading overlay, `(this page)` count label, row actions, wires up
  `AddProductModal`/`EditProductModal` and the shared `DeleteConfirmModal`.
  Takes `{ addOpen, onAddClose }` — the "+ Add Product" button and its open
  state live in `page.tsx` (the header), this component only owns the modal.
- `_components/InventoryTabs.tsx` — accessible tab strip
  (`role="tablist"`/`role="tab"`, `InventoryTabId = "products" | "locations"`).
  Built in Phase 2 Task 3; wired into `page.tsx` in Task 6, rendered only
  when `view === "active"`.
- `_components/LocationsTab.tsx` (Phase 2 Task 6, 2026-09-26) —
  `LocationsTab({ isAdmin, addOpen, onAddClose, hidden })`: the Locations
  list. `hidden` (fix round 1, 2026-09-26) is applied to the component's own
  root `tabpanel` div so `page.tsx` can keep this component mounted while
  the Products tab is showing — see `page.tsx`'s entry above for why.
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
  Also renders `<FulfillmentDefaultsCard key={defaultsKey} isAdmin={isAdmin}
  />` after the `<DataTable>` — `defaultsKey` is built from
  `settings.default_location_id`, `locations` (id + active flag), and
  `platformDefaults` (sorted by platform) so the card remounts, and its
  internal draft resets to the saved values, whenever any of those change
  elsewhere (a location edited/deactivated, a reload).
- `_components/FulfillmentDefaultsCard.tsx` (Phase 2 Task 7, 2026-09-26) —
  `FulfillmentDefaultsCard({ isAdmin })`: the tenant's default location plus
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

## Advanced inventory ledger (Business plan) — Phase 1 of 4

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
- `stock_transfers` move lots between locations (immutable; delete only while
  untouched); dropship-type locations never hold stock;
- the legacy `current_stock` triggers keep running unchanged for every plan.

Tables: `stock_locations`, `inventory_settings`, `platform_location_defaults`,
`stock_lots`, `stock_transfers`, `stock_movements`. Client-writable: locations,
platform defaults (admin), transfers. Everything else is trigger/RPC-owned.
Trigger errors are `INV_*: detail` — show them with
`inventoryErrorMessage()` (`src/lib/inventory/inventoryErrors.ts`).
Phase 2 (this UI) shows the enable flow and the Locations tab; batches on
purchases/sales (Phase 3) and transfers (Phase 4) come next.

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
