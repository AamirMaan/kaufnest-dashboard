# Settings feature

Route: `/dashboard/settings`. Lets a user view/edit the tenant's shared
Company Profile — company identity, contact info, tax/registration, banking
details, and invoice defaults — and generate a demo invoice PDF using those
values.

## Files in this folder

- `page.tsx` — a single form, reading
  `useAppSelector((s) => s.companyProfile.profile)` (hydrated in
  `dashboard/layout.tsx` from the `company_profile` table) into local
  `companyForm` state, grouped into sections:
  - **Company Profile**: `name`, `logo_url`, `address`, `currency`, `timezone`
  - **Contact**: `phone`, `email`
  - **Tax & Registration**: `vat_number`, `tax_id`, `vat_rate` (default VAT
    rate used by the Add/Edit modals in Sales/Expenses/Purchases)
  - **Banking Details**: `bank_name`, `iban`, `bic`
  - **Invoice Defaults**: `invoice_prefix`, `payment_terms`, `footer_notes`

  All fields are `Field`/`Input`/`Select`/`Textarea`/`Row` from
  `components/ui/FormFields`, `disabled={!canEditCompanyProfile}`. Editable
  only for `admin`/`super_admin` (`useAppSelector((s) =>
  s.currentUser.profile?.role)`, matching the `company_profile_update` RLS
  policy in `005_tenant_provisioning.sql`); `accountant` sees a read-only
  form (no Save button). Saves via
  `createTenantClient().from("company_profile").update(...)`, then dispatches
  `hydrateCompanyProfile(data)` to sync Redux. The whole form is hidden if
  `companyProfile.profile` is `null`.

  "Generate Demo Invoice" calls `generateSalesInvoice([DEMO_SALE],
  companyForm)` — available to every role (read-only users can still preview
  the PDF using the saved profile).

This feature has **no private `_components`**. `_store/companyProfileSlice.test.ts`
does not live here — `companyProfileSlice` itself is a shared slice (see
below); only its test was added as part of this feature's work.

## Why `generateInvoice` is NOT colocated here

It's tempting to move it in since this page "owns" the settings UI, but it's
imported by `components/modals/InvoiceModal.tsx` too (used from Sales,
Expenses, and Purchases to generate PDF invoices using the same
`CompanyProfile`). Moving it here would create a reverse dependency from
shared → feature. It lives in `src/lib/utils/generateInvoice.ts` — builds the
PDF (`jspdf`/`jspdf-autotable`) with
`generateSalesInvoice`/`generateExpensesInvoice`/`generatePurchasesInvoice`,
all taking a `CompanyProfile` as their `settings` argument.

If you change the `CompanyProfile` shape, update `src/types/index.ts`,
`generateInvoice.ts` (`addHeader`/`addFooter`), `InvoiceModal.tsx`, this
page's form, and the relevant DB migrations (see this folder's `SKILL.md`).

## Shared dependencies

- `components/ui/{FormFields,Button,Toast}`
- `lib/utils/{generateInvoice,currency}`
- `lib/supabase/client` (`createTenantClient`, Company Profile save)
- `store/slices/companyProfileSlice` (`hydrateCompanyProfile`),
  `store/slices/currentUserSlice` (role gate)
- `types` (`Sale`, `CompanyProfile`, `Currency`)

## Tests

`src/store/slices/companyProfileSlice.test.ts` covers the slice
(`hydrateCompanyProfile` initial/replace behavior). No tests target `page.tsx`
or `generateInvoice`.
