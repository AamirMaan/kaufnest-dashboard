---
name: purchases-feature
description: Work on the Purchases dashboard feature (list, add/edit/delete inventory purchase records, invoices) at src/app/dashboard/purchases — use when the task mentions purchases, inventory buys, vendors, or the /dashboard/purchases route.
---

# Working on the Purchases feature

This feature is fully colocated under `src/app/dashboard/purchases/`. Read
`CLAUDE.md` in this folder first — it explains the file map and the
Supabase-write → slice-update → audit-log data flow every mutation follows.

## Minimal file set for common changes

- **Add/change a field on a purchase**: `_components/AddPurchaseModal.tsx`
  (create form), `_components/EditPurchaseModal.tsx` (edit form + before/after
  audit diff), `_store/purchasesSlice.ts` only if the shape stored in Redux
  changes, and `src/types/index.ts` for the `Purchase` type. Also check
  `page.tsx` if the field needs to render in the table or be filterable
  (`lib/utils/filters.ts`).
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change reducer logic**: `_store/purchasesSlice.ts` + its test.

## Test command

`npx jest dashboard/purchases`

## Gotchas

- `purchasesSlice` is registered centrally in `src/store/store.ts` and hydrated
  in `src/store/StoreProvider.tsx` — those two files import it via the
  `@/app/dashboard/purchases/_store/purchasesSlice` alias. If you rename the
  slice file, update those imports too.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Sales and Expenses
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
