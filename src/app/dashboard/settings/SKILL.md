---
name: settings-feature
description: Work on the Settings dashboard feature (company/invoice profile configuration) at src/app/dashboard/settings — use when the task mentions company profile, invoice settings/template details, or the /dashboard/settings route.
---

# Working on the Settings feature

Read `CLAUDE.md` in this folder first. This is a thin feature: the page itself
is the only feature-private file. It renders a single form, backed entirely by
`companyProfileSlice` + the per-tenant `company_profile` table — there is no
separate localStorage-backed invoice settings anymore. `generateInvoice.ts`
(shared, used by `InvoiceModal` too) reads its header/footer fields straight
from `CompanyProfile`.

## Minimal file set for common changes

- **Add/change a Company Profile field (incl. invoice/banking/contact
  fields)**: `page.tsx` (form field + the `handleCompanyProfileSubmit` update
  payload) AND `src/types/index.ts` (`CompanyProfile`) AND
  `supabase/migrations/005_tenant_provisioning.sql` (`company_profile` table +
  `provision_tenant_schema()`, per the "3 places" rule in
  `supabase/SKILL.md`) AND a one-off `ALTER TABLE` migration for
  already-provisioned tenants (`tenant_kaufnest`). If the field should appear
  on generated PDFs, also update `src/lib/utils/generateInvoice.ts`
  (`addHeader`/`addFooter`).
- **Change Company Profile role gating**: `page.tsx`'s
  `COMPANY_PROFILE_ROLES` constant — keep in sync with the
  `company_profile_update` RLS policy in `005_tenant_provisioning.sql`.
- **Change only this page's form/layout**: `page.tsx` only.
- **Add/change field validation**: `src/lib/utils/validation.ts` (pure helpers)
  AND `src/lib/utils/validation.test.ts` (colocated tests) AND `page.tsx`
  (import + inline `{validator(field) && <p>…</p>}` warning).

## Test command

`npx jest companyProfileSlice` (covers `companyProfileSlice.test.ts` in
`src/store/slices/`). No test suite targets `page.tsx` or `generateInvoice`.

## Gotchas

- IBAN/VAT validation is non-blocking (warning only, save still proceeds) —
  validators in `src/lib/utils/validation.ts` return `null` for valid/empty
  and an error string for invalid, but `handleCompanyProfileSubmit` never
  reads them; the form submits regardless.
- The dashboard layout fetches `company_profile` with `.maybeSingle()` — a
  missing row returns `null` (not an error). The form renders nothing when
  `companyProfile.profile === null`; profiles are created by provisioning, not
  by this page.
- The save handler uses `.upsert()` (not `.update()`) so a missing row is
  created rather than silently failing. The `id` field must be included in the
  upsert payload for conflict resolution to work.
- Don't fork `generateInvoice` into this folder — it's shared with the
  `InvoiceModal` used across three other features. Changing the
  `CompanyProfile` shape requires updating `src/types/index.ts`,
  `generateInvoice.ts`, `InvoiceModal.tsx`, and the Add/Edit modals' default
  VAT rate (sales/expenses/purchases), per `companyProfileSlice`.
- If `companyProfile.profile` is `null` (e.g. a `public`-schema fallback user
  pre-migration), the entire form renders nothing — don't add a "create
  profile" flow here; profiles are created by
  `provision_tenant_schema()`/`/api/admin/provision-tenant`.
- `vat_rate`, `invoice_prefix`, and `payment_terms` are NOT NULL with DB
  defaults (`19`, `'INV-'`, `'30 days'`) — every provisioned tenant has a
  usable value even before the user visits this page.
