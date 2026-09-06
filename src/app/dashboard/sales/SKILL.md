---
name: sales-feature
description: Work on the Sales dashboard feature (list, add/edit/delete sales records, invoices) at src/app/dashboard/sales — use when the task mentions sales, sale records, or the /dashboard/sales route.
---

# Working on the Sales feature

This feature is fully colocated under `src/app/dashboard/sales/`. Read
`CLAUDE.md` in this folder first — it explains the file map and the
Supabase-write → slice-update → audit-log data flow every mutation follows.

## Minimal file set for common changes

- **Add/change order-detail page content**: `[id]/page.tsx` only. For net-proceeds
  or gross-profit formula changes also touch `_components/orderMath.ts` + its test.
- **Wire the Download Invoice button** (Phase 5 — DONE): `[id]/page.tsx` — the
  button now calls `handleDownloadInvoice()` which calls `generateOrderInvoice(sale,
  companyProfile)` from `@/lib/utils/generateInvoice`. `companyProfile` is read from
  `useAppSelector((s) => s.companyProfile.profile)` (hydrated by the dashboard
  layout). Button stays disabled only while `companyProfile` is null.
  - Per-order invoice recipe lives in `generateInvoice.ts → generateOrderInvoice`.
    Uses `invoiceNumberFor` (deterministic, id-based) and `computeOrderInvoiceTotals`
    from `invoiceMath.ts`. Logo is fetched async before `addHeader` is called and
    passed as a pre-resolved `logoDataUrl` string parameter.

- **Add/change a field on a sale**: `_components/AddSaleModal.tsx` (create form),
  `_components/EditSaleModal.tsx` (edit form + before/after audit diff),
  `_store/salesSlice.ts` only if the shape stored in Redux changes, and
  `src/types/index.ts` for the `Sale` type. Also check `page.tsx` if the field
  needs to render in the table or be filterable (`lib/utils/filters.ts`).
  **Also update `_components/importFormats.ts`** if the new field should be
  importable — add an `ALIASES` entry (EN + German header names), a `col(...)`
  to each format's `columns`, template headers/example, and validation in
  `validateRowForFormat()`. The modal itself rarely needs to change.
- **Add/change an order status**: `_components/orderStatus.ts` (`ORDER_STATUSES`
  preset list + `statusLabel`/`isPresetStatus`) and its colocated test. Also
  check `StatusBadge` in `src/components/ui/Badge.tsx` for a variant mapping if
  you add a new preset that should render with a non-default color.
- **Change the shipping-label-generation modal (rates/buy flow)**:
  `_components/GenerateLabelModal.tsx` only — it's a self-contained
  fetch-driven two-step modal (`POST /api/shipping/rates` then `POST
  /api/shipping/buy`, both under `src/app/api/shipping/`), no Redux slice of
  its own. Package-dimension/weight fields live in step 1's `<form
  id="generate-label-form">`; rate list rendering lives in step 2. Types
  (`EasyPostRate`, `Shipment`) and the EasyPost wrapper live in
  `src/lib/shipping/` — not this folder. As of 2026-09-06 (Task 6) the
  component exists but is not yet imported anywhere; Task 7 wires it into
  `[id]/page.tsx`'s order-detail page action row.
- **Change list/filter/table behavior**: `page.tsx` only.
- **Change server-side filter pushdown logic**: `_store/salesSlice.ts` →
  `fetchSalesPage` thunk. Filters map: `preset`/`dateFrom`/`dateTo` →
  `gte/lte("date", ...)`, `platform` → `eq("platform", ...)`,
  `currency` → `eq("currency", ...)`, `status` → `eq("status", ...)`.
- **Change pagination defaults** (page size, etc.): `src/lib/utils/pagedQuery.ts`
  (`DEFAULT_PAGE_SIZE`) — affects all features once they adopt this pattern.
- **Change reducer logic**: `_store/salesSlice.ts` + its test.
- **Change export columns**: `handleExport()` in `page.tsx` — edit the `headers`
  array and the row-mapping lambda.
- **Change import validation / accepted columns / header aliases / add a new
  import format**: `_components/importFormats.ts` only (pure registry —
  `IMPORT_FORMATS`, `ALIASES`, `validateRowForFormat`). Extend
  `importFormats.test.ts` in the same commit. Locale parsing primitives
  (decimal commas, German dates, delimiter detection) live in
  `src/lib/utils/localeParse.ts` and `src/lib/utils/csv.ts`.

- **Add or change a shipping-address field**: `supabase/migrations/041_sales_shipping_address.sql` +
  `supabase/migrations/005_tenant_provisioning.sql` (schema), `src/types/index.ts`
  (the `Sale` type), `src/lib/integrations/mapToSale.ts` (eBay sync mapping),
  `_components/AddSaleModal.tsx` + `EditSaleModal.tsx` (manual entry),
  `[id]/page.tsx` (display).
- **Change eBay order status push-back** (shipped/cancelled → eBay): the four
  touch points are `_components/EditSaleModal.tsx` (the trigger + the
  Carrier/Tracking fields), `[id]/page.tsx` (the Retry row),
  `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts` (the
  server side), and `src/lib/utils/filters.ts` →
  `isEbayIntegrationSyncedSale` (the eligibility predicate both ends share).
  Full contract in `src/lib/integrations/SKILL.md`'s "eBay order status
  push-back" section; see the gotchas below before changing any of it.

## Test command

`npx jest dashboard/sales` — runs `_store/salesSlice.test.ts` and
`_components/orderMath.test.ts` (and any other `*.test.ts` colocated here).
The push-back eligibility predicate is tested with the shared filters:
`npx jest lib/utils/filters`.

## Gotchas — eBay order status push-back

Four traps, all found in the 2026-09-04 final review of the feature and all
fixed — don't reintroduce them:

- **Reconcile Redux after the sync, or the Retry row is invisible.** The
  sync-status route writes `ebay_sync_error`/`ebay_fulfillment_id`/
  `ebay_synced_at` server-side, *after* `EditSaleModal`'s own
  `.update().select()` has already returned the pre-sync row. `[id]/page.tsx`
  renders `storeVersion ?? fetchedSale` and never re-fetches once a store
  version exists, so whatever Redux holds is what the user sees. Both call
  sites therefore end with `const fresh = await fetchSaleById(sale.id); if
  (fresh) dispatch(updateSale(fresh));` — unconditionally, success and
  failure. Failure is what makes the Retry row appear; success is what clears
  a stale error from a previous attempt.
- **Never re-inline `platform === "ebay" && external_order_id`.** Use
  `isEbayIntegrationSyncedSale` (`lib/utils/filters.ts`). A CSV-imported eBay
  row passes the naive check but has no `":"` line-item suffix, so the route
  would use the whole id as both `orderId` and `lineItemId` and eBay would
  reject it every single time — while the user was still forced through the
  required Carrier/Tracking fields. The predicate is in `lib/utils/` and not
  `lib/integrations/` on purpose: `EditSaleModal` is a Client Component and
  the project verifier BLOCKS `@/lib/integrations/*` imports from `"use
  client"` files (the existing `ebay/carriers` import there only survives via
  a `// verifier:allow server-module-in-client` comment on the line above it).
- **A 403 writes nothing server-side.** `requireIntegrationAdmin()` runs
  before the route touches the row, and `manage_integrations` excludes
  `accountant` while `update_sale` (which opens the modal) includes it. So
  `EditSaleModal` writes `ebay_sync_error` from the client on *any* sync
  failure — otherwise an accountant's status change silently never reaches
  eBay and leaves no trace for an admin to retry.
- **`createShippingFulfillment` is not idempotent on eBay's side.** eBay
  allows several fulfillments per order (partial shipments), so a retry after
  "eBay call succeeded, local DB write failed" double-ships the order with no
  error. The route short-circuits on `status === "shipped" &&
  sale.ebay_fulfillment_id` and only re-runs the local write. The `cancelled`
  branch has no equivalent key and deliberately no guard.
- Related: `tracking_number`/`shipping_carrier` are only overwritten by a save
  that sets the order TO `"shipped"`. Any other status passes the existing
  values through — nulling them on the normal shipped → delivered step erased
  the record of what was pushed to eBay while `ebay_fulfillment_id` survived.

## Gotchas — buyer shipping address

- **Pre-existing eBay orders never backfill their address on a later
  re-sync.** `mergeImportedSale`'s ownership rule for these nine fields is
  inverted from most others: existing wins over incoming, always — it can't
  tell "user cleared it" from "never captured", so an existing `NULL` beats
  an incoming real value every time. An order imported/synced before
  migration `041_sales_shipping_address.sql` landed has `NULL` in all nine
  columns and will keep it forever, no matter how many times it's re-synced.
  Only orders synced AFTER 041 landed get an auto-captured address; older
  ones need the address filled in by hand via Edit Order.
- **Editing a sale writes these nine fields into the audit log's before/after
  snapshot whenever they're set** — same full-snapshot pattern
  `EditSaleModal` already used for every other field before this feature, not
  a new pattern. The consequence is new, though: a buyer's name, address,
  phone, and email now accumulate in `audit_logs.metadata` on *every* edit of
  that order, not just edits that touch the shipping section. This changes
  the audit table's data-protection profile — a GDPR erasure request against
  a buyer now needs to consider audit rows too, not just the `sales` row.

## Gotchas — fee fields

- `shipping_cost`, `shipping_charged`, `advertising_fee`, `platform_fee` are
  all `number | null`. Empty string in form state → `null` before the DB
  write (never `0`). This is the same pattern as `vat_rate`/`vat_amount`.
- `EditSaleModal` auto-opens the "Fees & shipping" section when the existing sale has
  at least one fee non-null (checked in the `showFees` initializer).
- Import validation lives in `validateRowForFormat()` in the pure
  `_components/importFormats.ts` (unit-tested in `importFormats.test.ts` and
  `ImportSalesModal.test.ts`); the modal only orchestrates file reading, the
  dedup query, and inserts.
- The table "Fees" column sums `shipping_cost + advertising_fee + platform_fee`
  (seller costs); `shipping_charged` is not in the computed sum — it's the
  buyer-facing amount and appears only in the CSV export.
- **`005_tenant_provisioning.sql`'s `sales` CREATE TABLE was missing all four
  fee columns until 2026-08-27, despite all four being live on every existing
  tenant.** `010_order_fees.sql` added the first three via
  `run_on_all_tenant_schemas` (after `027_reconcile_tenant_drift.sql` fixed
  `010`'s own original bug — it had hardcoded `tenant_kaufnest` instead of
  using `run_on_all_tenant_schemas`), but nobody updated `005`'s CREATE TABLE
  template alongside either fix, so a tenant provisioned any time between
  `010` and this fix would have been provisioned WITHOUT them. Found while
  adding `platform_fee` (035) — checking `005` before adding a new fee column
  is what surfaced it. Confirmed live via direct query that all 5 tenants
  already had the first three (so `010`/`027` themselves were fine, just
  `005`'s template was stale) before fixing `005` alongside `035`. **If you
  add a 5th fee column, add it to BOTH the new migration's
  `run_on_all_tenant_schemas` call AND `005`'s `sales` CREATE TABLE — this is
  exactly the gap that bit this column family twice.**
- `_components/FeeAmountOrPercentField.tsx` computes the percent-mode amount
  via `computeFeeFromPercent(itemTotal, pct)` (`lib/utils/currency.ts`),
  where `itemTotal` is `qty × unit_price` — confirmed with the user
  explicitly rather than assumed, since "% of the order" is genuinely
  ambiguous (item total only, vs. item + shipping). If a future request
  wants the shipping-inclusive base, that's a one-line change to what gets
  passed as `itemTotal` in both modals, not a change to the component or
  `computeFeeFromPercent` itself.

## Gotchas — CSV import formats (German support)

- **`Versandkosten` maps to `shipping_charged`** (what the buyer paid — I6), NOT
  `shipping_cost`. Seller-side shipping needs an explicit `shipping_cost` /
  `versandkosten_bezahlt` header. Don't "fix" this mapping without reading
  IMPORT_PLAN.md decision I6.
- **Encoding fallback**: `readFileText()` in `ImportSalesModal` reads UTF-8 first
  and re-reads as `windows-1252` when the decode contains `�`. German Excel CSVs
  are usually windows-1252; don't remove the fallback.
- **Duplicate pre-check chunks `.in()` at 200 ids** (`IN_CHUNK`) — Supabase/
  PostgREST URLs break on very long `in()` lists. Keep chunking if you touch it.
- **Skipped ≠ error**: rows marked `skipped` (order already exists / duplicate in
  file) don't block the import; rows with `error` do. `canImport` requires zero
  errors AND at least one *actionable* row — `importable.length > 0 ||
  refundCount > 0`, since a refunds-only file has no importable rows at all
  (see the refunds-only gotcha below).
- **Never derive numbers with `parseFloat` in import code** — always
  `parseLocaleNumber` (`"9,99"` would silently become `9`). Same for dates:
  `parseFlexibleDate`, never a bare regex.
- The delimiter is auto-detected per file (`detectDelimiter` in
  `lib/utils/csv.ts`) — affects the purchases/expenses imports too, since they
  share `parseCsvText`.

## Gotchas — date-order detection

- `10-04-2026` is ambiguous. The importer used to assume day-first for every
  `N-N-YYYY` string; a month-first file therefore imported every date whose
  day was 1–12 wrongly, with no error. That mis-dated 145 live orders in
  `tenant_k2_textil` — they landed on the 4th of twelve different months.
  `detectDateOrder` now decides from file evidence instead.
- **The 145-row incident was a PARTIAL rewrite, and per-value evidence alone
  cannot catch it.** Excel converted the cells it could read as US dates (both
  fields ≤ 12) to `04/09/2026` and left the rest as `30-04-2026` text. The
  flipped cells have both fields ≤ 12 by construction, so they never produce
  month-first evidence — `detectDateOrder`'s evidence-only conflict check is
  structurally blind to this shape of corruption. The tell is that the
  surviving and flipped cells use **different separators**. `detectDateOrder`
  therefore also refuses the file outright when the date column mixes `/` and
  `-` (`conflict.kind === "separator"`), independent of what the per-value
  evidence says. Don't remove or weaken this check thinking the evidence
  conflict already covers it — it doesn't, that's the whole reason it exists.
- `conflict` is now `{ kind: "evidence" | "separator"; sampleA: string;
  sampleB: string }` (was `{ dayFirstSample, monthFirstSample }`). For
  `"evidence"`, `sampleA`/`sampleB` are the day-first/month-first samples
  respectively (same meaning as before, renamed). For `"separator"`, they're
  just two real values using the two different separators found.
  `ImportSalesModal.tsx` builds a different error message per `kind` — the
  separator one explicitly says a spreadsheet tool likely rewrote part of the
  file. Both callers of `detectDateOrder().conflict` were audited (grep
  confirms `ImportSalesModal.tsx` is the only one outside the module) when
  this shape changed.
- A dot-separated date (`15.01.2024`) is ALWAYS day-first, even when the
  detected order is `mdy`. `DD.MM.YYYY` is the German convention and
  `MM.DD.YYYY` does not occur, so `parseFlexibleDate` deliberately ignores
  `order` for them. Because of this, `hasOrderSensitiveDate` (`localeParse.ts`)
  returns `false` for a file whose dates are ALL dot-separated — in that case
  `ImportSalesModal` disables the whole Date-format `<select>` (rather than
  leave "Month first" as a silent no-op) and shows a one-line explanation.
- **The ambiguous-case hint shows a real, parsed example, not a "check the
  preview" pointer** — the modal has no row preview to check. `firstAmbiguousDate`
  (`localeParse.ts`) returns the first file value that is genuinely
  order-ambiguous; the modal parses it with whatever order will actually be
  applied and renders `"<value>" will be imported as <D Month YYYY>.` If you
  add a real preview table to the modal later, this hint can point at it
  instead, but don't reintroduce a pointer to a UI element that doesn't exist.
- **`parseAndValidate` is guarded against races with a run-id ref**
  (`requestIdRef` in `ImportSalesModal.tsx`). Two rapid format/date-order
  changes each call `parseAndValidate`, and the two results differ ONLY in
  date interpretation — a naive `await` chain can let the slower (now stale)
  call's `setParsed`/`setChecking(false)` land last, silently importing rows
  under the wrong date order while the dropdown shows the newer one. Every
  `setParsed` call after an `await`, and both `setChecking` calls inside
  `markDuplicates` (which now takes the caller's `requestId`), check
  `requestIdRef.current === requestId` first. Keep this guard if you touch
  either function — it's easy to "simplify" away and silently reintroduce the
  race.
- Importing the `.xlsx` directly sidesteps ambiguity entirely **when the
  sheet's date column holds real dates** — `excel.ts` converts those to ISO
  before parsing. It does not help when the cells hold date-formatted text,
  which marketplace exports often do.

## Gotchas — Amazon VAT-report import (`priceColumnsAreLineTotals`/`vatRateIsFraction`)

- **`total_amount` stores the ITEM line total, never the sheet's `total`.**
  `app/dashboard/_lib/aggregateSales.ts:25` computes revenue as `total_amount
  + shipping_charged`, so storing the shipping-inclusive sheet total there
  double-counts shipping. `total` is used only to validate `total ≈
  total_amount + shipping_charged`, then discarded.
- **Amazon's `unit_price` column is optional; when it's absent, back the item
  total OUT of the sheet total** (`sheetTotal - shippingCharged`) — using the
  sheet total raw reopens the same double-count as above. See
  `validateRowForFormat`'s `priceColumnsAreLineTotals` branch in
  `importFormats.ts`.
- **Amazon writes VAT rates as fractions (`0.19`), not percentages.** Scaling
  is driven by the `vatRateIsFraction` format flag, never by the value's
  magnitude — an `if (rate < 1)` check would silently mishandle a genuine
  100% rate.
- **In `classifySkip` the format guard (`if
  (!format.priceColumnsAreLineTotals) return null`) must be the FIRST
  statement.** Putting the blank-row check above it makes `generic` and
  `ebay` silently skip blank rows instead of erroring them — those two
  formats must keep their pre-existing all-or-nothing validation behaviour.
- **`RETURN`/`FC_TRANSFER` are skipped as noise BEFORE field validation**,
  because they legitimately have an EMPTY `date` column (and every other
  required field) — Amazon leaves them blank on those row types. Moving the
  `classifySkip` call after date parsing reintroduces a `Row N: invalid or
  missing "date"` failure on every one of them.
- **`REFUND` rows are exempt from BOTH duplicate pre-check passes**
  (file-level dupes and the DB `.in()` check in `markDuplicates`) — they
  carry the `external_order_id` of an existing sale by definition, so
  without the carve-out every refund is dropped as "order already exists"
  and the matching path in `handleImport` never runs, making the whole
  feature unreachable.
- **`REFUND` rows have an EMPTY `date` column, exactly like `RETURN` rows
  do** (confirmed against a real April 2026 report row, see
  `importFormats.test.ts`'s "Amazon REFUND rows" describe block). The refund
  parse branch in `validateRowForFormat` therefore runs BEFORE the date
  parse — neither the date parse nor the amazon price branch could run on a
  refund row anyway. Moving the refund check after the date parse
  reintroduces a `Row N: invalid or missing "date"` failure on every REFUND
  line.
- **A refund never becomes a row — it deducts from its matched sale.**
  `data: null` on a `ParsedRow` with `isRefund: true`; two DB constraints
  make a standalone negative row impossible anyway:
  `sales_unit_price_check (unit_price >= 0)` and a non-partial UNIQUE index
  on `(platform, external_order_id)` (every refund shares its order id with
  its own sale).
- **A refund is split across two columns because a SALE's `total_amount`
  holds the item total only** (shipping lives in `shipping_charged`). The
  parsed `refund` carries `amount` (full), `itemAmount`, and
  `shippingAmount`; `itemAmount` is deducted from `total_amount`,
  `shippingAmount` from `shipping_charged`. When `unit_price` is blank on the
  sheet, `itemAmount` is backed out of `amount` using the row's
  `shipping_charged`, mirroring the SALE branch. A row whose parts don't sum
  to the whole (`itemAmount < 0 || itemAmount > amount`) is a row error, not
  reconciled — writing a mismatched deduction would make `refunded_amount`
  unauditable against what was actually subtracted.
- **A refund's reported VAT is usually 0, so VAT is SCALED, not subtracted.**
  Amazon writes `TOTAL_ACTIVITY_VALUE_VAT_AMT = 0` on REFUND lines. Naively
  subtracting it leaves a fully-refunded order at `total_amount 0.06` with
  its original `vat_amount 1.28` — Net renders as −1.22 and €1.28 of VAT on
  €0.06 of goods reaches the Overview VAT Position and the invoice PDF. The
  loop subtracts only a **non-zero** `target.vatAmount` (Amazon's own figure
  is authoritative); otherwise it scales:
  `previous.vat_amount × (nextGross / prevGross)`, gross being
  `total_amount + (shipping_charged ?? 0)`. Guard on `prevGross > 0`, floor
  at 0, leave `null` as `null`. Do NOT "simplify" this into a recomputation
  from `vat_rate`: `vat_amount` is the combined item+shipping figure and the
  two rates can differ (Swedish shipping at 25%), so a single-rate
  recomputation is wrong on mixed-rate orders — scaling preserves the
  blended effective rate.
- **A refunded order's `unit_price` keeps its pre-refund value on purpose.**
  The update touches `total_amount`/`shipping_charged`/`vat_amount`/`status`/
  `refunded_amount` only, so invoices and CSV export show e.g. `8.05 | 0.06`
  on one line. Totals come from `total_amount` and are correct; `unit_price`
  is the price the item sold at. Not a bug — don't back-derive it.
- **A REFUND row must never reach the summary-row heuristic.** `classifySkip`
  detects the trailing "Total" row structurally
  (`!date && !product_name && !quantity`), and a refund has no `date` by
  design — so an export that also blanks product_name/quantity on refund
  lines would classify every refund as `"summary row"` and refunds would
  silently stop working. The `status === "refund"` check is scoped to skip
  *that one heuristic*, deliberately not an early `return null`, so a refund
  in an unsupported currency is still caught by the currency guard below it.
- **Amazon order ids are NOT unique in the sheet** — a multi-line order (one
  line per SKU) repeats the same `order_id`. Refund matching keys on platform
  + `external_order_id` + resolved `product_id`, never `external_order_id`
  alone. Note what this does and does not protect against: it canNOT be
  deducting "the wrong line", because only ONE line of a multi-line order can
  ever exist in `sales` — `idx_sales_platform_external_order_id` is
  non-partial, and `markDuplicates`' in-file pass marks the second and later
  lines `"duplicate in file"`. What actually happens is that a refund against
  any line OTHER than the imported one resolves a `product_id` that matches
  nothing and is reported as `refundsSkipped` ("no matching order found").
  Keep `product_id` in the key — it is correct — but don't justify it with a
  wrong-line scenario the schema makes impossible.
- **Unmatched refunds are skipped, not inserted.** A non-partial UNIQUE index
  on `(platform, external_order_id)` exists in every tenant schema (verified
  live) — a standalone insert for an order id with no matching line raises a
  unique violation and fails the *whole* batch, not just that row. Unlike
  the file-level skip reasons, this is NOT surfaced as a `ParsedRow.skipped`
  reason in the pre-import preview — matching happens only inside
  `handleImport`, and the outcome (`refundsSkipped`) is reported post-import
  via `ImportSummary`/the toast in `page.tsx`.
- **Refund matching requires a non-null `product_id`** — it's part of the
  match key (see above). Every integrations-synced Amazon order has
  `product_id: null` by design (see `src/lib/integrations/`'s SKILL.md), and
  so does any CSV row whose SKU isn't in inventory. In a tenant that uses the
  eBay/Amazon platform sync, this means **100% of REFUND rows in a CSV
  import skip** as unmatched — not a bug, just a consequence of the match
  key, but it reads to a user as "refunds don't work" if you don't know this.
- **The insert runs BEFORE the refund loop, not after.** An Amazon monthly
  report routinely contains both the SALE and its REFUND in the same file
  (sold 3 April, refunded 24 April). `handleImport` inserts `insertRows`
  first so a same-file refund can match a row that was just committed —
  matching refunds first would silently skip same-period refunds as
  unmatched, since the query would run before the SALE existed.
- **`refunded_amount` is the re-import idempotency marker** — see the
  dedicated gotcha below for what that implies for a second refund on the
  same order.
- **The already-refunded check is a LOOSE `!= null`, not `!==`, on
  purpose.** Migration `031_sales_refunded_amount.sql` is not yet applied to
  any tenant schema — until it is, `previous.refunded_amount` reads as
  `undefined`, and `undefined !== null` is `true`. A strict check would
  silently classify EVERY refund as already-applied and deduct nothing while
  the import still reports success. The loose check falls through to the
  `update` instead, which Supabase rejects for the missing column, surfacing
  a real error on the `updErr` path. **Do not "tighten" this** — it looks
  like a bug fix and is actually the thing preventing a silent no-op.
- **The already-refunded check runs BEFORE the over-refund check.** A fully
  refunded order has `total_amount = 0`; checking the over-refund condition
  first would misreport a harmless re-import as "exceeds the order" instead
  of the correct "already applied".
- **Over-refund is a per-row skip (`refundsExceeded`), not an import abort**,
  using the same `0.02` tolerance the SALE branch reconciles
  `total ≈ items + shipping` with. `total_amount`/`shipping_charged`/
  `vat_amount` are floored at `0` on the write, so a within-tolerance
  overshoot can leave `refunded_amount` up to 2c above what was actually
  deducted — a deliberate, bounded trade against ever writing a negative
  total, which would corrupt every revenue aggregate.
- **On `matchErr`/`updErr` the modal calls `blockRetry()`, clearing
  `parsed`** so the Import button cannot be re-clicked — a retry would
  re-insert the SALE rows already committed earlier in the same run and trip
  the unique index.
- **A refunds-only file is importable.** A REFUND row's `data` is `null`, so
  it's never in `importable` — `canImport` and the Import button's row count
  add `refundCount` (rows with `isRefund && !skipped`) to `importable.length`
  so a refunds-only file doesn't read as "Import 0 rows".
- **The refund loop has no transaction.** It runs after the insert, so by
  the time it starts the insert has already committed. A mid-loop Supabase
  failure (the `matchErr`/`updErr` branches) leaves earlier refunds in the
  *same* loop already committed too, but bails via `blockRetry()` before
  reaching the second batch audit-log write — so the visible state is
  "insert + some refunds applied, no refund-outcomes audit row for any of
  it." Known limitation, not handled.

## Gotchas — `refunded_amount` idempotency

- `refunded_amount` doubles as both the audit figure (what was refunded) and
  the guard that prevents re-deducting it — there is no separate "already
  processed" flag. This means **one refund per order** is a hard limit, not
  a v1 shortcut to relax later without a schema change: a second, genuinely
  separate refund against the same sale (e.g. two partial Amazon refunds)
  cannot be represented and is silently skipped as `refundsAlreadyApplied`.
  If partial/multiple refunds per order are ever needed, this needs a
  separate ledger table, not a second column on `sales`.

## Gotchas — server-side pagination

- **Do not call `filterSales()` in `page.tsx`** — filters are pushed to Supabase
  in `fetchSalesPage`. Calling the in-memory helper would silently double-filter
  and produce wrong counts.
- **`state.sales.items` is always one page** (up to `pageSize` rows). Any code
  that assumes `items` contains all records (e.g. the Overview page's
  `effectiveSales`) reads from its own copy of the data, not from here —
  but be careful when adding new aggregations.
- **DataTable column sorting is page-local** (v1 deliberate limitation). Users
  who want a globally sorted view should use the date ordering already applied
  server-side. If full sort pushdown is added later, extend `fetchSalesPage`
  with an `order` param.
- **`statusOptions` in `page.tsx`** is derived from the current page only.
  Custom statuses not on the current page won't appear in the filter dropdown
  until a matching page is loaded. This is an acceptable v1 trade-off.
- **`addSale` increments `total`** so the Pagination count stays accurate after
  a manual add without re-fetching. `removeSale` decrements it only when the
  item was actually found in `items` (prevents double-decrement on a no-op).
- **`StoreProvider` prop shape changed**: `sales` is now
  `{ data: Sale[], count: number }` (not `Sale[]`). Layout passes
  `{ data: salesData ?? [], count: salesCount ?? 0 }`. If you add a new
  feature prop with the same shape, follow this pattern.
- **CSV export** runs a separate Supabase query without `.range()` — it does
  NOT use the Redux items. This ensures the export always covers all matching
  records (up to the 5 000-row safety cap), even when the user is on page 3.
- **`excludedCount` is page-scoped** — it counts non-revenue orders
  (`!isRevenueSale`, i.e. `returned` or `cancelled`) within `state.sales.items`
  (the current page), not across all matching rows. The UI note "N
  returned/cancelled order(s) excluded from totals" is therefore page-local;
  it is not labelled "(this page)" in the UI, but that is what it reflects.
  `refunded` orders are NOT counted here — they still count toward revenue,
  see `sales/CLAUDE.md` → "Order status + returns".
- **Invoice modal falls back to current page only when nothing is selected** —
  `InvoiceModal` receives the `selected` rows array. When `selected` is empty,
  it has no records to render; the Generate Invoice button is disabled until at
  least one row is checked. Selection is page-local (cleared on page navigation),
  so a user cannot span an invoice across multiple pages in v1.

## Gotchas — detail page

- `params` is a **Promise** in this Next.js version. Use React's `use(params)` (not
  `await`) in Client Components to unwrap it — see
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
- Direct-URL hits to `/dashboard/sales/[id]` land before the layout hydrates Redux,
  so `state.sales.items` may be empty. The page falls through to a Supabase fetch via
  `createTenantClient` and then dispatches `addSale` to populate Redux.
- **Linked purchase on the detail page**: the Financials card shows Cost of Goods and
  Gross Profit rows when a `Purchase` with `sale_id === sale.id` exists. The page
  first checks `state.purchases.items` (fast path — already populated by the layout on
  normal navigation); if not found it fires a second `useEffect` that queries the
  `purchases` table with `.maybeSingle()` (won't throw on no-row), then dispatches
  `addPurchase` to hydrate Redux AND sets local `fetchedLinkedPurchase` state.
  Use `.maybeSingle()`, not `.single()` — the purchase may genuinely not exist.
  The guard `purchases.some((p) => p.sale_id === sale.id)` skips the Supabase fetch
  when Redux already has the row (avoids a redundant round-trip on list → detail nav).
- The `EditSaleModal` prop `sale` controls open/close: pass `null` to close, a
  `Sale` object to open. On the detail page, pass `editOpen ? sale : null` so closing
  the modal transitions back cleanly.
- Delete navigates to `/dashboard/sales` after removing the item from Redux — same
  audit-log + product-stock-refetch pattern as the list page.
- **Download Invoice** calls `generateOrderInvoice` (not `generateSalesInvoice`) —
  the per-order variant uses `invoiceNumberFor` (deterministic, id-based) and
  `computeOrderInvoiceTotals` from `src/lib/utils/invoiceMath.ts`. The button is
  transiently disabled on hard-refresh until `companyProfile` hydrates from Redux.

## Gotchas

- `salesSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` — those two files import it via the `@/app/dashboard/sales/_store/salesSlice`
  alias. If you rename the slice file, update those imports too.
- `DeleteConfirmModal` and `InvoiceModal` are shared with Expenses and Purchases
  (`src/components/modals/`) — modify them carefully, changes ripple to those
  features.
- Every create/update must call `writeAuditLog` + `dispatch(addAuditLog(...))` —
  the audit log is the compliance trail for this bookkeeping app, don't skip it.
- `Sale.product_id` is optional and FK's to `products` (Inventory feature) —
  the modals just set it via a `Select`; a DB trigger keeps `current_stock` in
  sync. Never write to `products.current_stock` from here.
- The "Inventory Product" dropdown's filter/auto-fill logic lives in the
  colocated `productOptions.ts` (`selectableProducts`, `productNameFor`) —
  pure functions, unit-tested in `productOptions.test.ts`. Edit *that* file if
  the selection rules change, not the inline JSX in the modals.
  `EditSaleModal` passes its `form.product_id` as the second arg so the
  sale's existing link stays visible even at 0 stock — keep that "don't drop
  the existing link on edit" guard. Selecting a product also auto-fills
  `product_name` — don't remove that or the free-text name and the link can
  drift apart again.
- `Sale.vat_rate`/`vat_amount` are populated only when "Total includes VAT" is
  checked (`Checkbox` + `vatAmountFromGross`); send `null` for both when it's
  off — see `CLAUDE.md` → "Inventory link + VAT" for the full pattern, which is
  identical across Sales/Purchases/Expenses modals.
- `writeAuditLog` `entityId` param is `string | undefined` — **not nullable**.
  For bulk-import audit entries (one log per batch), simply omit `entityId`
  rather than passing `null`. Passing `null` is a TypeScript error.
- **Returned orders are excluded from revenue/profit everywhere.** The stock
  delta formula in `apply_sale_stock_change()` (migration
  `003_add_order_status.sql` for `public`; baked into
  `provision_tenant_schema()` in `005_tenant_provisioning.sql` for every
  tenant schema including `tenant_kaufnest`) is
  `(status = 'returned' AND restock) ? 0 : -quantity`. If you add a new
  revenue/profit aggregation (in this page's `summary` or in
  `app/dashboard/page.tsx`'s StatCards/charts), filter out
  `status === "returned"` rows first (`page.tsx` does this inline in the
  `summary` useMemo; Overview uses an `effectiveSales` array) — otherwise
  written-off/returned orders will inflate those figures.
- The UI says "Orders" everywhere (page title, Sidebar, modal titles, toast
  messages) but the route, table, type, and slice all stay "sales" — don't
  rename files/exports when making more "Orders"-flavored UI tweaks.
- The "Search" box in `FilterBar` matches `product_name`, `external_order_id`,
  and `description` via a Supabase `.or()`/`ilike` clause (see
  `fetchSalesPage` in `_store/salesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`) before being embedded —
  don't build the `.or()` string from a raw, unsanitized value. `handleExport`
  mirrors the same predicate; keep both in sync if the column set ever changes.
