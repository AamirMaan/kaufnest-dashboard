# Plans agent playbook

## Minimal file sets

**Add a new plan feature flag** (e.g. a new boolean gate):
1. `supabase/control-plane/012_plans.sql` (or a new migration) — add the
   column to `control.plans` (never apply it yourself — the user applies
   migrations).
2. `entitlements.ts` — add the field to `Plan` (camelCase) and `PlanRow`
   (snake_case), map it in `planFromRow`, add it to `PlanEntitlements` and
   `entitlementsOf`, and if it's a simple boolean gate add it to
   `PlanFeature`/`PLAN_FEATURES` so `plansWithFeature`/`planNamesByFeature`/
   `availabilityLine` pick it up for free.
3. `validatePlan.ts` — add it to `PlanInput`/`PlanErrors` (if it needs its
   own validation rule), `INPUT_KEYS` (for `planDiff`), and
   `planInputToRow`'s snake_case mapping. Add a label to `FEATURE_LABELS` if
   turning it off should show up in `detectReductions`. The `/admin`
   `PlanForm` (later task) consumes this file — don't duplicate its rules in
   the form component.
4. `src/lib/utils/pricing.ts`'s feature-tick list, if the flag is customer-
   visible on the pricing page.

**Change a plan's price, name, tagline, or visibility from `/admin`**: goes
through `PATCH /api/admin/plans/[key]`, which calls `syncStripePlan` before
writing `control.plans`. No file changes needed for this — it's data, not
code — but see the Gotchas below before touching `stripeSync.ts` itself.

**Add a new gating helper**: put it in `entitlements.ts` next to the
existing ones (`canAddUser`, `hasPlatformIntegrations`, etc.) — it should
take `PlanEntitlements`, not `Plan`, so callers go through
`entitlementsOf()`'s fail-closed mapping and can't accidentally bypass it
with a raw plan row.

**Read the catalog from a server context**: `getPlanCatalog()` /
`getPlan(key)` / `getEntitlements(key)` from `catalog.ts`. Never call
`createControlClient()` directly for plans — the 60 s cache and the
fail-closed empty-catalog throw live in `catalog.ts`.

## Gotchas

- **Fail closed, always.** `NO_ENTITLEMENTS` (`maxUsers: 1`, every boolean
  `false`, `aiGenerationsPerMonth: 0`) is what `entitlementsOf(null)` and
  `getEntitlements()` on an unknown/typo'd key return. Never add a helper
  that treats a missing plan as "unlimited" or "trust the caller" — a typo'd
  key must never grant features.
- **The trial plan's key is always exactly `"trial"`.**
  `src/lib/utils/trial.ts`'s `isTrialExpired` compares against that literal.
  The DB's own `plans_trial_key` CHECK enforces `(kind = 'trial') = (key =
  'trial')`, so this is a DB invariant, not just a convention.
- **The cache is per server instance, 60 s TTL, not distributed.** A write
  from `/admin` should call `invalidatePlanCatalog()` so *that* instance
  sees its own change immediately; every other instance (if there's more
  than one) picks it up within 60 s. Don't reach for Next.js Cache
  Components for this — the app deliberately doesn't use that.
- **A refresh failure after the TTL serves the previous catalog, not an
  error** — `getPlanCatalog()` only throws when there is *no* cache yet
  (first load, or right after `invalidatePlanCatalog()`) and the read
  fails. This is deliberate: a transient control-plane blip shouldn't 500
  every tenant's dashboard.
- **Never import `@/lib/plans/catalog` (or the future `stripeSync.ts`) from
  a `"use client"` file** — verifier-enforced (`server-module-in-client` in
  `.claude/verifiers/rules.py`); the PreToolUse hook blocks the edit
  outright. `entitlements.ts` is pure/client-safe and is the one file in
  this folder a Client Component may import directly.
- **`PlanRow` numeric columns can arrive as numeric strings** (PostgREST
  sometimes serializes `numeric` columns as strings) — `planFromRow` always
  runs them through `Number(...)` via the local `num()` helper; don't
  compare a raw row field without going through `planFromRow` first.
- **`getPlanPriceMap()` is intentionally uncached** — it backs Stripe
  webhook price→plan resolution for grandfathered subscriptions, which
  needs every historical price, not just the current one; keeping it
  separate from the 60 s plan cache avoids coupling two different
  invalidation needs.
- **`stripeSync.ts`: Stripe first, DB second.** `createStripePlan`/
  `syncStripePlan` are always called before the `control.plans`
  insert/update. If the DB write then fails, the new Stripe price is an
  unused orphan (harmless — nothing points at it) and a retry reuses the
  *same* Stripe object via the idempotency key rather than creating a
  second one. Idempotency keys: `plan-create-product-<key>`,
  `plan-create-price-<key>-<cents>`, `plan-price-<key>-<cents>-<oldPriceId>`.
  Stripe keeps a given key's response for 24 h, so an identical retry
  within that window returns the original object instead of erroring or
  duplicating.
- **Deactivating a Stripe price never touches existing subscriptions** —
  `prices.update(id, { active: false })` only stops that price from being
  usable for *new* purchases/plan-changes; tenants already subscribed at
  the old price keep billing on it (grandfathering), which is why
  `getPlanPriceMap()` (above) has to resolve every historical price, not
  just the current one.
- **Stripe SDK type names, confirmed against `stripe@22.2.0`**: the brief
  names `Stripe.ProductsResource`/`Stripe.PricesResource`, but this
  version's actual exports are singular — `Stripe.ProductResource`/
  `Stripe.PriceResource` (`node_modules/stripe/cjs/resources/{Products,Prices}.d.ts`).
  `StripePlanApi` in `stripeSync.ts` uses the singular names; if a future
  Stripe SDK upgrade renames them again, that's the one place to fix.
- **`syncStripePlan` only touches Stripe for what actually changed** — a
  `maxUsers`/`sortOrder`/etc.-only edit on a plan with `stripeProductId:
  null` returns `{}` without error; only a price/name/tagline/retire-unretire
  change on an unlinked plan throws `PlanSyncError` ("Run npm run
  plans:seed-stripe first"). A trial-kind plan never reaches Stripe at all
  (`syncStripePlan` returns `{}` immediately for `kind !== "paid"`).
