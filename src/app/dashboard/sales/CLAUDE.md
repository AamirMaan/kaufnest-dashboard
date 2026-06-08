# Sales feature

Route: `/dashboard/sales`. Lists sales records (per platform: Amazon, eBay, Etsy,
Shopify, other), with add/edit/delete and PDF invoice generation.

## Files in this folder

- `page.tsx` — list view: filtering (`FilterBar` + `filterSales`), row selection,
  invoice trigger, wires up the modals below.
- `_store/salesSlice.ts` — Redux slice for `state.sales` (`items`, `loaded`).
  Actions: `hydrateSales`, `addSale`, `updateSale`, `removeSale`. Used **only** by
  this feature — registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/salesSlice.test.ts` — reducer tests. Run with `npx jest dashboard/sales`.
- `_components/AddSaleModal.tsx` / `EditSaleModal.tsx` — create/edit forms.
- `_components/productOptions.ts` (+ colocated `.test.ts`) — pure helpers
  (`selectableProducts`, `productNameFor`) shared by both modals for the
  "Inventory Product" dropdown; see "Inventory link + VAT" below.

## Data flow (the pattern every mutation follows)

1. Write to Supabase (`createClient()` from `@/lib/supabase/client`, table `sales`).
2. On success, dispatch the local slice action (`addSale`/`updateSale`/`removeSale`)
   so the UI updates without a refetch.
3. Call `writeAuditLog` (`@/lib/utils/audit`) to persist an audit row, then dispatch
   `addAuditLog` (`@/store/slices/auditLogsSlice`) to reflect it immediately in the
   shared audit log state.

`EditSaleModal` additionally requires a "reason for edit" and records a
before/after diff in the audit metadata — follow that shape if you add new
editable fields.

## Inventory link + VAT (additive fields on `Sale`)

- `product_id: string | null` — optional FK to `products` (Inventory feature).
  Both modals render an "Inventory Product" `Select` sourced from
  `useAppSelector((s) => s.inventory.items)`; selecting one is enough — a DB
  trigger (`sales_stock_change`, see `supabase/migrations/002_inventory_and_vat.sql`)
  decrements `products.current_stock` automatically. **Don't add client-side
  stock math.**
  - The dropdown is filtered via `selectableProducts()` (from the colocated
    `productOptions.ts`) to products with `current_stock > 0` — you can only
    sell what purchases have actually brought in — and shows the stock count
    per option (`"Name — N in stock"`). `EditSaleModal` passes `form.product_id`
    as the second arg so the sale's *currently linked* product stays visible
    even at 0 stock — editing an existing sale never silently drops its link.
  - Picking a product also auto-fills `product_name` via `productNameFor()`
    (see `selectProduct()` in each modal) so the free-text name and the linked
    record can't silently diverge — the user can still hand-edit the name
    afterward if they want a different invoice label.
  - `productOptions.ts` is pure (just filters/looks up over `Product[]`, no
    Supabase/Redux deps) specifically so it's unit-testable without rendering —
    see `productOptions.test.ts`. Extend it (not the modals) if the
    selection/filename rules change.
- `vat_rate`/`vat_amount: number | null` — populated when the user checks
  "Total includes VAT" (a `Checkbox` from `FormFields`). The rate defaults to
  `readInvoiceSettings().vatRate` but is editable per-record; the amount is
  extracted from the gross total via `vatAmountFromGross` (`lib/utils/currency`).
  Both stay `null` when the toggle is off — `total_amount` (generated column)
  remains the gross/paid figure either way.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Modal`, `Button`, `FormFields` (incl. `Checkbox`),
  `DataTable`, `FilterBar`, `Badge` (`PlatformBadge`), `Toast`
- `components/modals/{DeleteConfirmModal,InvoiceModal}` — shared with Expenses and
  Purchases (don't fork these; extend them if you need new shared behavior)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state read/written
  by every CRUD feature
- `app/dashboard/inventory/_store/inventorySlice` — read-only here, for the
  product-link `Select` (`s.inventory.items`)
- `lib/utils/{audit,currency,date,filters,generateInvoice}`, `lib/hooks/useInvoiceSettings`
- `types` (`Sale`, `Platform`, `Currency`, `Product`)

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
