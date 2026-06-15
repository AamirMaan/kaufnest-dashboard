---
name: settings-feature
description: Work on the Settings dashboard feature (invoice template configuration) at src/app/dashboard/settings — use when the task mentions invoice settings, business/invoice template details, or the /dashboard/settings route.
---

# Working on the Settings feature

Read `CLAUDE.md` in this folder first. This is a thin feature: the page itself
is the only feature-private file. It now has two independent sections —
**Company Profile** (new, backed by `companyProfileSlice` + `company_profile`
table) and **Invoice Settings** (existing, localStorage-backed via
`useInvoiceSettings`). The invoice-settings hook and PDF generator are shared
with `InvoiceModal` (used by Sales/Expenses/Purchases), so they intentionally
live in `src/lib/`, not here.

## Minimal file set for common changes

- **Add/change a Company Profile field**: `page.tsx` (form fields + the
  `handleCompanyProfileSubmit` update payload) AND `src/types/index.ts`
  (`CompanyProfile`) AND `supabase/migrations/005_tenant_provisioning.sql`
  (`company_profile` table + `provision_tenant_schema()`, per the "3 places"
  rule in `supabase/SKILL.md`) AND a one-off `ALTER TABLE` migration for
  already-provisioned tenants (`tenant_kaufnest`).
- **Change Company Profile role gating**: `page.tsx`'s
  `COMPANY_PROFILE_ROLES` constant — keep in sync with the
  `company_profile_update` RLS policy in `005_tenant_provisioning.sql`.
- **Add/change an invoice-settings field shown on this page**: `page.tsx` AND
  `src/lib/hooks/useInvoiceSettings.ts` (the `InvoiceSettings` type + storage),
  AND `src/lib/utils/generateInvoice.ts` if the field should appear on
  generated PDFs, AND `src/components/modals/InvoiceModal.tsx` if it reads
  that field directly.
- **Change only this page's form/layout**: `page.tsx` only.

## Test command

`npx jest companyProfileSlice` (covers `companyProfileSlice.test.ts` in
`src/store/slices/`). No test suite targets `page.tsx`,
`useInvoiceSettings`, or `generateInvoice`.

## Gotchas

- Don't fork `useInvoiceSettings`/`generateInvoice` into this folder — they're
  shared with the `InvoiceModal` used across three other features. Changing
  the `InvoiceSettings` shape requires updating all three locations listed above.
- Company Profile and Invoice Settings are **separate save paths** with
  separate data sources — don't merge their forms or state. Company Profile
  is a real per-tenant DB row (`company_profile`, RLS-gated, shared across all
  users of the tenant); Invoice Settings is per-browser `localStorage` via
  `useInvoiceSettings`.
- If `companyProfile.profile` is `null` (e.g. a `public`-schema fallback user
  pre-migration), the Company Profile section renders nothing — don't add a
  "create profile" flow here; profiles are created by
  `provision_tenant_schema()`/`/api/admin/provision-tenant`.
