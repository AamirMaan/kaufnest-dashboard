---
name: expenses-feature
description: Work on the Expenses dashboard feature (list, add/edit/delete expense records, invoices) at src/app/dashboard/expenses — use when the task mentions expenses, expense categories, or the /dashboard/expenses route.
---

# Working on the Expenses feature

This feature is fully colocated under `src/app/dashboard/expenses/`. Read
`CLAUDE.md` in this folder first — it explains the file map and the
Supabase-write → slice-update → audit-log data flow every mutation follows.

## Minimal file set for common changes

- **Add/change a field on an expense**: `_components/AddExpenseModal.tsx` (create
  form), `_components/EditExpenseModal.tsx` (edit form + before/after audit diff),
  `_store/expensesSlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Expense`/`ExpenseCategory` types. Also check
  `page.tsx` if the field needs to render in the table or be filterable
  (`lib/utils/filters.ts`). **Also update `ImportExpensesModal.tsx`** if the
  field needs import support.
- **Change list/filter/table behavior**: `page.tsx` only (filters dispatch `fetchExpensesPage`, no in-memory filtering).
- **Change reducer logic**: `_store/expensesSlice.ts` + its test.
- **Change export columns**: `handleExport()` in `page.tsx`.
- **Change import validation / accepted columns**: `validateRow()` in
  `_components/ImportExpensesModal.tsx` only.

## Test command

`npx jest dashboard/expenses`

## Gotchas

- **Server-side pagination**: `page.tsx` dispatches `fetchExpensesPage` on every
  filter change and page navigation — do NOT call `filterExpenses` in memory.
  `state.expenses.items` is always the current page only; `state.expenses.total`
  is the full count.
- **Summary cards** are computed from `state.expenses.items` (current page) and
  labelled "(this page)" — they are not all-time aggregates.
- **Export** calls Supabase directly with the same filters but no `.range()` (up
  to 5 000 rows) so it always covers all matching records, not just the current page.
- `expensesSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` — those two files import it via the
  `@/app/dashboard/expenses/_store/expensesSlice` alias. If you rename the slice
  file, update those imports too.
- `StoreProvider` now receives `expenses` as `{ data: Expense[], count: number }`
  (not a plain `Expense[]`) and dispatches `hydrateExpenses` (alias for
  `hydratePage`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Sales and Purchases
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Expense.vat_rate`/`vat_amount` are populated only when "Amount includes VAT"
  is checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when
  it's off — see `CLAUDE.md` → "VAT" for the full pattern. Note expenses get
  **no** product-link `Select` (that's Sales/Purchases only — expenses aren't
  inventory items).
- `writeAuditLog` `entityId` is `string | undefined` — omit it for bulk-import
  batch entries rather than passing `null` (which is a TypeScript error).
