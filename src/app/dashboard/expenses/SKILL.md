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
- **Change import validation / accepted columns / add an import format**:
  `_components/expenseImportFormats.ts` + its colocated test — the pure
  registry (`EXPENSE_IMPORT_FORMATS`, `classifySkip`, `validateExpenseRow`).
  Do NOT put validation in the modal. A new *header alias* goes in the shared
  `src/lib/utils/importAliases.ts` instead (Sales reads the same table).
- **Change how a description maps to a category**: `_lib/expenseCategory.ts` +
  its test. Rule order in that file is first-match-wins.

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
- **`classifySkip`'s format guard must stay the first statement** in the
  function (`if (!format.classifiesSkips) return null;`). Any check above it
  makes `generic` inherit skip behaviour and silently swallow the blank rows it
  is required to error on. This exact bug shipped once in the Sales module — a
  test pins it (`"skips NOTHING for the generic format"`).
- **The skip-rule ORDER in `classifySkip` is load-bearing**, because a real
  filler row matches more than one rule. In particular the summary-row check
  fires only when the `date` cell is NON-EMPTY, so the ledger's zero-amount
  filler rows (which have no date) fall through to the zero-amount rule instead
  of being mislabelled "summary row". Don't reorder.
- **An expense `amount` may be negative or zero** — `validateExpenseRow`
  rejects only a non-numeric value. Credit-note rows are the whole reason
  `expenses_amount_check` was dropped (migration `032`). If you touch the
  validator, don't reintroduce the old `amount <= 0` rejection.
- **Never derive `vat_amount` when the file supplies one**, and never let a
  derivation produce positive VAT on a negative amount. `vatAmountFromGross`
  returns 0 for a non-positive rate, so the sign is carried explicitly
  (derive from `Math.abs(amount)`, then negate) — a credit note claiming back
  positive input tax would be a wrong figure on a filed VAT return.
- **`vendor_vat_number` merges `vendor_vat_number` + `tax_number` per row.**
  `resolveHeaders` maps one sheet header per key, so folding the two German
  columns (`UStID des Anbieters`, `Steuernummer`) into one alias list would
  silently drop whichever column lost the race. Merge in the validator, not in
  `ALIASES`.
- **`vorsteuer` has no `description` column on purpose** — the ledger's
  "Description" column IS the title, and one sheet column cannot resolve to two
  keys. `title`'s alias list is `ALIASES.title` ∪ `ALIASES.description` for
  that format only.
- The "Search" box in `FilterBar` matches `title`, `vendor`, `description`,
  and `invoice_number` via a Supabase `.or()`/`ilike` clause (see
  `fetchExpensesPage` in `_store/expensesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`). `handleExport` mirrors
  the same predicate — keep both in sync if the column set ever changes.
