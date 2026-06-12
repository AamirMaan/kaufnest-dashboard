# Inventory feature

Route: `/dashboard/inventory`. Lists tracked products (name, SKU, current
stock, reorder threshold), with add/edit/delete. Unlike Sales/Purchases, this
page has **no filtering or invoice generation** — it's a simpler list view.

## Files in this folder

- `page.tsx` — list view: `DataTable`, row actions, wires up the modals below
  and the shared `DeleteConfirmModal`.
- `_store/inventorySlice.ts` — Redux slice for `state.inventory` (`items`,
  `loaded`). Actions: `hydrateProducts`, `addProduct`, `updateProduct`,
  `removeProduct`. Used **only** by this feature — registered centrally in
  `src/store/store.ts` and hydrated in `src/store/StoreProvider.tsx`, but
  otherwise self-contained here.
- `_store/inventorySlice.test.ts` — reducer tests. Run with `npx jest dashboard/inventory`.
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

- `components/ui/{Modal,Button,FormFields,DataTable,Badge,Toast}`
- `components/modals/DeleteConfirmModal` — shared with Sales, Expenses, Purchases
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `lib/utils/audit`
- `types` (`Product`)

## Tests

`npx jest dashboard/inventory` runs `_store/inventorySlice.test.ts`.
