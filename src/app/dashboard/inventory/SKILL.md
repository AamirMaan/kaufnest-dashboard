---
name: inventory-feature
description: Work on the Inventory dashboard feature (product catalog, stock levels, reorder thresholds) at src/app/dashboard/inventory — use when the task mentions inventory, products, stock, SKUs, reorder thresholds, or the /dashboard/inventory route.
---

# Working on the Inventory feature

This feature is fully colocated under `src/app/dashboard/inventory/`. Read
`CLAUDE.md` in this folder first — especially the section on how
`current_stock` is maintained, since it's the one thing in this feature that
does **not** follow the usual client-writes-then-dispatches pattern.

## Minimal file set for common changes

- **Add/change a catalog field** (name, SKU, reorder threshold, etc.):
  `_components/AddProductModal.tsx` (create form),
  `_components/EditProductModal.tsx` (edit form + before/after audit diff),
  `_store/inventorySlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Product` type. Also check `page.tsx` if the
  field needs to render in the table.
- **Change how stock is calculated**: don't touch this folder — edit the
  trigger functions (`apply_purchase_stock_change`/`apply_sale_stock_change`)
  in `supabase/migrations/002_inventory_and_vat.sql`. Stock math lives in the
  database so the client never has to reconcile it.
- **Change which records can link to a product**: that UI lives in the
  Purchases/Sales `Add`/`Edit` modals (`product_id` `Select`), not here.
- **Change list/table behavior**: `page.tsx` only.
- **Change reducer logic**: `_store/inventorySlice.ts` + its test.

## Test command

`npx jest dashboard/inventory`

## Gotchas

- `inventorySlice` is registered centrally in `src/store/store.ts` and hydrated
  in `src/store/StoreProvider.tsx` (and fetched in `dashboard/layout.tsx`) —
  those import it via the `@/app/dashboard/inventory/_store/inventorySlice`
  alias. If you rename the slice file, update those imports too.
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
