# Plan management in /admin — design

Date: 2026-10-03
Status: approved in brainstorming, awaiting spec review
Sub-project 2 of "permissions + business plans" (sub-project 1 = section
permissions, PR #121, migration 055).

## Goal

Let a platform admin create, edit, hide and retire subscription plans from
`/admin` — prices, user limits, features, AI quota, and the free trial — with
no code deploy. Today all of this is hardcoded (`PLAN_LIMITS` in
`src/lib/utils/planGating.ts`, `MONTHLY_EUR`/`NAMES`/`TAGLINES` in
`src/lib/utils/pricing.ts`, `STRIPE_PRICE_*` env vars in `src/lib/stripe.ts`,
`TRIAL_DAYS = 14` in `src/app/api/signup/provision/route.ts`).

## Decisions (from brainstorming)

| Topic | Decision |
| --- | --- |
| Scope | Edit existing plans **and** create new ones / retire old ones |
| Pricing changes | /admin auto-creates Stripe product/price; existing subscribers are **grandfathered** on their old price until they change plan |
| Lifecycle | `public` / `hidden` / `retired` |
| Interval | Monthly only (EUR) |
| Trial | Managed in /admin: features + length in days (new sign-ups only) |
| Feature edits | Apply to every tenant on the plan immediately; limits only block new actions |
| Storage | `control.plans` table in Project A (approach A) — not Stripe metadata, not a JSON blob |

## Non-goals

- Yearly pricing, multi-currency, coupons.
- Per-tenant entitlement overrides (beyond the existing `ai_enabled` /
  `shipping_labels_enabled` tenant switches, which stay as they are).
- Plan versioning / grandfathered *features* (only prices are grandfathered).
- Inventing new feature kinds from the UI — the feature set is the fixed list
  below; a new kind of feature still needs code.
- Deleting plans (retire instead).
- Moving existing subscribers to a new price.

## 1. Data model (Project A, `supabase/control-plane/012_plans.sql`)

### `control.plans`

| Column | Type | Notes |
| --- | --- | --- |
| `key` | `text primary key` | `^[a-z][a-z0-9_]{1,31}$`. Immutable after create (referenced by `tenants.plan` and Stripe `metadata.plan`). |
| `kind` | `text not null` | `'trial'` or `'paid'`. Partial unique index: at most one `trial` row. |
| `name` | `text not null` | Display name. |
| `tagline` | `text not null default ''` | |
| `visibility` | `text not null` | `'public'`, `'hidden'`, `'retired'`. Trial row is always `'hidden'`. |
| `monthly_eur` | `numeric(10,2)` | Required (≥ 1) for `paid`, null for `trial`. |
| `stripe_product_id` | `text` | Paid only. |
| `stripe_price_id` | `text` | Paid only — the *current* price for new purchases. |
| `max_users` | `integer` | Null = unlimited; otherwise ≥ 1. |
| `platform_integrations` | `boolean not null` | |
| `ai_features` | `boolean not null` | |
| `ai_generations_per_month` | `integer not null default 0` | Must be 0 when `ai_features` is false. |
| `messaging_and_listings` | `boolean not null` | |
| `advanced_inventory` | `boolean not null` | |
| `trial_days` | `integer` | Trial only, 1–90; null for paid. |
| `sort_order` | `integer not null default 0` | |
| `highlighted` | `boolean not null default false` | "Highlight on pricing page". |
| `created_at` / `updated_at` | `timestamptz` | |

CHECK constraints enforce the per-kind rules above (paid ⇒ price not null;
trial ⇒ trial_days not null, price null, visibility hidden; AI quota 0 when AI
off). RLS enabled, no policies; `grant select, insert, update on control.plans
to service_role` (matching `004_admin_audit_log.sql`'s pattern — all access is
through the server-side control client).

### `control.plan_prices`

Every Stripe price a plan has ever had, so grandfathered subscriptions on an
old price still resolve to their plan.

| Column | Type |
| --- | --- |
| `stripe_price_id` | `text primary key` |
| `plan_key` | `text not null references control.plans(key)` |
| `monthly_eur` | `numeric(10,2) not null` |
| `created_at` | `timestamptz not null default now()` |

### Seed

The migration inserts today's four plans with today's exact values
(`starter` €20 / 3 users; `pro` €30 / 5 users / integrations; `business` €50 /
unlimited / everything / 300 AI; `trial` hidden / 14 days / Business features
/ 300 AI), names and taglines from `pricing.ts`, `sort_order` 1–3,
`highlighted` on `pro`. Stripe IDs are left null.

A one-off script (`scripts/plans-seed-stripe.mjs`; `npm run plans:seed-stripe`) reads
`STRIPE_PRICE_STARTER/PRO/BUSINESS` from `.env.local`, looks each price up in
Stripe to get its product, and writes `stripe_price_id` / `stripe_product_id`
plus the matching `plan_prices` row. Idempotent.

`tenants.plan` is already free `text` — no change needed.

## 2. Reading plans in the app

### `src/lib/plans/entitlements.ts` (pure, client-safe)

- `type PlanKey = string`.
- `interface PlanEntitlements { maxUsers: number /* Infinity = unlimited */;
  platformIntegrations; aiFeatures; aiGenerationsPerMonth;
  messagingAndListings; advancedInventory }`.
- `interface Plan` — the row shape in camelCase.
- `entitlementsOf(plan: Plan | null): PlanEntitlements` — **fails closed**:
  null/unknown ⇒ `maxUsers 1`, every feature false, AI quota 0.
- Same-named helpers as today's `planGating.ts`, but taking entitlements:
  `canAddUser(ent, count)`, `hasPlatformIntegrations(ent)`,
  `hasAiFeatures(ent)`, `getAiGenerationLimit(ent)`,
  `hasMessagingAndListings(ent)`, `hasAdvancedInventory(ent)`.
- `type PlanFeature = "platformIntegrations" | "aiFeatures" |
  "messagingAndListings" | "advancedInventory"`.
- `plansWithFeature(plans: Plan[], feature): string[]` — names of
  `public` plans with that feature, in `sort_order`; plus
  `formatPlanList(names)` → `"the Pro and Business plans"` /
  `"the Business plan"` / `null` when empty.

`src/lib/utils/planGating.ts` (+ test) is **deleted**; all ~35 importers move
to the new helpers.

### `src/lib/plans/catalog.ts` (server-only)

- `getPlanCatalog(): Promise<Plan[]>` — reads `control.plans` via
  `createControlClient()`, cached in module memory for 60 s.
  `invalidatePlanCatalog()` clears it (called after admin writes). The app
  uses no Next.js caching today; Cache Components are not adopted for this.
- `getPlan(key): Promise<Plan | null>`.
- `getEntitlements(key): Promise<PlanEntitlements>` = `entitlementsOf(await getPlan(key))`.
- On a control-plane read error: return the last cached value if any,
  otherwise throw (callers already fail closed on control-plane errors).

### Client

- `dashboard/layout.tsx` already reads the tenant's `plan`; it additionally
  loads that plan's `PlanEntitlements` and a
  `planNamesByFeature: Record<PlanFeature, string[]>` (from
  `plansWithFeature`) and dispatches them into `currentUserSlice`
  (`setPlanEntitlements`, `setPlanNamesByFeature`), next to `tenantPlan`.
  Fails closed (`entitlementsOf(null)`) if the catalog cannot be read.
- `useAccess()`'s plan ceiling (055's `applyPlanCeiling` /
  `planAllows` in `src/lib/permissions/sections.ts`) takes `PlanEntitlements`
  instead of a `TenantPlan`.
- Upgrade screens derive their copy from `planNamesByFeature` instead of
  hardcoded strings: Integrations, Messages, Listings (`BusinessEbayGate`),
  Planner, Dropshipping, `AdvancedInventoryUpsellCard`. When no public plan
  has the feature: "Contact us to unlock this feature."
- `TenantPlan` in `src/types/index.ts` becomes `string` (alias of `PlanKey`);
  places that compared against literal plan names compare entitlements or
  `kind` instead. `isTrialExpired` checks `plan === "trial"` — kept, since
  the trial row's key is fixed as `trial`.

### Server gates

Integrations connect/review/import routes, the AI guard and quota
(`src/lib/ai/`), listings/messages routes, advanced-inventory guard, user
invite (`canAddUser`) and `/api/billing/status` call
`getEntitlements(tenant.plan)`.

### Trial length

`/api/signup/provision` reads `trial_days` from the `trial` row (falls back
to 14 if the row is missing, logged). Running trials keep their
`trial_ends_at`.

### Unchanged

`proxy.ts` (trial-expiry only); 055 database permissions (plan-agnostic);
`tenants.plan` writers (Stripe webhook + /admin only).

## 3. Billing and Stripe

### Purchasability — `canPurchase(plan, tenantCurrentPlanKey)` (pure, in `entitlements.ts`)

- `kind = 'trial'` → never.
- `public` → yes (requires `stripe_price_id`).
- `hidden` → only if it is the tenant's current plan (custom deal assigned
  in /admin).
- `retired` → never (a tenant on it can still switch *to* a public plan).
- No `stripe_price_id` → never ("Plan not available").

`/api/billing/checkout` and `/api/billing/change-plan` replace
`PLANS`/`VALID_PLANS` with `getPlan(key)` + `canPurchase`, charge
`plan.stripe_price_id`, and keep `metadata.plan = key`.

### Webhook

Plan resolution for `customer.subscription.created/updated`:
1. `sub.metadata.plan` if it is a known plan key;
2. else the subscription item's price id looked up in `plan_prices`;
3. else log `[billing/webhook] unknown plan for price …` and **omit `plan`
   from the patch** (status/subscription id still update). Replaces today's
   silent `?? "starter"` default.

Still the sole billing writer of `tenants.plan`/`status`.

### `src/lib/plans/stripeSync.ts` (server-only)

| Admin action | Stripe | Database |
| --- | --- | --- |
| Create paid plan | `products.create` + monthly EUR `prices.create` (`metadata.plan_key`) | insert plan + `plan_prices` row |
| Change price | new `prices.create` on the same product; old price `active: false` (existing subscriptions unaffected) | update `stripe_price_id`, insert `plan_prices` row |
| Rename / tagline | `products.update` | — |
| Retire | `products.update({ active: false })` | — |
| Un-retire | `products.update({ active: true })` | — |

Stripe is called first; the DB write follows. A failed DB write leaves an
orphan inactive-for-use price — harmless — and returns an error to retry.
Stripe calls use an idempotency key derived from
`plan_key + action + new value` so a retry does not duplicate products/prices.

### Pricing page and plan picker

- `pricedPlans(plans: Plan[])` in `src/lib/utils/pricing.ts` builds the
  table from public paid plans (sorted), ticks still derived from
  entitlements. `MONTHLY_EUR`, `NAMES`, `TAGLINES`, `PaidPlan` removed.
- Marketing `Pricing.tsx` gets public plans on the server.
- `PlanPicker` gets them from `/api/billing/status`'s response (new
  `plans` field), which already feeds Settings → Billing and
  `/trial-expired`.

### Removed

`STRIPE_PRICE_*` env vars (`.env.local.example`), `PLANS` in
`src/lib/stripe.ts`.

## 4. /admin

Header gets a **Plans** link beside Tenants and Support.

### `/admin/plans` (list)

Table (all plans incl. trial, by `sort_order`): name + key, visibility badge
(Public / Hidden / Retired / Trial), monthly price, users, feature ticks,
tenant count, row link. Primary button **New plan**. `emptyMessage` set.

### `/admin/plans/new` and `/admin/plans/[key]` (shared `PlanForm`)

- **Identity** — name, tagline; key auto-slugged from name, editable on
  create only, read-only afterwards with "Used by billing — can't change".
- **Visibility** — Public / Hidden / Retired (not shown for trial).
  Choosing Retired shows "N tenants stay on this plan".
- **Price** — monthly EUR (paid only). On edit, a changed price shows
  "Creates a new Stripe price. N current subscribers keep €X until they
  change plan."
- **Limits & features** — max users + Unlimited checkbox; four feature
  checkboxes; AI quota (shown only when AI is on).
- **Trial only** — trial length (days), "Applies to new sign-ups only".
- **Display** — sort order, highlight on pricing page.

Save rules: real `<form>`, `required` on required controls, submit
`disabled={saving || !isFormValid}`, "Saving…", toast on success and
failure, edits kept on failure. If the save **removes a feature or lowers a
limit** on a plan with tenants, a `ConfirmActionModal` lists the reductions
and the affected tenant count first.

### `validatePlan(input, { existingKeys, publicPaidCount, isCreate })` — pure, tested

- key matches `^[a-z][a-z0-9_]{1,31}$`, unique on create, not `trial` for paid;
- name required;
- paid: price ≥ 1 (two decimals);
- `max_users` null or ≥ 1;
- AI quota integer ≥ 0, and 0 when AI off;
- trial: `trial_days` 1–90;
- cannot hide/retire the last public paid plan;
- trial cannot change visibility.

Returns `Record<field, message>`; the same function runs in the API route.

### Tenant screens

`EditTenantModal` and `AddTenantModal` plan dropdowns come from
`GET /api/admin/plans`: all non-retired plans plus the tenant's current plan
even if retired. `tenantVariants.ts` maps known keys as today and any other
key to a neutral badge.

### API (all gated by `isPlatformAdmin`, safe error messages only)

- `GET /api/admin/plans` — catalog + per-plan tenant counts.
- `POST /api/admin/plans` — validate, Stripe sync (paid), insert,
  `invalidatePlanCatalog()`, audit.
- `PATCH /api/admin/plans/[key]` — validate, Stripe sync (price/name/
  visibility changes), update, invalidate, audit.
- No DELETE.

Audit: `control.admin_audit_log` rows with `action` `plan_create` /
`plan_update`, `tenant_id` null, `metadata` `{ key, before, after }`.
New server-only helper `requirePlatformAdmin()` in
`src/lib/plans/authGuard.ts` (wraps `isPlatformAdmin`), added to the
verifier's `_AUTH_MARKERS`.

## 5. Testing

Unit (colocated):
- `entitlements.test.ts` — fail-closed fallback, helpers, `plansWithFeature`
  / `formatPlanList`, `canPurchase` (public/hidden/retired/trial/no price).
- `validatePlan.test.ts` — every rule above.
- `pricing.test.ts` — rewritten to build from a catalog fixture.
- Webhook plan resolution — metadata → price lookup → unknown (no plan write).
- `stripeSync.test.ts` — Stripe mocked: create, price change (old price
  deactivated, new `plan_prices` row), rename, retire; idempotency keys.
- Reduction detector (which edits need the confirm modal).

Live parity (integration, skipped without env): seeded `control.plans`
values equal the pre-change hardcoded `PLAN_LIMITS` / prices / names, so the
switch-over is a no-op.

## 6. Rollout

1. User applies `supabase/control-plane/012_plans.sql` (tables + seed).
2. User runs `npm run plans:seed-stripe` (writes current Stripe IDs).
3. Deploy code.
4. Remove `STRIPE_PRICE_*` env vars.

Until step 2, checkout/change-plan return "Plan not available" (no
`stripe_price_id`) rather than charging a wrong price; gating already works
from the seeded rows after step 1.

## 7. Docs

Update `src/app/admin/CLAUDE.md` + `SKILL.md` (Plans pages, API, components),
`AGENTS.md` (replace `planGating.ts`/`pricing.ts`/`stripe.ts PLANS` bullets
with `src/lib/plans/`), `supabase/SKILL.md` file map (012 control-plane),
`src/lib/utils/SKILL.md`, billing/integrations/AI/listings/messages/
inventory docs that cite `planGating.ts`, `.env.local.example`.

## Implementation notes (2026-10-03)

Deviations from the plan above, discovered during implementation:

- Reused `verifyPlatformAdmin` (from `api/admin/tenants/route.ts`, now
  returning `{ ok: true; email: string } | { ok: false; response }`) instead
  of adding a new `requirePlatformAdmin()` in `src/lib/plans/authGuard.ts` —
  the existing helper already did the job and now also supplies the audit
  log's `admin_email`.
- `toWireEntitlements`/`fromWireEntitlements` (`src/lib/plans/entitlements.ts`)
  carry `PlanEntitlements` across the Server → Client Component hop in
  `dashboard/layout.tsx` → `StoreProvider.tsx`, since `Infinity` (unlimited
  `maxUsers`) doesn't survive RSC serialization — the wire form uses `-1`.
- The invite route (`src/app/api/users/invite/route.ts`) now enforces
  `maxUsers` via `canAddUser(ent, userCount)` — this limit was never
  enforced before the catalog existed.
- The billing webhook fails the event (returns 500, so Stripe retries)
  when `getPlanCatalog()`/`getPlanPriceMap()` can't be read, rather than
  silently skipping the plan write.
- Catalog/integrations/invite tenant lookups use `.maybeSingle()` instead of
  `.single()`, so a genuine lookup error still surfaces as a 500 while a
  merely-missing row fails closed (null) instead of both cases throwing the
  same way.
- The old Stripe price is deactivated only **after** the `control.plans`
  update commits — `syncStripePlan` returns `{ priceId?, deactivatePriceId? }`
  and never calls `deactivateStripePrice` itself; the route handler does,
  once the DB write succeeds. This avoids deactivating a still-referenced
  price if the DB write then fails.
- `stripeSync.ts`'s `StripePlanApi` types against `Stripe.ProductResource`/
  `Stripe.PriceResource` (singular) — the actual exported names in the
  `stripe@22` SDK, not the `Product`/`Price` names used elsewhere in older
  examples.
- `/trial-expired` shows "Loading plans…" until its `GET /api/billing/status`
  read settles, rather than rendering an empty `PlanPicker` first.
- The marketing page's "Every plan starts with the same N-day free trial"
  line and the Hero/TrialInfo copy both read the trial length from
  `getTrialDays()` (the catalog's `trial` row) instead of a hardcoded `14`.
