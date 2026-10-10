# Plan Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded plan matrix (`planGating.ts`, `pricing.ts` tables, `STRIPE_PRICE_*` env, `TRIAL_DAYS = 14`) with a `control.plans` catalog that a platform admin creates, edits, hides and retires from `/admin`, with Stripe products/prices created automatically and old prices grandfathered.

**Architecture:** Project A gets `control.plans` + `control.plan_prices` (control-plane migration 012). A pure, client-safe module (`src/lib/plans/entitlements.ts`) holds the `Plan`/`PlanEntitlements` types and every gating helper; a server-only module (`src/lib/plans/catalog.ts`) reads the catalog with a 60 s in-memory cache. The dashboard layout hydrates the tenant's entitlements into Redux; server routes call `getEntitlements(tenant.plan)`. `/admin/plans` writes through API routes that call Stripe first (`stripeSync.ts`), then the DB, then invalidate the cache and write `control.admin_audit_log`.

**Tech Stack:** Next.js App Router (non-standard version — read `node_modules/next/dist/docs/` before using a Next API you have not seen in this repo), Supabase (control plane = Project A via `createControlClient()`), Stripe Node SDK v22, Redux Toolkit, Jest (ts-jest, node env).

**Spec:** `docs/superpowers/specs/2026-10-03-plan-management-design.md`

## Global Constraints

- Branch: `feat/plan-management` (already exists, spec committed). Never commit to `main`.
- The user applies SQL migrations themselves. **Never apply a migration or run DDL** against any database. Read-only SQL is fine.
- Commit hooks: `.husky/pre-commit` runs `tsc --noEmit`, `eslint`, and the project verifier — do NOT run `tsc`/`lint` by hand; fix what the commit reports and re-run the same commit. Run focused tests yourself: `npx jest <path>`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- AGENTS.md docs rule: every task updates the affected feature `CLAUDE.md`/`SKILL.md` **in the same commit** as its code.
- Server-only modules (`src/lib/plans/catalog.ts`, `src/lib/plans/stripeSync.ts`, `src/lib/supabase/control.ts`, `src/lib/stripe.ts`) must never be imported from a `"use client"` file. `src/lib/plans/entitlements.ts`, `validatePlan.ts`, `resolvePlanKey.ts` are pure and client-safe.
- Route handlers never return raw Postgres or Stripe error text to the client — log server-side, return a fixed user-safe message.
- Unknown / missing plan ⇒ **fail closed**: `maxUsers 1`, every feature false, AI quota 0.
- The trial plan's key is always exactly `trial` (`isTrialExpired` in `src/lib/utils/trial.ts` relies on it).
- Plan key format: `^[a-z][a-z0-9_]{1,31}$`. Immutable after creation.
- Monthly EUR only. Paid price ≥ €1, at most 2 decimals. Trial length 1–90 days.
- Feature list is fixed: `platformIntegrations`, `aiFeatures` (+ `aiGenerationsPerMonth`), `messagingAndListings`, `advancedInventory`, plus `maxUsers` (null = unlimited).
- Seeded values (must equal today's hardcoded values exactly):

  | key | kind | name | tagline | visibility | €/mo | max_users | integrations | ai | ai/mo | msg+listings | adv. inventory | trial_days | sort | highlighted |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | trial | trial | Trial | `''` | hidden | null | null | true | true | 300 | true | true | 14 | 0 | false |
  | starter | paid | Starter | Bookkeeping for a small team, entered by hand. | public | 20 | 3 | false | false | 0 | false | false | null | 1 | false |
  | pro | paid | Pro | Pull your eBay and Amazon orders in automatically. | public | 30 | 5 | true | false | 0 | false | false | null | 2 | true |
  | business | paid | Business | Run listings, messages and the whole operation in one place. | public | 50 | null | true | true | 300 | true | true | null | 3 | false |

- UI conventions (AGENTS.md): atoms from `src/components/ui/*`, tokens via `var(--color-*)`, one primary `Button` per view, real `<form id>` + `type="submit" form="<id>"`, `required` on controls, `disabled={saving || !isFormValid}`, busy label "Saving…", `useToast()` on success AND failure, failed saves keep the user's edits.

## File Structure

**Create**
- `supabase/control-plane/012_plans.sql` — tables, constraints, grants, seed.
- `scripts/plans-seed-stripe.mjs` — one-off: copy current Stripe price/product IDs into the seeded rows (replaces `scripts/stripe-setup.mjs`).
- `src/lib/plans/entitlements.ts` (+ `.test.ts`) — pure types + helpers.
- `src/lib/plans/catalog.ts` (+ `.test.ts`) — server-only cached loader.
- `src/lib/plans/catalog.integration.test.ts` — live parity check of seeded rows.
- `src/lib/plans/resolvePlanKey.ts` (+ `.test.ts`) — webhook plan resolution.
- `src/lib/plans/validatePlan.ts` (+ `.test.ts`) — input parsing, validation, reductions, diff.
- `src/lib/plans/stripeSync.ts` (+ `.test.ts`) — Stripe product/price sync (Stripe injected).
- `src/lib/plans/CLAUDE.md`, `src/lib/plans/SKILL.md`.
- `src/app/api/admin/plans/route.ts` (GET, POST), `src/app/api/admin/plans/[key]/route.ts` (PATCH).
- `src/app/admin/plans/page.tsx`, `src/app/admin/plans/new/page.tsx`, `src/app/admin/plans/[key]/page.tsx`.
- `src/app/admin/plans/_components/PlanForm.tsx`.
- `src/app/admin/plans/_lib/planFormState.ts` (+ `.test.ts`).
- `src/app/admin/_components/planOptions.ts` (+ `.test.ts`).

**Delete**
- `src/lib/utils/planGating.ts`, `src/lib/utils/planGating.test.ts`, `scripts/stripe-setup.mjs`.

**Modify** (by task, listed in each task)

---

### Task 1: Control-plane migration + Stripe seed script

**Files:**
- Create: `supabase/control-plane/012_plans.sql`
- Create: `scripts/plans-seed-stripe.mjs`
- Delete: `scripts/stripe-setup.mjs`
- Modify: `package.json` (scripts: replace `"stripe:setup"` with `"plans:seed-stripe": "node --env-file=.env.local scripts/plans-seed-stripe.mjs"`)
- Modify: `supabase/SKILL.md` (file-map table: add a `control-plane/012_plans.sql` row, status `⏳ apply` with a one-line description; mention running `npm run plans:seed-stripe` after applying)

**Interfaces:**
- Produces: tables `control.plans`, `control.plan_prices` with exactly the columns below (snake_case). Later tasks read them through `PlanRow`.

- [ ] **Step 1: Write the migration**

`supabase/control-plane/012_plans.sql`:

```sql
-- ============================================================
-- Plan catalog — control plane (Project A, kaufnest-control)
-- Run in the Supabase SQL editor for PROJECT A.
--
-- Replaces the hardcoded plan matrix (src/lib/utils/planGating.ts,
-- src/lib/utils/pricing.ts, STRIPE_PRICE_* env vars, TRIAL_DAYS = 14).
-- Managed from /admin/plans. See
-- docs/superpowers/specs/2026-10-03-plan-management-design.md.
--
-- After applying: run `npm run plans:seed-stripe` once per environment to
-- copy the existing Stripe price/product IDs into the seeded rows. Until
-- then checkout/change-plan answer "Plan not available" (gating already
-- works from the seeded rows).
-- ============================================================

create table if not exists control.plans (
  key                      text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  kind                     text not null check (kind in ('trial', 'paid')),
  name                     text not null check (length(btrim(name)) > 0),
  tagline                  text not null default '',
  visibility               text not null check (visibility in ('public', 'hidden', 'retired')),
  monthly_eur              numeric(10,2),
  stripe_product_id        text,
  stripe_price_id          text unique,
  max_users                integer check (max_users is null or max_users >= 1),
  platform_integrations    boolean not null default false,
  ai_features              boolean not null default false,
  ai_generations_per_month integer not null default 0 check (ai_generations_per_month >= 0),
  messaging_and_listings   boolean not null default false,
  advanced_inventory       boolean not null default false,
  trial_days               integer,
  sort_order               integer not null default 0,
  highlighted              boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- The trial row's key is fixed: isTrialExpired() compares plan === 'trial'.
  constraint plans_trial_key check ((kind = 'trial') = (key = 'trial')),
  constraint plans_ai_quota_needs_ai check (ai_features or ai_generations_per_month = 0),
  constraint plans_kind_shape check (
    (kind = 'paid'
      and monthly_eur is not null and monthly_eur >= 1
      and trial_days is null)
    or
    (kind = 'trial'
      and monthly_eur is null and stripe_price_id is null and stripe_product_id is null
      and visibility = 'hidden'
      and trial_days between 1 and 90)
  )
);

-- Every Stripe price a plan has ever had. Grandfathered subscriptions stay
-- on an old price; the webhook resolves it back to its plan through here.
create table if not exists control.plan_prices (
  stripe_price_id text primary key,
  plan_key        text not null references control.plans(key),
  monthly_eur     numeric(10,2) not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_plan_prices_plan_key on control.plan_prices (plan_key);

alter table control.plans enable row level security;
alter table control.plan_prices enable row level security;

-- All access goes through the server-side control client (service role),
-- same pattern as 004_admin_audit_log.sql. No delete: plans are retired.
grant select, insert, update on control.plans to service_role;
grant select, insert on control.plan_prices to service_role;

insert into control.plans
  (key, kind, name, tagline, visibility, monthly_eur, max_users,
   platform_integrations, ai_features, ai_generations_per_month,
   messaging_and_listings, advanced_inventory, trial_days, sort_order, highlighted)
values
  ('trial',    'trial', 'Trial',    '',
     'hidden', null, null, true,  true,  300, true,  true,  14,   0, false),
  ('starter',  'paid',  'Starter',  'Bookkeeping for a small team, entered by hand.',
     'public', 20,   3,    false, false, 0,   false, false, null, 1, false),
  ('pro',      'paid',  'Pro',      'Pull your eBay and Amazon orders in automatically.',
     'public', 30,   5,    true,  false, 0,   false, false, null, 2, true),
  ('business', 'paid',  'Business', 'Run listings, messages and the whole operation in one place.',
     'public', 50,   null, true,  true,  300, true,  true,  null, 3, false)
on conflict (key) do nothing;
```

- [ ] **Step 2: Write the seed script**

`scripts/plans-seed-stripe.mjs`:

```js
// One-off, per Stripe mode (test/live): copy the existing Stripe price IDs
// (STRIPE_PRICE_STARTER/_PRO/_BUSINESS in .env.local) into the seeded
// control.plans rows (control-plane 012), plus their product IDs and a
// control.plan_prices history row. Idempotent — safe to re-run.
//
// Usage: npm run plans:seed-stripe
//
// After this has run in an environment, the STRIPE_PRICE_* env vars are no
// longer read by the app and can be deleted.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const control = createClient(
  process.env.CONTROL_SUPABASE_URL,
  process.env.CONTROL_SUPABASE_SERVICE_KEY
).schema("control");

const ENV = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

async function main() {
  console.log(`Seeding plan Stripe IDs (${
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "TEST"
  } mode)...\n`);

  for (const [key, priceId] of Object.entries(ENV)) {
    if (!priceId) {
      console.log(`- ${key}: STRIPE_PRICE_${key.toUpperCase()} not set, skipped`);
      continue;
    }
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const monthlyEur = (price.unit_amount ?? 0) / 100;

    const { error: planError } = await control
      .from("plans")
      .update({ stripe_price_id: priceId, stripe_product_id: productId, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (planError) throw new Error(`${key}: ${planError.message}`);

    const { error: historyError } = await control
      .from("plan_prices")
      .upsert({ stripe_price_id: priceId, plan_key: key, monthly_eur: monthlyEur }, { onConflict: "stripe_price_id" });
    if (historyError) throw new Error(`${key} history: ${historyError.message}`);

    console.log(`- ${key}: price ${priceId} (€${monthlyEur}), product ${productId}`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Delete `scripts/stripe-setup.mjs`, update `package.json` script, update `supabase/SKILL.md` file map**

```bash
git rm scripts/stripe-setup.mjs
```

In `package.json` replace the line `"stripe:setup": "node --env-file=.env.local scripts/stripe-setup.mjs",` with `"plans:seed-stripe": "node --env-file=.env.local scripts/plans-seed-stripe.mjs",`. Grep the repo for other mentions of `stripe:setup` / `stripe-setup` (`grep -rn "stripe:setup\|stripe-setup" --exclude-dir=node_modules --exclude-dir=.next .`) and repoint them to `plans:seed-stripe` (docs only — `.env.local.example` is handled in Task 4).

- [ ] **Step 4: Commit**

```bash
git add supabase/control-plane/012_plans.sql scripts/plans-seed-stripe.mjs package.json supabase/SKILL.md
git commit -m "feat(plans): control.plans catalog migration (012) and Stripe seed script"
```

---

### Task 2: Pure entitlements module + server catalog loader

**Files:**
- Create: `src/lib/plans/entitlements.ts`, `src/lib/plans/entitlements.test.ts`
- Create: `src/lib/plans/catalog.ts`, `src/lib/plans/catalog.test.ts`
- Create: `src/lib/plans/catalog.integration.test.ts`
- Create: `src/lib/plans/CLAUDE.md`, `src/lib/plans/SKILL.md`
- Modify: `.claude/verifiers/rules.py` (`server-module-in-client` pattern) and `.claude/verifiers/test_rules.py`

**Interfaces:**
- Produces (exact names, used by every later task):
  - `type PlanKey = string`, `type PlanKind = "trial" | "paid"`, `type PlanVisibility = "public" | "hidden" | "retired"`
  - `interface Plan` (camelCase, below), `interface PlanRow` (snake_case DB row), `planFromRow(row): Plan`
  - `interface PlanEntitlements`, `NO_ENTITLEMENTS`, `entitlementsOf(plan)`
  - `canAddUser`, `hasPlatformIntegrations`, `hasAiFeatures`, `getAiGenerationLimit`, `hasMessagingAndListings`, `hasAdvancedInventory` — all take `PlanEntitlements`
  - `type PlanFeature`, `PLAN_FEATURES`, `sortPlans`, `plansWithFeature`, `planNamesByFeature`, `formatPlanList`, `availabilityLine`
  - `canPurchase(plan, currentPlanKey)`, `isAssignablePlan(plan, currentPlanKey)`
  - `catalog.ts`: `getPlanCatalog()`, `invalidatePlanCatalog()`, `getPlan(key)`, `getEntitlements(key)`, `getTrialDays()`, `getPlanPriceMap()`

- [ ] **Step 1: Write the failing tests for `entitlements.ts`**

`src/lib/plans/entitlements.test.ts`:

```ts
import {
  NO_ENTITLEMENTS,
  availabilityLine,
  canAddUser,
  canPurchase,
  entitlementsOf,
  formatPlanList,
  getAiGenerationLimit,
  hasAdvancedInventory,
  hasAiFeatures,
  hasMessagingAndListings,
  hasPlatformIntegrations,
  isAssignablePlan,
  planFromRow,
  planNamesByFeature,
  plansWithFeature,
  sortPlans,
  type Plan,
  type PlanRow,
} from "./entitlements";

const plan = (over: Partial<Plan> = {}): Plan => ({
  key: "pro",
  kind: "paid",
  name: "Pro",
  tagline: "",
  visibility: "public",
  monthlyEur: 30,
  stripeProductId: "prod_1",
  stripePriceId: "price_1",
  maxUsers: 5,
  platformIntegrations: true,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
  trialDays: null,
  sortOrder: 2,
  highlighted: false,
  ...over,
});

describe("planFromRow", () => {
  it("maps snake_case columns and coerces numeric strings", () => {
    const row: PlanRow = {
      key: "pro", kind: "paid", name: "Pro", tagline: "t", visibility: "public",
      monthly_eur: "30.00" as unknown as number, stripe_product_id: "prod_1", stripe_price_id: "price_1",
      max_users: 5, platform_integrations: true, ai_features: false, ai_generations_per_month: 0,
      messaging_and_listings: false, advanced_inventory: false, trial_days: null,
      sort_order: 2, highlighted: true,
    };
    expect(planFromRow(row)).toEqual(plan({ tagline: "t", highlighted: true }));
  });
});

describe("entitlementsOf", () => {
  it("fails closed for null", () => {
    expect(entitlementsOf(null)).toEqual(NO_ENTITLEMENTS);
    expect(NO_ENTITLEMENTS).toEqual({
      maxUsers: 1, platformIntegrations: false, aiFeatures: false,
      aiGenerationsPerMonth: 0, messagingAndListings: false, advancedInventory: false,
    });
  });
  it("maps null max_users to Infinity", () => {
    expect(entitlementsOf(plan({ maxUsers: null })).maxUsers).toBe(Infinity);
  });
  it("forces AI quota to 0 when AI is off", () => {
    expect(entitlementsOf(plan({ aiFeatures: false, aiGenerationsPerMonth: 50 })).aiGenerationsPerMonth).toBe(0);
  });
});

describe("helpers", () => {
  const ent = entitlementsOf(plan({ maxUsers: 3, aiFeatures: true, aiGenerationsPerMonth: 300 }));
  it("canAddUser is strict less-than", () => {
    expect(canAddUser(ent, 2)).toBe(true);
    expect(canAddUser(ent, 3)).toBe(false);
    expect(canAddUser(entitlementsOf(plan({ maxUsers: null })), 10_000)).toBe(true);
  });
  it("feature flags", () => {
    expect(hasPlatformIntegrations(ent)).toBe(true);
    expect(hasAiFeatures(ent)).toBe(true);
    expect(getAiGenerationLimit(ent)).toBe(300);
    expect(hasMessagingAndListings(ent)).toBe(false);
    expect(hasAdvancedInventory(ent)).toBe(false);
  });
});

describe("plansWithFeature / formatPlanList / availabilityLine", () => {
  const catalog = [
    plan({ key: "business", name: "Business", sortOrder: 3, messagingAndListings: true }),
    plan({ key: "pro", name: "Pro", sortOrder: 2 }),
    plan({ key: "starter", name: "Starter", sortOrder: 1, platformIntegrations: false }),
    plan({ key: "secret", name: "Secret", visibility: "hidden", sortOrder: 4 }),
    plan({ key: "old", name: "Old", visibility: "retired", sortOrder: 5 }),
    plan({ key: "trial", kind: "trial", name: "Trial", visibility: "hidden", sortOrder: 0, monthlyEur: null }),
  ];
  it("lists only public paid plans, in sort order", () => {
    expect(plansWithFeature(catalog, "platformIntegrations")).toEqual(["Pro", "Business"]);
    expect(plansWithFeature(catalog, "messagingAndListings")).toEqual(["Business"]);
    expect(plansWithFeature(catalog, "advancedInventory")).toEqual([]);
  });
  it("planNamesByFeature covers every feature", () => {
    expect(planNamesByFeature(catalog)).toEqual({
      platformIntegrations: ["Pro", "Business"],
      aiFeatures: [],
      messagingAndListings: ["Business"],
      advancedInventory: [],
    });
  });
  it("formatPlanList", () => {
    expect(formatPlanList([])).toBeNull();
    expect(formatPlanList(["Business"])).toBe("the Business plan");
    expect(formatPlanList(["Pro", "Business"])).toBe("the Pro and Business plans");
    expect(formatPlanList(["A", "B", "C"])).toBe("the A, B and C plans");
  });
  it("availabilityLine", () => {
    expect(availabilityLine("eBay messaging", ["Business"])).toBe("eBay messaging is available on the Business plan.");
    expect(availabilityLine("eBay messaging", [])).toBe("Contact us to unlock this feature.");
  });
  it("sortPlans orders by sortOrder then key", () => {
    expect(sortPlans([plan({ key: "b", sortOrder: 1 }), plan({ key: "a", sortOrder: 1 }), plan({ key: "z", sortOrder: 0 })]).map((p) => p.key))
      .toEqual(["z", "a", "b"]);
  });
});

describe("canPurchase", () => {
  it("public with a price: yes", () => expect(canPurchase(plan(), "trial")).toBe(true));
  it("no Stripe price: no", () => expect(canPurchase(plan({ stripePriceId: null }), "trial")).toBe(false));
  it("trial: never", () => expect(canPurchase(plan({ key: "trial", kind: "trial", visibility: "hidden" }), "trial")).toBe(false));
  it("hidden: only the tenant's own plan", () => {
    const hidden = plan({ key: "deal", visibility: "hidden" });
    expect(canPurchase(hidden, "deal")).toBe(true);
    expect(canPurchase(hidden, "pro")).toBe(false);
  });
  it("retired: never", () => expect(canPurchase(plan({ visibility: "retired" }), "pro")).toBe(false));
});

describe("isAssignablePlan", () => {
  it("null plan: no", () => expect(isAssignablePlan(null, "pro")).toBe(false));
  it("retired: only when unchanged", () => {
    const old = plan({ key: "old", visibility: "retired" });
    expect(isAssignablePlan(old, "old")).toBe(true);
    expect(isAssignablePlan(old, "pro")).toBe(false);
  });
  it("hidden, public and trial are assignable", () => {
    expect(isAssignablePlan(plan({ visibility: "hidden" }), null)).toBe(true);
    expect(isAssignablePlan(plan(), null)).toBe(true);
    expect(isAssignablePlan(plan({ key: "trial", kind: "trial", visibility: "hidden" }), null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/plans/entitlements.test.ts`
Expected: FAIL — `Cannot find module './entitlements'`.

- [ ] **Step 3: Implement `entitlements.ts`**

`src/lib/plans/entitlements.ts`:

```ts
/**
 * Plan catalog types + every plan-gating helper (pure, client-safe).
 * Replaces the hardcoded PLAN_LIMITS table that lived in
 * lib/utils/planGating.ts. Rows come from control.plans (control-plane 012)
 * via the server-only lib/plans/catalog.ts.
 */

export type PlanKey = string;
export type PlanKind = "trial" | "paid";
export type PlanVisibility = "public" | "hidden" | "retired";

export interface Plan {
  key: PlanKey;
  kind: PlanKind;
  name: string;
  tagline: string;
  visibility: PlanVisibility;
  monthlyEur: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  /** null = unlimited */
  maxUsers: number | null;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  aiGenerationsPerMonth: number;
  messagingAndListings: boolean;
  advancedInventory: boolean;
  trialDays: number | null;
  sortOrder: number;
  highlighted: boolean;
}

/** A control.plans row as PostgREST returns it. */
export interface PlanRow {
  key: string;
  kind: string;
  name: string;
  tagline: string;
  visibility: string;
  monthly_eur: number | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  max_users: number | null;
  platform_integrations: boolean;
  ai_features: boolean;
  ai_generations_per_month: number;
  messaging_and_listings: boolean;
  advanced_inventory: boolean;
  trial_days: number | null;
  sort_order: number;
  highlighted: boolean;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function planFromRow(r: PlanRow): Plan {
  return {
    key: r.key,
    kind: r.kind === "trial" ? "trial" : "paid",
    name: r.name,
    tagline: r.tagline ?? "",
    visibility: r.visibility === "hidden" || r.visibility === "retired" ? r.visibility : "public",
    monthlyEur: num(r.monthly_eur),
    stripeProductId: r.stripe_product_id,
    stripePriceId: r.stripe_price_id,
    maxUsers: num(r.max_users),
    platformIntegrations: r.platform_integrations,
    aiFeatures: r.ai_features,
    aiGenerationsPerMonth: num(r.ai_generations_per_month) ?? 0,
    messagingAndListings: r.messaging_and_listings,
    advancedInventory: r.advanced_inventory,
    trialDays: num(r.trial_days),
    sortOrder: num(r.sort_order) ?? 0,
    highlighted: r.highlighted,
  };
}

export interface PlanEntitlements {
  /** Infinity = unlimited */
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  /** Monthly pool of AI generations shared by the whole tenant (src/lib/ai/quota.ts). */
  aiGenerationsPerMonth: number;
  /** Messages + Listings. */
  messagingAndListings: boolean;
  /** Batches, locations and FIFO cost of goods (advanced inventory). */
  advancedInventory: boolean;
}

/** Unknown/missing plan: nothing unlocked. A typo'd key must never grant features. */
export const NO_ENTITLEMENTS: PlanEntitlements = Object.freeze({
  maxUsers: 1,
  platformIntegrations: false,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
});

export function entitlementsOf(plan: Plan | null | undefined): PlanEntitlements {
  if (!plan) return NO_ENTITLEMENTS;
  return {
    maxUsers: plan.maxUsers === null ? Infinity : plan.maxUsers,
    platformIntegrations: plan.platformIntegrations,
    aiFeatures: plan.aiFeatures,
    aiGenerationsPerMonth: plan.aiFeatures ? plan.aiGenerationsPerMonth : 0,
    messagingAndListings: plan.messagingAndListings,
    advancedInventory: plan.advancedInventory,
  };
}

export const canAddUser = (ent: PlanEntitlements, currentUserCount: number): boolean =>
  currentUserCount < ent.maxUsers;
export const hasPlatformIntegrations = (ent: PlanEntitlements): boolean => ent.platformIntegrations;
export const hasAiFeatures = (ent: PlanEntitlements): boolean => ent.aiFeatures;
export const getAiGenerationLimit = (ent: PlanEntitlements): number => ent.aiGenerationsPerMonth;
export const hasMessagingAndListings = (ent: PlanEntitlements): boolean => ent.messagingAndListings;
export const hasAdvancedInventory = (ent: PlanEntitlements): boolean => ent.advancedInventory;

export type PlanFeature = "platformIntegrations" | "aiFeatures" | "messagingAndListings" | "advancedInventory";
export const PLAN_FEATURES: readonly PlanFeature[] = [
  "platformIntegrations",
  "aiFeatures",
  "messagingAndListings",
  "advancedInventory",
] as const;

export function sortPlans(plans: readonly Plan[]): Plan[] {
  return [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** Names of the PUBLIC paid plans that include `feature`, in display order. */
export function plansWithFeature(plans: readonly Plan[], feature: PlanFeature): string[] {
  return sortPlans(plans)
    .filter((p) => p.kind === "paid" && p.visibility === "public" && p[feature])
    .map((p) => p.name);
}

export function planNamesByFeature(plans: readonly Plan[]): Record<PlanFeature, string[]> {
  return Object.fromEntries(PLAN_FEATURES.map((f) => [f, plansWithFeature(plans, f)])) as Record<PlanFeature, string[]>;
}

/** ["Pro","Business"] → "the Pro and Business plans"; [] → null. */
export function formatPlanList(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `the ${names[0]} plan`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} plans`;
}

/** Upgrade-screen sentence: "<subject> is available on the Business plan." */
export function availabilityLine(subject: string, names: readonly string[]): string {
  const list = formatPlanList(names);
  return list ? `${subject} is available on ${list}.` : "Contact us to unlock this feature.";
}

/**
 * Can a tenant currently on `currentPlanKey` buy `plan` through Stripe
 * (checkout / change-plan)? Hidden plans are custom deals: only the tenant a
 * platform admin already put on that plan may pay for it.
 */
export function canPurchase(plan: Plan, currentPlanKey: PlanKey | null): boolean {
  if (plan.kind !== "paid" || !plan.stripePriceId) return false;
  if (plan.visibility === "public") return true;
  if (plan.visibility === "hidden") return plan.key === currentPlanKey;
  return false;
}

/** Can /admin put a tenant on `plan`? Retired plans only when unchanged. */
export function isAssignablePlan(plan: Plan | null, currentPlanKey: PlanKey | null): boolean {
  if (!plan) return false;
  return plan.visibility !== "retired" || plan.key === currentPlanKey;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/lib/plans/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `catalog.ts`**

`src/lib/plans/catalog.test.ts`:

```ts
const rows = [
  { key: "trial", kind: "trial", name: "Trial", tagline: "", visibility: "hidden", monthly_eur: null,
    stripe_product_id: null, stripe_price_id: null, max_users: null, platform_integrations: true,
    ai_features: true, ai_generations_per_month: 300, messaging_and_listings: true, advanced_inventory: true,
    trial_days: 21, sort_order: 0, highlighted: false },
  { key: "pro", kind: "paid", name: "Pro", tagline: "", visibility: "public", monthly_eur: 30,
    stripe_product_id: "prod_p", stripe_price_id: "price_p", max_users: 5, platform_integrations: true,
    ai_features: false, ai_generations_per_month: 0, messaging_and_listings: false, advanced_inventory: false,
    trial_days: null, sort_order: 2, highlighted: true },
];

let plansResult: { data: unknown; error: unknown } = { data: rows, error: null };
let pricesResult: { data: unknown; error: unknown } = {
  data: [{ stripe_price_id: "price_old", plan_key: "pro" }, { stripe_price_id: "price_p", plan_key: "pro" }],
  error: null,
};
const from = jest.fn((table: string) => {
  const result = table === "plans" ? plansResult : pricesResult;
  const builder = {
    select: () => builder,
    order: () => builder,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
});

jest.mock("@/lib/supabase/control", () => ({
  createControlClient: () => ({ schema: () => ({ from }) }),
}));

import {
  getEntitlements,
  getPlan,
  getPlanCatalog,
  getPlanPriceMap,
  getTrialDays,
  invalidatePlanCatalog,
} from "./catalog";

beforeEach(() => {
  invalidatePlanCatalog();
  from.mockClear();
  plansResult = { data: rows, error: null };
});

it("loads and maps the catalog", async () => {
  const plans = await getPlanCatalog();
  expect(plans.map((p) => p.key)).toEqual(["trial", "pro"]);
  expect(plans[1].monthlyEur).toBe(30);
});

it("caches for 60 s", async () => {
  await getPlanCatalog();
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(1);
  invalidatePlanCatalog();
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(2);
});

it("expires the cache after 60 s", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  await getPlanCatalog();
  now.mockReturnValue(1_000_000 + 60_001);
  await getPlanCatalog();
  expect(from).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("serves the stale cache on a read error, throws without one", async () => {
  await getPlanCatalog();
  invalidatePlanCatalog();
  plansResult = { data: null, error: { message: "boom" } };
  await expect(getPlanCatalog()).rejects.toThrow("Could not load plan catalog");
});

it("getPlan / getEntitlements fail closed on unknown keys", async () => {
  expect(await getPlan("nope")).toBeNull();
  expect(await getPlan(null)).toBeNull();
  expect((await getEntitlements("nope")).platformIntegrations).toBe(false);
  expect((await getEntitlements("pro")).maxUsers).toBe(5);
});

it("getTrialDays reads the trial row, falls back to 14", async () => {
  expect(await getTrialDays()).toBe(21);
  invalidatePlanCatalog();
  plansResult = { data: rows.filter((r) => r.kind !== "trial"), error: null };
  expect(await getTrialDays()).toBe(14);
  invalidatePlanCatalog();
  plansResult = { data: null, error: { message: "boom" } };
  expect(await getTrialDays()).toBe(14);
});

it("getPlanPriceMap maps every historical price to its plan", async () => {
  const map = await getPlanPriceMap();
  expect(map.get("price_old")).toBe("pro");
  expect(map.get("price_p")).toBe("pro");
});
```

Note the stale-cache test: after `invalidatePlanCatalog()` there is no cache, so it must throw. Add one more case proving the stale path: load once, then make the next read fail **without** invalidating but after the TTL (mock `Date.now`), and expect the old plans back:

```ts
it("returns the previous catalog when a refresh fails", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(2_000_000);
  await getPlanCatalog();
  now.mockReturnValue(2_000_000 + 60_001);
  plansResult = { data: null, error: { message: "boom" } };
  const plans = await getPlanCatalog();
  expect(plans.map((p) => p.key)).toEqual(["trial", "pro"]);
  now.mockRestore();
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx jest src/lib/plans/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 7: Implement `catalog.ts`**

`src/lib/plans/catalog.ts`:

```ts
import { createControlClient } from "@/lib/supabase/control";
import { entitlementsOf, planFromRow, type Plan, type PlanEntitlements, type PlanRow } from "./entitlements";

/**
 * Server-only. Reads control.plans (control-plane 012) with a 60 s
 * in-memory cache per server instance. /admin writes call
 * invalidatePlanCatalog() so the instance that saved sees the change at once;
 * other instances pick it up within 60 s. The app uses no Next.js caching,
 * so this deliberately does not adopt Cache Components.
 */

const TTL_MS = 60_000;
const DEFAULT_TRIAL_DAYS = 14;

let cache: { at: number; plans: Plan[] } | null = null;

export function invalidatePlanCatalog(): void {
  cache = null;
}

export async function getPlanCatalog(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.plans;

  const { data, error } = await createControlClient()
    .schema("control")
    .from("plans")
    .select("*")
    .order("sort_order")
    .order("key");

  if (error || !data) {
    if (cache) {
      console.error("[plans/catalog] refresh failed, serving previous catalog", error);
      return cache.plans;
    }
    throw new Error(`Could not load plan catalog: ${error?.message ?? "no data"}`);
  }

  const plans = (data as PlanRow[]).map(planFromRow);
  cache = { at: Date.now(), plans };
  return plans;
}

export async function getPlan(key: string | null | undefined): Promise<Plan | null> {
  if (!key) return null;
  return (await getPlanCatalog()).find((p) => p.key === key) ?? null;
}

export async function getEntitlements(key: string | null | undefined): Promise<PlanEntitlements> {
  return entitlementsOf(await getPlan(key));
}

/** Trial length for NEW sign-ups. Running trials keep their trial_ends_at. */
export async function getTrialDays(): Promise<number> {
  try {
    const trial = (await getPlanCatalog()).find((p) => p.kind === "trial");
    if (trial?.trialDays) return trial.trialDays;
    console.error("[plans/catalog] no trial plan row, using default trial length");
  } catch (err) {
    console.error("[plans/catalog] trial length lookup failed, using default", err);
  }
  return DEFAULT_TRIAL_DAYS;
}

/** Every Stripe price id ever used → plan key (control.plan_prices). Not cached. */
export async function getPlanPriceMap(): Promise<Map<string, string>> {
  const { data, error } = await createControlClient()
    .schema("control")
    .from("plan_prices")
    .select("stripe_price_id, plan_key");
  if (error || !data) throw new Error(`Could not load plan prices: ${error?.message ?? "no data"}`);
  return new Map((data as { stripe_price_id: string; plan_key: string }[]).map((r) => [r.stripe_price_id, r.plan_key]));
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx jest src/lib/plans/`
Expected: PASS (both suites).

- [ ] **Step 9: Write the live parity integration test**

Look at `src/lib/permissions/sectionPermissions.integration.test.ts` for how this repo's integration tests load env and skip without credentials; follow the same pattern. `src/lib/plans/catalog.integration.test.ts` reads `control.plans` with a service-role control client (`CONTROL_SUPABASE_URL`/`CONTROL_SUPABASE_SERVICE_KEY`) and asserts, for each of `trial`, `starter`, `pro`, `business`, that `planFromRow(row)` matches the seeded table in Global Constraints (every column except Stripe IDs). If the table does not exist yet (migration not applied — PostgREST error code `PGRST205` or `42P01`), the test must skip with a console note, not fail. Do NOT run it against the network in the default suite — the `jest.config.ts` ignore pattern already excludes `*.integration.test.ts`; run it with `npm run test:integration -- src/lib/plans` only if `.env.local` exists, and report the result (skipped is fine).

- [ ] **Step 10: Add plans server modules to the verifier's client-import guard**

In `.claude/verifiers/rules.py`, rule `server-module-in-client`, extend the pattern so `@/lib/plans/catalog` and `@/lib/plans/stripeSync` are server-only:

```python
        pattern=re.compile(
            r"""from\s+["'](@/lib/supabase/(server|control)"""
            r"""|@/lib/integrations[^"']*|@/lib/plans/(catalog|stripeSync)|@/lib/stripe|stripe)["']"""
        ),
```

Add a case to `.claude/verifiers/test_rules.py` following the existing `server-module-in-client` cases: a `"use client"` file importing `@/lib/plans/catalog` is flagged; one importing `@/lib/plans/entitlements` is not. Run: `uv run .claude/verifiers/test_rules.py` — expected all pass.

- [ ] **Step 11: Docs**

Create `src/lib/plans/CLAUDE.md` (file map: the files above + which are server-only vs client-safe; data flow: control.plans → catalog.ts (60 s cache) → layout hydration / server gates; tests command `npx jest src/lib/plans`) and `src/lib/plans/SKILL.md` (minimal file sets: "add a new plan feature flag" = migration column + `Plan`/`PlanRow`/`planFromRow`/`PlanEntitlements`/`PLAN_FEATURES` + validatePlan + PlanForm + pricing features; gotchas: fail-closed `NO_ENTITLEMENTS`; trial key fixed `trial`; cache is per instance, 60 s; never import catalog/stripeSync client-side — verifier-enforced).

- [ ] **Step 12: Commit**

```bash
git add src/lib/plans .claude/verifiers/rules.py .claude/verifiers/test_rules.py
git commit -m "feat(plans): entitlements helpers and cached plan catalog loader"
```

---

### Task 3: Move every gate to catalog entitlements

**Files:**
- Modify: `src/types/index.ts` (`TenantPlan` → `export type TenantPlan = string; // a control.plans key (see src/lib/plans/)`)
- Modify: `src/store/slices/currentUserSlice.ts` (+ `.test.ts`), `src/store/StoreProvider.tsx`, `src/app/dashboard/layout.tsx`
- Modify: `src/lib/permissions/sections.ts` (+ `sections.test.ts`), `src/store/useAccess.ts`
- Modify client gates: `src/app/dashboard/settings/page.tsx`, `src/app/dashboard/messages/page.tsx`, `src/app/dashboard/planner/page.tsx`, `src/app/dashboard/listings/_components/BusinessEbayGate.tsx`, `src/app/dashboard/listings/_components/ListingForm.tsx`, `src/app/dashboard/integrations/page.tsx`, `src/app/dashboard/integrations/review/page.tsx`, `src/app/dashboard/dropshipping/page.tsx`, `src/app/dashboard/inventory/_lib/advancedInventory.ts` (+ its test if present), `src/app/dashboard/inventory/_store/useAdvancedInventory.ts`, `src/app/dashboard/inventory/_components/AdvancedInventoryUpsellCard.tsx`, `src/components/ui/AiUsageNote.tsx`
- Modify server gates: `src/app/api/integrations/review/route.ts`, `src/app/api/integrations/review/import/route.ts`, `src/app/api/integrations/[platform]/connect/route.ts`, `src/lib/ai/authGuard.ts`, `src/app/api/listings/ai/usage/route.ts`, `src/app/api/admin/ai-usage/route.ts`, `src/lib/inventory/access.ts` (+ test if present), `src/lib/inventory/authGuard.ts`, `src/app/api/users/invite/route.ts`, `src/app/api/signup/provision/route.ts`, `src/app/api/admin/provision-tenant/route.ts`
- Modify copy: `src/app/(marketing)/page.tsx`, `src/app/(marketing)/_components/{Hero,TrialInfo}.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/trial-expired/page.tsx`
- Docs: every touched feature's `CLAUDE.md`/`SKILL.md` that mentions `planGating` (find with `grep -rln planGating src --include=*.md`), plus `src/lib/permissions` docs if any.

`src/lib/utils/planGating.ts` stays until Task 4 (pricing.ts still imports it); after this task **no other file** may import it — verify with `grep -rn "planGating" src --include=*.ts --include=*.tsx | grep -v "lib/utils/pricing\|lib/utils/planGating"` → empty.

**Interfaces:**
- Consumes (Task 2): `PlanEntitlements`, `PlanFeature`, `entitlementsOf`, `NO_ENTITLEMENTS`, `planNamesByFeature`, `availabilityLine`, `canAddUser`, the `has*`/`getAiGenerationLimit` helpers; `getPlanCatalog`, `getEntitlements`, `getTrialDays`.
- Produces:
  - `currentUserSlice` state: `planEntitlements: PlanEntitlements | null`, `planNamesByFeature: Record<PlanFeature, string[]> | null`; actions `setPlanEntitlements`, `setPlanNamesByFeature`. `tenantPlan` stays (the key, for display/billing).
  - `StoreProvider` props `planEntitlements?: PlanEntitlements | null`, `planNamesByFeature?: Record<PlanFeature, string[]> | null`.
  - `sections.ts`: `planAllows(section, ent: PlanEntitlements | null)`, `applyPlanCeiling(access, ent)`, `effectiveAccess(role, exceptions, ent)`.
  - `src/store/usePlan.ts` (new, client): `usePlan(): { ent: PlanEntitlements | null; availability: (feature: PlanFeature, subject: string) => string }`.
  - `canEnableAdvancedInventory(ent: PlanEntitlements, role)`; `advancedInventory.ts`'s plan parameter becomes `ent: PlanEntitlements | null`.

- [ ] **Step 1: Slice — failing tests first**

In `src/store/slices/currentUserSlice.test.ts` add:

```ts
import { setPlanEntitlements, setPlanNamesByFeature } from "./currentUserSlice";
import { NO_ENTITLEMENTS } from "@/lib/plans/entitlements";

it("starts with no plan entitlements or plan names", () => {
  const state = reducer(undefined, { type: "@@INIT" });
  expect(state.planEntitlements).toBeNull();
  expect(state.planNamesByFeature).toBeNull();
});

it("stores plan entitlements and plan names", () => {
  const names = { platformIntegrations: ["Pro"], aiFeatures: [], messagingAndListings: [], advancedInventory: [] };
  let state = reducer(undefined, setPlanEntitlements(NO_ENTITLEMENTS));
  state = reducer(state, setPlanNamesByFeature(names));
  expect(state.planEntitlements).toEqual(NO_ENTITLEMENTS);
  expect(state.planNamesByFeature).toEqual(names);
});
```

Run `npx jest src/store/slices/currentUserSlice.test.ts` → FAIL. Then add to the slice state (with a doc comment: "From control.plans via dashboard/layout.tsx; null until hydrated — every gate treats null as 'not entitled'"), initial `null`s, and two reducers `setPlanEntitlements(state, action: PayloadAction<PlanEntitlements>)`, `setPlanNamesByFeature(state, action: PayloadAction<Record<PlanFeature, string[]>>)`; export them. Re-run → PASS.

Note: `PlanEntitlements.maxUsers` can be `Infinity`. Redux Toolkit's serializability check accepts numbers incl. Infinity; the layout passes props from a Server Component to `StoreProvider` (a Client Component) — **`Infinity` does not survive the RSC boundary reliably**. So `StoreProvider` must receive a serializable form: pass `planEntitlements` with `maxUsers: Number.isFinite(x) ? x : -1` from the layout and convert `-1` back to `Infinity` in `StoreProvider` before dispatch. Put both conversions in `entitlements.ts` as `toWireEntitlements(ent)` / `fromWireEntitlements(wire)` with a unit test each (round-trip, finite and infinite).

- [ ] **Step 2: Layout + StoreProvider hydration**

In `src/app/dashboard/layout.tsx`, after the existing `control.tenants` read (keep it), load the catalog:

```ts
  let planEntitlements: PlanEntitlements = NO_ENTITLEMENTS;
  let namesByFeature: Record<PlanFeature, string[]> | null = null;
  try {
    const catalog = await getPlanCatalog();
    planEntitlements = entitlementsOf(catalog.find((p) => p.key === tenantPlan) ?? null);
    namesByFeature = planNamesByFeature(catalog);
  } catch (err) {
    // Fail closed: no plan features until the catalog is readable again.
    console.error("[dashboard/layout] plan catalog unavailable", err);
  }
```

Pass `planEntitlements={toWireEntitlements(planEntitlements)}` and `planNamesByFeature={namesByFeature}` to `StoreProvider`; in `StoreProvider` dispatch `setPlanEntitlements(fromWireEntitlements(planEntitlements))` when provided and `setPlanNamesByFeature(planNamesByFeature)` when non-null, next to the existing `setTenantPlan` dispatch. Update the comment above the plan block ("drives platform-integrations gating") to say entitlements now come from `control.plans`.

- [ ] **Step 3: `usePlan()` hook**

`src/store/usePlan.ts`:

```ts
"use client";

import { useAppSelector } from "./hooks";
import { availabilityLine, type PlanEntitlements, type PlanFeature } from "@/lib/plans/entitlements";

/**
 * The tenant's plan entitlements (null until hydrated — treat as "not
 * entitled") and the upgrade-screen sentence for a feature, derived from
 * which PUBLIC plans include it (control.plans) instead of hardcoded copy.
 */
export function usePlan(): {
  ent: PlanEntitlements | null;
  availability: (feature: PlanFeature, subject: string) => string;
} {
  const ent = useAppSelector((s) => s.currentUser.planEntitlements);
  const names = useAppSelector((s) => s.currentUser.planNamesByFeature);
  return {
    ent,
    availability: (feature, subject) => availabilityLine(subject, names?.[feature] ?? []),
  };
}
```

- [ ] **Step 4: `sections.ts` plan ceiling — tests first**

In `src/lib/permissions/sections.test.ts`, every call that passes a plan string (`"pro"`, `"starter"`, `"business"`, `"trial"`, `null`) to `planAllows`/`applyPlanCeiling`/`effectiveAccess` changes to pass entitlements. Add at the top of the test file:

```ts
import { NO_ENTITLEMENTS, type PlanEntitlements } from "@/lib/plans/entitlements";
const ENT = (over: Partial<PlanEntitlements> = {}): PlanEntitlements => ({ ...NO_ENTITLEMENTS, ...over });
const STARTER = ENT({ maxUsers: 3 });
const PRO = ENT({ maxUsers: 5, platformIntegrations: true });
const BUSINESS = ENT({ maxUsers: Infinity, platformIntegrations: true, aiFeatures: true, aiGenerationsPerMonth: 300, messagingAndListings: true, advancedInventory: true });
```

and replace `"starter"`→`STARTER`, `"pro"`→`PRO`, `"business"`/`"trial"`→`BUSINESS`, keeping `null` as `null`. Run → FAIL (type/behaviour). Then in `sections.ts` replace the planGating import with `import { hasMessagingAndListings, hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";`, drop `TenantPlan` from the types import, and change the three signatures:

```ts
export function planAllows(section: Section, ent: PlanEntitlements | null): boolean {
  if (!ent) return !["integrations", "listings", "messages"].includes(section);
  if (section === "integrations") return hasPlatformIntegrations(ent);
  if (section === "listings" || section === "messages") return hasMessagingAndListings(ent);
  return true;
}
```

(`applyPlanCeiling(access, ent: PlanEntitlements | null)` and `effectiveAccess(role, exceptions, ent: PlanEntitlements | null)` just rename the parameter.) In `src/store/useAccess.ts` read `s.currentUser.planEntitlements` instead of `tenantPlan` and pass it to `applyPlanCeiling`; update the doc comment. Find any other `effectiveAccess(`/`applyPlanCeiling(` callers with grep and update them. Run `npx jest src/lib/permissions src/store` → PASS.

- [ ] **Step 5: Client gates**

For each file, replace the `planGating` import + `tenantPlan` selector with `usePlan()` and the same helper from `@/lib/plans/entitlements`. Pattern:

```ts
// before
const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) { … }
// after
const { ent, availability } = usePlan();
if (!ent || !hasPlatformIntegrations(ent)) { … }
```

Upgrade copy — replace the hardcoded sentence with `availability(...)`:

| File | Feature | Subject (exact string) |
|---|---|---|
| `messages/page.tsx` | `messagingAndListings` | `"eBay messaging"` |
| `planner/page.tsx` | `platformIntegrations` | `"The Profit Planner"` |
| `listings/_components/BusinessEbayGate.tsx` | `messagingAndListings` | `"eBay listing creation"` |
| `dropshipping/page.tsx` | `platformIntegrations` | `"Dropshipping listing management"` |
| `integrations/page.tsx` | `platformIntegrations` | `"Automatic eBay and Amazon order syncing"` |
| `inventory/_components/AdvancedInventoryUpsellCard.tsx` | `advancedInventory` | replace the trailing `"Available on the Business plan."` with `{availability("advancedInventory", "Batches, locations and FIFO costing")}` |

AI visibility files (`settings/page.tsx`, `ListingForm.tsx`, `AiUsageNote.tsx`): `const aiVisible = !!ent && hasAiFeatures(ent) && aiEnabled;`. `integrations/review/page.tsx`: `!!ent && hasPlatformIntegrations(ent) && …`.

`inventory/_lib/advancedInventory.ts`: change the `plan: TenantPlan | null` parameter to `ent: PlanEntitlements | null` and `if (!ent || !hasAdvancedInventory(ent)) return "upsell";`; update its colocated test (if one exists) to pass entitlements objects; update its caller(s) (grep the function name) to pass `ent` from `usePlan()`. `useAdvancedInventory.ts`: `const { ent } = usePlan(); const entitled = !!ent && hasAdvancedInventory(ent);`.

`BusinessEbayGate.tsx` keeps its name (renaming is out of scope); update its doc comment from "behind the Business plan" to "behind the Messages & Listings plan feature".

- [ ] **Step 6: Server gates**

Integrations routes (`review`, `review/import`, `[platform]/connect`) — replace `hasPlatformIntegrations((tenant?.plan ?? "trial") as TenantPlan)` with:

```ts
  let ent;
  try {
    ent = await getEntitlements(tenant?.plan ?? null);
  } catch (err) {
    console.error("[integrations/…] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }
```

(Use the route's own log prefix. This intentionally drops the old `?? "trial"` fallback: a missing tenant row now fails closed.)

`src/lib/ai/authGuard.ts`: inside the existing `try`, after `row` is found: `const ent = await getEntitlements(row.plan);` then `if (!hasAiFeatures(ent) || !row.ai_enabled)` and `limit = getAiGenerationLimit(ent);`. `src/app/api/listings/ai/usage/route.ts`: `const limit = getAiGenerationLimit(await getEntitlements(tenant.plan));` inside its existing error handling. `src/app/api/admin/ai-usage/route.ts`: load `const catalog = await getPlanCatalog();` once (inside its existing try/error path) and use `getAiGenerationLimit(entitlementsOf(catalog.find((p) => p.key === tenant.plan) ?? null))` per tenant.

`src/lib/inventory/access.ts`: `canEnableAdvancedInventory(ent: PlanEntitlements, role)` → `hasAdvancedInventory(ent) && (role === "admin" || role === "super_admin")`; update its test. `src/lib/inventory/authGuard.ts`: after reading `plan`, `const ent = await getEntitlements(plan)` (inside the existing try → 500 path), call `canEnableAdvancedInventory(ent, profile?.role)`, and change the 403 copy to `"Batches and locations are available to admins on plans with advanced inventory."`.

`src/app/api/users/invite/route.ts` — **new enforcement** (the plan user limit was declared but never enforced). After the duplicate-invite check (step 3b) and before `inviteUserByEmail`, insert:

```ts
  // 3c. Plan user limit (control.plans.max_users). Deactivated users don't count.
  const { data: tenantRow } = await createControlClient()
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .maybeSingle<{ plan: string }>();
  const { count: userCount, error: countError } = await tenantService
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .neq("status", "deactivated");
  let ent;
  try {
    ent = await getEntitlements(tenantRow?.plan ?? null);
  } catch (err) {
    console.error("[users/invite] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (countError) {
    console.error("[users/invite] user count failed", countError.message);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!canAddUser(ent, userCount ?? 0)) {
    return NextResponse.json(
      { error: `Your plan allows up to ${ent.maxUsers} users. Upgrade your plan to invite more.` },
      { status: 403 }
    );
  }
```

Check the Users page's invite handler shows `data.error` in a toast on a non-OK response (it should already); if it shows a generic message instead, make it prefer `data.error`.

`src/app/api/signup/provision/route.ts`: delete `const TRIAL_DAYS = 14;`; before computing `trialEnd`, `const trialDays = await getTrialDays();` and use it. `src/app/api/admin/provision-tenant/route.ts`: same, replacing the literal `14` (`getTrialDays()` never throws).

- [ ] **Step 7: Trial-length copy**

`src/app/(marketing)/page.tsx` (already a dynamic server component — it reads cookies): `const trialDays = await getTrialDays();` and pass `trialDays` to `Hero` and `TrialInfo` (and, in Task 4, `Pricing`). `Hero.tsx`: `{trialDays} days free · full access · no credit card`. `TrialInfo.tsx`: `Try the whole thing for {trialDays} days`. `(auth)/signup/page.tsx` (client): `Free trial · no credit card`. `trial-expired/page.tsx`: `Your Boughtopia trial is over.` (drop the number). Update `src/app/(marketing)/CLAUDE.md`'s Hero line accordingly.

- [ ] **Step 8: `TenantPlan` → `string`**

Change the type in `src/types/index.ts`. Fix every compile error the pre-commit `tsc` reports (expected: `src/app/admin/_components/tenantVariants.ts`'s `Record<TenantPlan, …>` still compiles but loses exhaustiveness — leave it for Task 6; `isTrialExpired` keeps working). Do not add casts to silence errors — fix types properly.

- [ ] **Step 9: Run tests**

Run: `npx jest src/lib src/store src/app/dashboard src/components`
Expected: PASS. Then the grep from the top of this task → only `pricing.ts`/`planGating.ts` remain.

- [ ] **Step 10: Docs + commit**

Update every doc that names `planGating` functions for the files you changed (`grep -rln "planGating" src --include=*.md`) to point at `src/lib/plans/entitlements.ts` / `usePlan()`; add a gotcha to `src/app/dashboard/SKILL.md`: "Plan gates read `state.currentUser.planEntitlements` via `usePlan()` — null before hydration ⇒ not entitled; upgrade copy comes from `availability()`, never hardcode plan names." Add a gotcha to `src/app/dashboard/users/SKILL.md` about the new invite limit (403 with the plan's `maxUsers`).

```bash
git add -A src
git commit -m "feat(plans): gate features on catalog entitlements; enforce plan user limit on invite"
```

(Ensure `git status` shows no unrelated files such as `graphify-out/*` staged — unstage them if so.)

---

### Task 4: Billing on the catalog — pricing, plan picker, checkout, change-plan, webhook

**Files:**
- Create: `src/lib/plans/resolvePlanKey.ts`, `src/lib/plans/resolvePlanKey.test.ts`
- Modify: `src/lib/utils/pricing.ts`, `src/lib/utils/pricing.test.ts`, `src/lib/utils/SKILL.md`
- Modify: `src/components/billing/PlanPicker.tsx`, `src/app/dashboard/settings/_components/BillingSection.tsx`, `src/app/trial-expired/page.tsx`, `src/app/(marketing)/_components/Pricing.tsx`, `src/app/(marketing)/page.tsx`
- Modify: `src/app/api/billing/status/route.ts`, `src/app/api/billing/checkout/route.ts`, `src/app/api/billing/change-plan/route.ts`, `src/app/api/billing/webhook/route.ts`
- Modify: `src/lib/stripe.ts` (delete `PLANS` and its comment, and the `PaidPlan` import), `.env.local.example` (delete the three `STRIPE_PRICE_*` lines and their comment; add a comment that plan prices live in `control.plans`, seeded by `npm run plans:seed-stripe`)
- Delete: `src/lib/utils/planGating.ts`, `src/lib/utils/planGating.test.ts`
- Docs: billing docs (`docs` referenced from AGENTS.md billing bullet if a SKILL/CLAUDE exists under `src/app/api/billing/` or `src/lib/billing/`), `src/app/dashboard/settings/` docs, `src/app/(marketing)/CLAUDE.md`.

**Interfaces:**
- Consumes: `Plan`, `entitlementsOf`, `sortPlans`, `canPurchase` (Task 2); `getPlanCatalog`, `getPlan`, `getPlanPriceMap`, `getTrialDays` (Task 2).
- Produces:
  - `pricedPlans(plans: readonly Plan[]): PricedPlan[]` — builds cards for the given plans that are `kind === "paid"` with a non-null `monthlyEur`, sorted; does **not** filter visibility (callers do). `PricedPlan.plan` is `string`. `PaidPlan` type is removed.
  - `GET /api/billing/status` response gains `plans: PricedPlan[]` — the plans this tenant may buy (`canPurchase(p, tenant.plan)`), `[]` if the catalog is unreadable.
  - `PlanPicker` props: `plans: PricedPlan[]`, `onSelectPlan: (plan: string) => void`, `currentPlan?: string`, `loadingPlan?: string | null`.
  - `resolvePlanKey(input: { metadataPlan: string | null | undefined; priceId: string | null | undefined; paidPlanKeys: ReadonlySet<string>; priceToPlan: ReadonlyMap<string, string> }): string | null`.

- [ ] **Step 1: `resolvePlanKey` — tests first**

`src/lib/plans/resolvePlanKey.test.ts`:

```ts
import { resolvePlanKey } from "./resolvePlanKey";

const paidPlanKeys = new Set(["starter", "pro", "business"]);
const priceToPlan = new Map([["price_old_pro", "pro"], ["price_biz", "business"]]);

it("prefers a known metadata plan", () => {
  expect(resolvePlanKey({ metadataPlan: "pro", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("pro");
});
it("falls back to the price history", () => {
  expect(resolvePlanKey({ metadataPlan: undefined, priceId: "price_old_pro", paidPlanKeys, priceToPlan })).toBe("pro");
  expect(resolvePlanKey({ metadataPlan: "gone", priceId: "price_biz", paidPlanKeys, priceToPlan })).toBe("business");
});
it("never resolves to the trial", () => {
  expect(resolvePlanKey({ metadataPlan: "trial", priceId: null, paidPlanKeys, priceToPlan })).toBeNull();
});
it("returns null when nothing matches (no silent starter default)", () => {
  expect(resolvePlanKey({ metadataPlan: undefined, priceId: "price_unknown", paidPlanKeys, priceToPlan })).toBeNull();
  expect(resolvePlanKey({ metadataPlan: null, priceId: null, paidPlanKeys, priceToPlan })).toBeNull();
});
it("ignores a price mapped to a plan that is no longer paid/known", () => {
  expect(resolvePlanKey({ metadataPlan: null, priceId: "x", paidPlanKeys, priceToPlan: new Map([["x", "trial"]]) })).toBeNull();
});
```

Run → FAIL. Implement `src/lib/plans/resolvePlanKey.ts`:

```ts
/**
 * Which plan a Stripe subscription is on (billing webhook). Metadata first
 * (checkout/change-plan always write metadata.plan), then the price id via
 * control.plan_prices — covers grandfathered prices and subscriptions edited
 * in the Stripe dashboard. Null = unknown: the webhook then leaves
 * tenants.plan untouched instead of the old silent "starter" default.
 */
export function resolvePlanKey(input: {
  metadataPlan: string | null | undefined;
  priceId: string | null | undefined;
  paidPlanKeys: ReadonlySet<string>;
  priceToPlan: ReadonlyMap<string, string>;
}): string | null {
  const { metadataPlan, priceId, paidPlanKeys, priceToPlan } = input;
  if (metadataPlan && paidPlanKeys.has(metadataPlan)) return metadataPlan;
  const fromPrice = priceId ? priceToPlan.get(priceId) : undefined;
  if (fromPrice && paidPlanKeys.has(fromPrice)) return fromPrice;
  return null;
}
```

Run → PASS.

- [ ] **Step 2: `pricedPlans` — tests first**

Rewrite `src/lib/utils/pricing.test.ts` to build from a catalog fixture (reuse the `plan()` factory shape from Task 2's test, defined locally). Cases:
1. Only `kind === "paid"` plans with `monthlyEur !== null` are returned, sorted by `sortOrder` (a trial row in the input is dropped).
2. Visibility is NOT filtered (a hidden plan passed in is returned) — callers filter.
3. `users`: `maxUsers: null` → `"Unlimited users"`; `5` → `"Up to 5 users"`; `1` → `"Up to 1 user"`.
4. Feature ticks follow the plan flags — for a plan with `platformIntegrations: true, messagingAndListings: false, aiFeatures: true`, the features array equals:
   ```ts
   [
     { label: "Sales, expenses, purchases & inventory", included: true },
     { label: "VAT tracking & PDF invoices", included: true },
     { label: "CSV import & export", included: true },
     { label: "Full audit trail", included: true },
     { label: "eBay & Amazon order import", included: true },
     { label: "eBay listings & buyer messages", included: false },
     { label: "AI-assisted insights", included: true },
   ]
   ```
5. `highlighted`, `name`, `tagline`, `monthlyEur` copied from the plan.

Run → FAIL. Rewrite `src/lib/utils/pricing.ts`:

```ts
import { entitlementsOf, sortPlans, type Plan } from "@/lib/plans/entitlements";

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PricedPlan {
  plan: string;
  name: string;
  monthlyEur: number;
  tagline: string;
  users: string;
  features: PlanFeature[];
  highlighted: boolean;
}

/**
 * Pricing cards for the given plans (control.plans rows). Callers choose
 * which plans to show — the marketing page passes public plans,
 * /api/billing/status passes the plans this tenant may buy. Feature ticks are
 * derived from the same entitlements the app gates on, so a card cannot
 * advertise a capability the app does not grant.
 */
export function pricedPlans(plans: readonly Plan[]): PricedPlan[] {
  return sortPlans(plans)
    .filter((p): p is Plan & { monthlyEur: number } => p.kind === "paid" && p.monthlyEur !== null)
    .map((p) => {
      const ent = entitlementsOf(p);
      return {
        plan: p.key,
        name: p.name,
        monthlyEur: p.monthlyEur,
        tagline: p.tagline,
        users:
          ent.maxUsers === Infinity
            ? "Unlimited users"
            : `Up to ${ent.maxUsers} user${ent.maxUsers === 1 ? "" : "s"}`,
        features: [
          { label: "Sales, expenses, purchases & inventory", included: true },
          { label: "VAT tracking & PDF invoices", included: true },
          { label: "CSV import & export", included: true },
          { label: "Full audit trail", included: true },
          { label: "eBay & Amazon order import", included: ent.platformIntegrations },
          { label: "eBay listings & buyer messages", included: ent.messagingAndListings },
          { label: "AI-assisted insights", included: ent.aiFeatures },
        ],
        highlighted: p.highlighted,
      };
    });
}
```

Run → PASS. Then `git rm src/lib/utils/planGating.ts src/lib/utils/planGating.test.ts` and confirm `grep -rn "planGating" src --include=*.ts --include=*.tsx` is empty.

- [ ] **Step 3: Status route + PlanPicker + callers**

`/api/billing/status`: after the tenant lookup,

```ts
  let plans: PricedPlan[] = [];
  try {
    plans = pricedPlans((await getPlanCatalog()).filter((p) => canPurchase(p, tenant.plan)));
  } catch (err) {
    console.error("[billing/status] plan catalog unavailable", err);
  }
```

and add `plans` to the JSON response. `PlanPicker`: take `plans` as a prop instead of calling `pricedPlans()`; `PaidPlan` → `string`. If `plans` is empty render `<p className="text-sm text-[var(--color-text-muted)]">No plans are available right now. Please try again later.</p>`. `BillingSection.tsx` and `trial-expired/page.tsx`: add `plans: PricedPlan[]` to their local `BillingStatus` type, pass `status.plans` (`trial-expired` already fetches status; when the status fetch failed, pass `[]`). `BillingSection`: `currentPaidPlan` becomes `status.plan === "trial" ? undefined : status.plan`; the "Your workspace is on the X plan" copy should show the plan's name when it is in `status.plans` (fall back to the key).

`Pricing.tsx`: accept props `{ plans: PricedPlan[]; trialDays: number }` (stay a server component, no data fetching inside); copy `Every plan starts with the same {trialDays}-day free trial.`; when `plans` is empty render `Pricing is temporarily unavailable.` in place of the grid. `(marketing)/page.tsx`: 

```ts
  let pricing: PricedPlan[] = [];
  try {
    pricing = pricedPlans((await getPlanCatalog()).filter((p) => p.visibility === "public"));
  } catch (err) {
    console.error("[marketing] plan catalog unavailable", err);
  }
```

and render `<Pricing plans={pricing} trialDays={trialDays} />`. The grid uses `lg:grid-cols-3`; change it to adapt to the count: `lg:grid-cols-${…}` is not allowed with Tailwind JIT — use a lookup `const COLS = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" }` and `COLS[Math.min(plans.length, 4) as 1|2|3|4] ?? "lg:grid-cols-3"`.

- [ ] **Step 4: Checkout + change-plan**

Both routes: delete `VALID_PLANS`, the `PLANS`/`PaidPlan` imports. Keep the existing `if (!plan || typeof plan !== "string")` → 400 `"Unknown plan"`. Move plan resolution **after** the tenant lookup (change-plan must also `select("plan, stripe_subscription_id")`):

```ts
  let target;
  try {
    target = await getPlan(plan);
  } catch (err) {
    console.error("[billing/checkout] plan catalog unavailable", err);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
  if (!target || !canPurchase(target, tenant.plan as string)) {
    return NextResponse.json({ error: "Plan not available" }, { status: 400 });
  }
  const priceId = target.stripePriceId!;
```

(change-plan: log prefix `[billing/change-plan]`, 500 copy `"Could not change plan. Please try again."`.) Keep `metadata.plan = plan` exactly as today in both places.

- [ ] **Step 5: Webhook**

In `customer.subscription.created/updated`, replace `const plan = (sub.metadata?.plan as string) ?? "starter";` with:

```ts
      let plan: string | null;
      try {
        const [catalog, priceToPlan] = await Promise.all([getPlanCatalog(), getPlanPriceMap()]);
        plan = resolvePlanKey({
          metadataPlan: sub.metadata?.plan,
          priceId: sub.items?.data?.[0]?.price?.id,
          paidPlanKeys: new Set(catalog.filter((p) => p.kind === "paid").map((p) => p.key)),
          priceToPlan,
        });
      } catch (err) {
        // Catalog unreadable: fail the event so Stripe retries it later.
        console.error("[billing/webhook] plan catalog unavailable", err);
        writeFailed = true;
        break;
      }
      if (!plan) {
        console.error("[billing/webhook] unknown plan for subscription", sub.id, sub.items?.data?.[0]?.price?.id);
      }

      const patch: { stripe_subscription_id: string; plan?: string; status?: string } = {
        stripe_subscription_id: sub.id,
        ...(plan ? { plan } : {}),
      };
```

Check how `writeFailed` is turned into the response at the end of the handler and make sure `break` out of the `case` still reaches it (it does if the switch is followed by the `writeFailed` check — verify by reading the bottom of the file). Update the block comment at the top of the case to mention the price fallback.

- [ ] **Step 6: Remove `PLANS` + env**

Delete `PLANS` and its comment from `src/lib/stripe.ts` (and the now-unused `PaidPlan` import). Edit `.env.local.example` as listed above. `grep -rn "STRIPE_PRICE_\|PaidPlan\|\bPLANS\b" src` → empty.

- [ ] **Step 7: Run tests**

Run: `npx jest src/lib src/components src/app/dashboard/settings src/app/trial-expired "src/app/(marketing)"`
Expected: PASS.

- [ ] **Step 8: Docs + commit**

Update `src/lib/utils/SKILL.md` (remove the `planGating` section; `pricedPlans(plans)` now takes the catalog; the "pricedPlans must match getPlanLimits" pin is gone because both derive from `entitlementsOf`), AGENTS.md's billing bullets (`src/lib/stripe.ts` no longer has `PLANS`; `pricing.ts` takes catalog plans; `planGating.ts` bullet → `src/lib/plans/`), `src/app/(marketing)/CLAUDE.md`, and the billing docs.

```bash
git add -A src AGENTS.md .env.local.example
git commit -m "feat(billing): prices, plan picker and webhook read the plan catalog"
```

---

### Task 5: Admin plan API — validation, Stripe sync, routes

**Files:**
- Create: `src/lib/plans/validatePlan.ts` (+ `.test.ts`)
- Create: `src/lib/plans/stripeSync.ts` (+ `.test.ts`)
- Create: `src/app/api/admin/plans/route.ts`, `src/app/api/admin/plans/[key]/route.ts`
- Modify: `src/app/api/admin/tenants/route.ts` (`verifyPlatformAdmin` returns the email)
- Docs: `src/lib/plans/CLAUDE.md`/`SKILL.md`, `src/app/admin/CLAUDE.md` (API section)

**Interfaces:**
- Consumes: `Plan`, `PlanKind`, `PlanVisibility`, `sortPlans` (Task 2); `getPlanCatalog`, `invalidatePlanCatalog` (Task 2); `getStripe()` from `@/lib/stripe`.
- Produces:
  - `interface PlanInput` = `Plan` minus `stripeProductId`/`stripePriceId` (same camelCase field names).
  - `type PlanErrors = Partial<Record<keyof PlanInput | "form", string>>`
  - `parsePlanInput(body: unknown): PlanInput | null`
  - `validatePlan(input: PlanInput, ctx: { isCreate: boolean; catalog: readonly Plan[] }): PlanErrors`
  - `detectReductions(before: Plan, after: PlanInput): string[]`
  - `planDiff(before: Plan | null, after: PlanInput): Record<string, { from: unknown; to: unknown }>`
  - `planInputToRow(input: PlanInput): Record<string, unknown>` (snake_case columns, no stripe ids, no timestamps)
  - `stripeSync.ts`: `type StripePlanApi = { products: Pick<Stripe.ProductsResource, "create" | "update">; prices: Pick<Stripe.PricesResource, "create" | "update"> }`, `toCents(eur)`, `createStripePlan(stripe, input)`, `syncStripePlan(stripe, before, after)`, `class PlanSyncError extends Error`.
  - `verifyPlatformAdmin()` → `{ ok: true; email: string } | { ok: false; response: NextResponse }`.
  - `GET /api/admin/plans` → `{ plans: Plan[]; tenantCounts: Record<string, number> }`; `POST` body `PlanInput` → `201 { plan: Plan }`; `PATCH /api/admin/plans/[key]` body `PlanInput` → `200 { plan: Plan }`. Errors: `400 { error, fieldErrors?: PlanErrors }`, `403`, `404`, `409`, `500`, `502`.

- [ ] **Step 1: `validatePlan.ts` — tests first**

`src/lib/plans/validatePlan.test.ts` must cover, each as its own `it`:
- `parsePlanInput`: returns null for non-objects; coerces numeric strings (`"30"` → 30); `maxUsers: ""`/`null` → null; booleans default false; `tagline` defaults `""`; trims `name`.
- key: invalid format (`"Pro"`, `"1pro"`, `"p"`, 33 chars) → `errors.key`; duplicate on create → `"A plan with this key already exists."`; `"trial"` for a paid plan → error; key is NOT checked for duplicates when `isCreate: false`.
- create with `kind: "trial"` → `errors.kind` = `"Only paid plans can be created."`.
- name empty → `errors.name`.
- paid: `monthlyEur` null/0/0.5 → error; `19.999` → error (more than 2 decimals); `100001` → error; `19.99` OK.
- `maxUsers` 0 → error; null OK; 1.5 → error.
- AI: `aiFeatures false` + `aiGenerationsPerMonth 10` → `errors.aiGenerationsPerMonth`; negative or non-integer quota → error.
- trial: `trialDays` 0/91/null → error; 30 OK; trial with `visibility: "public"` → `errors.visibility` = `"The trial is always hidden."`.
- last public plan: catalog has one public paid plan `pro`; editing `pro` to `hidden` or `retired` → `errors.visibility` = `"Keep at least one public plan."`; creating a new hidden plan is fine; editing `pro` while a second public plan exists is fine.
- `sortOrder` non-integer → error.
- `detectReductions`: `maxUsers 5 → 3` → `["Max users: 5 → 3"]`; `null → 10` → `["Max users: Unlimited → 10"]`; `3 → null` → `[]`; turning off a feature → `"Removes Platform integrations"` (labels: `platformIntegrations` "Platform integrations", `aiFeatures` "AI features", `messagingAndListings` "Listings & messages", `advancedInventory` "Advanced inventory"); AI quota `300 → 100` → `"AI generations / month: 300 → 100"`; increases → `[]`.
- `planDiff`: only changed fields appear; `before: null` lists every field with `from: null`.
- `planInputToRow`: maps every field to its snake_case column (`maxUsers` → `max_users`, etc.) and omits stripe ids.

Run → FAIL. Implement `src/lib/plans/validatePlan.ts`:

```ts
import type { Plan, PlanKind, PlanVisibility } from "./entitlements";

/** Pure: shared by the /admin plan form (client) and the admin plan API routes. */

export type PlanInput = Omit<Plan, "stripeProductId" | "stripePriceId">;
export type PlanErrors = Partial<Record<keyof PlanInput | "form", string>>;

const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;
const MAX_EUR = 100_000;

const FEATURE_LABELS = {
  platformIntegrations: "Platform integrations",
  aiFeatures: "AI features",
  messagingAndListings: "Listings & messages",
  advancedInventory: "Advanced inventory",
} as const;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function parsePlanInput(body: unknown): PlanInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  return {
    key: String(b.key ?? "").trim(),
    kind: (b.kind === "trial" ? "trial" : "paid") as PlanKind,
    name: String(b.name ?? "").trim(),
    tagline: String(b.tagline ?? "").trim(),
    visibility: (["public", "hidden", "retired"].includes(b.visibility as string) ? b.visibility : "public") as PlanVisibility,
    monthlyEur: toNum(b.monthlyEur),
    maxUsers: toNum(b.maxUsers),
    platformIntegrations: b.platformIntegrations === true,
    aiFeatures: b.aiFeatures === true,
    aiGenerationsPerMonth: toNum(b.aiGenerationsPerMonth) ?? 0,
    messagingAndListings: b.messagingAndListings === true,
    advancedInventory: b.advancedInventory === true,
    trialDays: toNum(b.trialDays),
    sortOrder: toNum(b.sortOrder) ?? 0,
    highlighted: b.highlighted === true,
  };
}

const isInt = (n: number | null): n is number => n !== null && Number.isInteger(n);

export function validatePlan(input: PlanInput, ctx: { isCreate: boolean; catalog: readonly Plan[] }): PlanErrors {
  const e: PlanErrors = {};

  if (!KEY_RE.test(input.key)) {
    e.key = "Use 2–32 lowercase letters, digits or _, starting with a letter.";
  } else if (input.kind === "paid" && input.key === "trial") {
    e.key = "\"trial\" is reserved for the free trial.";
  } else if (ctx.isCreate && ctx.catalog.some((p) => p.key === input.key)) {
    e.key = "A plan with this key already exists.";
  }

  if (ctx.isCreate && input.kind !== "paid") e.kind = "Only paid plans can be created.";
  if (!input.name) e.name = "Name is required.";

  if (input.kind === "paid") {
    const eur = input.monthlyEur;
    if (eur === null || Number.isNaN(eur) || eur < 1 || eur > MAX_EUR) {
      e.monthlyEur = "Enter a monthly price between €1 and €100,000.";
    } else if (Math.abs(Math.round(eur * 100) - eur * 100) > 1e-6) {
      e.monthlyEur = "Use at most two decimals.";
    }
  } else {
    if (!isInt(input.trialDays) || input.trialDays < 1 || input.trialDays > 90) {
      e.trialDays = "Trial length must be 1–90 days.";
    }
    if (input.visibility !== "hidden") e.visibility = "The trial is always hidden.";
  }

  if (input.maxUsers !== null && (!isInt(input.maxUsers) || input.maxUsers < 1)) {
    e.maxUsers = "Max users must be a whole number of 1 or more, or Unlimited.";
  }

  if (!isInt(input.aiGenerationsPerMonth) || input.aiGenerationsPerMonth < 0) {
    e.aiGenerationsPerMonth = "AI generations must be a whole number of 0 or more.";
  } else if (!input.aiFeatures && input.aiGenerationsPerMonth !== 0) {
    e.aiGenerationsPerMonth = "Turn on AI features to give an AI allowance.";
  }

  if (!isInt(input.sortOrder)) e.sortOrder = "Display order must be a whole number.";

  if (input.kind === "paid" && !e.visibility) {
    const otherPublic = ctx.catalog.filter(
      (p) => p.kind === "paid" && p.visibility === "public" && p.key !== input.key
    ).length;
    if (otherPublic + (input.visibility === "public" ? 1 : 0) < 1) {
      e.visibility = "Keep at least one public plan.";
    }
  }

  return e;
}

const fmtUsers = (n: number | null) => (n === null ? "Unlimited" : String(n));

/** Edits that take something away from tenants already on the plan. */
export function detectReductions(before: Plan, after: PlanInput): string[] {
  const out: string[] = [];
  const b = before.maxUsers ?? Infinity;
  const a = after.maxUsers ?? Infinity;
  if (a < b) out.push(`Max users: ${fmtUsers(before.maxUsers)} → ${fmtUsers(after.maxUsers)}`);
  for (const f of Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]) {
    if (before[f] && !after[f]) out.push(`Removes ${FEATURE_LABELS[f]}`);
  }
  if (after.aiFeatures && after.aiGenerationsPerMonth < before.aiGenerationsPerMonth) {
    out.push(`AI generations / month: ${before.aiGenerationsPerMonth} → ${after.aiGenerationsPerMonth}`);
  }
  return out;
}

const INPUT_KEYS: (keyof PlanInput)[] = [
  "key", "kind", "name", "tagline", "visibility", "monthlyEur", "maxUsers",
  "platformIntegrations", "aiFeatures", "aiGenerationsPerMonth", "messagingAndListings",
  "advancedInventory", "trialDays", "sortOrder", "highlighted",
];

export function planDiff(before: Plan | null, after: PlanInput): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of INPUT_KEYS) {
    const from = before ? before[k] : null;
    if (from !== after[k]) diff[k] = { from, to: after[k] };
  }
  return diff;
}

export function planInputToRow(i: PlanInput): Record<string, unknown> {
  return {
    key: i.key,
    kind: i.kind,
    name: i.name,
    tagline: i.tagline,
    visibility: i.visibility,
    monthly_eur: i.kind === "paid" ? i.monthlyEur : null,
    max_users: i.maxUsers,
    platform_integrations: i.platformIntegrations,
    ai_features: i.aiFeatures,
    ai_generations_per_month: i.aiFeatures ? i.aiGenerationsPerMonth : 0,
    messaging_and_listings: i.messagingAndListings,
    advanced_inventory: i.advancedInventory,
    trial_days: i.kind === "trial" ? i.trialDays : null,
    sort_order: i.sortOrder,
    highlighted: i.highlighted,
  };
}
```

Note `detectReductions` for a `3 → null` change: `a = Infinity`, not `< b`, so `[]` — matches the test. Run → PASS.

- [ ] **Step 2: `stripeSync.ts` — tests first**

`src/lib/plans/stripeSync.test.ts` builds a fake: `const stripe = { products: { create: jest.fn().mockResolvedValue({ id: "prod_new" }), update: jest.fn().mockResolvedValue({}) }, prices: { create: jest.fn().mockResolvedValue({ id: "price_new" }), update: jest.fn().mockResolvedValue({}) } };` Cases:
- `toCents(19.99)` → `1999`; `toCents(20)` → `2000`.
- `createStripePlan(stripe, input{key:"enterprise", name:"Enterprise", tagline:"Big", monthlyEur:99})` → returns `{ productId: "prod_new", priceId: "price_new" }`; `products.create` called with `{ name: "Boughtopia Enterprise", description: "Big", metadata: { plan_key: "enterprise" } }, { idempotencyKey: "plan-create-product-enterprise" }`; `prices.create` with `{ product: "prod_new", currency: "eur", unit_amount: 9900, recurring: { interval: "month" }, metadata: { plan_key: "enterprise" } }, { idempotencyKey: "plan-create-price-enterprise-9900" }`. Empty tagline → `description` omitted (key absent).
- `syncStripePlan` with an unchanged paid plan → no Stripe calls, returns `{}`.
- price change `30 → 35` on `pro` (`stripeProductId: "prod_p"`, `stripePriceId: "price_p"`) → `prices.create({ product: "prod_p", currency: "eur", unit_amount: 3500, recurring: { interval: "month" }, metadata: { plan_key: "pro" } }, { idempotencyKey: "plan-price-pro-3500-price_p" })`, then `prices.update("price_p", { active: false })`; returns `{ priceId: "price_new" }`. Assert create was called before update (`mock.invocationCallOrder`).
- name change → `products.update("prod_p", { name: "Boughtopia Pro Plus" })` (+ `description` when the tagline is non-empty and changed).
- `public → retired` → `products.update("prod_p", { active: false })`; `retired → hidden` → `{ active: true }`; `public → hidden` → no product call.
- paid plan with `stripeProductId: null` and any change that needs Stripe (price/name/visibility-retire) → rejects with `PlanSyncError` message `"This plan isn't linked to Stripe yet. Run npm run plans:seed-stripe first."`; with only non-Stripe changes (e.g. `maxUsers`) → no error, `{}`.
- trial plan → never calls Stripe, returns `{}`.

Run → FAIL. Implement `src/lib/plans/stripeSync.ts`:

```ts
import type Stripe from "stripe";
import type { Plan } from "./entitlements";
import type { PlanInput } from "./validatePlan";

/**
 * Server-only. Keeps Stripe products/prices in step with control.plans.
 * Called BEFORE the DB write: if the DB write then fails, the new price is
 * an unused orphan (harmless) and the retry reuses it via the idempotency
 * key. Old prices are deactivated for NEW purchases only — existing
 * subscriptions keep billing on them (grandfathering).
 */

export type StripePlanApi = {
  products: Pick<Stripe.ProductsResource, "create" | "update">;
  prices: Pick<Stripe.PricesResource, "create" | "update">;
};

export class PlanSyncError extends Error {}

export const toCents = (eur: number): number => Math.round(eur * 100);

const productName = (name: string) => `Boughtopia ${name}`;

export async function createStripePlan(
  stripe: StripePlanApi,
  input: Pick<PlanInput, "key" | "name" | "tagline" | "monthlyEur">
): Promise<{ productId: string; priceId: string }> {
  const product = await stripe.products.create(
    {
      name: productName(input.name),
      ...(input.tagline ? { description: input.tagline } : {}),
      metadata: { plan_key: input.key },
    },
    { idempotencyKey: `plan-create-product-${input.key}` }
  );
  const cents = toCents(input.monthlyEur!);
  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: "eur",
      unit_amount: cents,
      recurring: { interval: "month" },
      metadata: { plan_key: input.key },
    },
    { idempotencyKey: `plan-create-price-${input.key}-${cents}` }
  );
  return { productId: product.id, priceId: price.id };
}

export async function syncStripePlan(
  stripe: StripePlanApi,
  before: Plan,
  after: PlanInput
): Promise<{ priceId?: string }> {
  if (before.kind !== "paid") return {};

  const priceChanged = after.monthlyEur !== null && toCents(after.monthlyEur) !== toCents(before.monthlyEur ?? 0);
  const productUpdate: Stripe.ProductUpdateParams = {};
  if (after.name !== before.name) productUpdate.name = productName(after.name);
  if (after.tagline !== before.tagline && after.tagline) productUpdate.description = after.tagline;
  const wasRetired = before.visibility === "retired";
  const isRetired = after.visibility === "retired";
  if (wasRetired !== isRetired) productUpdate.active = !isRetired;

  const needsStripe = priceChanged || Object.keys(productUpdate).length > 0;
  if (!needsStripe) return {};
  if (!before.stripeProductId) {
    throw new PlanSyncError("This plan isn't linked to Stripe yet. Run npm run plans:seed-stripe first.");
  }

  if (Object.keys(productUpdate).length > 0) {
    await stripe.products.update(before.stripeProductId, productUpdate);
  }

  if (!priceChanged) return {};
  const cents = toCents(after.monthlyEur!);
  const price = await stripe.prices.create(
    {
      product: before.stripeProductId,
      currency: "eur",
      unit_amount: cents,
      recurring: { interval: "month" },
      metadata: { plan_key: before.key },
    },
    { idempotencyKey: `plan-price-${before.key}-${cents}-${before.stripePriceId ?? "none"}` }
  );
  if (before.stripePriceId) {
    await stripe.prices.update(before.stripePriceId, { active: false });
  }
  return { priceId: price.id };
}
```

(The test's "name change" case expects only `{ name }` when the tagline is unchanged — matches.) Run → PASS.

- [ ] **Step 3: `verifyPlatformAdmin` returns the email**

In `src/app/api/admin/tenants/route.ts` change the return type to `Promise<{ ok: true; email: string } | { ok: false; response: NextResponse }>` and `return { ok: true, email: user.email ?? "" };`. Existing callers only check `ok` — no other change.

- [ ] **Step 4: `GET` / `POST /api/admin/plans`**

`src/app/api/admin/plans/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { getStripe } from "@/lib/stripe";
import { getPlanCatalog, invalidatePlanCatalog } from "@/lib/plans/catalog";
import { planFromRow, type PlanRow } from "@/lib/plans/entitlements";
import { createStripePlan } from "@/lib/plans/stripeSync";
import { parsePlanInput, planDiff, planInputToRow, validatePlan } from "@/lib/plans/validatePlan";
import { verifyPlatformAdmin } from "../tenants/route";

export async function GET() {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  try {
    invalidatePlanCatalog();
    const plans = await getPlanCatalog();
    const control = createControlClient();
    // One head-count per plan — bounded by the number of plans, not tenants.
    const counts = await Promise.all(
      plans.map(async (p) => {
        const { count, error } = await control
          .schema("control")
          .from("tenants")
          .select("id", { count: "exact", head: true })
          .eq("plan", p.key);
        if (error) throw new Error(error.message);
        return [p.key, count ?? 0] as const;
      })
    );
    return NextResponse.json({ plans, tenantCounts: Object.fromEntries(counts) });
  } catch (err) {
    console.error("[admin/plans] list failed", err);
    return NextResponse.json({ error: "Could not load plans." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const input = parsePlanInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  let catalog;
  try {
    invalidatePlanCatalog();
    catalog = await getPlanCatalog();
  } catch (err) {
    console.error("[admin/plans] catalog read failed", err);
    return NextResponse.json({ error: "Could not create the plan. Please try again." }, { status: 500 });
  }

  const fieldErrors = validatePlan(input, { isCreate: true, catalog });
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "Please fix the highlighted fields.", fieldErrors }, { status: 400 });
  }

  let stripeIds: { productId: string; priceId: string };
  try {
    stripeIds = await createStripePlan(getStripe(), input);
  } catch (err) {
    console.error("[admin/plans] Stripe create failed", err);
    return NextResponse.json({ error: "Stripe didn't accept the new plan. Please try again." }, { status: 502 });
  }

  const control = createControlClient();
  const { data, error } = await control
    .schema("control")
    .from("plans")
    .insert({ ...planInputToRow(input), stripe_product_id: stripeIds.productId, stripe_price_id: stripeIds.priceId })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/plans] insert failed", error);
    const status = error?.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "A plan with this key already exists." : "Could not save the plan. Please try again." },
      { status }
    );
  }

  const { error: priceError } = await control
    .schema("control")
    .from("plan_prices")
    .insert({ stripe_price_id: stripeIds.priceId, plan_key: input.key, monthly_eur: input.monthlyEur });
  if (priceError) console.error("[admin/plans] plan_prices insert failed", priceError);

  invalidatePlanCatalog();
  const { error: auditError } = await control.schema("control").from("admin_audit_log").insert({
    admin_email: check.email,
    action: "plan_create",
    tenant_id: null,
    metadata: { key: input.key, changes: planDiff(null, input) },
  });
  if (auditError) console.error("[admin/plans] audit insert failed", auditError);

  return NextResponse.json({ plan: planFromRow(data as PlanRow) }, { status: 201 });
}
```

- [ ] **Step 5: `PATCH /api/admin/plans/[key]`**

`src/app/api/admin/plans/[key]/route.ts` — same imports plus `syncStripePlan`, `PlanSyncError`. Params: `{ params }: { params: Promise<{ key: string }> }`, `const { key } = await params;` (same shape as `api/admin/tenants/[id]/route.ts`). Flow:

1. `verifyPlatformAdmin()`.
2. `invalidatePlanCatalog(); const catalog = await getPlanCatalog();` (try → 500 `"Could not save the plan. Please try again."`), `const before = catalog.find((p) => p.key === key)`; missing → 404 `"Plan not found"`.
3. `const parsed = parsePlanInput(body)`; null → 400. Force immutables: `const input = { ...parsed, key: before.key, kind: before.kind };`.
4. `validatePlan(input, { isCreate: false, catalog })` → 400 with `fieldErrors`.
5. `let sync; try { sync = await syncStripePlan(getStripe(), before, input); } catch (err) { if (err instanceof PlanSyncError) return 409 { error: err.message }; log; return 502 "Stripe didn't accept the change. Please try again." }`.
6. Update: `.from("plans").update({ ...planInputToRow(input), ...(sync.priceId ? { stripe_price_id: sync.priceId } : {}), updated_at: new Date().toISOString() }).eq("key", key).select("*").single()`; error → log, 500 `"Could not save the plan. Please try again."`.
7. If `sync.priceId`: insert `plan_prices` `{ stripe_price_id: sync.priceId, plan_key: key, monthly_eur: input.monthlyEur }` (log on error).
8. `invalidatePlanCatalog()`; audit `action: "plan_update"`, `metadata: { key, changes: planDiff(before, input) }` (log on error).
9. `200 { plan: planFromRow(data) }`.

- [ ] **Step 6: Run tests + verifier**

Run: `npx jest src/lib/plans`
Expected: PASS. Run `uv run .claude/verifiers/verify_changes.py` — expected no new findings in the new routes (`verifyPlatformAdmin` is an auth marker).

- [ ] **Step 7: Docs + commit**

`src/lib/plans/CLAUDE.md`/`SKILL.md`: add `validatePlan.ts`, `stripeSync.ts`, `resolvePlanKey.ts`; gotchas: "Stripe first, DB second; idempotency keys `plan-create-product-<key>`, `plan-create-price-<key>-<cents>`, `plan-price-<key>-<cents>-<oldPriceId>` — Stripe keeps keys 24 h, so an identical retry within that window returns the same object"; "deactivating a price never touches existing subscriptions". `src/app/admin/CLAUDE.md`: API section for `/api/admin/plans` and the `verifyPlatformAdmin` email return.

```bash
git add src/lib/plans src/app/api/admin src/app/admin/CLAUDE.md
git commit -m "feat(admin): plan validation, Stripe sync and plan API routes"
```

---

### Task 6: /admin Plans screens + tenant plan dropdowns

**Files:**
- Create: `src/app/admin/plans/_lib/planFormState.ts` (+ `.test.ts`)
- Create: `src/app/admin/_components/planOptions.ts` (+ `.test.ts`)
- Create: `src/app/admin/plans/page.tsx`, `src/app/admin/plans/new/page.tsx`, `src/app/admin/plans/[key]/page.tsx`, `src/app/admin/plans/_components/PlanForm.tsx`
- Modify: `src/app/admin/layout.tsx` (header nav), `src/app/admin/_components/tenantVariants.ts`, `src/app/admin/page.tsx`, `src/app/admin/tenants/[id]/page.tsx`, `src/app/admin/_components/EditTenantModal.tsx`, `src/app/admin/_components/AddTenantModal.tsx`
- Modify: `src/app/api/admin/tenants/[id]/route.ts` (PATCH validates plan), `src/app/api/admin/provision-tenant/route.ts` (validates plan)
- Docs: `src/app/admin/CLAUDE.md`, `src/app/admin/SKILL.md`

**Interfaces:**
- Consumes: `Plan`, `isAssignablePlan`, `sortPlans` (Task 2); `PlanInput`, `PlanErrors`, `validatePlan`, `detectReductions` (Task 5); `GET/POST /api/admin/plans`, `PATCH /api/admin/plans/[key]` (Task 5); `getPlan` (Task 2) server-side.
- Produces:
  - `planFormState.ts`: `emptyPlanInput(): PlanInput` (paid, public, `monthlyEur: null`, `maxUsers: null`, all features false, AI 0, `trialDays: null`, `sortOrder: 0`, `highlighted: false`, empty strings); `inputFromPlan(plan: Plan): PlanInput`; `slugifyKey(name: string): string` (lowercase, non `[a-z0-9]` runs → `_`, trim `_`, prefix `p_` if it starts with a digit, cut to 32).
  - `planOptions.ts`: `planOptions(catalog: readonly Plan[], currentKey: string | null): { value: string; label: string }[]` — `sortPlans`, keep `isAssignablePlan(p, currentKey)`, label `p.kind === "trial" ? \`Trial (${p.trialDays} days)\` : p.visibility === "hidden" ? \`${p.name} (hidden)\` : p.visibility === "retired" ? \`${p.name} (retired)\` : p.name`.
  - `tenantVariants.ts`: `planVariant(key: string): "info" | "success" | "warning" | "danger" | "default"` — `trial` warning, `starter` info, `pro` success, `business` danger, anything else `default`. Remove `PLAN_VARIANT` and update its two callers. Check `Badge` supports a `"default"` variant (STATUS_VARIANT already uses it).

- [ ] **Step 1: Pure helpers — tests first**

`planFormState.test.ts`: `slugifyKey("Enterprise Plus!")` → `"enterprise_plus"`; `slugifyKey("  2024 Deal ")` → `"p_2024_deal"`; `slugifyKey("a".repeat(40)).length` → 32; `inputFromPlan(plan)` copies every `PlanInput` field and drops stripe ids; `emptyPlanInput()` passes `validatePlan` only after name, key and price are set (assert the errors object has exactly `key`, `name`, `monthlyEur` for the empty input against a catalog with one public plan).

`planOptions.test.ts`: catalog of trial (14 days), starter, pro, hidden `deal`, retired `old` → for `currentKey: "pro"` options are `[Trial (14 days), Starter, Pro, Deal (hidden)]` (retired excluded); for `currentKey: "old"` the retired plan is included as `Old (retired)`.

Run → FAIL, implement both modules, run → PASS.

- [ ] **Step 2: Admin header nav**

In `src/app/admin/layout.tsx`, next to the Admin badge add a `<nav className="flex items-center gap-4 ml-6">` with three `next/link` `Link`s — `"/admin"` "Tenants", `"/admin/plans"` "Plans", `"/admin/support"` "Support" — styled like the existing "Back to Dashboard" link (`text-sm text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] transition-colors`).

- [ ] **Step 3: `/admin/plans` list page**

Client component. Fetch `GET /api/admin/plans` on mount (loading state: `<Loader2 size={16} className="animate-spin" />` + "Loading plans…"; error state: message + "Retry" button that refetches). Header: `text-2xl font-bold` "Plans" + subtitle `text-sm` "Prices, limits and features for every subscription plan." + primary `Button` "New plan" (`Plus` icon) linking to `/admin/plans/new`. Table — copy the table/card classes from `src/app/admin/page.tsx` — columns: Plan (name, and key in `text-xs` muted mono), Visibility (`Badge`: trial → "Trial"/warning, public → "Public"/success, hidden → "Hidden"/info, retired → "Retired"/default), Price (`€{monthlyEur}/mo` or "—"), Users ("Unlimited" or number), Features (four small `Check`/`X` lucide icons with `title`/`aria-label` naming the feature, plus `AI {n}/mo` text when on), Tenants (count), and a final unlabeled column with a `Link` to `/admin/plans/{key}` using the same hamburger-icon link pattern as the tenants table (with `aria-label={\`Edit ${name}\`}`). Empty state: "No plans yet."

- [ ] **Step 4: `PlanForm` component**

`src/app/admin/plans/_components/PlanForm.tsx` (client). Props:

```ts
interface PlanFormProps {
  mode: "create" | "edit";
  original: Plan | null;          // null in create mode
  catalog: Plan[];
  tenantCount: number;            // tenants on `original` (0 in create mode)
  onSaved: (plan: Plan) => void;
}
```

State: `const [input, setInput] = useState<PlanInput>(original ? inputFromPlan(original) : emptyPlanInput());`, `keyTouched` (create mode: key follows `slugifyKey(name)` until the user edits the key field), `saving`, `serverErrors: PlanErrors`, `confirmOpen`. `const errors = validatePlan(input, { isCreate: mode === "create", catalog });` `const isFormValid = Object.keys(errors).length === 0;` Show a field's error under it only once that field has been touched or a submit was attempted (track `attempted` + `touched` set), merged with `serverErrors` from a 400 response.

Layout — `<form id="plan-form" onSubmit={handleSubmit} className="space-y-6">` of card sections (`rounded-[var(--radius-card)] border … p-6`, `text-base font-semibold` headings), using `Field`/`Input`/`Select`/`Textarea`/`Checkbox`/`Row` from `@/components/ui/FormFields`:

1. **Identity** — Name (`required`), Tagline, Key (`required`; `readOnly` in edit mode with helper text "Used by billing — can't change"; in create mode helper "Lowercase letters, digits and _").
2. **Visibility** (hidden for the trial) — `Select` Public / Hidden / Retired with helper text per option ("Shown on the pricing page and in the plan picker." / "Only you can assign it, from a tenant's page." / "No new tenants. Tenants already on it keep it."). When `input.visibility === "retired" && original?.visibility !== "retired"` show a warning note: `${tenantCount} tenant(s) stay on this plan.`
3. **Price** (paid only) — "Monthly price (EUR)" `Input type="number" step="0.01" min="1" required`. In edit mode, when the price differs from `original.monthlyEur`, show the note: `Creates a new Stripe price. ${tenantCount} current subscriber(s) keep €${original.monthlyEur} until they change plan.`
4. **Limits & features** — Max users `Input type="number" min="1"` + `Checkbox` "Unlimited" (checked ⇒ `maxUsers: null` and the input disabled); `Checkbox`es "Platform integrations (eBay & Amazon)", "AI features", "Listings & messages", "Advanced inventory"; when AI is on, "AI generations per month" `Input type="number" min="0"`. Turning AI off sets `aiGenerationsPerMonth: 0`.
5. **Trial** (trial only) — "Trial length (days)" `Input type="number" min="1" max="90" required`, helper "Applies to new sign-ups only."
6. **Display** — "Display order" number input, `Checkbox` "Highlight on pricing page".

Footer (outside the form): `Button variant="secondary"` "Cancel" → `router.push("/admin/plans")`, and primary `Button type="submit" form="plan-form" disabled={saving || !isFormValid}` labelled `saving ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"`.

`handleSubmit`: `e.preventDefault(); setAttempted(true); if (!isFormValid) return;` In edit mode, `const reductions = detectReductions(original!, input); if (reductions.length > 0 && tenantCount > 0) { setConfirmOpen(true); return; }` else `save()`. `ConfirmActionModal` (from `../../_components/ConfirmActionModal`) with `title="Reduce this plan?"`, `message={\`${tenantCount} tenant(s) on ${original.name} lose: ${reductions.join("; ")}. This applies immediately.\`}`, `confirmLabel="Save changes"`, `confirmingLabel="Saving…"`, `tone="warning"`, `loading={saving}`, `onConfirm={save}`, `onClose={() => setConfirmOpen(false)}`.

`save()`: `POST /api/admin/plans` (create) or `PATCH /api/admin/plans/${original.key}` (edit) with `JSON.stringify(input)`; on OK → `toast.success(mode === "create" ? "Plan created" : "Plan saved")`, `onSaved(data.plan)`; on non-OK → `setServerErrors(data.fieldErrors ?? {})`, `toast.error(data.error ?? "Could not save the plan.")`, keep `input` untouched; on network error → `toast.error("Network error — please try again.")`; always `setSaving(false)` and close the confirm modal in `finally`.

- [ ] **Step 5: New + edit pages**

`/admin/plans/new/page.tsx`: fetch `GET /api/admin/plans` (for `catalog`), back link `<ChevronLeft/> Plans` to `/admin/plans`, title "New plan", render `<PlanForm mode="create" original={null} catalog={plans} tenantCount={0} onSaved={(p) => router.push(\`/admin/plans/${p.key}\`)} />`.

`/admin/plans/[key]/page.tsx`: `params: Promise<{ key: string }>` resolved with React's `use()` (same as `tenants/[id]/page.tsx`); fetch `GET /api/admin/plans`, find the plan (not found → "Plan not found" + back link); title = plan name + visibility badge; render `PlanForm mode="edit"` with `tenantCount={tenantCounts[key] ?? 0}`; `onSaved` refetches (bump a `refreshKey`) and remounts the form with the saved plan (`key={plan.key + refreshKey}` on `PlanForm`). Both pages: loading spinner + error/Retry states like the list page.

- [ ] **Step 6: Tenant plan dropdowns + server validation**

`EditTenantModal.tsx` and `AddTenantModal.tsx`: on open, fetch `GET /api/admin/plans` and render `<option>`s from `planOptions(plans, tenant.plan)` (Add: `planOptions(plans, null)`, default value `"trial"`). Remove the local `type Plan = …` union in `AddTenantModal` (`useState<string>`). While loading, render only the current value as a single option so the select is never empty; on fetch error, keep that single option and show `text-xs` "Couldn't load plans." under the select.

`tenantVariants.ts`: replace `PLAN_VARIANT` with `planVariant(key)`; update `src/app/admin/page.tsx` and `src/app/admin/tenants/[id]/page.tsx` to call it. Where those pages show the plan text, keep showing the key (renaming display to names is not required).

Server: in `api/admin/tenants/[id]/route.ts` PATCH, when `body.plan !== undefined && body.plan !== tenant.plan` (the route already fetches the current tenant — add `plan` to that select if missing): `const target = await getPlan(body.plan)` (try → 500 `"Could not update tenant. Please try again."`); `if (!isAssignablePlan(target, tenant.plan)) return 400 { error: "That plan can't be assigned." }`. In `api/admin/provision-tenant/route.ts`: `if (!isAssignablePlan(await getPlan(plan), null)) return 400 { error: "That plan can't be assigned." }` (inside its existing error handling).

- [ ] **Step 7: Run tests**

Run: `npx jest src/app/admin src/lib/plans`
Expected: PASS.

- [ ] **Step 8: Docs + commit**

`src/app/admin/CLAUDE.md`: file-map entries for `plans/page.tsx`, `plans/new/page.tsx`, `plans/[key]/page.tsx`, `plans/_components/PlanForm.tsx`, `plans/_lib/planFormState.ts`, `_components/planOptions.ts`, header nav; update `tenantVariants.ts` and the two modals' entries. `src/app/admin/SKILL.md`: minimal file set "change plan form fields" (PlanForm + validatePlan + planFormState + migration if a column) and gotchas (key immutable; reductions confirm only when tenants exist; retired plans only appear in a tenant's dropdown when it's the current plan).

```bash
git add src/app/admin src/app/api/admin
git commit -m "feat(admin): Plans screens and catalog-driven tenant plan dropdowns"
```

---

### Task 7: Docs sweep + full verification

**Files:**
- Modify: `AGENTS.md`, `CLAUDE.md` (root, only if it references plan gating), `docs/superpowers/specs/2026-10-03-plan-management-design.md` (implementation notes), any remaining doc hits.

- [ ] **Step 1: Find stale references**

```bash
grep -rn "planGating\|PLAN_LIMITS\|getPlanLimits\|STRIPE_PRICE_\|stripe:setup\|TRIAL_DAYS\|PaidPlan\|PLAN_VARIANT" --include=*.md --include=*.ts --include=*.tsx --include=*.mjs --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=graphify-out .
```

Every hit outside `docs/superpowers/` history and `supabase/control-plane/012_plans.sql` comments must be updated to the new modules (`src/lib/plans/…`, `control.plans`, `npm run plans:seed-stripe`).

- [ ] **Step 2: AGENTS.md**

In the "New shared code" list: replace the `src/lib/stripe.ts` + `planGating.ts` + `pricing.ts` bullet with: `src/lib/stripe.ts` (Stripe client only) + `src/lib/plans/` (plan catalog: `entitlements.ts` pure gating helpers, `catalog.ts` server-only 60 s cached loader of `control.plans`, `validatePlan.ts`, `stripeSync.ts`, `resolvePlanKey.ts`) + `src/lib/utils/pricing.ts` (pricing cards built from catalog plans). In the `src/app/admin/` bullet add "Plans management (`/admin/plans`)". Keep the rule "Stripe webhooks are the source of truth for `plan`/`status`" and add: "`/admin` may also assign a plan (`isAssignablePlan`); plan *definitions* live in `control.plans` and are edited only through `/api/admin/plans`."

- [ ] **Step 3: Spec implementation notes**

Append a short "Implementation notes (2026-10-03)" section to the spec listing deviations: reused `verifyPlatformAdmin` (from `api/admin/tenants/route.ts`, now returning the email) instead of a new `requirePlatformAdmin`; `toWireEntitlements`/`fromWireEntitlements` for the RSC boundary (`Infinity`); the invite route now enforces `maxUsers` (it was never enforced before); the webhook fails the event (Stripe retries) when the catalog is unreadable.

- [ ] **Step 4: Full verification**

Run: `npx jest` (whole suite) — expected all pass; report the totals.
Run: `uv run .claude/verifiers/verify_changes.py` — expected no new findings in changed files.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md CLAUDE.md docs src
git commit -m "docs: plan management sweep"
```
