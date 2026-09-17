# Purchases feature

Route: `/dashboard/purchases`. Lists inventory purchase records (product, vendor,
quantity, unit price), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset, currency, general keyword search across product
  name/vendor/description), `<Pagination>`, loading overlay, Gross/VAT/Net
  summary **(this page)**, **Export CSV** button (server-side query, paginated
  via `@/lib/utils/fetchAllRows` up to a 5 000-row cap — see "CSV
  import/export" below and `dashboard/SKILL.md`'s Max Rows gotcha), **Import
  CSV** button, wires up the modals below.
- `_store/purchasesSlice.ts` — Redux slice for `state.purchases` (`items`,
  `loaded`, `page`, `pageSize`, `total`, `isFetching`).
  Actions: `hydratePage` (also exported as `hydratePurchases` for `StoreProvider`),
  `addPurchase`, `updatePurchase`, `removePurchase`, `setFetching`.
  Thunk: `fetchPurchasesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, currency, and a keyword `search` matched
  via `.or()`/`ilike` across `product_name`/`vendor`/`description`, sanitized
  with `sanitizeIlikeSearchTerm`), `.select("*", { count: "exact" })`,
  `.order("date")`, and `.range(from, to)` from `rangeFor()`. There is no
  standalone vendor filter — the general search box covers vendor.
  Used **only** by this feature — registered centrally in `src/store/store.ts`
  and hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/purchasesSlice.test.ts` — reducer tests (covers `hydratePurchases`,
  `addPurchase`/`removePurchase` total arithmetic, `fetchPurchasesPage`
  pending/fulfilled/rejected cases). Run with `npx jest dashboard/purchases`.
- `_components/AddPurchaseModal.tsx` / `EditPurchaseModal.tsx` — create/edit forms.
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

## Delete gating (super_admin + permission overrides)

`page.tsx` computes `canDelete = isSuperAdmin || hasDeleteOverride`, where
`hasDeleteOverride` reads
`s.currentUser.profile?.permission_overrides?.includes("delete_purchase")`
directly (not via `hasPermission()` from `lib/utils/permissions.ts` — see the
Sales feature's CLAUDE.md for why: it would resurrect the matrix's
`["super_admin", "admin"]` default, silently giving every admin delete rights
they've never had in this UI). Overrides are granted per-user via the Users
feature's Permissions modal and also enforced in Postgres RLS
(`{{schema}}.current_user_has_override('delete_purchase')` in the
`purchases_delete` policy, see `supabase/migrations/023_user_permission_overrides.sql`).

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

**Summary cards** show "(this page)" totals only — computed from
`state.purchases.items` (current page). Clearly labelled in the UI.

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
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv,pagedQuery,fetchAllRows}`, `store/slices/companyProfileSlice`
- `types` (`Purchase`, `Product`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` runs a fresh Supabase query with the
same filter predicates, paginated via `fetchAllRows` up to a 5 000-row overall
cap (see `dashboard/SKILL.md`'s Max Rows gotcha) and calls
`exportToCsv`. Columns: `date, product_name, vendor, quantity, unit_price,
total_amount, currency, vat_rate, vat_amount, description`.

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
rather than erroring, ready for the FX rate review step. As of this
extraction (Task 13 of the currency-conversion-at-import plan) the modal
does not yet ACT on `sheetCurrency` — every row still imports
base-currency-unconverted regardless — that wiring is Task 14.

## Tests

`npx jest dashboard/purchases` runs `_store/purchasesSlice.test.ts` and
`_components/purchaseImportFormats.test.ts`.
