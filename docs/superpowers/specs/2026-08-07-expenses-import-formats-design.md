# Expenses import — German VAT ledger format

**Date:** 2026-08-07
**Status:** Design approved by user. Ready for an implementation plan.
**Branch:** `feat/expenses-import-formats` (off `main` @ `a3c8105`)

## Problem

The Expenses importer never received the tolerance the Sales importer has. It
is still the original implementation:

| | Sales import | Expenses import |
|---|---|---|
| Dates | `parseFlexibleDate` + order detection | **ISO only** — `/^\d{4}-\d{2}-\d{2}$/` |
| Numbers | `parseLocaleNumber` | **`parseFloat`** |
| Headers | `ALIASES` map | **exact names only** |
| Noise rows | `classifySkip` | **none — every one errors** |
| Encoding | windows-1252 fallback | **UTF-8 only** |
| Partial import | skips are non-fatal | **all-or-nothing** |

Importing a real quarterly *Vorsteuerkonto* (German input-tax ledger) fails on
**every data row** — 109 of 109 — with `invalid or missing "date" (expected
YYYY-MM-DD)`, because the sheet uses `13.04.2026`.

`ImportPurchasesModal.tsx` has the identical defect. It is **out of scope**
here but should adopt the same shared modules afterwards.

## Evidence — the real Q2-2026 sheet

Columns: `Date, Supplier, Invoice Number, UStID des Anbieters, Steuernummer,
Description, Net Amount (€), VAT Rate (%), VAT Amount (€), Gross Amount (€)`.

Nothing maps to the app's required `title` or `amount`. Beyond that:

- **109 data rows**, dates as `13.04.2026` and `2.04.2026` (day-first, dot).
- **11 credit notes** — `Erstattung von Verkäufergebühren` (−104.04),
  `Tarifas reembolsadas`, `Frais remboursés`, `Commissioni rimborsate`,
  `Återbetalda avgifter`. Together **−€218.14 net, −€41.44 VAT**.
- **4 rows carry a 19% rate but €0.00 VAT** (e.g. `Gebühren im Zusammenhang
  mit "Versand durch Amazon"`, 34.70 / 0.00 / 34.70). Deriving VAT from the
  rate would invent €6.59 of tax that was never charged.
- **Six languages** for the same fees — Amazon localises per marketplace:
  `Gebühren für Verkaufen bei Amazon`, `Selling on Amazon Fees`, `Tarifas de
  vender en Amazon`, `Commissioni di vendita su Amazon`, `Frais de vente sur
  Amazon`, `Kosten voor Verkopen via Amazon`, `Avgifter för Sälja på Amazon`.
- **One description contains a line break** inside a quoted field
  (`"Contribuciones ecológicas y tarifas de\nservicio de RAP…"`).
- **Noise rows**: a `Total` summary row, two `0.00` filler rows, and trailing
  partial rows.
- **Non-Amazon vendors throughout** — LEASYS, Circle K, star Tankstelle, Metro,
  DCP Hamburg, Tank Logistik, nextechnology, Zollner24.

That last point is why the format is named **`vorsteuer`**, not "amazon".
Naming it after Amazon would misdescribe half the file.

## Design

### Where the code lives

Two new **shared** modules, consumed by Sales and Expenses:

- `src/lib/utils/importAliases.ts` — the German/multilingual header vocabulary,
  lifted from Sales' private `ALIASES` and widened for expense columns
  (`lieferant`, `rechnungsnummer`, `netto`, `brutto`, `ust-id`, …).
- `src/lib/utils/importCoerce.ts` — generic row coercion: locale numbers with
  `%` and `€` stripping, flexible dates, blank normalisation.

Two new **feature-private** modules, mirroring the Sales layout:

- `src/app/dashboard/expenses/_components/expenseImportFormats.ts` — the format
  registry (`generic`, `vorsteuer`), column resolution, skip classification and
  row validation. Pure: no React/Supabase/Redux.
- `src/app/dashboard/expenses/_lib/expenseCategory.ts` — the multilingual
  keyword → category map.

Sales' **control flow is not touched**; only its imports move. That code took
three fix rounds to stabilise a day before this work, so the design
deliberately keeps the blast radius to import statements.

### Column mapping (`vorsteuer`)

| Sheet column | → | Field |
|---|---|---|
| `Date` | → | `date` |
| `Description` | → | `title` |
| `Supplier` | → | `vendor` |
| `Gross Amount (€)` | → | `amount` |
| `VAT Rate (%)` | → | `vat_rate` (strips `%`) |
| `VAT Amount (€)` | → | `vat_amount` |
| `Invoice Number` | → | `invoice_number` |
| `UStID des Anbieters`, else `Steuernummer` | → | `vendor_vat_number` |
| `Net Amount (€)` | → | validation only, never stored |

**Gross becomes `amount`** because the app's `amount` is the gross figure
`vatAmountFromGross` extracts VAT from.

**The file's `vat_amount` always wins over a derived value** — the four
0%-VAT-at-19% rows above are exactly the case a single-rate derivation gets
wrong. Same rule the Sales importer already follows.

`Net + VAT ≈ Gross` is checked with a 0.02 tolerance, matching the Sales
reconciliation; a mismatch beyond that is a row error.

Both `UStID des Anbieters` and `Steuernummer` are supplier tax identifiers and
the sheet populates whichever the vendor has (the `star Tankstelle` rows carry
only a `Steuernummer`). `vendor_vat_number` takes UStID when present, else
Steuernummer.

### Credit notes → negative expenses

`expenses_amount_check CHECK (amount >= 0)` (verified live on
`tenant_k2_textil`) makes a credit note unstorable. Migration `032` relaxes it
via `run_on_all_tenant_schemas`, mirrored into `provision_tenant_schema()` in
`005_tenant_provisioning.sql` — the 2-places rule.

A credit note is then simply a negative expense, and **every existing SUM
reconciles with no aggregate changes**: totals, VAT Position, monthly trend.
Skipping them instead would leave the dashboard €218.14 and €41.44 adrift from
the filed figures, which is why this option was chosen.

**Consequence to handle:** `src/app/dashboard/page.tsx:774` renders every
Expenses-by-Category amount in `--color-danger` (red). A negative category
total is money coming *back*, so red misreads it. Render a negative total in
`--color-success` and a positive one in `--color-danger` as now — the colour
follows the sign rather than being hardcoded. ("Expenses by Category" is a **list**, not a
chart — an earlier draft of this design wrongly assumed a pie chart and
proposed clamping. No clamping is needed; the only `PieChart` on that page is
Revenue by Platform, which reads sales.)

The Overview area chart may now show a month dipping below zero. That is
correct and needs no special handling.

### Categorisation

`categoryFor(description)` in `_lib/expenseCategory.ts` — a documented keyword
table, matched case-insensitively against the description, unmatched → `other`:

| Category | Keywords (any language) |
|---|---|
| `advertising` | `ads`, `werbung`, `advertising`, `publicidad` |
| `shipping` | `versand`, `fulfilment`, `fulfillment`, `logistik`, `logistica`, `logística`, `fraktas`, `expédition`, `spedizione`, `verzending`, `container packing` |
| `software` | `subscription`, `abonnement`, `sellerboard` |
| `office` | `office`, `büro`, `buero`, `supply`, `towel` |
| `tax` | `epr`, `eco-contribution`, `ecológicas`, `contribuciones` |
| `other` | everything else |

The modal shows the resulting breakdown before import
(`advertising 22 · shipping 40 · software 3 · office 2 · other 42`), so a wrong
guess is visible rather than silent — the reason a keyword map was chosen over
defaulting everything to `other`.

**Known gap:** Amazon *selling/commission* fees (~25 rows) have no fitting
category and land in `other` alongside Benzin and car leasing. Adding a `fees`
category would ripple through `ExpenseCategory`, the DB check, `CategoryBadge`
and the filters, so it is deliberately **out of scope**. Flagged as a
follow-up rather than silently accepted.

### Skip classification

Mirrors Sales' `classifySkip`: skipped rows are counted and named, never
errored, because a real export is full of them.

| Row | Action |
|---|---|
| `Total` summary row | **skip**, counted |
| blank / all-empty | **skip** |
| zero-amount filler (`0.00` with no date) | **skip**, counted |
| unsupported currency | **skip**, counted |
| everything else | validate |

As in Sales, the **format guard must be the first statement** in the function,
so `generic` never inherits `vorsteuer`'s skip behaviour.

### One shared bug this depends on

`src/lib/utils/csv.ts:81-86` splits on newlines **before** parsing fields, so a
quoted field containing a line break becomes two malformed rows. The Q2 sheet
has exactly one. This is a genuine defect in shared code used by all three
importers, and the file cannot import correctly without fixing it.

### The `generic` format

Gains the same locale tolerance (dates, numbers, aliases), matching how Sales
treats its own generic format — "German tolerance applies to ALL formats".
Existing ISO/plain-number templates continue to work unchanged; the tolerance
is strictly additive.

Its **required fields are unchanged** (`date`, `title`, `amount`), and it gains
**no** skip classification — a blank or summary row still errors there, exactly
as today. Only `vorsteuer` skips.

`vorsteuer` requires `date`, `Description` (→ `title`) and `Gross Amount`
(→ `amount`). A row missing any of the three, and not caught by skip
classification, is a row error.

Zero is a legitimate `amount` (the DB check already allowed it, and the sheet's
`0.00` filler rows are skipped structurally rather than by value), so the
`amount <= 0` rejection in the current validator becomes `amount` must be a
number — negative and zero both pass.

## Out of scope

- `ImportPurchasesModal.tsx` — same defect, separate branch.
- A `fees` expense category.
- Bulk re-categorisation UI.
- Matching credit notes to the original expense (no shared key exists — the
  credit note carries a different invoice number, `DE-CN-AEU-…` vs `DE-AEU-…`).
- Any change to Sales' import control flow.

## Testing

Per AGENTS.md: no dev server, no `curl`, and the agent does not run
`npm test`/`tsc`/`lint` mid-task.

All new logic is pure and gets colocated tests, with real rows from the Q2
sheet as fixtures:

- `expenseImportFormats` — a `13.04.2026` date; a credit note (−21.63);
  a 19%-rate/€0.00-VAT row asserting the file's VAT wins; a `Net + VAT ≠ Gross`
  row erroring; the `Total` row skipped not errored; `generic` unaffected.
- `expenseCategory` — one row per language for the same fee; unmatched → `other`.
- `importCoerce` — `"19%"` → 19, `"1.234,56"` → 1234.56, `"€ 342,66"` → 342.66.
- `csv.ts` — a quoted field containing a newline parses as ONE row.

The modal itself has no test coverage (same as Sales); its wiring is verified
by review and by the user in a browser.

## Decisions taken

| Decision | Chosen | Rejected because |
|---|---|---|
| Scope | Expenses + shared vocabulary | All three at once would rework Sales days after it shipped |
| Credit notes | Negative amounts, relax the CHECK | Skipping leaves €218.14/€41.44 unreconciled; a flag makes every SUM special-case it |
| Categories | Multilingual keyword map + visible preview | All-`other` means 109 manual edits per quarter with no bulk-edit UI |
| Format name | `vorsteuer` | Half the file's vendors aren't Amazon |
| `amount` source | Gross | The app's `amount` is gross; `vatAmountFromGross` extracts from it |
| VAT | File's `vat_amount` wins | Four rows have a 19% rate with €0.00 actual VAT |
