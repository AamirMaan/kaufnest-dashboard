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
  `src/lib/utils/importAliases.ts` instead (Sales reads the same table). A new
  *column* also needs a `templateExample` value inserted at the same index —
  see the gotcha below.
- **Change how a description maps to a category**: `_lib/expenseCategory.ts` +
  its test. Rule order in that file is first-match-wins.
- **Change the VAT-preservation decision on edit**: `_lib/vatPreservation.ts`
  (`vatInputsUnchanged`/`resolveVatAmount`) + its colocated test — not inline
  in `EditExpenseModal.tsx`. The comparison must stay against the form's own
  initial snapshot (`EditExpenseModal`'s `initialForm` state), never against
  `expense`'s raw `vat_rate`/`vat_amount` — see the gotcha below for why.
- **Change the import modal's UI/plumbing** (dropdown, summary line, category
  preview, file reading): `_components/ImportExpensesModal.tsx` only — and read
  `sales/_components/ImportSalesModal.tsx` first, it is the mature sibling this
  file is deliberately modelled on (format dropdown, `parsedSource`, run-id
  guard, `skipReasonCounts`). Keep the two structurally alike; a reviewer will
  diff them — **except for two deliberate divergences**, both documented as
  gotchas below and neither to be "fixed" by copying Sales back: the split
  `fileReadIdRef`/`requestIdRef` staleness counters, and the absence of a
  date-order selector. **No validation belongs in the modal** — it goes in
  `_components/expenseImportFormats.ts`.

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
- **Rule 1 tests `date` and `amount` only — `title` is deliberately excluded.**
  A section-header row is exactly "a title and nothing else"; if the rule also
  required an empty title that row would match nothing (rule 2 needs a
  non-empty date, rule 3 needs a parseable amount and `parseLocaleNumber("")`
  is `null`, not `0`), fall through to `invalid or missing "date"`, and — since
  validation is all-or-nothing — one header line would make the whole file
  unimportable. Widening it does NOT swallow the zero-amount filler rows: their
  `amount` is the non-empty string `"0"`, so they still reach rule 3. If you
  touch rule 1, the `"skips a zero-amount filler row"` test going red means you
  widened too far.
- **An expense `amount` may be negative or zero — in the IMPORTER *and* in both
  modals.** `validateExpenseRow` rejects only a non-numeric value; credit-note
  rows are the whole reason `expenses_amount_check` was dropped (migration
  `032`). The same rule now holds in `AddExpenseModal` and `EditExpenseModal`:
  both parse with `Number.isFinite` and reject only `"Amount must be a
  number."`. Do not reinstate `if (!(amount > 0))` in any of the three.
  - **Why the modals had to change too (2026-08-07).** With the old guard, the
    11 credit notes the importer creates were **permanently uneditable**:
    opening one and changing only its category hit "Amount must be greater than
    0." on Save, and there was no other way to fix the row in the UI. Zero was
    blocked as well, which the registry explicitly permits. `AddExpenseModal`
    was changed by the same ruling rather than as a side effect — a user must
    be able to hand-enter a credit note they received, and it is incoherent for
    the app to import a shape it refuses to let you type.
  - **The `min="0.01"` on the Amount `<Input>` had to go with it.** It is
    browser-level constraint validation, so it blocks submit *before*
    `handleSubmit` runs — fixing only the JS guard would have left the form
    just as stuck, with no error message of our own to explain it. `step="0.01"`
    stays.
  - **The Net/VAT/Gross preview is gated on `amountIsValid`, not `amount > 0`.**
    Under the old gate it hid itself for exactly the rows whose breakdown is
    least obvious. `vatAmountFromGross` is linear in `gross`, so a negative
    gross yields negative input tax — the correct sign for a credit note.
- **A `vat_rate` stated as a FRACTION ("0.19") is caught by arithmetic, not by
  magnitude.** The import modal accepts `.xlsx` and the source ledger is one:
  open it in Excel and re-save, and the rate column becomes percentage-formatted
  cells that `excel.ts` stringifies as `"0.19"`. That passes `parseLocaleRate`
  and the 0–100 range check, and would be stored as a 0.19 % rate with nothing
  downstream to notice. `validateExpenseRow` cross-checks the rate against the
  row's own figures instead: when `net_amount`, `vat_amount` and `vat_rate` are
  all resolved, `|vat_amount − net_amount × vat_rate / 100|` must be within
  0.02 (the same tolerance the reconciliation check uses), and the failure
  message names Excel percentage formatting as the likely cause. A fraction
  rate misses by two orders of magnitude, so it cannot hide.
  - **Do NOT "simplify" this to `if (rate < 1) rate *= 100`.** That heuristic
    was explicitly rejected on the Sales branch: it silently corrupts a genuine
    100 % rate, and it guesses where the row already states the answer.
  - **The `vat_amount !== 0` condition is load-bearing — never drop it.** Four
    real Q2 rows state 19 % against €0.00 of actual VAT (`Gebühren im
    Zusammenhang mit "Versand durch Amazon"`, 34.70 gross). For those, net ×
    rate is 6.59 against a stated 0.00 — a genuine, intended disagreement that
    `vat_amount` wins (see the VAT-authority gotcha above). Without the
    exemption the check rejects four valid rows, and since validation is
    all-or-nothing that makes the real quarterly file unimportable. A test pins
    each of the three cases: consistent row passes, fraction rate errors,
    19 %/€0.00 row still passes.
  - It also cannot fire when the sheet has no `net_amount` column — there is no
    arithmetic to check against, so the rate is taken at face value. That is the
    `generic` format's normal state.
- **Amount colour follows the SIGN in the expenses table.** `page.tsx` renders
  a negative amount in `--color-success` and a positive one in `--color-danger`,
  matching the Overview page's Expenses-by-Category list. Rendering every row in
  `--color-danger` made a refund read as a cost on the screen users actually
  meet these rows on.
- **VAT "is there any" checks test `!== 0`, never `> 0`.** Credit notes carry
  negative input tax, so a period made only of refunds sums to a negative VAT
  total that is still real VAT to report. Both `hasVat` (`expenses/page.tsx`)
  and `hasVatData` (`dashboard/page.tsx`) used `> 0` and hid their entire VAT
  summary for exactly those periods.
- **The VAT column's sort sentinel is `Number.NEGATIVE_INFINITY`, not `-1`.**
  `sortValue: (e) => e.vat_amount ?? -1` meant "no VAT sorts below everything",
  which stopped being true once credit notes brought negative `vat_amount`s: a
  real −19.77 sorted *below* the sentinel and interleaved null rows between the
  credit notes and the ordinary ones. `NEGATIVE_INFINITY` is the only sentinel a
  real figure cannot collide with, and it preserves the nulls-last-ascending
  behaviour without touching `DataTable`'s shared comparator. Any new sentinel
  for a signed column needs the same reasoning.
- **NEVER recompute VAT from `amount × vat_rate` for an imported expense.**
  On a `vorsteuer` row `vat_rate` and `vat_amount` can legitimately disagree,
  and **`vat_amount` is the authority**. Four real ledger rows state a 19 %
  rate against €0.00 of actual VAT (`Gebühren im Zusammenhang mit "Versand
  durch Amazon"`, 34.70 gross), so they are stored as
  `vat_rate: 19, vat_amount: 0` — a correct reading of the file, and a loaded
  gun. Anything that re-derives from the rate resurrects €5.54 of input tax
  that was never charged, on a filed VAT return.

  **`EditExpenseModal` is fixed (2026-08-07).** It used to seed `vat_included`
  from `e.vat_rate != null` and never read the stored `e.vat_amount`, writing
  `vatAmountFromGross(amount, vatRate)` unconditionally on every save — merely
  OPENING an imported 0.00-VAT expense and pressing Save rewrote its
  `vat_amount` from 0.00 to 5.54, and the audit diff recorded it as a
  user-made change.

  **The guard is "did the user change anything in the form", not "does the
  form still match the expense's stored rate".** Those sound like the same
  test and are not: `expenseToForm` seeds `vat_rate` from the tenant's
  default whenever the expense's own rate is `null` (a `generic`-format row
  with a VAT *amount* but no rate column parses to exactly this shape —
  `vat_amount: 96.26, vat_rate: null`). Comparing the live form against the
  expense's raw `vat_rate` would read `"19" !== null` as "user changed it" on
  a completely untouched row and silently recompute 96.26 away — the same
  corruption this fix exists to prevent, just reached through a different
  door. The first version of this fix made exactly that mistake. The correct
  comparison is form-against-its-own-initial-snapshot: `EditExpenseModal`
  captures `initialForm` state from `expenseToForm(expense, defaultVatRate)`
  once per loaded expense, re-derived **during render** (not an effect) via
  an `expense.id`-vs-`loadedExpenseId` identity check — the React-documented
  "adjusting state when a prop changes" pattern. A `useRef` written during
  render was tried first and rejected by this repo's `react-hooks/refs` lint
  rule (`.current` may not be read or written during render); `useState`
  called conditionally in the render body is the sanctioned replacement, and
  the modal is also remounted per row by `page.tsx`'s `key={editTarget?.id}`,
  though this guard doesn't depend on that. The pure helper
  `_lib/vatPreservation.ts` (`vatInputsUnchanged`/`resolveVatAmount`,
  colocated test covers all 5 behaviours below) compares
  `form.{amount,vat_rate,vat_included}` against that snapshot — never against
  `expense` directly. An untouched field always compares equal because both
  sides were seeded by the identical defaulting logic; a real edit to either
  input is still caught because only the live side moves.

  The checkbox is seeded from `e.vat_rate != null || e.vat_amount != null`,
  so a row carrying an amount with no rate still shows as VAT-included
  instead of silently losing it the moment the box is unticked and re-ticked.

  **`AddExpenseModal` shares no helper with this** — it imports the same
  `vatAmountFromGross` but has its own inline `vatAmount` derivation with no
  `vatInputsUnchanged`/initial-snapshot concept, which is correct for it: it
  creates rows from scratch, so there is no stored figure to preserve.

  **No code may recompute VAT from `amount × vat_rate` for an imported
  expense — the stored `vat_amount` is always the authority.** The other two
  places this rule applies, still unwritten:
  1. **`generateInvoice` / `InvoiceModal`** (shared with Sales + Purchases) —
     render the stored `vat_amount`; never re-derive it for the PDF.
  2. **Any VAT-return or net-basis export** — sum the stored `vat_amount`;
     derive net as `amount − vat_amount`, not from the rate.
- **VAT derivation precedence is file → `gross − net` → rate → null**, and the
  rate is last on purpose (a stated rate is not evidence the tax was charged;
  `gross − net` gets the 0.00-VAT rows right and the rate does not). Don't
  reorder. The rate branch must also never produce positive VAT on a negative
  amount: `vatAmountFromGross` returns 0 for a non-positive rate, so the sign
  is carried explicitly — derive from `Math.abs(amount)`, then negate. The
  `gross − net` branch inherits the sign for free.
- **Guard the rate branch with `vatRate !== null`, never truthiness.** A stated
  **0 %** is a real answer — zero-rated intra-EU supplies are ordinary in a
  German ledger — and `if (vatRate)` is false at 0, which would store
  `vat_rate: 0` beside `vat_amount: null`, i.e. *unknown* where the file
  actually said *zero*. Note Sales has this exact truthiness bug at
  `sales/_components/importFormats.ts:503`; the divergence is intentional and
  Sales was left alone as out of scope. Don't "align" the two by copying the
  bug back into Expenses.
- **The reconciliation check must not become conditional on which branch
  produced `vat_amount`.** It runs whenever `net_amount` is present and VAT
  resolved, including when VAT was derived from net (where it holds by
  construction). A check that is trivially true is still the check; making it
  branch-dependent is how it quietly stops running.
- **`vendor_vat_number` merges `vendor_vat_number` + `tax_number` per row.**
  `resolveHeaders` maps one sheet header per key, so folding the two German
  columns (`UStID des Anbieters`, `Steuernummer`) into one alias list would
  silently drop whichever column lost the race. Merge in the validator, not in
  `ALIASES`.
- **Don't reuse `classifiesSkips` as an "is this the vorsteuer format" test.**
  Whether a sheet carries noise rows and whether an explicit `category` column
  may win are unrelated ideas. The category branch tests `format.id ===
  "vorsteuer"`; a future format declared `classifiesSkips: true` *with* a
  category column would otherwise silently discard every user-stated category,
  and no existing test would fail. Sales draws the same distinction with a
  dedicated `vatRateIsFraction` flag — a named flag or an id check are both
  fine, a borrowed one is not.
- **An absent category column and a blank category cell are different.**
  `raw.category?.trim().toLowerCase()` is `undefined` for the former and `""`
  for the latter. Absent → `categoryFor(title)` guesses; blank → the historical
  `"other"` default, so re-importing an old generic template with some cells
  left empty doesn't start assigning categories the user never chose. `!x`
  collapses the two — test `=== undefined` explicitly.
- **`vorsteuer` has no `description` column on purpose** — the ledger's
  "Description" column IS the title, and one sheet column cannot resolve to two
  keys. `title`'s alias list is `ALIASES.title` ∪ `ALIASES.description` for
  that format only.
- **`ImportExpensesModal` has no test coverage and none is planned.** Every
  testable rule lives in the pure modules (`expenseImportFormats.ts`,
  `_lib/expenseCategory.ts`, `lib/utils/{importAliases,localeParse,csv}`), each
  with a colocated test. Don't contort the component to make it testable — move
  the logic into a pure module instead, which is the split that already exists.
- **The category breakdown is a safety feature, not decoration.** When
  `categoryFor(title)` is deciding the category, the modal has no per-row
  preview, so the `Categories: shipping 40 · advertising 22 · other 42` line is
  the only chance to notice a bad guess before it lands. Don't drop it while
  tidying the summary block.
- **Gate the breakdown on the GUESS, not on the format.** The condition is
  `categoriesAreGuessed` — the resolved header mapping has no `category` key —
  not `formatId === "vorsteuer"`. `generic` guesses too whenever the sheet
  omits the column (`validateExpenseRow` falls through to `categoryFor` when
  `raw.category === undefined`), and a format-based check leaves exactly that
  case silent, which is the thing the breakdown exists to prevent. It also
  correctly stays hidden when the user did supply categories, since then
  nothing is being guessed.
- **`templateExample` must stay ordered to match its format's `columns`.** The
  Template download emits `columns.map(c => c.key)` as the header line and
  `templateExample` as the single data row; nothing at runtime cross-checks
  them, and because every value is a string a mismatch produces a
  perfectly-valid-looking template with every cell under the wrong header. Add
  a column mid-list ⇒ insert the matching value at the same index. Two tests
  in `expenseImportFormats.test.ts` pin the length and that each example
  re-imports cleanly; `vorsteuer`'s also pins which figure is gross (602.91)
  and which is net (506.65), so a "fix" can't just swap them.
- **Skipped rows must never block an import.** They carry `data: null` *and*
  `error: null`, so they fall out of both `validRows` and `errors` by
  construction — `canImport` needs no special case. If you add a new
  `SkipReason`, keep that shape: giving a skip a non-null `error` would make a
  real Vorsteuerkonto (mostly filler rows) unimportable, which is the exact
  failure the skip machinery exists to prevent.
- **Call `classifySkip` before `validateExpenseRow`, never after.** Noise rows
  legitimately have no `date`; validating first fails the whole file on
  `invalid or missing "date"`. `validateExpenseRow` also calls `classifySkip`
  itself, so the orderings agree — the modal's explicit call is there to keep
  the skip path visible where the rows are built. Don't "simplify" it away
  without checking the ordering still holds.
- **The live staleness guard is `fileReadIdRef` in `handleFile`, not
  `requestIdRef` in `parseAndValidate`.** The only async step in this modal is
  the file read (Sales' guard covers its duplicate-check round-trip; there is no
  such query here). `parseAndValidate` is declared `async` but has **no
  `await`**, so it runs to completion synchronously and its internal check can
  never be false — it is future-proofing kept for parity with Sales, nothing
  more. **If you add an `await` there, only the writes after that check are
  covered; anything you add above it needs its own re-check.** Don't reason
  about it as though it currently protects the writes around it.
- **Two counters, on purpose — don't merge them, and don't "align" this with
  Sales.** `fileReadIdRef` is bumped only by a newer FILE; format changes must
  not bump it. With one shared counter (which is what Sales has), this sequence
  silently imported the wrong file: A loaded → pick B → change the format before
  B's `FileReader` fires → `handleFormatChange` re-parses A and bumps the
  counter → B resolves, sees a newer id, returns. The modal then showed
  `fileName: "B.csv"` with A's rows loaded and Import wrote **A's data into a
  VAT ledger**, and it never self-healed (every later format change re-parsed A
  again). Paired with `formatIdRef` — `handleFormatChange` updates the ref
  *before* re-parsing, and `handleFile`'s `.then` parses against
  `formatIdRef.current` rather than its captured `formatId` — so B wins, under
  whatever format is selected when it lands. **`ImportSalesModal` still has this
  window** and the divergence is intentional: Sales lets B eventually win, so
  its outcome is merely stale rather than wrong-file. Copying Sales' single-
  counter version back here reintroduces the bug.
- **`readFileText`'s windows-1252 retry is load-bearing, not cosmetic.**
  `categoryFor()` keyword-matches German fee descriptions, so a mojibaked UTF-8
  read ("Geb�hren") silently sends every row to `other` — a broken category
  breakdown with no error anywhere.
- **There is deliberately no date-order selector.** The Vorsteuerkonto uses dot
  dates, which `parseFlexibleDate` always reads day-first regardless of
  `DateOrder`, so a selector would be a no-op on the file the format exists
  for. Ambiguous `/`-separated dates are read day-first and the modal says so
  via `hasOrderSensitiveDate`. If a month-first expense export ever turns up,
  port Sales' selector *with* its `detectDateOrder` conflict handling — a
  detector without the conflict refusal silently picks an order on a mixed
  file.
- The "Search" box in `FilterBar` matches `title`, `vendor`, `description`,
  and `invoice_number` via a Supabase `.or()`/`ilike` clause (see
  `fetchExpensesPage` in `_store/expensesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`). `handleExport` mirrors
  the same predicate — keep both in sync if the column set ever changes.
