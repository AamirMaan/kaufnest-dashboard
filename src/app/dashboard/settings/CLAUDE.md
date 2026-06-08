# Settings feature

Route: `/dashboard/settings`. Lets a user configure invoice template details
(business name, address, tax ID, footer notes, etc.) and preview/export an
example invoice.

## Files in this folder

- `page.tsx` — settings form (`Field`/`Input`/`Textarea`/`Row` from
  `components/ui/FormFields`) backed by `useInvoiceSettings`, plus a "generate
  sample invoice" action via `generateSalesInvoice`.

That's it — this feature has **no private `_components`/`_store`**. Everything
substantial it depends on is shared (see below) because the same invoice
machinery is also used directly from the shared `InvoiceModal`.

## Why `useInvoiceSettings` / `generateInvoice` are NOT colocated here

It's tempting to move them in since this page "owns" the settings UI, but both
are imported by `components/modals/InvoiceModal.tsx` too (used from Sales,
Expenses, and Purchases to generate PDF invoices using these same settings).
Moving them here would create a reverse dependency from shared → feature.
They live in:
- `src/lib/hooks/useInvoiceSettings.ts` — reads/writes settings (localStorage-backed)
- `src/lib/utils/generateInvoice.ts` — builds the PDF (`jspdf`/`jspdf-autotable`)
  with `generateSalesInvoice`/`generateExpenseInvoice`/`generatePurchaseInvoice`

If you change the settings shape (`InvoiceSettings`), update both of those and
`InvoiceModal` — they all destructure the same fields.

## Shared dependencies

- `components/ui/{FormFields,Button,Toast}`
- `lib/hooks/useInvoiceSettings`, `lib/utils/{generateInvoice,currency}`
- `types` (`Sale` — used for the sample invoice)

## Tests

No tests currently target this page or `useInvoiceSettings`/`generateInvoice`.
