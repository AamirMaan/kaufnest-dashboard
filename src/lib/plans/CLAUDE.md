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
| `validatePlan.ts` | No — pure, client-safe | `PlanInput` (= `Plan` minus the two Stripe id fields), `PlanErrors`, `parsePlanInput` (coerces an API-route/form body into `PlanInput`, never throws), `validatePlan(input, { isCreate, catalog })` (field-level + cross-field rules: key format/reserved/duplicate, paid-price range/decimals, trial length, last-public-plan guard, AI quota vs. `aiFeatures`), `detectReductions` (tenant-facing "this takes something away" warnings for the admin confirm step), `planDiff` (audit-log `metadata.changes`), `planInputToRow` (camelCase → snake_case `control.plans` columns, never includes the Stripe ids — those are written separately once Stripe confirms them) |
| `validatePlan.test.ts` | — | unit tests for the above |
| `stripeSync.ts` | **Yes** | `StripePlanApi` (the minimal `products.create/update` + `prices.create/update` shape the route handlers pass in — `Pick<Stripe.ProductResource, …>`/`Pick<Stripe.PriceResource, …>`, see the Gotchas below for the SDK's actual export names), `toCents`, `createStripePlan` (new plan → Stripe product + price), `syncStripePlan` (edit → price replacement / product rename / retire-unretire, only when something Stripe-relevant changed — returns `{ priceId?, deactivatePriceId? }`, never deactivates anything itself), `deactivateStripePrice` (the caller runs this only after its own DB write commits — see the Gotchas below), `PlanSyncError` (thrown when an edit needs Stripe but the plan was never linked to it) |
| `stripeSync.test.ts` | — | unit tests, fake `StripePlanApi` (`jest.fn()` per method) — no real Stripe SDK involved |

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

## Consumers (plan-management Task 5 — admin plan API)

- `src/app/api/admin/plans/route.ts` (`GET`, `POST`) and
  `src/app/api/admin/plans/[key]/route.ts` (`PATCH`) — the `/admin` plan
  management API. Both call `invalidatePlanCatalog()` then `getPlanCatalog()`
  at the top of every handler (so a concurrent edit from another request is
  never validated against a stale catalog), run `validatePlan`/`parsePlanInput`,
  then `createStripePlan`/`syncStripePlan` (Stripe first) before writing
  `control.plans` (DB second) and `control.admin_audit_log` (`action:
  "plan_create"`/`"plan_update"`, `metadata: { key, changes: planDiff(...) }`).
  Both import `verifyPlatformAdmin` from `../tenants/route` (now returns
  `{ ok: true; email: string }` — the email is the audit log's `admin_email`).

## Shared deps

- `src/lib/supabase/control.ts` — `createControlClient()`, the service-role
  client `catalog.ts` reads `control.plans`/`control.plan_prices` through.
- `src/lib/stripe.ts` — `getStripe()`, passed into `createStripePlan`/
  `syncStripePlan` by the admin plan API routes.

## Tests

```
npx jest src/lib/plans
npm run test:integration -- src/lib/plans   # requires .env.local; skips cleanly if 012 isn't applied
```
