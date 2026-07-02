# Inventory feature

Route: `/dashboard/inventory`. Lists tracked products (name, SKU, current
stock, reorder threshold), with add/edit/delete and name search. Server-side
pagination is active.

## Files in this folder

- `page.tsx` — list view: name search (`ilike` filter), `<Pagination>`,
  loading overlay, `(this page)` count label, row actions, wires up the modals
  below and the shared `DeleteConfirmModal`.
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

## Tests

`npx jest dashboard/inventory` runs `_store/inventorySlice.test.ts`.
