---
name: lib-hooks
description: Reference for the shared hooks in src/lib/hooks (useInvoiceSettings) — use when reading or writing invoice template settings, or wiring a new consumer of InvoiceSettings.
---

# Shared hooks (`src/lib/hooks/`)

Currently a single hook backing the invoice-template settings feature.

## useInvoiceSettings.ts

`"use client"`. Persists `InvoiceSettings` to `localStorage` under
`"kaufnest_invoice_settings"` — there's no Supabase table for this, it's
purely client-side config.

- `export interface InvoiceSettings` — company/bank/invoice-template fields
  (`companyName`, `iban`, `invoicePrefix`, `footerNotes`, `vatRate`, etc). This
  is the single source of truth for the shape; `generateInvoice.ts` imports the
  type from here rather than `src/types`.
- `export const DEFAULT_INVOICE_SETTINGS` — all-blank defaults except
  `country: "Germany"`, `invoicePrefix: "INV-"`, `paymentTerms: "30 days"`,
  `vatRate: 19`.
- `vatRate: number` — the default VAT rate (%) shown as a starting point on the
  per-record "Includes VAT?" toggle in the Sales/Purchases/Expenses Add/Edit
  modals (`readInvoiceSettings().vatRate`, paired with `vatAmountFromGross` from
  `lib/utils/currency` — see `lib/utils/SKILL.md`). It's editable per-record;
  this is just the seed value, not an enforced rate.
- `export function useInvoiceSettings()` → `{ settings, save }`. `save(updated)`
  replaces the whole object (no partial merge) and writes through to
  `localStorage` synchronously.
- `export function readInvoiceSettings()` — one-shot read for places that
  need the settings without subscribing to changes (e.g. a PDF-generation
  call site that isn't itself a settings-editing component).
- `loadFromStorage` guards `typeof window === "undefined"` and wraps
  `JSON.parse` in `try/catch`, merging onto `DEFAULT_INVOICE_SETTINGS` so a
  partially-saved/older shape never produces `undefined` fields.

## Where this is used

- `app/dashboard/settings/page.tsx` — the settings form, via `useInvoiceSettings()`
  for the read+write cycle.
- `components/modals/InvoiceModal.tsx` and `lib/utils/generateInvoice.ts` —
  read-only consumers via `readInvoiceSettings()` when generating a PDF.
