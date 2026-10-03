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
| `entitlements.ts` | No — pure, client-safe | `Plan`/`PlanRow`/`PlanEntitlements` types, `planFromRow`, `entitlementsOf`, every gating helper (`canAddUser`, `hasPlatformIntegrations`, `hasAiFeatures`, `getAiGenerationLimit`, `hasMessagingAndListings`, `hasAdvancedInventory`), the feature-list helpers (`PLAN_FEATURES`, `sortPlans`, `plansWithFeature`, `planNamesByFeature`, `formatPlanList`, `availabilityLine`), the purchase/assignability rules (`canPurchase`, `isAssignablePlan`), and `toWireEntitlements`/`fromWireEntitlements` (unlimited `maxUsers` ↔ `-1` for the Server → Client Component hop in `dashboard/layout.tsx` → `StoreProvider`) |
| `entitlements.test.ts` | — | unit tests for the above |
| `catalog.ts` | **Yes** | `getPlanCatalog()` (60 s in-memory cache per server instance), `invalidatePlanCatalog()`, `getPlan(key)`, `getEntitlements(key)`, `getTrialDays()`, `getPlanPriceMap()` — all read `control.plans`/`control.plan_prices` via `createControlClient()` (`src/lib/supabase/control.ts`) |
| `catalog.test.ts` | — | unit tests, mocks `@/lib/supabase/control` |
| `resolvePlanKey.ts` | No — pure, client-safe | `resolvePlanKey({ metadataPlan, priceId, paidPlanKeys, priceToPlan })` — which paid plan a Stripe subscription is on, for the billing webhook: `metadata.plan` first, then the price id via `control.plan_prices` (grandfathered prices / dashboard edits). Never resolves to the trial; `null` = unknown, and the webhook then leaves `tenants.plan` untouched (no silent `starter` default) |
| `resolvePlanKey.test.ts` | — | unit tests for the above |
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

## Consumers (plan-management Task 3)

- Client: `dashboard/layout.tsx` hydrates `currentUserSlice.planEntitlements`
  + `planNamesByFeature`; every client gate reads them via
  `src/store/usePlan.ts` (`usePlan(): { ent, availability }`), and
  `useAccess()`/`sections.ts`' `planAllows`/`applyPlanCeiling`/
  `effectiveAccess` take `PlanEntitlements | null`.
- Server: integrations routes (`review`, `review/import`, `[platform]/connect`),
  `lib/ai/authGuard.ts`, `api/listings/ai/usage`, `api/admin/ai-usage`,
  `lib/inventory/authGuard.ts`, `api/users/invite` (user limit) call
  `getEntitlements`/`getPlanCatalog`; `api/signup/provision`,
  `api/admin/provision-tenant` and the marketing page call `getTrialDays()`.

## Consumers (plan-management Task 4 — billing)

- Marketing page: `getPlanCatalog()` → public plans → `pricedPlans()` →
  `<Pricing plans trialDays>`.
- `GET /api/billing/status`: returns `plans` = `pricedPlans()` of the
  catalog filtered by `canPurchase(p, tenant.plan)` (`[]` if the catalog is
  unreadable); `PlanPicker` (Settings, `/trial-expired`) renders only those.
- `POST /api/billing/checkout` / `change-plan`: `getPlan(key)` +
  `canPurchase` after the tenant lookup; charge `plan.stripePriceId`;
  `"Plan not available"` (400) otherwise, 500 if the catalog is unreadable.
- Billing webhook: `getPlanCatalog()` + `getPlanPriceMap()` →
  `resolvePlanKey`; a catalog read failure returns 500 so Stripe retries.

## Shared deps

- `src/lib/supabase/control.ts` — `createControlClient()`, the service-role
  client `catalog.ts` reads `control.plans`/`control.plan_prices` through.

## Tests

```
npx jest src/lib/plans
npm run test:integration -- src/lib/plans   # requires .env.local; skips cleanly if 012 isn't applied
```
