# Public landing page + self-serve signup — design

**Date:** 2026-08-28
**Status:** Approved, ready for implementation plan
**Domain:** `https://app.boughtopia.com`

## Goal

Give Boughtopia a public front door: a marketing home page at `/` that
explains the product and its plans, and a self-serve signup flow that lets a
visitor create their own tenant and start a 14-day trial without any platform
admin involvement.

## Context — what exists today

- **`/` is not a landing page.** `src/app/page.tsx` is a bare
  `redirect("/dashboard")`. There is no public marketing surface anywhere.
- **There is no signup.** `(auth)/` contains only `login`, `forgot-password`,
  and `set-password`. A tenant is created exclusively by a platform admin via
  `/admin` → "Add Tenant", which calls `POST /api/admin/provision-tenant` and
  emails an invite. A visitor has no path into the product.
- **No prices exist in the codebase.** `planGating.ts` defines what each plan
  *unlocks*; `stripe.ts`'s `PLANS` holds placeholder price IDs
  (`price_starter_monthly`), not real Stripe prices. Stripe was never wired up.
- **Trial expiry is not enforced.** `control.tenants.trial_ends_at` is set at
  provision time (now + 14 days) but nothing reads it. `proxy.ts` checks only
  `status === "deactivated"`.
- **`control.tenants.status` has no CHECK constraint** — it is
  `text not null default 'active'` with an explanatory comment only (verified
  in `control-plane/001_schema.sql`). Values in live use: `active`, `invited`,
  `deactivated`.
- **`control.tenants.admin_email` is nullable and non-unique**
  (`control-plane/003_add_admin_email.sql`). Verified live 2026-08-28: zero
  duplicate non-null values, so a unique index applies cleanly.

## Decisions

Each was an explicit choice, recorded here so the implementation plan does not
relitigate them.

| Decision | Choice | Why |
| --- | --- | --- |
| Signup model | Full self-serve with automatic trial | No admin in the loop |
| Credit card at signup | **Not required** | Keeps Stripe entirely out of scope — it is not set up, and requiring it would block the landing page on unrelated work |
| When the schema is provisioned | **After email verification** | See "The provisioning risk" below — this is the load-bearing decision |
| What the trial unlocks | **Everything (mirrors Business)** | The product is sold as multi-platform bookkeeping; a trial that cannot connect eBay/Amazon cannot demonstrate the product |
| At trial expiry | **Lock out, data preserved** | Mirrors the proven `/account-deactivated` pattern; simplest to build, hardest to game |
| Page language | **English** | The app UI, privacy policy and email templates are already English; a German page handing off to an English app reads as unfinished |

### Pricing

| Plan | Price | Users | Integrations | Listings + Messages | AI |
| --- | --- | --- | --- | --- | --- |
| Starter | €20/mo | 3 | ✗ | ✗ | ✗ |
| Pro | €30/mo | 5 | ✓ | ✗ | ✗ |
| Business | €50/mo | Unlimited | ✓ | ✓ | ✓ |

Monthly only. Annual is deliberately deferred — the amounts live in one
constant, so adding an annual column later does not touch the page layout.

`PLAN_LIMITS.starter.maxUsers` changes from `1` to `3` as part of this work
(the plan is being sold as multi-user).

## The provisioning risk

This is the single most important constraint in the design, and the reason
provisioning is deferred behind email verification.

`addExposedSchema` (`src/lib/supabase/managementApi.ts`) adds a new tenant
schema to Project B's PostgREST "Exposed schemas" list by doing a
**read-modify-write on a single global config string**, via the Supabase
Management API, authenticated with an **account-wide personal access token**.

Three consequences:

1. **Lost update under concurrency.** Two provisions overlapping means one
   schema silently never lands in the list, and that tenant's entire app
   returns 404/406 with no error anywhere.
2. **Shared blast radius.** The list is global. The existing teardown code
   already documents that a malformed list makes PostgREST fail its
   schema-cache load (`3F000`) and return `PGRST002` **for every tenant** —
   a total outage, not a single-customer problem.
3. **Cost per call.** Each provision creates ~13 tables with RLS, triggers and
   indexes, then triggers a PostgREST schema-cache reload on the shared
   project plus a hardcoded 2-second wait.

Exposing that path directly to unauthenticated internet traffic is not
acceptable. Hence: an anonymous form submit may only create a cheap,
unconfirmed auth row. The expensive, globally-risky path runs only after a
human has proved control of a real inbox.

## Architecture

### 1. Landing page

New route group `src/app/(marketing)/`, mirroring the existing `(auth)`
group's structure. `src/app/page.tsx` is deleted; `(marketing)/page.tsx`
serves `/`.

Logged-in visitors to `/` are redirected to `/dashboard`, so the marketing
page only ever renders for logged-out visitors. This keeps it free of
conditional signed-in/signed-out header states.

Page sections, in order:

1. **Nav** — Boughtopia logo (`BrandMark`), "Sign in" → `/login`, "Start free
   trial" → `/signup`
2. **Hero** — headline, subheadline, primary CTA to `/signup`, with "14 days
   free · no credit card" as supporting text
3. **Features** — the real, shipped feature set: multi-platform sales
   tracking, VAT/invoicing, inventory with automatic stock sync, eBay/Amazon
   order import, eBay listing creation, buyer messaging, audit trail
4. **Pricing** — three cards (see below)
5. **Trial explainer** — what 14 days full access means, what happens after
6. **Footer** — privacy policy link, contact

**Pricing is derived, not transcribed.** `(marketing)/_lib/pricing.ts` holds
the three € amounts and the plan ordering, and computes each card's ✓/✗ marks
**from `PLAN_LIMITS` in `planGating.ts`**. The pricing page therefore cannot
advertise a capability the application actually gates off; editing the plan
matrix updates the page. This module is pure and unit-tested.

The page is a Server Component with no client-side state beyond whatever a
mobile nav toggle needs.

### 2. Signup

New `(auth)/signup/page.tsx`, inheriting the existing `(auth)/layout.tsx`
dark centered-card shell, so it matches `/login` visually with no new styling.

Fields: company name, full name, email, password.

On submit the browser calls `supabase.auth.signUp()` directly with the anon
key, placing `company_name` and `full_name` into `user_metadata`:

```ts
await supabase.auth.signUp({
  email,
  password,
  options: { data: { company_name, full_name } },
});
```

This creates an **unconfirmed auth user and nothing else** — no tenant row, no
schema, no Management API call. Supabase sends the confirmation email and owns
token generation, expiry and replay protection.

Deliberately **not** done at signup:

- **No slug availability check.** It costs a round-trip and is racy regardless
  (the slug could be taken between check and confirm). Uniqueness is resolved
  at provision time by suffixing: `tenant_acme`, then `tenant_acme_2`. The
  schema name is internal; the user only ever sees their company name.
- **No duplicate-email check.** `signUp()` rejects an existing email natively,
  which also preserves the current one-email-one-tenant guarantee that
  `provision-tenant` enforces manually.

**Security note:** `user_metadata` is user-controlled. It is read *only* for
company name and full name. `tenant_schema` and `role` are never taken from
it — they are written server-side via `set_user_tenant` and a direct
`profiles` insert, exactly as the existing admin flow does.

### 3. Provisioning

**`/auth/confirm` gains one branch.** After a successful OTP verification, if
the user has **no `app_metadata.tenant_schema`** but **does have
`user_metadata.company_name`**, this is a self-serve signup: redirect to
`/welcome` instead of `/dashboard`. All existing behaviour (the
invited → active transition for admin-provisioned tenants) is untouched.

**New `/welcome` page.** Calls `POST /api/signup/provision`, shows "Setting up
your workspace…", then redirects to `/dashboard`. On failure it shows the
error and a Retry button. It performs its own session check and redirects to
`/login` if there is none.

**`/welcome` and `/trial-expired` must stay outside the `proxy.ts` matcher**
(currently `["/", "/dashboard", "/dashboard/:path*", "/login"]`), and this is
load-bearing in both cases. A user arriving at `/welcome` has a session but
**no `tenant_schema` yet** — the proxy's tenant lookup would find nothing and
bounce them, making provisioning unreachable. `/trial-expired` would
redirect-loop, the same reason `/account-deactivated` is already excluded.
Adding either route to the matcher breaks the flow it belongs to.

Provisioning runs here rather than inline in the `/auth/confirm` redirect
because it takes roughly ten seconds (schema creation + a 2-second PostgREST
cache wait). Doing it inside a redirect handler risks a serverless timeout
mid-flight with no way to tell the user what happened.

**`POST /api/signup/provision`** requires an authenticated session and runs:

1. Reject if `app_metadata.tenant_schema` is already set (already provisioned).
2. Derive `slug` from `company_name` **using the same sanitisation
   `/api/admin/provision-tenant` already applies** — extract it into a shared
   helper rather than writing a second, subtly different version, since the
   two paths must produce identical schema names. Then find the first free
   `tenant_<slug>`, suffixing `_2`, `_3` … on collision.
3. **Claim first:** insert the `control.tenants` row with `status:
   'provisioning'`, `plan: 'trial'`, `trial_ends_at: now + 14 days`,
   `admin_email: user.email`. A unique constraint on `admin_email` makes this
   the idempotency lock — a refresh or double-click hits the constraint and
   returns early instead of creating a second schema.
4. `service.rpc("provision_tenant_schema", { schema_name })`.
5. `addExposedSchema(schemaName)` — **must** precede steps 6–7, which use
   `createServiceClientForTenant` and would 404/406 against an unexposed
   schema.
6. Seed `company_profile` with the company name, EUR, UTC.
7. Insert the `profiles` row with `role: 'super_admin'`, then
   `service.rpc("set_user_tenant", { user_id, schema_name })`.
8. Update the `control.tenants` row to `status: 'active'`.

Steps 4–8 mirror the existing `/api/admin/provision-tenant` sequence; the
differences are the claim row in step 3 and the absence of an invite email
(the user is already authenticated and has already set a password).

**Session refresh is mandatory.** `set_user_tenant` writes
`app_metadata.tenant_schema`, but the JWT the user is holding was issued
*before* that write. Every RLS policy reads the claim from the token
(`auth.jwt() -> 'app_metadata' ->> 'tenant_schema'`), not from the auth
server, so the stale token would fail every query. `/welcome` must call
`supabase.auth.refreshSession()` after a successful provision and before
redirecting to `/dashboard`.

**`addExposedSchema` is hardened** in the same change: after the PATCH,
re-read the config and verify the schema actually landed; retry with backoff
if it did not. This is the lost-update race described above. It is a latent
bug in the *existing* admin provisioning path too, so the fix benefits both
callers — it is included here because self-serve signup materially raises the
odds of concurrent provisions.

### 4. Trial lifecycle

- **`PLAN_LIMITS.trial` mirrors `business`** — unlimited users, integrations,
  AI, messaging/listings. One-line change in `planGating.ts`.
- **Enforcement in `proxy.ts`.** The proxy already fetches the tenant row for
  `/dashboard/*` to check `status`; extend that same `select` to include
  `plan, trial_ends_at`. If `plan === 'trial'` and `trial_ends_at` is in the
  past, redirect to `/trial-expired`. No additional database round-trip.
- **New `/trial-expired` page** mirroring `/account-deactivated`: explains the
  trial has ended, shows the three plans, links to contact. Like that page it
  falls outside the `proxy.ts` matcher (`["/", "/dashboard",
  "/dashboard/:path*", "/login"]`), so it cannot redirect-loop.
- The expiry check is extracted as a pure `isTrialExpired(plan, trialEndsAt,
  now)` predicate so it is unit-testable without a request.

Tenant data is never touched at expiry. Restoring access is a plan change in
`/admin`.

## Data model changes

One migration against **Project A (control plane)**:

```sql
create unique index if not exists idx_tenants_admin_email
  on control.tenants (admin_email);
```

Postgres treats multiple NULLs as distinct, so existing rows with no
`admin_email` (including `tenant_kaufnest`) are unaffected — a plain unique
index is correct here, no partial predicate needed. Verified live 2026-08-28:
no duplicate non-null values exist, so this applies cleanly.

`status: 'provisioning'` needs **no** schema change — the column has no CHECK
constraint.

No Project B (data plane) migration is required. `provision_tenant_schema`
already creates everything a tenant needs.

## File structure

**Created**

| Path | Responsibility |
| --- | --- |
| `src/app/(marketing)/layout.tsx` | Marketing shell (light background, no app chrome) |
| `src/app/(marketing)/page.tsx` | The landing page, composed of the sections below |
| `src/app/(marketing)/_components/*.tsx` | One component per page section (Nav, Hero, Features, Pricing, TrialInfo, Footer) |
| `src/app/(marketing)/_lib/pricing.ts` | Prices + feature marks derived from `PLAN_LIMITS` |
| `src/app/(marketing)/_lib/pricing.test.ts` | Asserts the derived marks match `PLAN_LIMITS` |
| `src/app/(marketing)/CLAUDE.md` + `SKILL.md` | Feature docs, per the project convention |
| `src/app/(auth)/signup/page.tsx` | Signup form |
| `src/app/welcome/page.tsx` | Post-confirmation provisioning screen |
| `src/app/trial-expired/page.tsx` | Trial-ended lockout page |
| `src/app/api/signup/provision/route.ts` | The provisioning route |
| `src/lib/utils/trial.ts` + `.test.ts` | `isTrialExpired` predicate |
| `supabase/control-plane/005_tenants_admin_email_unique.sql` | The unique index |
| `email-templates/confirm-signup.html` | Branded Supabase "Confirm signup" template |

**Modified**

| Path | Change |
| --- | --- |
| `src/app/page.tsx` | **Deleted** — replaced by `(marketing)/page.tsx` |
| `src/app/auth/confirm/route.ts` | Route self-serve signups to `/welcome` |
| `src/proxy.ts` | Select `plan, trial_ends_at`; redirect expired trials |
| `src/lib/utils/planGating.ts` | `trial` mirrors `business`; `starter.maxUsers` 1 → 3 |
| `src/lib/supabase/managementApi.ts` | Read-back verification + retry in `addExposedSchema` |
| `src/app/(auth)/login/page.tsx` | Add "Don't have an account? Start free trial" link |

## Error handling

| Failure | Behaviour |
| --- | --- |
| Duplicate email at signup | Inline form error from Supabase, with a link to `/login` |
| Weak password / invalid email | Inline client-side validation before submit |
| User confirms twice / refreshes `/welcome` | Unique `admin_email` constraint rejects the second claim; route returns the existing tenant and `/welcome` proceeds to refresh + redirect |
| `provision_tenant_schema` fails | Tenant row stays `provisioning` (visible in `/admin`); `/welcome` shows the error and a Retry. Safe to retry — the RPC is idempotent |
| `addExposedSchema` fails | Same: retryable, and `addExposedSchema` is a no-op when the schema is already listed |
| Trial expired mid-session | Next `/dashboard/*` request is redirected by the proxy |

The route returns generic messages to the client and logs detail server-side,
consistent with the project verifier's rule against returning raw Postgres
errors.

## Testing

Per the working agreement, unit tests cover pure logic only; the provisioning
route is verified in the browser, exactly as `/admin` is.

- `pricing.test.ts` — derived feature marks match `PLAN_LIMITS` for all three
  plans, so the page cannot drift from what the app enforces
- `trial.test.ts` — `isTrialExpired` across: non-trial plan, trial in future,
  trial in past, null `trial_ends_at`, and exact boundary
- Slug uniqueness helper — collision suffixing
- Existing suite (813 tests) must stay green; `planGating.test.ts` needs
  updating for the new `trial`/`starter` values

## Manual steps (outside the codebase)

1. **Supabase Dashboard → Authentication:** enable email confirmations, and
   paste in the branded "Confirm signup" template from
   `email-templates/confirm-signup.html`.
2. **Supabase Dashboard → URL Configuration:** confirm the redirect allow-list
   covers `https://app.boughtopia.com/auth/confirm**` (already required by the
   domain migration).
3. **Apply** `control-plane/005_tenants_admin_email_unique.sql` to Project A.
4. **Provide a real contact address.** The footer's contact link and the
   privacy policy currently both point at `privacy@boughtopia.example`, a
   placeholder carried over from the rebrand. The landing page is the first
   page a stranger sees, so this needs replacing with a real inbox before
   launch. It is one constant shared by both pages.

## Implementation sequencing

The two halves are independent apart from one link, so they can be built and
reviewed separately:

1. **Trial lifecycle first** (`planGating` changes, `isTrialExpired`,
   `proxy.ts`, `/trial-expired`) — small, self-contained, and the thing that
   makes giving away full-featured trials safe. Nothing else should merge
   before it.
2. **Signup + provisioning** — the risky half. Includes the
   `addExposedSchema` hardening and the control-plane migration.
3. **Landing page** — no backend dependencies; its CTA points at `/signup`
   from step 2.

## Out of scope

- **Stripe / paid conversion.** No checkout, no price IDs, no webhook. An
  expired trial is converted by a platform admin changing the plan in
  `/admin`. Self-serve payment is its own project.
- **Annual pricing.** Monthly only; the constant is structured to accept it
  later.
- **i18n / a German landing page.** Would require introducing i18n to a
  codebase that has none.
- **Renaming the `trial` plan or reworking the plan matrix** beyond the two
  values named above.
- **A job runner for serialized provisioning.** The read-back verification in
  `addExposedSchema` is the proportionate fix at this volume.
