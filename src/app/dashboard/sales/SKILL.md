---
name: sales-feature
description: Work on the Sales dashboard feature (list, add/edit/delete sales records, invoices) at src/app/dashboard/sales — use when the task mentions sales, sale records, or the /dashboard/sales route.
---

# Working on the Sales feature

This feature is fully colocated under `src/app/dashboard/sales/`. Read
`CLAUDE.md` in this folder first — it explains the file map and the
Supabase-write → slice-update → audit-log data flow every mutation follows.

## Minimal file set for common changes

- **Add/change a field on a sale**: `_components/AddSaleModal.tsx` (create form),
  `_components/EditSaleModal.tsx` (edit form + before/after audit diff),
  `_store/salesSlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Sale` type. Also check `page.tsx` if the field
  needs to render in the table or be filterable (`lib/utils/filters.ts`).
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change reducer logic**: `_store/salesSlice.ts` + its test.

## Test command

`npx jest dashboard/sales`

## Gotchas

- `salesSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` — those two files import it via the `@/app/dashboard/sales/_store/salesSlice`
  alias. If you rename the slice file, update those imports too.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Expenses and Purchases
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Sale.product_id` is optional and FK's to `products` (Inventory feature) —
  the modals just set it via a `Select`; a DB trigger keeps `current_stock` in
  sync. Never write to `products.current_stock` from here.
- The "Inventory Product" dropdown's filter/auto-fill logic lives in the
  colocated `productOptions.ts` (`selectableProducts`, `productNameFor`) —
  pure functions, unit-tested in `productOptions.test.ts`. Edit *that* file if
  the selection rules change, not the inline JSX in the modals.
  `EditSaleModal` passes its `form.product_id` as the second arg so the
  sale's existing link stays visible even at 0 stock — keep that "don't drop
  the existing link on edit" guard. Selecting a product also auto-fills
  `product_name` — don't remove that or the free-text name and the link can
  drift apart again.
- `Sale.vat_rate`/`vat_amount` are populated only when "Total includes VAT" is
  checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when it's
  off — see `CLAUDE.md` → "Inventory link + VAT" for the full pattern, which is
  identical across Sales/Purchases/Expenses modals.
