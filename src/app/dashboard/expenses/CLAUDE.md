# Expenses feature

Route: `/dashboard/expenses`. Lists expenses by category (shipping, advertising,
tax, office, etc.), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterExpenses`), row
  selection, invoice trigger, Gross/VAT/Net summary, **Export CSV** button
  (exports `filtered` via `lib/utils/csv`), **Import CSV** button, wires up the
  modals below.
- `_store/expensesSlice.ts` — Redux slice for `state.expenses` (`items`, `loaded`).
  Actions: `hydrateExpenses`, `addExpense`, `updateExpense`, `removeExpense`. Used
  **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/expensesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/expenses`.
- `_components/AddExpenseModal.tsx` / `EditExpenseModal.tsx` — create/edit forms.
- `_components/ImportExpensesModal.tsx` — bulk CSV import: same pattern as the
  Sales/Purchases import modals but for expenses. See "CSV import/export" below.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`await createTenantClient()` from `@/lib/supabase/client`, table `expenses`).
2. On success, dispatch the local slice action (`addExpense`/`updateExpense`/`removeExpense`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditExpenseModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## VAT (additive fields on `Expense`)

- `vat_rate`/`vat_amount: number | null` — populated when the user checks
  "Amount includes VAT" (a `Checkbox` from `FormFields`). The rate defaults to
  `companyProfile.profile?.vat_rate` (per-tenant default from
  `store/slices/companyProfileSlice`, falls back to `19`) but is editable
  per-record; the amount is extracted from the gross `amount` via
  `vatAmountFromGross`
  (`lib/utils/currency`). Both stay `null` when the toggle is off. Unlike
  Sales/Purchases, expenses have **no product link** — they aren't inventory
  items, so there's no `product_id`/`Select`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Badge` (`CategoryBadge`), `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Sales and
  Purchases (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv}`, `store/slices/companyProfileSlice`
- `types` (`Expense`, `ExpenseCategory`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` maps `filtered` to rows and calls
`exportToCsv`. Columns: `date, title, category, vendor, amount, currency,
vat_rate, vat_amount, description`.

**Import** (`ImportExpensesModal`): Required: `date` (YYYY-MM-DD), `title`,
`amount`. Optional: `category` (default "other"), `vendor`, `currency`
(default EUR), `vat_rate`, `description`. `vat_amount` is computed. All rows
must be valid; one audit log entry for the batch (omit `entityId`).

## Tests

`npx jest dashboard/expenses` runs `_store/expensesSlice.test.ts`.
