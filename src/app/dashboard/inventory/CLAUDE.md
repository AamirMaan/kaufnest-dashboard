# Inventory feature

Route: `/dashboard/inventory`. Lists tracked products (name, SKU, current
stock, reorder threshold), with add/edit/delete and name search. Server-side
pagination is active.

## Files in this folder

- `page.tsx` (Phase 2 shell, 2026-09-26) — thin shell only: `<PageHeader>` +
  "+ Add Product" button state, the advanced-inventory `upsell`/`loading`/
  `error` banners driven by `advancedInventoryView(plan, advanced)`
  (`_lib/advancedInventory.ts`) and `fetchAdvancedInventory()`
  (`_store/advancedInventorySlice.ts`, dispatched on mount only when
  `hasAdvancedInventory(plan)` and not yet loaded/loading/errored), and
  renders `<ProductsTab>` unconditionally below them. No table/search code
  lives here anymore — see `_components/ProductsTab.tsx`. The `enable` and
  `active` views both currently render the same plain products page (no
  half-built UI); the enable card (Task 4) and the `InventoryTabs` strip
  (Task 6, only once there's a Locations tab) are not wired in yet.
- `_components/ProductsTab.tsx` — the actual list view, moved out of
  `page.tsx` unchanged: name search (`ilike` filter), `<Pagination>`,
  loading overlay, `(this page)` count label, row actions, wires up
  `AddProductModal`/`EditProductModal` and the shared `DeleteConfirmModal`.
  Takes `{ addOpen, onAddClose }` — the "+ Add Product" button and its open
  state live in `page.tsx` (the header), this component only owns the modal.
- `_components/InventoryTabs.tsx` — accessible tab strip
  (`role="tablist"`/`role="tab"`, `InventoryTabId = "products" | "locations"`).
  Built in Phase 2 Task 3 but **not yet rendered by `page.tsx`** — wired in
  once the Locations tab exists (Task 6).
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
UI arrives in Phases 2–4 (see the spec's "Phasing").

## Pagination data flow

Server-side pagination is active. The flow for a search change or page navigation is:

1. User types in the search box or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchInventoryPage({ page, pageSize, search })`.
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
