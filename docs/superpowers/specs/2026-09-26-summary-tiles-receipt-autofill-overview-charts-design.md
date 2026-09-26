# Summary tiles, PDF receipts + non-AI autofill, Overview charts — design

**Date:** 2026-09-26
**Branch:** `feat/ui-summary-receipts-overview` (worktree `.worktrees/feat-ui-summary-receipts-overview`, cut from `main` @ `81e5e78`)
**Status:** approved in brainstorming, pending spec review

Three independent UI improvements, delivered as three commit groups on one
branch. Part 1 is reviewed before parts 2 and 3 start.

## Migration numbering

`feat/advanced-inventory` (unmerged) already owns `047`/`048`. This branch
starts at **`049`** so the two branches merge without a number collision.
All tenant DDL goes through `public.run_on_all_tenant_schemas` **and** is
mirrored into `provision_tenant_schema()` in `005_tenant_provisioning.sql`
(the 2-places rule in `supabase/SKILL.md`). Functions are **not** `SECURITY
DEFINER` — they run as the caller so existing RLS applies, matching
`045_overview_aggregation_functions.sql`.

---

## Part 1 — Summary tiles on Orders, Purchases, Expenses

### Goal
Replace the "Gross (this page): … · VAT (this page): …" text lines above the
Sales, Purchases and Expenses tables with a row of small, display-only tiles
whose values cover **every record matching the active filters**, not just the
current page. Tiles are not clickable.

### Tiles

| Page | Tiles (in order) |
| --- | --- |
| Orders | Orders (count) · Gross · VAT · Net · Fees (`platform_fee + advertising_fee + shipping_cost`) · Shipping charged · Excluded (count of returned/cancelled) |
| Purchases | Purchases (count) · Units bought · Gross · VAT · Net |
| Expenses | Expenses (count) · Gross · VAT · Net · Top category (name + amount) |

Rules:
- Money is **not** converted — one line per currency inside a tile, same as
  today's `join(" + ")` behaviour, but stacked.
- Orders: gross/VAT/net/fees/shipping exclude returned + cancelled orders
  (current behaviour); "Excluded" counts them. If the status filter is set to
  returned or cancelled, the excluded rows ARE the result set — the function
  honours the status filter first, then the exclusion applies only when no
  status filter is set. (Matches what the page shows today: the summary
  follows the visible rows.)
- A money tile whose every currency value is 0 is hidden. Expenses VAT uses
  `!== 0` (negative VAT from credit notes is real), matching the existing
  `hasVat` comment in `expenses/page.tsx`.
- Count tiles always show (including 0).

### Database — `049_table_summary_functions.sql`
Three functions per tenant schema:

```
get_sales_summary(p_from date, p_to date, p_platform text, p_currency text, p_status text, p_search text)
get_purchases_summary(p_from date, p_to date, p_currency text, p_search text)
get_expenses_summary(p_from date, p_to date, p_category text, p_currency text, p_search text)
```

Each returns `SETOF` one row per currency with the sums/counts above
(`get_expenses_summary` also returns `top_category`, `top_category_amount`
per currency; `get_sales_summary` returns `excluded_count` per currency).
NULL parameter = filter not applied. Search mirrors the `ILIKE` column sets
used by the page thunks today:
- sales: `product_name`, `external_order_id`, `description`
- purchases: `product_name`, `vendor`, `description`
- expenses: `title`, `vendor`, `description`, `invoice_number`

Search term is bound as a parameter (`'%' || p_search || '%'`), never
concatenated into SQL.

Row volume: the functions aggregate server-side and return ≤ one row per
currency — structurally bounded by the number of currencies in use, so no
pagination is needed (checklist item 3/4 in `AGENTS.md`).

### Client
- **Shared filter mapping.** Each slice's `fetchXPage` builds its PostgREST
  filters inline. Extract a pure `xFilterParams(filters, dateRange)` per
  feature (in `_store/`) that returns the normalised filter values; both the
  page thunk and the summary thunk consume it so they cannot drift. Colocated
  tests.
- **Thunk.** Each slice gains `fetchXSummary` (state: `summary`,
  `summaryLoading`). Pages dispatch it when filters/date range change — **not**
  on page/sort change — and after create/edit/delete/import (same places that
  refetch the page today).
- **Atom.** New `src/components/ui/SummaryTiles.tsx` (3 consumers → shared).
  Props: `tiles: { label: string; lines: string[]; tone?: "default" | "success" | "danger" | "muted" }[]`, `loading: boolean`.
  Compact tiles: `rounded-[var(--radius-btn)]`, `border-[var(--color-border)]`,
  `px-3 py-2`, label `text-[11px]` muted, value `text-sm font-semibold
  tabular-nums`, wrapping flex row. Skeleton tiles while loading. Tokens only,
  no hardcoded colours.
- The "(this page)" `summary` useMemo blocks in the three pages are deleted.

### Errors
Summary fetch failure → tiles row shows a single muted "Totals unavailable"
line and a `useToast()` error; the table itself is unaffected. Raw Postgres
errors are never surfaced.

---

## Part 2 — Expense receipts: PDF support + non-AI autofill

### PDF support
- `ReceiptUploader.tsx`: accept `image/*,application/pdf`; the type guard
  becomes image-or-PDF; 15 MB cap unchanged.
- The `expense-receipts` bucket (046) sets no `allowed_mime_types`, so **no
  migration is needed**.
- PDF entries render a `FileText` icon + filename instead of a thumbnail;
  clicking opens the existing short-lived signed URL in a new tab
  (`rel="noopener noreferrer"`).

### Autofill ("Fill from receipt")
A button on each receipt entry in Add/Edit Expense modals. No AI, no network
calls except fetching OCR assets; the file never leaves the browser.

**`expenses/_lib/extractReceiptText.ts`** (browser-only, dynamically imported
on click so neither library is in the main bundle):
1. PDF → `pdfjs-dist` text extraction of all pages.
2. If the PDF yields < 40 non-whitespace chars (scanned), render page 1 to a
   canvas at 2× scale and OCR it.
3. Image → OCR directly.
OCR = `tesseract.js` with `deu+eng`. Worker/core/lang data load from the
library's default CDN on first use and are then browser-cached.
Returns `{ text: string; source: "pdf-text" | "ocr" }`.

**`expenses/_lib/parseReceipt.ts`** (pure, fully unit-tested):
`parseReceipt(text): ParsedReceipt` with all fields optional:
`date, amount, currency, vatRate, vatAmount, vendorVatNumber, invoiceNumber,
vendor, category`.
- Numbers: handles `1.234,56`, `1,234.56`, `1234,56`, `1234.56`, `€`/`EUR`/
  `£`/`GBP`/`$`/`USD` prefixes/suffixes.
- Amount: the largest amount on a line containing a total keyword
  (`Gesamt`, `Gesamtbetrag`, `Summe`, `Endbetrag`, `Total`, `Amount due`,
  `Grand total`, `Zu zahlen`), falling back to the largest amount on the page.
- Currency: symbol/ISO code nearest the chosen amount; else the most frequent
  one; restricted to the app's `Currency` type.
- VAT: rate from `(\d{1,2}(?:[.,]\d)?)\s?%` near `MwSt|USt|VAT|Mehrwertsteuer|Umsatzsteuer`;
  amount from the same line. Cross-check `vatAmount ≈ amount·rate/(100+rate)`
  within 0.02; if only one of rate/amount found, derive the other when the
  check can be made.
- VAT number: EU pattern `\b[A-Z]{2}\s?[0-9A-Z]{8,12}\b` restricted to known
  EU prefixes + `GB`, preferring one near `USt-IdNr|VAT No|UID`.
- Invoice number: token after `Rechnungsnummer|Rechnungs-Nr|Rechnung Nr|Invoice No|Invoice #|Invoice Number|Beleg-Nr`.
- Date: `dd.mm.yyyy`, `dd/mm/yyyy`, `yyyy-mm-dd`, `d. Monat yyyy` (German +
  English month names); prefer one near `Datum|Rechnungsdatum|Date|Invoice date`;
  reject future dates > 1 day ahead.
- Vendor: first non-empty line that is not an address/number/keyword line
  (heuristic, low confidence).
- Category: only suggested via a small keyword map
  (e.g. `DHL|DPD|Hermes|UPS|Deutsche Post → shipping`) against
  `ExpenseCategory` values; otherwise unset.

**Applying results** (in the modals):
- Only **empty** fields are filled; nothing the user typed is overwritten.
- Filled fields get a subtle highlight (token-based ring) until edited.
- Toast: "Filled N fields from receipt" / "Couldn't read any details from this
  receipt".
- Button: `Wand2`/`ScanText` icon, "Fill from receipt" → "Reading…" with
  `Loader2 animate-spin`, disabled while running or while an upload is in
  flight. Errors (worker load failure, corrupt PDF) → error toast, form
  untouched.
- Title is never auto-filled — it stays manual so the user's own naming is
  kept explicit.

Dependencies added: `pdfjs-dist`, `tesseract.js`. pdf.js worker is loaded via
`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` — verify
against this Next.js version's bundler docs in `node_modules/next/dist/docs/`
during planning.

---

## Part 3 — Overview as chart cards

### Database — `050_overview_timeseries.sql`
`get_overview_timeseries(p_from date, p_to date, p_currency text) RETURNS jsonb`
(one call, like the 045 functions, filtered to the profile's base currency):

```
{
  "months": [ { "month": "2026-01",
                "revenue_by_platform": { "ebay": n, "amazon": n, ... },
                "orders": n, "returned_cancelled": n,
                "expenses_by_category": { "<category>": n, ... },
                "purchases": n, "units": n,
                "vat_collected": n, "vat_paid": n } ],
  "previous": { "revenue": n, "expenses": n, "purchases": n, "orders": n },
  "top_vendor": { "name": text, "amount": n } | null
}
```
`previous` covers the equal-length window immediately before `[p_from, p_to]`
(null when either bound is null, i.e. "all time"). Months with no data are
emitted as zero rows via `generate_series` so charts have no gaps. Returned/
cancelled orders are excluded from revenue, consistent with the existing
overview. The existing 045 functions and `payouts` stay as they are.

### Client
- **`dashboard/_lib/overviewCharts.ts`** (pure, tested): `pctChange(cur, prev)`
  (null when prev is 0/missing), `margin`, `bestWorstMonth`,
  `stackedSeries(months, key)`, `topCategoryShare`, `netProfitSeries`,
  `balanceBars(balance)`.
- **`dashboard/_components/`**: `ChartCard.tsx` (title, headline value,
  change badge ▲/▼ with success/danger token, meta line, chart slot, empty
  state "No data in this period") plus `RevenueCard`, `ExpensesCard`,
  `PurchasesCard`, `NetProfitCard`, `OrdersCard`, `PlatformBalanceCard`
  (used for eBay and Amazon), `VatCard`, `TopProductsCard`.
- Charts: `recharts` (already installed), existing chart palette constant in
  `page.tsx` moved to `_lib/chartPalette.ts`. Tooltips format with
  `formatCurrency`.
- `page.tsx` keeps: period filter, data fetching, Quick Start. The tile grid,
  inline Monthly Trend/Platform pie/VAT/Top products/Expenses-by-category
  sections are replaced by the cards in a responsive grid
  (`grid-cols-1 lg:grid-cols-2`, balance cards full width on small screens).
- Cards are display-only (no click-through).

### Cards

| Card | Headline | Chart / extras |
| --- | --- | --- |
| Revenue | total + Δ% | monthly stacked bars by platform; AOV, order count |
| Expenses | total + Δ% | monthly stacked bars by category; top category share |
| Purchases | total + Δ% | monthly bars; units bought, top vendor |
| Net Profit | total + margin % | monthly line (revenue − expenses − purchases); best/worst month |
| Orders | count + Δ% | monthly bars; returned/cancelled rate |
| eBay / Amazon Balance | balance earned | horizontal bars: sales, fees, expenses, transferred, pending |
| VAT Position | net VAT due | monthly grouped bars collected vs paid |
| Top Products | top 5 | horizontal bars by revenue |

---

## Testing
- `_store/*FilterParams.test.ts` for each of the three features.
- `SummaryTiles` tile-building helpers (hide-zero, per-currency lines) tested
  as a pure function next to the atom.
- `parseReceipt.test.ts`: ≥ 10 fixture texts (German supermarket-style,
  German Rechnung, English invoice, Amazon/eBay PDF text, DHL receipt, noisy
  OCR with `O`/`0` confusion, credit note, no-VAT receipt, multi-currency).
- `overviewCharts.test.ts` for every helper.
- SQL functions are exercised by extending the existing
  `overviewRpc.integration.test.ts` pattern where the environment allows.
- Manual browser check (user or Playwright MCP if dev server is running) for
  each part.

## Docs
Same-commit updates to `sales/`, `purchases/`, `expenses/`, `dashboard/`
`CLAUDE.md` + `SKILL.md`, `src/components/ui/SKILL.md`, and
`supabase/SKILL.md` file-map table (049, 050 — not applied).

## Out of scope
AI-based receipt reading; clickable tiles/cards; currency conversion in
tiles; OCR of PDF pages beyond page 1; scheduled/background parsing.
