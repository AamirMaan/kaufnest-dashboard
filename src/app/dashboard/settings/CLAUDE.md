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
  `createTenantClient().from("company_profile").upsert(...)` (includes `id` so
  it creates the row on first save if provisioning somehow missed it), then
  dispatches `hydrateCompanyProfile(data)` to sync Redux. The layout fetches
  the profile with `.maybeSingle()` (not `.single()`) — if no row exists yet,
  `companyProfile.profile` is `null` and the whole form is hidden until the
  row is created.

  **Inline validation warnings** are shown beneath the `iban`, `vat_number`,
  `email`, and `vat_rate` fields using pure helpers from
  `src/lib/utils/validation.ts`. Warnings are non-blocking — the Save button
  remains enabled regardless.

  "Generate Demo Invoice" calls `generateSalesInvoice([DEMO_SALE],
  companyForm)` — available to every role (read-only users can still preview
  the PDF using the saved profile).

This feature has one private component: `_components/BillingSection.tsx`
(2026-08-29) — fetches `GET /api/billing/status` and renders `PlanPicker`
(`src/components/billing/`, shared with `/trial-expired`). No subscription
yet → picking a plan calls `POST /api/billing/checkout` and redirects to
Stripe. Has a subscription → `PlanPicker`'s `currentPlan` is set, so picking
a *different* plan calls `POST /api/billing/change-plan` instead
(`PlanPicker` itself doesn't know which — its caller decides), plus a
"Cancel subscription" action (`POST /api/billing/cancel`, sets
`cancel_at_period_end` rather than cancelling immediately). Rendered above
the Company Profile form, not merged into it — billing is a separate
concern with its own loading state, independent of whether
`companyProfile.profile` has loaded.

Three more things this component handles that aren't obvious from the routes
alone:

- **Role gating is done in the component, not just the routes.** `status` has
  no role gate (a read, safe for anyone), but `checkout`/`change-plan`/`cancel`
  all require `requireBillingAdmin`. `BillingSection` reads
  `currentUser.profile?.role` itself (`admin`/`super_admin` only) and renders a
  read-only summary sentence for everyone else instead of live Subscribe/
  Switch/Cancel controls — same "read-only, not hidden or broken" precedent as
  `canEditCompanyProfile` below, since a non-admin clicking a button that 403s
  is a worse experience than not showing the button.
- **Checkout-return confirmation.** `checkout/route.ts`'s `success_url` sends
  the browser back to `/dashboard/settings?billing=success`. On mount,
  `BillingSection` reads that query param off `window.location.search`
  directly (not `next/navigation`'s `useSearchParams()` — see the Gotcha in
  `SKILL.md` for why) and, if present, shows a "Payment received — setting up
  your subscription…" message while polling `status` until
  `hasSubscription` flips true.
- **Bounded reconciliation polling**, not a single optimistic write. After
  `change-plan` succeeds, the new plan is set locally right away for instant
  feedback, then `status` is re-fetched up to 3 times (1.5s apart) until the
  fetched plan matches — see `SKILL.md`'s Gotcha for why a single one-shot
  check was worse than not reconciling at all.

`_store/companyProfileSlice.test.ts`
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
