# Plan catalog (`src/lib/plans/`)

The plan catalog lives in `control.plans` (control-plane migration
`supabase/control-plane/012_plans.sql`) — not yet applied to the live
database (see `AGENTS.md` / `supabase/SKILL.md`'s apply-status table before
relying on this against a real DB). This folder is the single place that
reads it and turns a row into the gating decisions the rest of the app
needs. It replaces the old hardcoded `PLAN_LIMITS` table in
`src/lib/utils/planGating.ts`.

## File map

| File | Server-only? | Owns |
| --- | --- | --- |
| `entitlements.ts` | No — pure, client-safe | `Plan`/`PlanRow`/`PlanEntitlements` types, `planFromRow`, `entitlementsOf`, every gating helper (`canAddUser`, `hasPlatformIntegrations`, `hasAiFeatures`, `getAiGenerationLimit`, `hasMessagingAndListings`, `hasAdvancedInventory`), the feature-list helpers (`PLAN_FEATURES`, `sortPlans`, `plansWithFeature`, `planNamesByFeature`, `formatPlanList`, `availabilityLine`), and the purchase/assignability rules (`canPurchase`, `isAssignablePlan`) |
| `entitlements.test.ts` | — | unit tests for the above |
| `catalog.ts` | **Yes** | `getPlanCatalog()` (60 s in-memory cache per server instance), `invalidatePlanCatalog()`, `getPlan(key)`, `getEntitlements(key)`, `getTrialDays()`, `getPlanPriceMap()` — all read `control.plans`/`control.plan_prices` via `createControlClient()` (`src/lib/supabase/control.ts`) |
| `catalog.test.ts` | — | unit tests, mocks `@/lib/supabase/control` |
| `catalog.integration.test.ts` | — | live parity test against the real control-plane DB; skips cleanly (console note) while 012 is unapplied — see its own header comment |

`stripeSync.ts` is referenced by the verifier's server-only import guard as a
planned future file (plan↔Stripe price sync) — it does not exist yet; later
tasks in this plan add it.

## Data flow

```
control.plans (012)  →  catalog.ts (60 s cache, server-only)  →  layout hydration / server-side gates (requireXGuard-style checks, API routes)
```

`entitlements.ts` has no network dependency — it only shapes data that
`catalog.ts` (or a test) hands it. Anything that needs plan gating from a
Client Component calls a server route / thunk that goes through
`catalog.ts`; it must never import `catalog.ts` directly (enforced by
`.claude/verifiers/rules.py`'s `server-module-in-client` rule).

## Shared deps

- `src/lib/supabase/control.ts` — `createControlClient()`, the service-role
  client `catalog.ts` reads `control.plans`/`control.plan_prices` through.

## Tests

```
npx jest src/lib/plans
npm run test:integration -- src/lib/plans   # requires .env.local; skips cleanly if 012 isn't applied
```
