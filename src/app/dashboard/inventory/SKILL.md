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
  `src/types/index.ts` for the `Product` type. Also check `page.tsx` if the
  field needs to render in the table. If the new field is needed in Sales/
  Purchases dropdowns, also add it to `ProductSelector` in `inventorySlice.ts`
  and update the selector query in `layout.tsx`.
- **Change how stock is calculated**: don't touch this folder — edit the
  trigger functions (`apply_purchase_stock_change`/`apply_sale_stock_change`)
  in `supabase/migrations/002_inventory_and_vat.sql`. Stock math lives in the
  database so the client never has to reconcile it.
- **Change which records can link to a product**: that UI lives in the
  Purchases/Sales `Add`/`Edit` modals (`product_id` `Select`), not here.
  Those modals now read from `s.inventory.selectorItems` (not `.items`).
- **Change list/table behavior or search**: `page.tsx` only.
- **Change reducer logic**: `_store/inventorySlice.ts` + its test.
- **Change pagination**: `_store/inventorySlice.ts` (`fetchInventoryPage` thunk),
  `page.tsx` (`<Pagination>` wiring), `src/app/dashboard/layout.tsx` (initial
  paginated fetch), `src/store/StoreProvider.tsx` (`hydrateProducts` call).
- **Change selector list fields**: `_store/inventorySlice.ts` (`ProductSelector`
  type + `fetchInventorySelectors` select clause), `layout.tsx` (selector
  query columns), `src/app/dashboard/sales/_components/productOptions.ts`
  (`SelectorProduct` interface).

## Test command

`npx jest dashboard/inventory`

## Gotchas

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
