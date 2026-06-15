# Settings feature

Route: `/dashboard/settings`. Lets a user configure invoice template details
(business name, address, tax ID, footer notes, etc.) and preview/export an
example invoice, plus (new) view/edit the tenant's shared Company Profile.

## Files in this folder

- `page.tsx` — two independent sections:
  - **Company Profile** (new): reads `useAppSelector((s) => s.companyProfile.profile)`
    (hydrated in `dashboard/layout.tsx` from the `company_profile` table),
    edits `name`/`logo_url`/`vat_number`/`address`/`currency`/`timezone` via
    `Field`/`Input`/`Select`/`Textarea`/`Row`. Editable only for `admin`/
    `super_admin` (`useAppSelector((s) => s.currentUser.profile?.role)`,
    matching the `company_profile_update` RLS policy in
    `005_tenant_provisioning.sql`); `accountant` sees a read-only form. Saves
    via `createTenantClient().from("company_profile").update(...)`, then
    dispatches `hydrateCompanyProfile(data)` to sync Redux. Hidden entirely if
    `companyProfile.profile` is `null`.
  - **Invoice settings** (existing): form (`Field`/`Input`/`Textarea`/`Row`
    from `components/ui/FormFields`) backed by `useInvoiceSettings`, plus a
    "generate sample invoice" action via `generateSalesInvoice`.

This feature has **no private `_components`**. `_store/companyProfileSlice.test.ts`
does not live here — `companyProfileSlice` itself is a shared slice (see
below); only its test was added as part of this feature's work. Everything
substantial the invoice-settings section depends on is shared (see below)
because the same invoice machinery is also used directly from the shared
`InvoiceModal`.

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
- `lib/supabase/client` (`createTenantClient`, Company Profile save)
- `store/slices/companyProfileSlice` (`hydrateCompanyProfile`),
  `store/slices/currentUserSlice` (role gate)
- `types` (`Sale`, `CompanyProfile`, `Currency`)

## Tests

`src/store/slices/companyProfileSlice.test.ts` covers the slice
(`hydrateCompanyProfile` initial/replace behavior). No tests target `page.tsx`
itself or `useInvoiceSettings`/`generateInvoice`.
