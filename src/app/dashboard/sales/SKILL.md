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
