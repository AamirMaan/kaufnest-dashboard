# Multi-currency imports, expense receipts, and month/quarter filters

**Date:** 2026-09-15
**Status:** Design approved by user (in conversation). Ready for an implementation plan.

## Problem

Four unrelated-looking requests that share one import path and one filter helper.

### 1. Non-base currencies are silently booked as base currency

`Currency` is `"EUR" | "USD" | "GBP"` (`src/types/index.ts:32`). A sheet row in
any other currency cannot be represented, and the import does not notice —
`validateRowForFormat` defaults an unreadable currency column to `EUR`
(`sales/_components/importFormats.ts:471`).

Confirmed live on `tenant_k2_textil`'s May 2026 Amazon VAT report. The sheet's
currency column is named `TRANSACTION_CURRENCY_CODE`; the alias table
(`lib/utils/importAliases.ts:38`) recognises only `currency` / `währung` /
`waehrung`, and alias matching is exact — so the column is never mapped. **24
Swedish orders worth 4 057,20 SEK (≈ €360) were booked as €4 057,20**, and
their 374,80 SEK of VAT landed in "VAT Collected" as euros. Revenue for the
month was overstated by roughly €3 320 on a true figure near €12 180.

`classifySkip` already has an `"unsupported currency"` guard
(`importFormats.ts:273`) — it just never fires, because the column it reads is
always blank.

Storing SEK correctly is **not** sufficient on its own. Overview filters every
table to `profileCurrency` to avoid meaningless mixed-currency sums
(`dashboard/page.tsx:168`), so a correctly-stored SEK order would simply vanish
from the dashboard rather than be wrong on it. Conversion is what makes the
data usable.

### 2. Expenses cannot hold a receipt

There is nowhere to attach the invoice or receipt an expense was entered from.
The evidence lives in someone's inbox, and a tax audit cannot follow the row
back to its document.

### 3. No month selection

`getPresetRange` (`lib/utils/filters.ts:19`) offers `this_month` and
`last_month`. There is no way to open March, or any month of a previous year.

### 4. Quarter selection is current-quarter only

`this_quarter` computes `Math.floor(now.getMonth() / 3)` from *today*. In Q3
there is no way to look at Q2 or Q1, let alone a quarter of last year — which
is exactly the view a quarterly VAT return needs.

## Scope

**In scope**

- Currency conversion at import time for **orders, expenses and purchases**,
  with a mandatory rate-review step the user confirms before anything is
  written.
- Multiple image receipts per expense, in a private Supabase Storage bucket.
- A "Specific period" date filter — any month, any quarter, or a full year, for
  any year with data — on Overview, Sales, Expenses, Purchases and Audit Logs.
- Two further defects in the same Amazon import path, found in the same audit
  (see "Adjacent import defects" below): multi-line orders losing every line
  after the first, and refunds silently discarded when they match no sale.

**Out of scope**

- PDF receipts. Most German supplier invoices arrive as PDFs, so this is the
  obvious follow-up, but it needs a second render path (file-type icon instead
  of a thumbnail) and is not required to close the gap.
- Converting historical rows already imported at the wrong currency. The May
  2026 data will need a one-off correction; that is a data task, not a code
  task, and is tracked separately.
- Reporting in a currency other than the tenant's base currency. Everything
  stored stays single-currency; the original is kept for audit only.
- A scheduled/background rate refresh. Rates are fetched on demand and cached.

## 1. Currency conversion

### Schema

Migration `045_multicurrency_and_receipts.sql`, applied through
`run_on_all_tenant_schemas` (never `ALTER TABLE tenant_kaufnest.*` directly —
there are multiple live tenants), **and** mirrored into
`provision_tenant_schema()` in `005_tenant_provisioning.sql`. That two-places
rule is the one in `supabase/SKILL.md`; a migration that updates only the first
leaves every future tenant without the columns.

On `sales`, `expenses` and `purchases`:

| Column | Type | Meaning |
| --- | --- | --- |
| `original_currency` | `text` | ISO-4217 code as it appeared in the sheet, e.g. `SEK`. |
| `original_total_amount` | `numeric` | The headline gross **before** conversion, for reconciliation. |
| `fx_rate` | `numeric` | Units of base currency per one unit of `original_currency`. |
| `fx_rate_date` | `date` | The date the rate was actually published (see the weekend rule). |

All four are nullable. **Null means no conversion happened** — a row entered in
the base currency has all four null, and that is the normal case. The existing
money columns always hold base-currency amounts, so every aggregation, export
and invoice keeps working untouched.

`Currency` stays `"EUR" | "USD" | "GBP"` — it types the *stored* amount, and
widening it would push mixed-currency handling into every consumer. The
original currency is a plain ISO-4217 string, validated on the way in.

### Rate source

ECB daily reference rates, via `https://data-api.ecb.europa.eu` (no API key,
CSV response).

**Mind the direction.** The ECB publishes the value of **one euro** in the
foreign currency — the `D.SEK.EUR.SP00.A` series gives `11.4…`, meaning 1 EUR =
11.4 SEK, not the other way round. Writing `quote(C)` for that published figure
(and `quote(EUR) = 1` by definition), the rate this spec stores is:

```
rate(X → base) = quote(base) / quote(X)
```

So SEK → EUR is `1 / 11.4 = 0.0877`, and a tenant based in USD cross-rates
through EUR with the same formula. Getting this inverted is the easiest possible
mistake here and it fails silently — a 130× overstatement looks like a data
problem, not a formula problem.

**The ECB publishes nothing on weekends or TARGET holidays.** When a date has
no publication, walk back up to 7 calendar days to the most recent one and
record *that* date in `fx_rate_date` — the standard treatment, and the one a
tax audit expects to see documented. If 7 days yield nothing, the currency is
unresolved and falls to manual entry.

### Files

- `src/lib/fx/ecb.ts` — **server-only.** Fetch and parse ECB CSV, cross-rate
  through EUR, apply the walk-back rule. Never imported from a Client
  Component; the project verifier's `guard_edit.py` denies that at write time.
- `src/lib/fx/convert.ts` — pure. `convertAmount(amount, rate)` with
  half-up rounding to 2dp, and `applyRate(bag, rate)` for the money fields of
  one parsed row. Colocated `convert.test.ts`.
- `src/app/api/fx/rates/route.ts` — `POST`. Takes
  `{ base: Currency, pairs: { currency: string, date: string }[] }`, returns
  `{ rates: Record<string, { rate: number, rateDate: string }>, unresolved: string[] }`.
  **Auth-guarded** — a route handler reaching Supabase without one is a
  verifier finding. Reads through the cache below before calling ECB.
- `control.fx_rates` — cache table in the control plane (Project A), keyed
  `(rate_date, currency)`, holding `quote(C)` exactly as the ECB published it —
  units of that currency per 1 EUR, never a derived pair rate, so a later base
  currency change needs no cache rebuild. FX rates are global
  reference data, not tenant data, so the control plane is the right home; the
  route is server-side, so `createControlClient` is legal there.

### Rate review — the step the user confirms

**No import writes a row until the user has seen and accepted the rates.**
After parsing, each import modal collects the distinct non-base currencies in
the file, requests rates in one round trip, and renders a review step:

| Currency | Rows | Date span | Rate | Source |
| --- | --- | --- | --- | --- |
| SEK | 26 | 29 May – 31 May 2026 | 0,08741 – 0,08812 | ECB per order date |
| PLN | 3 | 14 May 2026 | 0,23180 | ECB per order date |

Each currency has two modes:

- **ECB per order date** (default) — each row converts at the rate for its own
  date. The column shows the range across the file, or a single figure when the
  span resolves to one rate.
- **Manual** — the user types one rate, applied to **every row of that
  currency** in the file. This is the granularity the user asked for, and it is
  what a bookkeeper working to a fixed month rate needs.

Any currency can be flipped to Manual. A currency ECB could not resolve (API
down, exotic code, no publication in the walk-back window) **starts** in Manual
with an empty required input, and the import stays blocked until it is filled.

The confirm button follows the project's form conventions: `type="submit"` on a
real `<form>`, `disabled` while saving **and** while any rate is missing or
non-positive, and a busy verb while in flight.

Because three modals need this, it is shared: `src/components/import/FxRateReview.tsx`
(component) and `src/components/import/fxReviewState.ts` (pure state reducer +
`resolveRowRate(row, review)`, colocated test). Three consumers clears the 3+
bar in AGENTS.md's shared-vs-feature-private rule.

### Import wiring

- **Sales** — `sales/_components/ImportSalesModal.tsx` + `importFormats.ts`.
- **Expenses** — `expenses/_components/ImportExpensesModal.tsx` +
  `expenseImportFormats.ts`.
- **Purchases** — `purchases/_components/ImportPurchasesModal.tsx`. This one
  parses inline with no format registry, so the row-building code moves to a new
  `purchases/_components/purchaseImportFormats.ts` first, matching the other two.
  That extraction is what makes the shared review step attachable at all.

Add the Amazon header names to `ALIASES` in `lib/utils/importAliases.ts` so the
currency column is actually read: `transaction_currency_code` for `currency`,
and `total_activity_value_vat_amt` for `vat_amount` (the sheet's own combined
item+shipping VAT, currently ignored in favour of a single-rate derivation that
cannot represent a mixed-rate order).

### Display

Order and expense detail show the original alongside the converted figure:

> €355,61 — originally SEK 4 057,20 @ 0,08765 (ECB 2026-05-29)

Rendered only when `original_currency` is non-null.

## 2. Expense receipts

### Schema

On `expenses`, in the same migration: `receipts jsonb NOT NULL DEFAULT '[]'` —
an array of `{ path, name, mime, size, uploaded_at }`. A jsonb array rather than
a child table: no join on a hot list query, and it matches how listings already
store their image set.

### Bucket

`expense-receipts`, **private** (`public = false`). Path convention
`{tenant_schema}/{expense_id}/{uuid}.{ext}`, exactly as `listing-images` does —
the tenant-schema prefix is load-bearing, because the RLS policies compare
`(storage.foldername(name))[1]` against the caller's JWT `tenant_schema` claim.

Private is the deliberate difference from `listing-images`. That bucket is
public because eBay must fetch the URLs; a receipt is a financial document with
no such requirement, so it is read through a short-lived
`createSignedUrl(path, 60)` instead of a permanent public URL.

Policies reuse `public.current_tenant_role()` from
`022_listing_images_bucket.sql` — already schema-agnostic and already deployed.
Read is allowed to any authenticated member of the tenant (expenses are not
admin-only); insert and delete match the role that may edit an expense.

### Files

- `expenses/_lib/receiptPath.ts` — `EXPENSE_RECEIPTS_BUCKET`,
  `buildReceiptPath(tenantSchema, expenseId, fileName)`,
  `pathFromStoredReceipt(...)`. Colocated `receiptPath.test.ts`. The
  user-supplied filename is discarded in favour of a UUID, for the same reason
  it is in listings: spaces, unicode, slashes, and same-millisecond collisions.
- `expenses/_components/ReceiptUploader.tsx` — thumbnail strip, add, remove,
  per-file progress. Used by both `AddExpenseModal` and `EditExpenseModal`.

Images only (`image/*`). An upload in flight disables Save and shows a busy
verb; both success and failure fire a `useToast()`.

**Orphan rule:** on Add, the expense row is created first so the upload has an
`expense_id` to key its path on. If the row insert fails, nothing was uploaded.
If an upload fails after the row exists, the expense stands with fewer receipts
and the toast says so — no silent partial success.

## 3 + 4. Month and arbitrary-quarter filter

### Why this needs no schema or slice change

`getPresetRange(preset)` is called from four slices, each of which pushes the
resulting range straight into Supabase (`salesSlice.ts:43`). A year+period
selection resolves to an ordinary `{ from, to }` pair — so the picker sets
`preset: "custom"` with computed dates and every consumer works unchanged. No
new `DatePreset` value reaches the slices, no filter-state field is added in
four places, and the server-side pushdown is untouched.

The one cost is that the dropdown must re-derive its own label after a remount,
since the stored state is just a date pair. That derivation is exact: a pair
spanning precisely one calendar month, quarter or year has exactly one reading.

### UI

`components/ui/FilterBar.tsx` and Overview's own `RANGE_PRESETS` list
(`dashboard/page.tsx:42` — deliberately separate from FilterBar's) each gain a
**"Specific period"** entry. Choosing it reveals two selects:

- **Year** — earliest year with data through the current year, descending.
- **Period** — Full year, Q1–Q4, January–December.

Changing either recomputes `{ from, to }` and updates the filter state.

### Helpers

Both pure, in `lib/utils/filters.ts`, with cases added to `filters.test.ts`:

```ts
type PeriodUnit = "full" | "q1" | "q2" | "q3" | "q4"
               | "01" | "02" | ... | "12";

periodRange(year: number, unit: PeriodUnit): { from: string; to: string }
describePeriod(from: string, to: string): { year: number; unit: PeriodUnit } | null
```

`describePeriod` returns null when the pair is not an exact period span — which
is how a hand-typed custom range keeps rendering as "Custom Range" rather than
being mislabelled.

Month-end arithmetic uses the existing `new Date(y, m + 1, 0)` idiom already in
`getPresetRange`, so February and leap years need no special case.

## Adjacent import defects

Both found in the same 2026-09-15 audit of the May sheet, both in the Amazon
import path this spec already touches, and both fixed here.

### Multi-line orders lose every line after the first

`markDuplicates` keys on `` `${platform}:${external_order_id}` ``
(`ImportSalesModal.tsx:258`) and marks the second line of a multi-SKU order
`"duplicate in file"`. In the May sheet that silently dropped **27 order lines,
€816,35 and 35 units**.

The file's own code already knows better: 260 lines further down, the refund
matcher's comment states order ids are *"NOT unique within an Amazon sheet — a
multi-line order appears once per SKU"* and correctly adds `product_id` to its
matching key. The dedupe key was never given the same treatment.

**Fix:** key the in-file dedupe on `(platform, order_id, sku)`. Note that 4 of
the sheet's 1012 SALE lines share both order id *and* SKU — genuinely the same
product split across two lines — so those must be **merged** (quantities and
money summed) rather than dropped, or the fix leaks a smaller version of the
same bug.

### Refunds that match no sale disappear

30 REFUND rows; 22 matched a sale in the file, 8 refunded orders from an earlier
month that the file does not contain. Those 8 (**€93,21**) are counted in the
summary and then discarded.

**Fix:** surface unmatched refunds as a blocking warning listing the order ids,
with an explicit "import anyway" acknowledgement, rather than a number in a
summary nobody reads. A refund that silently evaporates is an understatement of
returns in a filed VAT figure.

### Not fixed here

404 of the 985 May orders (€7 662,90, ~49 % of gross) carry `vat_rate = 0` in
the sheet itself, with `TAX_COLLECTION_RESPONSIBILITY = SELLER` and
`TAX_REPORTING_SCHEME = REGULAR`. Amazon's VAT Calculation Service reported no
VAT on them and the app is copying that faithfully. This is an Amazon VCS
configuration question for the tenant, not an app defect.

## Testing

| Area | Tests |
| --- | --- |
| FX maths | `lib/fx/convert.test.ts` — rounding, cross-rate through EUR, zero and negative guards |
| Rate review state | `components/import/fxReviewState.test.ts` — mode switching, unresolved-currency blocking, `resolveRowRate` precedence |
| Receipt paths | `expenses/_lib/receiptPath.test.ts` — tenant prefix, extension handling, foreign-URL rejection |
| Period helpers | `lib/utils/filters.test.ts` — every quarter, month-end and leap-year boundaries, `describePeriod` round-trip and its null cases |
| Import formats | `importFormats.test.ts`, `expenseImportFormats.test.ts`, new `purchaseImportFormats.test.ts` — currency mapping, conversion applied, the multi-line dedupe fix including the same-SKU merge |

Per the working agreement: run the focused `npx jest <path>` for what changed;
`.husky/pre-commit` runs `tsc --noEmit`, `eslint` and the verifier, and
`.husky/pre-push` runs the full suite plus `next build`.

## Docs to update in the same commits

- `src/app/dashboard/expenses/CLAUDE.md` / `SKILL.md` — receipts file map, the
  orphan rule, the private-bucket-vs-public gotcha.
- `src/app/dashboard/sales/SKILL.md` — the dedupe-key gotcha and the FX step.
- `src/app/dashboard/purchases/CLAUDE.md` — new `purchaseImportFormats.ts`.
- `src/components/ui/SKILL.md` — FilterBar's "Specific period" mode.
- `src/lib/utils/SKILL.md` — `periodRange` / `describePeriod`.
- `supabase/SKILL.md` — migration `045` in the file-map table, and the new
  bucket.
- `AGENTS.md` — `src/lib/fx/` and `src/components/import/` in the shared list.

## Open questions

None. The four design decisions (convert-at-import, ECB rates, multiple image
receipts, year+period dropdown pair) were settled in conversation on
2026-09-15, and the user-confirmed rate-review step was added at the same time.
