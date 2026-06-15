# Purchases feature

Route: `/dashboard/purchases`. Lists inventory purchase records (product, vendor,
quantity, unit price), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterPurchases`), row
  selection, invoice trigger, Gross/VAT/Net summary, **Export CSV** button
  (exports `filtered` via `lib/utils/csv`), **Import CSV** button, wires up the
  modals below.
- `_store/purchasesSlice.ts` — Redux slice for `state.purchases` (`items`,
  `loaded`). Actions: `hydratePurchases`, `addPurchase`, `updatePurchase`,
  `removePurchase`. Used **only** by this feature — registered centrally in
  `src/store/store.ts` and hydrated in `src/store/StoreProvider.tsx`, but
  otherwise self-contained here.
- `_store/purchasesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/purchases`.
- `_components/AddPurchaseModal.tsx` / `EditPurchaseModal.tsx` — create/edit forms.
- `_components/ImportPurchasesModal.tsx` — bulk CSV import: same pattern as
  `ImportSalesModal` but for purchases. See "CSV import/export" below.

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
  is off — `total_amount` (generated column) remains the gross/paid figure
  either way.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Sales and
  Expenses (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `lib/utils/{audit,currency,date,filters,generateInvoice,csv}`, `store/slices/companyProfileSlice`
- `types` (`Purchase`, `Product`)

## CSV import/export

**Export**: `handleExport()` in `page.tsx` maps `filtered` to rows and calls
`exportToCsv`. Columns: `date, product_name, vendor, quantity, unit_price,
total_amount, currency, vat_rate, vat_amount, description`.

**Import** (`ImportPurchasesModal`): Required: `date` (YYYY-MM-DD),
`product_name`, `quantity`, `unit_price`. Optional: `vendor`, `currency`
(default EUR), `vat_rate`, `description`. `product_id` is NOT in the import
format. `total_amount` and `vat_amount` are computed. All rows must be valid;
one audit log entry for the batch (omit `entityId`).

## Tests

`npx jest dashboard/purchases` runs `_store/purchasesSlice.test.ts`.
