# Expenses feature

Route: `/dashboard/expenses`. Lists expenses by category (shipping, advertising,
tax, office, etc.), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: server-side pagination (`fetchExpensesPage` thunk),
  `FilterBar` (date preset, currency, category, general keyword search across
  title/vendor/description/invoice number), row selection, invoice trigger,
  Gross/VAT/Net summary **(this page)**, **Export CSV** button (server-side
  query, no `.range()`, capped at 5 000 rows), **Import CSV** button, wires up
  the modals below.
- `_store/expensesSlice.ts` — Redux slice for `state.expenses` (`items`, `loaded`,
  `page`, `pageSize`, `total`, `isFetching`).
  Actions: `hydratePage` (also exported as `hydrateExpenses` for `StoreProvider`),
  `addExpense`, `updateExpense`, `removeExpense`, `setFetching`.
  Thunk: `fetchExpensesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, category, currency, and a keyword `search`
  matched via `.or()`/`ilike` across `title`/`vendor`/`description`/
  `invoice_number`, sanitized with `sanitizeIlikeSearchTerm`),
  `.select("*", { count: "exact" })`, `.order("date")`, and `.range(from, to)`
  from `rangeFor()`. Dispatches `hydratePage` on success.
  Used **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/expensesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/expenses`.
- `_components/AddExpenseModal.tsx` / `EditExpenseModal.tsx` — create/edit forms.
- `_components/ImportExpensesModal.tsx` — bulk CSV import: same pattern as the
  Sales/Purchases import modals but for expenses. See "CSV import/export" below.

## Delete gating (super_admin + permission overrides)

`page.tsx` computes `canDelete = isSuperAdmin || hasDeleteOverride`, where
`hasDeleteOverride` reads
`s.currentUser.profile?.permission_overrides?.includes("delete_expense")`
directly (not via `hasPermission()` from `lib/utils/permissions.ts` — see the
Sales feature's CLAUDE.md for why: it would resurrect the matrix's
`["super_admin", "admin"]` default, silently giving every admin delete rights
they've never had in this UI). Overrides are granted per-user via the Users
feature's Permissions modal and also enforced in Postgres RLS
(`{{schema}}.current_user_has_override('delete_expense')` in the
`expenses_delete` policy, see `supabase/migrations/023_user_permission_overrides.sql`).

## Pagination data flow

Server-side pagination is active. `page.tsx` **does not apply `filterExpenses`
in memory** — all filtering happens in `fetchExpensesPage` (the thunk in
`_store/expensesSlice.ts`). The flow for a filter change or page navigation is:

1. User changes a filter or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchExpensesPage({ page, pageSize, filters })`.
3. The thunk builds a Supabase query with filter predicates + `.select("*", { count: "exact" })` + `.range(from, to)`, then dispatches `hydratePage({ data, count, page, pageSize })` on success.
4. `state.expenses.items` is replaced with the new page; `total` holds the full
   count across all pages; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydratePage` too (aliased as
   `hydrateExpenses`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

**Summary cards** show "(this page)" totals only — computed from `state.expenses.items`
(current page). Clearly labelled in the UI.

**CSV export** (`handleExport`) bypasses Redux and runs a fresh Supabase query
with the same filter predicates but **no `.range()`**, capped at 5 000 rows.

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
  Purchases (don't fork these; extend them if you need new shared behavior —
  `DeleteConfirmModal` also grew optional `confirmLabel`/`confirmingLabel`/
  `reasonLabel`/`reasonPlaceholder` props for the Users feature's Deactivate
  confirmation, all defaulting to the original "Delete" wording)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv}`, `store/slices/companyProfileSlice`
- `types` (`Expense`, `ExpenseCategory`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` runs a fresh Supabase query with the
same filter predicates (no `.range()`, capped at 5 000 rows) and calls
`exportToCsv`. Columns: `date, title, category, vendor, amount, currency,
vat_rate, vat_amount, description`.

**Import** (`ImportExpensesModal`): Required: `date` (YYYY-MM-DD), `title`,
`amount`. Optional: `category` (default "other"), `vendor`, `currency`
(default EUR), `vat_rate`, `description`. `vat_amount` is computed. All rows
must be valid; one audit log entry for the batch (omit `entityId`).

## Tests

`npx jest dashboard/expenses` runs `_store/expensesSlice.test.ts`.
