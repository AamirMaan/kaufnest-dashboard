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
  fields)**: `page.tsx` (form field + the `handleCompanyProfileSubmit` upsert
  payload) AND `src/types/index.ts` (`CompanyProfile`) AND a new
  `supabase/migrations/NNN_*.sql` using `run_on_all_tenant_schemas` (never a
  hardcoded `ALTER TABLE tenant_kaufnest...`) AND
  `supabase/migrations/005_tenant_provisioning.sql`'s `company_profile` table
  inside `provision_tenant_schema()` — the "2 places" rule in
  `supabase/SKILL.md`. See `042_company_profile_shipfrom_address.sql` for a
  worked example. If the field should appear on generated PDFs, also update
  `src/lib/utils/generateInvoice.ts` (`addHeader`/`addFooter`).
- **Change Company Profile role gating**: `page.tsx`'s
  `COMPANY_PROFILE_ROLES` constant — keep in sync with the
  `company_profile_update` RLS policy in `005_tenant_provisioning.sql`.
- **Change only this page's form/layout**: `page.tsx` only.
- **Add/change field validation**: `src/lib/utils/validation.ts` (pure helpers)
  AND `src/lib/utils/validation.test.ts` (colocated tests) AND `page.tsx`
  (import + inline `{validator(field) && <p>…</p>}` warning).
- **Change billing behavior (plans, checkout, cancellation)**: this
  feature's `_components/BillingSection.tsx` is presentation only — the
  actual logic lives in `src/app/api/billing/*` (routes) and
  `src/components/billing/PlanPicker.tsx` (shared with `/trial-expired`).
  Changing what a plan costs or includes is `src/lib/utils/pricing.ts` +
  `src/lib/utils/planGating.ts`, not this folder. `src/app/trial-expired/
  page.tsx` (outside this folder) duplicates `BillingSection`'s
  checkout-success-confirmation and `canManageBilling` gating patterns
  against the same `GET /api/billing/status` response shape — if you change
  that response shape or those UI patterns, check both files.

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
- **`BillingSection` optimistic-then-reconcile pattern**: after `change-plan`
  succeeds, the component sets the new plan locally immediately (instant
  feedback), then polls `GET /api/billing/status` up to 3 times, 1.5s apart,
  stopping as soon as the fetched plan matches. A single one-shot re-check
  (an earlier version of this fix) was worse than doing nothing: if the
  webhook hadn't written `control.tenants.plan` yet by that one check, it
  would silently overwrite the *correct* optimistic value with the *stale*
  DB one, with no further attempt to catch up. The same pattern (poll until
  a condition, not a single check) is reused for the post-checkout
  `?billing=success` confirmation, polling until `hasSubscription` is true
  instead of until `plan` matches.
- **Billing route auth is split; `status` now exposes the split as a field
  instead of each caller re-deriving it.** `GET /api/billing/status` itself
  has no role gate (a read, safe for any authenticated tenant member), but
  `POST /api/billing/checkout` / `change-plan` / `cancel` all require
  `requireBillingAdmin` (`admin`/`super_admin`). Rather than each consumer
  re-computing that role check from Redux, `status` computes
  `canManageBilling: boolean` server-side the same way `requireBillingAdmin`
  does (`src/lib/billing/authGuard.ts`) and returns it in the response.
  `BillingSection` reads `status.canManageBilling` directly (it dropped its
  old `useAppSelector((s) => s.currentUser.profile?.role)` check) and swaps
  in a read-only summary sentence for non-admins, so a non-admin never sees
  live Subscribe/Switch/Cancel buttons that would 403 with a raw
  `"Forbidden"` string on click. `/trial-expired/page.tsx` reads the same
  field for the same reason — it has no Redux store to read a role from at
  all (`StoreProvider` only wraps `/dashboard`), so before this fix its
  `PlanPicker` had no role gate whatsoever.
- **Reading `?billing=success` uses `window.location.search` in a `useEffect`,
  not `next/navigation`'s `useSearchParams()`.** This Next.js version has a
  Suspense-boundary requirement around `useSearchParams()` in some
  configurations (see AGENTS.md's "This is NOT the Next.js you know" note) —
  reading the query string via `window.location` sidesteps that entirely
  since it's plain client-side code with no App Router hook involved.
- The "Shipping From Address" section's six `ship_from_*` fields
  (`ship_from_street1/street2/city/state/postal_code/country`) are
  deliberately unvalidated and unconsumed by anything in this codebase today
  — they exist only for a later shipping-label feature. Don't add a
  `required` prop, format validation, or a country `<Select>` here; that
  belongs to the shipping-label feature when it lands, per
  `docs/superpowers/specs/2026-09-04-company-shipfrom-address-design.md`.
