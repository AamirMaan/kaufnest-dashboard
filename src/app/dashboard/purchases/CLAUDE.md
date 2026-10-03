# Purchases feature

Route: `/dashboard/purchases`. Lists inventory purchase records (product, vendor,
quantity, unit price), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset — incl. "Specific period", any month/quarter/year,
  see `components/ui/SKILL.md`'s FilterBar entry — currency, general keyword
  search across product name/vendor/description), row selection, invoice
  trigger, filtered summary tiles (Purchases/Units bought/Gross/VAT/Net —
  covers ALL matching rows, not just the current page, see "Summary thunk"
  below), **Export CSV** button
  (server-side query, paginated via `@/lib/utils/fetchAllRows` up to a
  5 000-row cap — see "CSV import/export" below and `dashboard/SKILL.md`'s
  Max Rows gotcha), **Import CSV** button, wires up the modals below.
- `_lib/purchasesSummaryTiles.ts` (+ colocated `.test.ts`) — pure
  `buildPurchasesTiles(rows: PurchasesSummaryRow[]): SummaryTile[]`, consumed
  by `page.tsx` to render the filtered summary tiles above the Purchases
  table. Builds Purchases/Units bought/Gross/VAT/Net tiles via the shared
  `moneyTile`/`countTile`/`compactTiles` helpers
  (`@/components/ui/summaryTileHelpers`); VAT and Net are omitted together
  when VAT is all-zero.
- `_store/purchasesFilterParams.ts` (+ colocated `.test.ts`) — pure mapper
  from `PurchaseFilters` to the RPC/query param shape (`p_from`/`p_to`/
  `p_currency`/`p_pattern`), shared by `fetchPurchasesPage` and
  `fetchPurchasesSummary` so the table and the summary tiles can never
  disagree about which filter predicates apply.
- `_store/purchasesSlice.ts` — Redux slice for `state.purchases` (`items`,
  `loaded`, `page`, `pageSize`, `total`, `isFetching`, plus the summary
  fields below).
  Actions: `hydratePage` (also exported as `hydratePurchases` for `StoreProvider`),
  `addPurchase`, `updatePurchase`, `removePurchase`, `setFetching`.
  Thunk: `fetchPurchasesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, currency, and a keyword `search` matched
  via `.or()`/`ilike` across `product_name`/`vendor`/`description`, sanitized
  with `sanitizeIlikeSearchTerm`), `.select("*", { count: "exact" })`,
  `.order("date")`, and `.range(from, to)` from `rangeFor()`. There is no
  standalone vendor filter — the general search box covers vendor.
  **Summary thunk** (2026-09-26): `fetchPurchasesSummary(filters:
  PurchaseFilters)` calls the `get_purchases_summary` RPC (migration 050) via
  `purchasesFilterParams` — the same mapper `fetchPurchasesPage` uses — and
  returns one `PurchasesSummaryRow` per currency (`src/types/index.ts`).
  State: `summary`/`summaryLoading`/`summaryError`/`summaryVersion` (bumped
  by `addPurchase`/`updatePurchase`/`removePurchase`)/`summaryRequestId`
  (stale-response guard — see the Sales feature's CLAUDE.md for the full
  pattern, identical here). A raw Postgres error is never forwarded — the
  thunk throws `new Error("purchases_summary_failed")` instead. **Consumed by
  `page.tsx`** (Task 6, 2026-09-26): a `useEffect` dispatches
  `fetchPurchasesSummary(filters)` whenever `filters` or `summaryVersion`
  changes (NOT on page/sort change), and `buildPurchasesTiles(summaryRows)`
  (`_lib/purchasesSummaryTiles.ts`) turns the result into the
  `<SummaryTiles>` row rendered above the Purchases table, replacing the old
  page-scoped "(this page)" Gross/VAT/Net block.
  Used **only** by this feature — registered centrally in `src/store/store.ts`
  and hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/purchasesSlice.test.ts` — reducer tests (covers `hydratePurchases`,
  `addPurchase`/`removePurchase` total arithmetic, `fetchPurchasesPage`
  pending/fulfilled/rejected cases). Run with `npx jest dashboard/purchases`.
- `_components/AddPurchaseModal.tsx` / `EditPurchaseModal.tsx` — create/edit forms.
  Both also render `_components/PurchaseInventoryFields.tsx` (location +
  landed costs) — see "Advanced inventory: location & landed costs" below.
- `_lib/purchaseInventoryFields.ts` (+ test, Phase 3 Task 4, 2026-09-26) —
  pure state/validation/payload helpers for the advanced-inventory fields on
  the purchase form: `PurchaseInventoryFieldsState { locationId, freight,
  customs, other }` (all strings — form-bound), `emptyPurchaseInventoryFields()`,
  `purchaseInventoryFieldsFrom(purchase)` (round-trips a `Purchase`, treats
  missing fields on older rows as empty), `isPurchaseInventoryFieldsValid`,
  `purchaseInventoryPayload` (→ `{ location_id, freight_cost, customs_cost,
  other_cost }`, `""`/empty → `null`), `hasLandedCosts` (drives the
  collapsible section's initial open state), `parseLandedPreview` (lenient
  parse for the live read-out only — invalid/empty reads as 0, unlike the
  strict validator).
- `_components/PurchaseInventoryFields.tsx` (Phase 3 Task 4, 2026-09-26) —
  the Location select + collapsible Freight/Customs/Other landed-cost
  inputs + live "Landed cost per unit" read-out (`landedUnitCost` from
  `inventory/_lib/landedCost.ts`). Pure presentational, driven entirely by
  the `value`/`onChange` props — see "Advanced inventory" below for when
  it's rendered.
- `_components/ImportPurchasesModal.tsx` — bulk CSV import: same pattern as
  `ImportSalesModal` but for purchases. See "CSV import/export" below.
- `_components/purchaseImportFormats.ts` (+ colocated `.test.ts`, 2026-09-17)
  — pure single-format registry (no format dropdown, unlike Sales — closer
  to Expenses' shape): `PURCHASE_IMPORT_COLUMNS`, `TEMPLATE_HEADERS`
  (derived from the columns so the two can't drift), `TEMPLATE_EXAMPLE`,
  and `validatePurchaseRow(raw, rowNum, dateOrder, baseCurrency)`. Extracted
  from what was previously inline in the modal — see "CSV import/export"
  below for what it gained (German header aliases, flexible dates, decimal
  commas, FX currency resolution) that the modal never had before.

## Buttons gated by section access (`useAccess()`)

`page.tsx` reads `const { can } = useAccess()` (`src/store/useAccess.ts`)
and gates the Purchases actions on the `purchases` section: Add/Import and
the row Edit icon need `can("purchases", 2)`; the row Delete icon needs
`can("purchases", 3)`. This replaced the previous `isSuperAdmin ||
hasDeleteOverride` check — the page no longer reads
`profile.permission_overrides` or imports `lib/utils/permissions.ts`. The DB
backs the delete bar independently via RLS (migration
`055_section_permissions.sql`, `purchases >= 3`), not just a UI-level gate.
Both `AddPurchaseModal.tsx`/`EditPurchaseModal.tsx` render the "Inventory
Product" select only when `can("inventory", 1)` — otherwise the free-text
product name field is all that's shown. **`AddPurchaseModal`'s "Add `<name>`
to inventory" checkbox** (shown when the typed product name doesn't match an
existing one) additionally requires `can("inventory", 2)` (Task 5 review,
fix round 1, 2026-09-30) — it creates a new `products` row, which is an edit
action, not just a read; `handleSubmit` re-checks the same level before
acting on `form.add_to_inventory`, in case a stale form submits after an
access change.

## Pagination data flow

Server-side pagination is active. `page.tsx` **does not apply `filterPurchases`
in memory** — all filtering happens in `fetchPurchasesPage` (the thunk in
`_store/purchasesSlice.ts`). The flow for a filter change or page navigation is:

1. User changes a filter or clicks Prev/Next in `<Pagination>`.
2. `page.tsx` dispatches `fetchPurchasesPage({ page, pageSize, filters })`.
3. The thunk builds a Supabase query with filter predicates + `.select("*", { count: "exact" })` + `.range(from, to)`, then dispatches `hydratePage({ data, count, page, pageSize })` on success.
4. `state.purchases.items` is replaced with the new page; `total` holds the full
   count across all pages; `isFetching` goes back to `false`.
5. The initial hydration (`StoreProvider`) calls `hydratePage` too (aliased as
   `hydratePurchases`) with `page=1, pageSize=DEFAULT_PAGE_SIZE`.

**Summary tiles** (2026-09-26, Task 6 — supersedes the old page-scoped
"(this page)" Gross/VAT/Net block) cover ALL rows matching the current
filters, not just the loaded page — they come from a separate
`fetchPurchasesSummary(filters)` dispatch (see "Summary thunk" above), not
from `state.purchases.items`. See "Gotchas — filtered-summary state" in
`SKILL.md`.

**CSV export** (`handleExport`) bypasses Redux and runs a fresh Supabase query
with the same filter predicates, paginated via `@/lib/utils/fetchAllRows` up
to a 5 000-row overall cap (NOT a single `.limit(5000)` — see
`dashboard/SKILL.md`'s Max Rows gotcha).

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`await createTenantClient()` from `@/lib/supabase/client`, table `purchases`).
2. On success, dispatch the local slice action (`addPurchase`/`updatePurchase`/`removePurchase`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditPurchaseModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Inventory link + VAT (additive fields on `Purchase`)

- `product_id: string | null` — optional FK to `products` (Inventory feature).
  Both modals render an "Inventory Product" `Select` sourced from
  `useAppSelector((s) => s.inventory.items)`; selecting one is enough — a DB
  trigger (`purchases_stock_change`, see `supabase/migrations/002_inventory_and_vat.sql`)
  increments `products.current_stock` automatically. **Don't add client-side
  stock math.**
- `vat_rate`/`vat_amount: number | null` — populated when the user checks
  "Total includes VAT" (a `Checkbox` from `FormFields`). The rate defaults to
  `companyProfile.profile?.vat_rate` (per-tenant default from
  `store/slices/companyProfileSlice`, falls back to `19`) but is editable
  per-record (e.g. reduced 7% rate on some goods); the amount is extracted from
  the gross total via
  `vatAmountFromGross` (`lib/utils/currency`). Both stay `null` when the toggle
  is off — `total_amount` (a plain writable `numeric(12,2) NOT NULL` column,
  not a generated one — verified live: `is_generated = NEVER`) remains the
  gross/paid figure either way.

## Advanced inventory: location & landed costs (Business plan, Phase 3 Task 4)

Both `AddPurchaseModal.tsx` and `EditPurchaseModal.tsx` call
`useAdvancedInventory()` (`inventory/_store/useAdvancedInventory.ts`) and
compute a local `tracksStock` boolean:
- Add: `advanced.active && (!!form.product_id || (form.add_to_inventory &&
  isNewProductName))` — true once the purchase either links an existing
  inventory product or will create+link a new one.
- Edit: `advanced.active && !!form.product_id &&
  isTrackedByLedger(purchase.created_at, advanced.settings)` — a purchase
  created before advanced inventory was enabled is ignored by the ledger
  triggers on UPDATE, so it shows a muted "This purchase predates batch
  tracking, so its location and landed costs aren't tracked." note instead
  of the fields, and nothing is added to the payload (final-review I3).

`<PurchaseInventoryFields>` renders **only when `tracksStock` is true** —
for Starter/Pro tenants, or a Business tenant that hasn't enabled advanced
inventory yet, or a purchase with no inventory link, the form is
byte-for-byte what it was before this feature: no new fields render and the
insert/update payload gets `{}` spread in (i.e. nothing added) via
`...(tracksStock ? purchaseInventoryPayload(inv) : {})`.

- **`""` (empty) `locationId` means "use the tenant's default location"** —
  the DB fills `location_id` from `inventory_settings.default_location_id`
  when advanced inventory is on; the component shows this as "Default
  location (<name>)" rather than an empty option.
- **The landed-cost read-out is display-only.** `landedUnitCost()`
  (`inventory/_lib/landedCost.ts`) is a TS mirror of the SQL formula the
  database actually uses to cost the stock lot — never derive the stored
  landed cost from this component; it exists purely so the user sees a
  preview while typing.
- The submit button is `disabled={saving || !isFormValid}` (final-review
  F5), where `isFormValid` mirrors exactly what `handleSubmit` rejects —
  Add: product name non-empty, unit price > 0, and
  `isPurchaseInventoryFieldsValid(inv)` when `tracksStock`; Edit: the same
  plus a non-empty reason for edit — matches the "mutating button must
  never look clickable when it can't succeed" convention (AGENTS.md → Form
  conventions).
- `EditPurchaseModal` initialises `inv` via
  `purchaseInventoryFieldsFrom(purchase ?? {})` — safe because the modal is
  always rendered with `key={editTarget?.id ?? "edit-purchase"}` at its
  call site (`page.tsx`), so a new purchase target remounts the component
  and re-runs `useState`'s initializer instead of reusing stale state.
- Both modals map a mutation's DB error with
  `inventoryErrorMessage(dbError, "Could not save the purchase.")` instead
  of showing the raw Postgres message — this is what surfaces
  `INV_CONSUMED` ("…units from this batch are already sold…") when editing
  a consumed batch's quantity/location. Both `handleSubmit`s are now
  wrapped in `try { … } catch (err) { setError(inventoryErrorMessage(err, …
  )); } finally { setSaving(false); }` so a thrown error (not just a
  returned `{ error }`) can't leave the button stuck on "Saving…" forever,
  and the post-success `writeAuditLog` call has its own inner
  try/catch so an audit-write failure never turns an already-saved
  purchase into a failure toast.

## Sale link (`sale_id`)

`sale_id: string | null` — when non-null, this purchase was created as the cost-of-goods record for a specific sale. The purchases list renders a "Linked to order →" link below the product name for these rows (navigates to `/dashboard/sales/{sale_id}`). The FK is `ON DELETE SET NULL` — if the linked sale is deleted, the purchase survives with `sale_id` reset to `null`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Pagination`, `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Sales and
  Expenses (don't fork these; extend them if you need new shared behavior —
  `DeleteConfirmModal` also grew optional `confirmLabel`/`confirmingLabel`/
  `reasonLabel`/`reasonPlaceholder` props for the Users feature's Deactivate
  confirmation, all defaulting to the original "Delete" wording)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `app/dashboard/inventory/_store/useAdvancedInventory` (Phase 3 Task 4) —
  entitlement/active state + `locations`/`settings` for the Location &
  landed-costs fields
- `app/dashboard/inventory/_lib/advancedInventory` (`LOCATION_TYPE_LABELS`,
  `platformLocationOptions`) and `app/dashboard/inventory/_lib/landedCost`
  (`landedUnitCost`) — consumed by `PurchaseInventoryFields.tsx`
- `lib/inventory/inventoryErrors` (`inventoryErrorMessage`) — maps `INV_*`
  trigger errors (and any other DB/thrown error) to user-safe copy in both
  modals
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv,pagedQuery,fetchAllRows}`, `store/slices/companyProfileSlice`
- `types` (`Purchase`, `Product`, `StockLocation`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` derives its filter predicates from
`purchasesFilterParams(filters)` (2026-09-27 final-review fix — the same
mapper `fetchPurchasesPage`/`fetchPurchasesSummary` use, replacing an earlier
hand-rolled filter block with an invalid `"0000-00-00"`/`"9999-99-99"`
custom-range fallback), runs a fresh Supabase query, paginated via
`fetchAllRows` up to a 5 000-row overall cap (see `dashboard/SKILL.md`'s Max
Rows gotcha) and calls `exportToCsv`. Columns: `date, product_name, vendor,
quantity, unit_price, total_amount, currency, vat_rate, vat_amount,
description`.

**Import** (`ImportPurchasesModal` + `purchaseImportFormats.ts`, extracted
2026-09-17): Required: `date`, `product_name`, `quantity`, `unit_price`.
Optional: `vendor`, `currency` (default EUR), `vat_rate`, `description`.
`product_id` is NOT in the import format. `total_amount` and `vat_amount`
are computed. All rows must be valid; one audit log entry for the batch
(omit `entityId`).

Before the 2026-09-17 extraction this modal read raw CSV header strings as
row keys directly (`raw.date`, `raw.product_name`, …), so only exact
English column names ever worked, `date` required the literal
`YYYY-MM-DD` shape (a strict regex), and numbers went through raw
`parseInt`/`parseFloat` (no decimal-comma tolerance). It now goes through
`resolveHeaders`/`canonicalizeRow` (`@/lib/utils/importAliases`, shared
with Sales/Expenses) and `parseFlexibleDate`/`parseLocaleNumber`
(`@/lib/utils/localeParse`) — same German-header-alias and locale
tolerance those two features already had. This is a strict superset: any
file that imported successfully before still does.

**Currency resolution routes through `resolveSheetCurrency`**
(`@/lib/fx/convert.ts`) from the start (not a hardcoded EUR/USD/GBP
allowlist) — a row whose `currency` column names a plausible ISO code
other than the tenant's base currency sets `ParsedPurchaseRow.sheetCurrency`
rather than erroring, ready for the FX rate review step.

**FX rate review (Task 14, 2026-09-17)**: `handleFile`'s `.then` now calls
`detectAndReviewFxRates` after parsing — groups any `sheetCurrency`-carrying
rows, POSTs `/api/fx/rates`, and opens the shared `<FxRateReview>`
component in place of the normal form; confirming applies the resolved
rate via `applyRate` (`lib/fx/convert.ts`) to each row's
`total_amount`/`vat_amount` directly (unlike Expenses, Purchase's money
field IS already `total_amount`, so no field-name adapter is needed here).
This modal has no format dropdown, so `fileReadIdRef` (claimed once per
file read) is its only staleness guard — re-checked after both the parse
and the new `/api/fx/rates` round trip, so a newer file selected while
either is in flight can't land a stale result. Same shared step
Sales/Expenses use (`ImportSalesModal.tsx`/`ImportExpensesModal.tsx`); see
either file's CLAUDE.md section for the full two-pass row lifecycle.

## Tests

`npx jest dashboard/purchases` runs `_store/purchasesSlice.test.ts`,
`_components/purchaseImportFormats.test.ts`, and (Phase 3 Task 4)
`_lib/purchaseInventoryFields.test.ts`.
