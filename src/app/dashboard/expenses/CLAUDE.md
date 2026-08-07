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
  `EditExpenseModal` delegates its VAT-write decision to
  `_lib/vatPreservation.ts` rather than deriving `vat_amount` inline — see
  that file's bullet below and the SKILL.md VAT gotcha before touching either.
- `_components/ImportExpensesModal.tsx` — bulk CSV/Excel import with a **format
  dropdown** (Generic / German VAT ledger). Holds the raw `{headers, rows}` off
  the file in `parsedSource` so changing the format re-derives `parsed` without
  a re-upload; resolves headers via `resolveHeaders`/`canonicalizeRow`
  (imported **directly** from `@/lib/utils/importAliases`, not via the
  registry), calls `classifySkip` before `validateExpenseRow` per row, groups
  skip reasons via `skipReasonCounts`, and shows a **category breakdown**
  before import whenever the categories are being guessed. Batch-inserts `validRows`,
  dispatches `addExpense` per row, writes one audit entry
  (`{bulk_import, count}`) and calls `onSuccess(count)`. Contains **no
  validation logic of its own** — all of it lives in the registry below. See
  "CSV import/export" below.
- `_components/expenseImportFormats.ts` (+ colocated `.test.ts`) — pure import
  format registry, the Expenses sibling of `sales/_components/importFormats.ts`:
  `EXPENSE_IMPORT_FORMATS` (`generic` / `vorsteuer`), skip classification
  (`classifySkip`/`SkipReason` — **vorsteuer only**), per-row validation
  (`validateExpenseRow`) and each format's `templateExample` row for the
  Template download. **All import-format/validation changes go here**, not
  in the modal. Header aliases are NOT defined here — they live in the shared
  `lib/utils/importAliases`, and this module deliberately does not re-export
  `resolveHeaders`/`canonicalizeRow` (the modal imports them from there
  directly, unlike Sales which re-exports them for back-compat).
- `_lib/expenseCategory.ts` (+ colocated `.test.ts`) — pure
  `categoryFor(description)`: guesses an `ExpenseCategory` from a multilingual
  fee description. The Vorsteuerkonto has no category column, and Amazon
  localises each fee description to its marketplace, so without this every
  imported row would land in "other".
- `_lib/vatPreservation.ts` (+ colocated `.test.ts`) — pure
  `vatInputsUnchanged`/`resolveVatAmount`, used only by `EditExpenseModal`.
  Decides whether an edit save should keep an imported row's stored
  `vat_amount` or recompute it from `amount × vat_rate` — see the SKILL.md
  VAT gotcha for why the comparison must be against the form's own initial
  snapshot (`initialForm` state in the modal, re-derived during render off an
  `expense.id` identity check — not a `useRef`; this repo's `react-hooks/refs`
  lint rule forbids reading/writing `.current` during render), never against
  `expense`'s raw fields directly.

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

**Import** (`ImportExpensesModal`): required and optional columns depend on the
chosen format — see the table below. Dates, decimal separators and header names
are locale-tolerant on every format (`lib/utils/localeParse`,
`lib/utils/importAliases`), so `15.01.2026` and `1.234,56` are accepted.
`vat_amount` is **not** simply computed — it follows the precedence below. All
non-skipped rows must be valid; one audit log entry for the batch (omit
`entityId`).

**What the modal does around the registry** (the Expenses sibling of
`ImportSalesModal` — mirror that file when changing this one):

- **Format dropdown** (`Select` from `components/ui/FormFields`) listing
  `EXPENSE_IMPORT_FORMAT_IDS` by `label`. Changing it re-parses the file
  already in `parsedSource` — the raw `{headers, rows}` is kept in state
  precisely so a format change never asks for a re-upload.
- **Staleness guards — two counters, and `handleFile` holds the live one.**
  - `fileReadIdRef` **is the guard that actually protects anything.**
    `handleFile` claims it before the read starts and re-checks it on **both**
    the `.then` and the `.catch`, so selecting file A then B before A's
    `FileReader` fires can't leave `parsedSource` and `parsed` describing
    different files. Only a newer **file** bumps it — a format change
    deliberately does not (see `formatIdRef` below).
  - `requestIdRef`, claimed inside `parseAndValidate`, exists for structural
    parity with `ImportSalesModal` (where the awaited step is the
    duplicate-check query). **It is currently unreachable**: `parseAndValidate`
    is declared `async` but contains no `await`, so it runs to completion
    synchronously and its check can never be false. Treat it as
    future-proofing, not protection. If you add an `await` to that function,
    only the writes **after** the existing check are covered — anything added
    above it needs its own re-check.
  - `formatIdRef` mirrors `formatId` for the async read path, and
    `handleFormatChange` updates the ref **before** it re-parses. `handleFile`'s
    `.then` parses against `formatIdRef.current`, not the `formatId` its closure
    captured, so a file that lands after a format change is parsed under the
    format now selected.
  - **This is a deliberate divergence from `ImportSalesModal`** — see the
    SKILL.md gotcha before "aligning" the two.
- **Header resolution**: `resolveHeaders(headers, format.columns)`; a
  non-empty `missingRequired` is a single **file-level** error naming the
  missing columns, and no rows are validated. Otherwise every row goes
  through `canonicalizeRow`.
- **`classifySkip` runs before `validateExpenseRow`, per row.** A noise row
  legitimately has no `date`, so validating first would fail the whole file
  on `invalid or missing "date"` — the same ordering bug that once broke
  every Amazon RETURN line in Sales. (`validateExpenseRow` also calls
  `classifySkip` internally, so the two orderings agree; the modal's explicit
  call is what keeps the skip path visible at the call site.)
- **Skips are non-fatal.** `canImport` is still
  `errors.length === 0 && validRows.length > 0` — a skipped row carries
  `data: null` and `error: null`, so it can never enter `validRows` nor block
  the import. Counts are grouped by reason (`skipReasonCounts`) and each
  reason is named in the summary line; an all-skipped file reads "All N rows
  skipped — 12 blank row, 3 zero amount."
- **Category breakdown before import**: a one-line
  `Categories: shipping 40 · advertising 22 · other 42` summary, sorted by
  count descending, derived from the valid rows' `data.category`. Shown when
  the resolved header mapping has **no `category` key** (state:
  `categoriesAreGuessed`) — i.e. exactly when `categoryFor(title)` is deciding
  the category rather than the user. That is always the case for `vorsteuer`
  (the format has no such column at all) and for `generic` whenever the sheet
  omits it; it stays hidden when the user supplied categories explicitly.
  **Condition it on the guess, never on `formatId === "vorsteuer"`** — that
  was the original spec and it left `generic`'s silent guessing unreported,
  which is the exact case the breakdown exists to prevent. This modal has no
  per-row preview, so without this line a wrong guess is only discoverable
  after it has landed in the table. Don't remove it when editing the summary
  block.
- **Template button** exports the selected format's
  `columns.map((c) => c.key)` as the header line plus that format's
  `templateExample` as one data row (header-only if a format defines no
  example). `templateExample` is **ordered to match `columns`** and nothing at
  runtime checks that — a column inserted mid-list without a matching value
  ships a template whose every cell sits under the wrong header, and it would
  still "work" since all values are strings. Two tests in
  `expenseImportFormats.test.ts` pin the alignment and that each example
  re-imports cleanly.
- **windows-1252 fallback** on CSV reads (`readFileText`, copied from
  `ImportSalesModal`). Load-bearing here, not cosmetic: `categoryFor()`
  matches German fee descriptions by keyword, so a mojibaked read would push
  every row into `other`.
- **Ambiguous dates are read day-first**, and the modal says so in a note when
  `hasOrderSensitiveDate` is true. There is deliberately **no date-order
  selector** (Sales has one): the target ledger uses dot dates, which
  `parseFlexibleDate` always reads day-first regardless of order, so a
  selector would be a no-op on the file this format exists for. If a customer
  ever brings a month-first expense export, port Sales' selector +
  `detectDateOrder` conflict handling rather than silently guessing.

**Import formats (`_components/expenseImportFormats.ts`)** — the pure registry
the modal validates against:

| Format | Required columns | Notes |
|---|---|---|
| `generic` | `date, title, amount` | the original template, unchanged apart from locale tolerance (German dates, decimal commas). Optional: `category`, `vendor`, `currency` (default EUR), `vat_rate`, `description`, `invoice_number`, `vendor_vat_number`. An explicit `category` still wins and is validated against `ExpenseCategory`. A **blank** category cell keeps the historical `"other"` default; `categoryFor()` guesses only when the column is **absent entirely** — those two cases are deliberately distinct. **No** skip classification — a blank row is still an error. |
| `vorsteuer` | `date, title, amount` | German input-tax ledger (Vorsteuerkonto). `amount` is the GROSS figure; `net_amount`/`vat_amount` cross-check it; `category` always comes from `categoryFor(title)`. Skip classification is on. |

⚠️ **`vat_rate` and `vat_amount` can legitimately disagree on an imported row,
and `vat_amount` is the authority.** See the SKILL.md gotcha before writing any
code that recomputes VAT from an expense's rate.

Rules that are easy to get wrong and are pinned by
`expenseImportFormats.test.ts`:

- **`amount` may be negative or zero.** Credit notes (`Erstattung von
  Verkäufergebühren`, −123.81) are real ledger rows — migration
  `032_expenses_allow_negative_amount.sql` dropped `expenses_amount_check`
  for them. Only a *non-numeric* amount is a row error.
- **VAT precedence is file → arithmetic → rate**, in that order, and the rate
  is deliberately last:
  1. the file's `vat_amount` when the column is present and parses;
  2. else `round2(amount − net_amount)` when the net column is present — this
     inherits the sign for free (−123.81 gross less −104.04 net is −19.77, the
     ledger's real credit-note figure);
  3. else `vatAmountFromGross`, derived from `Math.abs(amount)` with the
     amount's sign reapplied so a credit note can never produce *positive*
     input tax — reached whenever a rate is stated, tested `vatRate !== null`
     rather than by truthiness so a stated **0 %** yields `vat_amount: 0`
     (zero-rated) instead of `null` (unknown);
  4. else `null`.

  A stated rate is not evidence the tax was charged: four real rows state 19 %
  against €0.00 of actual VAT, so deriving from the rate there would invent
  €5.54 of input tax on a filed VAT return. `gross − net` gets those rows
  right; the rate does not.
- **net + VAT must reconcile with gross** within 2 cents (`does not reconcile`
  row error). The check runs whenever `net_amount` is present and VAT resolved
  — via the file *or* via step 2, where it holds by construction. It must not
  become conditional on which branch produced the VAT. `net_amount` is
  otherwise discarded — it is not a column on `Expense`.
- **`vendor_vat_number` merges two sheet columns per ROW**:
  `vendor_vat_number || tax_number`. The ledger has both a `UStID des
  Anbieters` and a `Steuernummer` and fills whichever a vendor has (fuel
  stations carry only a Steuernummer). `resolveHeaders` maps one header per
  key, so they must stay separate keys and merge here.
- **`classifySkip`'s rule order is load-bearing** and its format guard must be
  the first statement — see the SKILL.md gotchas. Rule 1 tests `date` and
  `amount` only (**not** `title`), so a section-header row carrying just a
  title is skipped as a "blank row" rather than failing the whole file on a
  date error.

## Tests

`npx jest dashboard/expenses` runs `_store/expensesSlice.test.ts`,
`_lib/expenseCategory.test.ts`, `_lib/vatPreservation.test.ts` and
`_components/expenseImportFormats.test.ts`.
