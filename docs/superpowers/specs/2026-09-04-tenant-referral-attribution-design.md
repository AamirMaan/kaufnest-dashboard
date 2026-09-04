# Tenant referral attribution

**Date:** 2026-09-04
**Status:** Design approved by user. Ready for an implementation plan.
**Branch:** `feat/tenant-referral-attribution` (off `main` @ `6345fc1`)

## Problem

Tenants sometimes come from a referral — someone who sent a prospect a signup
link, or an admin who knows a new tenant was introduced by an existing
customer/partner. There is currently no way to record who referred a tenant.
The business wants to identify these tenants so a referral share can be paid
out.

## Scope

**In scope:** a single `referral` attribution field on `control.tenants`,
capturable at signup (via a `?ref=` URL param or manual entry) or set/edited
later by a platform admin.

**Explicitly out of scope** (confirmed with user): no referrer entity/table,
no commission percentage, no payout ledger or automated calculation, no tie-in
to Stripe/billing revenue. `referral` is a plain string the business reads
off a tenant to compute and pay a share manually, outside the app. If
automated commission tracking is wanted later, it is a separate, much larger
feature (new data model for referrers, recurring calculation tied into the
Stripe webhook) and should get its own design.

## Data model

New nullable column, migration `supabase/control-plane/009_tenants_referral.sql`
(same shape as `003_add_admin_email.sql`):

```sql
alter table control.tenants add column if not exists referral text;
```

No constraint, no format enforcement (confirmed: free text, not a
slug-like code) — it needs to hold both a URL-param code (`alice-promo`) and
a plain human note (`"met at conference"`).

`src/types/index.ts`'s `Tenant` interface gets:

```ts
referral: string | null;
```

placed next to `admin_email` (same nullable-contact-ish shape).

## Capture — self-serve signup (`/signup?ref=CODE`)

`src/app/(auth)/signup/page.tsx`:
- Add `useSearchParams()` (from `next/navigation`) to read `ref` on mount;
  use it as the initial value of a new `referral` state.
- Add an optional "Referred by" text input to the form (prefilled from the
  URL param, still editable — covers both the auto-capture and manual-entry
  answers from scoping).
- Pass the trimmed value as `referral` inside `options.data` for
  `supabase.auth.signUp()`, alongside the existing `company_name`/
  `full_name`. Empty string → omit the key (matches how `company_name`/
  `full_name` are always non-empty required fields today; `referral` is the
  first optional one in this metadata object, so the provisioning route must
  tolerate it being entirely absent, not just empty).

`src/app/api/signup/provision/route.ts`:
- Read `user.user_metadata?.referral` the same way `companyName`/`fullName`
  are read (typeof-guard, trim).
- Include `referral: referral || null` in the existing claim-insert into
  `control.tenants` (the one that currently sets `name`, `slug`,
  `schema_name`, `admin_email`, `plan`, `status`, `trial_ends_at`).

No changes to `/welcome` or `app/auth/confirm/route.ts` — the referral value
travels entirely inside `user_metadata`, set once at signup, same as
`company_name`/`full_name` already do.

## Capture — admin-provisioned tenants (`/admin` → "Add Tenant")

`src/app/admin/_components/AddTenantModal.tsx`:
- Add an optional "Referral" `Field`/`Input`, state `referral`, included in
  the POST body to `/api/admin/provision-tenant`, reset on close like the
  other fields.

`src/app/api/admin/provision-tenant/route.ts`:
- Accept `referral` (optional string) in the request body.
- Include it in the existing `control.tenants` insert (step 6, alongside
  `admin_email`, `plan`, `status: "invited"`).

## Edit — either tenant origin

`src/app/admin/_components/EditTenantModal.tsx`:
- Add an optional "Referral" `Field`/`Input`, initialized from
  `tenant.referral ?? ""`, included in the existing diff-based patch
  (`if (referral !== (tenant.referral ?? "")) patch.referral = referral;`),
  reset on close like the other fields.

`src/app/api/admin/tenants/[id]/route.ts` (`PATCH`):
- Accept `referral?: string` in the body's type.
- **Different rule from `admin_email`'s empty-string skip**: `admin_email` is
  required, so an empty string is treated as "no change." `referral` is
  optional and must be clearable, so:
  ```ts
  if (body.referral !== undefined) {
    patch.referral = body.referral.trim() === "" ? null : body.referral.trim();
  }
  ```
  An admin submitting an empty Referral field explicitly clears a
  previously-set value to `null`.

## Display

`src/app/admin/tenants/[id]/page.tsx` Details card gets a "Referral" row
next to Admin Email/Trial Ends/Created, rendering `tenant.referral ?? "—"`
(same null-display convention as Admin Email elsewhere in this panel).

Not added to the main `/admin` tenants table — matches the ongoing pattern
(documented in `admin/CLAUDE.md`) of keeping that table slim and pushing
per-tenant detail onto `tenants/[id]`.

## Blast radius

Purely additive: one nullable column, one new optional field threaded through
two creation paths and one edit path, one new display row. No existing
constraint, RLS policy, or query changes. Every existing tenant row gets
`referral = null` and renders `—`, no backfill needed.

## Testing

Per AGENTS.md: no dev server, no `curl`, agent does not run
`npm test`/`tsc`/`lint` mid-task — ask the user to run and paste output.

This folder has no existing test suite (`admin/CLAUDE.md`: "almost entirely
Supabase/network calls ... which the working agreement keeps out of unit
tests"), so no new automated tests are expected here either. Verification is
manual, in the browser:

- Sign up via `/signup?ref=test-code` → confirm the "Referred by" field is
  prefilled with `test-code` → complete signup → in `/admin`, open the new
  tenant's detail page and confirm Referral shows `test-code`.
- Sign up via plain `/signup` (no `ref` param) → confirm the field is empty
  and optional → complete signup → detail page shows `—`.
- `/admin` → "Add Tenant" with a Referral value set → detail page shows it.
- `/admin` → "Add Tenant" with Referral left blank → detail page shows `—`.
- Edit an existing tenant, set a Referral value → Save → detail page updates.
- Edit that same tenant, clear the Referral field → Save → detail page goes
  back to `—` (confirms the clear-to-null path, not just the set path).

## Out of scope (restated)

- Referrer as a first-class entity (name, contact, payout %).
- Commission calculation, automated or otherwise.
- Payout status/ledger.
- Any change to Stripe billing, webhooks, or `control.tenants.plan`/`status`
  ownership.
- A Referral column on the main `/admin` tenants table.
- Format validation/constraints on the `referral` string.

## Docs to update alongside implementation

- `supabase/SKILL.md` — add `control-plane/009_tenants_referral.sql` to the
  apply-status table.
- `supabase/CLAUDE.md` — add it to the file list with the same one-paragraph
  description style as `003_add_admin_email.sql`.
- `src/app/admin/CLAUDE.md` — note the new Referral field in
  `AddTenantModal`/`EditTenantModal`'s descriptions and the detail page's
  Details card.
- `src/app/(auth)/CLAUDE.md` — extend the "load-bearing metadata keys" note
  on `signup/page.tsx` to include `referral` (optional, unlike the other two).
