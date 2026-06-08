# Purchases feature

Route: `/dashboard/purchases`. Lists inventory purchase records (product, vendor,
quantity, unit price), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterPurchases`), row
  selection, invoice trigger, wires up the modals below.
- `_store/purchasesSlice.ts` — Redux slice for `state.purchases` (`items`,
  `loaded`). Actions: `hydratePurchases`, `addPurchase`, `updatePurchase`,
  `removePurchase`. Used **only** by this feature — registered centrally in
  `src/store/store.ts` and hydrated in `src/store/StoreProvider.tsx`, but
  otherwise self-contained here.
- `_store/purchasesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/purchases`.
- `_components/AddPurchaseModal.tsx` / `EditPurchaseModal.tsx` — create/edit forms.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`createClient()` from `@/lib/supabase/client`, table `purchases`).
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
  `readInvoiceSettings().vatRate` but is editable per-record (e.g. reduced 7%
  rate on some goods); the amount is extracted from the gross total via
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
- `lib/utils/{audit,currency,date,filters,generateInvoice}`, `lib/hooks/useInvoiceSettings`
- `types` (`Purchase`, `Product`)

## Tests

`npx jest dashboard/purchases` runs `_store/purchasesSlice.test.ts`.
