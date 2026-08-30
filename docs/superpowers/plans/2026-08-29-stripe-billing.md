# Stripe Billing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing, non-functional Stripe scaffold into a working self-serve billing system for the three paid plans, with two entry points (trial-expired page, dashboard Settings) and the webhook as the sole writer of `control.tenants.plan`/`status`.

**Architecture:** Four billing API routes (`checkout` fixed, `change-plan`/`cancel`/`status` new) talk to Stripe and never write `plan`/`status` themselves; the webhook is the only writer, reacting to what Stripe reports back. A shared `PlanPicker` component (promoted `pricedPlans()` pricing data underneath it) renders the same plan cards on both entry points.

**Tech Stack:** Next.js Route Handlers, the `stripe` npm SDK (already a dependency, via `src/lib/stripe.ts`), Supabase control-plane client, React Client Components.

**Spec:** docs/superpowers/specs/2026-08-29-stripe-billing-design.md

## Global Constraints

- **Branch:** `feat/stripe-billing`. Never commit to `main`.
- **Monthly only** — no annual billing. `PLANS` drops its `annual` key entirely.
- **Webhook is the sole writer of `control.tenants.plan`/`status`** — the checkout/change-plan/cancel routes only talk to Stripe, never write those two columns directly.
- **No new DB migration** — `stripe_customer_id`/`stripe_subscription_id` already exist on `control.tenants` (`supabase/control-plane/001_schema.sql`).
- **Existing manually-managed tenants are untouched** — no Stripe customer is created for them; `/admin`'s plan dropdown keeps working exactly as it does today.
- **Route handlers are not unit-tested**, per this codebase's existing convention (`/api/admin/provision-tenant`, `/api/signup/provision` have none) — this applies to all four billing routes and the webhook.
- Never query `public.*`; never hardcode a tenant schema name.
- Do not run `npm test`/`tsc`/`lint` yourself mid-task unless a step says to — rely on the Husky pre-commit hook (runs `tsc --noEmit` + `eslint` + the verifier on every commit).

---

### Task 1: Relocate `pricing.ts` to shared

Pure relocation — content is identical, only the file's location and one import path change. This is a prerequisite for Task 6's `PlanPicker`, which needs `pricedPlans()` available outside the marketing route group.

**Files:**
- Create: `src/lib/utils/pricing.ts`
- Create: `src/lib/utils/pricing.test.ts`
- Delete: `src/app/(marketing)/_lib/pricing.ts`
- Delete: `src/app/(marketing)/_lib/pricing.test.ts`
- Modify: `src/app/(marketing)/_components/Pricing.tsx`
- Modify: `src/app/(marketing)/CLAUDE.md`
- Modify: `src/app/(marketing)/SKILL.md`
- Modify: `src/lib/utils/SKILL.md`

**Interfaces:**
- Produces: `pricedPlans(): PricedPlan[]`, `type PaidPlan`, `type PricedPlan`, `type PlanFeature` — all now importable from `@/lib/utils/pricing`. Consumed by Task 3 (checkout route), Task 4 (change-plan route), Task 6 (`PlanPicker`), Task 7 (trial-expired), Task 8 (Settings `BillingSection`).

- [ ] **Step 1: Create the file at its new location**

Create `src/lib/utils/pricing.ts` with this exact content (identical to the current `src/app/(marketing)/_lib/pricing.ts` — the `@/lib/utils/planGating` import is already an absolute alias, so nothing inside the file changes):

```ts
import { getPlanLimits } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

/** The plans a visitor can actually buy — `trial` is granted, never sold. */
export type PaidPlan = Exclude<TenantPlan, "trial">;

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PricedPlan {
  plan: PaidPlan;
  name: string;
  monthlyEur: number;
  tagline: string;
  users: string;
  features: PlanFeature[];
  highlighted: boolean;
}

const ORDER: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

const MONTHLY_EUR: Record<PaidPlan, number> = {
  starter: 20,
  pro: 30,
  business: 50,
};

const NAMES: Record<PaidPlan, string> = {
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

const TAGLINES: Record<PaidPlan, string> = {
  starter: "Bookkeeping for a small team, entered by hand.",
  pro: "Pull your eBay and Amazon orders in automatically.",
  business: "Run listings, messages and the whole operation in one place.",
};

/**
 * The pricing table's data.
 *
 * Prices live here; **feature ticks are derived from `PLAN_LIMITS`**
 * (`lib/utils/planGating.ts`) rather than written out by hand, so this page
 * physically cannot advertise a capability the application gates off. Change
 * the plan matrix and this page follows.
 */
export function pricedPlans(): PricedPlan[] {
  return ORDER.map((plan) => {
    const limits = getPlanLimits(plan);

    return {
      plan,
      name: NAMES[plan],
      monthlyEur: MONTHLY_EUR[plan],
      tagline: TAGLINES[plan],
      users:
        limits.maxUsers === Infinity
          ? "Unlimited users"
          : `Up to ${limits.maxUsers} users`,
      features: [
        { label: "Sales, expenses, purchases & inventory", included: true },
        { label: "VAT tracking & PDF invoices", included: true },
        { label: "CSV import & export", included: true },
        { label: "Full audit trail", included: true },
        { label: "eBay & Amazon order import", included: limits.platformIntegrations },
        { label: "eBay listings & buyer messages", included: limits.messagingAndListings },
        { label: "AI-assisted insights", included: limits.aiFeatures },
      ],
      highlighted: plan === "pro",
    };
  });
}
```

- [ ] **Step 2: Create the test file at its new location**

Create `src/lib/utils/pricing.test.ts` with this exact content (identical to the current test — the `./pricing` relative import stays valid since the test moves alongside the file it tests):

```ts
import { pricedPlans } from "./pricing";
import { getPlanLimits } from "@/lib/utils/planGating";

describe("pricedPlans", () => {
  it("returns the three paid plans in ascending price order", () => {
    const plans = pricedPlans();
    expect(plans.map((p) => p.plan)).toEqual(["starter", "pro", "business"]);
    expect(plans.map((p) => p.monthlyEur)).toEqual([20, 30, 50]);
  });

  it("never offers the trial plan as something to buy", () => {
    expect(pricedPlans().some((p) => (p.plan as string) === "trial")).toBe(false);
  });

  // The whole point of deriving: the page cannot advertise a capability the
  // app actually gates off.
  it("derives every feature mark from PLAN_LIMITS", () => {
    for (const plan of pricedPlans()) {
      const limits = getPlanLimits(plan.plan);
      const mark = (label: string) =>
        plan.features.find((f) => f.label === label)?.included;

      expect(mark("eBay & Amazon order import")).toBe(limits.platformIntegrations);
      expect(mark("eBay listings & buyer messages")).toBe(limits.messagingAndListings);
      expect(mark("AI-assisted insights")).toBe(limits.aiFeatures);
    }
  });

  it("describes the user cap from PLAN_LIMITS", () => {
    const byPlan = Object.fromEntries(pricedPlans().map((p) => [p.plan, p]));
    expect(byPlan.starter.users).toBe("Up to 3 users");
    expect(byPlan.pro.users).toBe("Up to 5 users");
    expect(byPlan.business.users).toBe("Unlimited users");
  });

  it("highlights exactly one plan", () => {
    expect(pricedPlans().filter((p) => p.highlighted)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test at its new location to confirm it passes**

Run: `npx jest src/lib/utils/pricing.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 4: Delete the old files**

```bash
git rm "src/app/(marketing)/_lib/pricing.ts" "src/app/(marketing)/_lib/pricing.test.ts"
```

- [ ] **Step 5: Update the marketing Pricing component's import**

In `src/app/(marketing)/_components/Pricing.tsx`, change:

```ts
import { pricedPlans } from "../_lib/pricing";
```

to:

```ts
import { pricedPlans } from "@/lib/utils/pricing";
```

- [ ] **Step 6: Run the marketing test pattern to confirm nothing broke**

Run: `npx jest marketing`
Expected: no test suites found (the pricing test moved out from under this pattern — this is expected, not a failure). Then run `npx tsc --noEmit` to confirm `Pricing.tsx`'s new import resolves.
Expected: tsc silent.

- [ ] **Step 7: Update the marketing feature's docs**

In `src/app/(marketing)/CLAUDE.md`, find the `_lib/pricing.ts` bullet under "Files in this folder" and remove it (it's no longer in this folder). Find the "Pricing is derived, not transcribed" section and update its file reference from `_lib/pricing.ts` to `src/lib/utils/pricing.ts`. Find the "Tests" section at the bottom, currently:

```markdown
## Tests

`npx jest marketing` runs `_lib/pricing.test.ts`.
```

Replace with:

```markdown
## Tests

Pricing's derivation logic is tested at `src/lib/utils/pricing.test.ts`
(moved out of this folder 2026-08-29 once Settings and `/trial-expired`
became consumers too — run `npx jest lib/utils/pricing`). This folder no
longer has a `_lib/` of its own.
```

In `src/app/(marketing)/SKILL.md`, find the "Change a price" and "Change what a plan includes" bullets and update their file references from `_lib/pricing.ts` to `src/lib/utils/pricing.ts`.

- [ ] **Step 8: Add the new file to `src/lib/utils/SKILL.md`**

Add a new entry (matching this file's existing style — check the file for the right heading to add under):

```markdown
- `pricing.ts` (+ colocated test) — `pricedPlans(): PricedPlan[]`, the three
  paid plans' prices/copy, with every feature tick derived from
  `PLAN_LIMITS` (`planGating.ts`) rather than hand-written, so it can't
  advertise a capability the app gates off. Moved here from the marketing
  page's private `_lib/` (2026-08-29) once Settings and `/trial-expired`
  became consumers too — 3+ features is this project's own threshold for
  promoting a feature-private file to shared.
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/utils/pricing.ts src/lib/utils/pricing.test.ts \
        "src/app/(marketing)/_components/Pricing.tsx" \
        "src/app/(marketing)/CLAUDE.md" "src/app/(marketing)/SKILL.md" \
        src/lib/utils/SKILL.md
git commit -m "refactor(pricing): promote pricing.ts from marketing-private to shared

pricedPlans() is about to gain two more consumers (Settings, /trial-expired)
beyond the marketing page — this project's own convention promotes a
feature-private file to shared once 3+ things use it. Pure relocation, no
behavior change; the colocated test moves with it."
```

---

### Task 2: `stripe.ts` env-var price IDs + setup script

**Files:**
- Modify: `src/lib/stripe.ts`
- Create: `scripts/stripe-setup.mjs`
- Modify: `package.json`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `type PaidPlan` (Task 1, `@/lib/utils/pricing`)
- Produces: `PLANS: Record<PaidPlan, string>` (env-var-backed, no `annual` key) — consumed by Task 3 (checkout) and Task 4 (change-plan).

- [ ] **Step 1: Rewrite `stripe.ts`**

Replace the full content of `src/lib/stripe.ts`:

```ts
import Stripe from "stripe";
import type { PaidPlan } from "@/lib/utils/pricing";

let stripeClient: Stripe | null = null;

// Lazily constructed so `next build` doesn't fail evaluating this module
// before STRIPE_SECRET_KEY is configured.
export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return stripeClient;
}

// Real Stripe price IDs, not hardcoded literals: test-mode and live-mode
// price IDs are different values for the same-looking product, so hardcoding
// them here would force a code change on every mode switch. Populated by
// `npm run stripe:setup` (scripts/stripe-setup.mjs) — see that script and
// .env.local.example.
export const PLANS: Record<PaidPlan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
  business: process.env.STRIPE_PRICE_BUSINESS!,
};
```

- [ ] **Step 2: Create the setup script**

Create `scripts/stripe-setup.mjs`:

```js
// Run once per Stripe mode (test/live) to create the three Products + their
// monthly EUR Prices, then paste the printed price IDs into .env.local as
// STRIPE_PRICE_STARTER/_PRO/_BUSINESS.
//
// Usage: npm run stripe:setup
//
// Not idempotent — running it twice creates duplicate Products. If you need
// to re-run it (e.g. you fat-fingered a price), delete the stale Products
// in the Stripe Dashboard first.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = [
  { key: "starter", name: "Starter", eur: 20 },
  { key: "pro", name: "Pro", eur: 30 },
  { key: "business", name: "Business", eur: 50 },
];

async function main() {
  console.log(`Creating Stripe Products/Prices in ${
    process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "TEST"
  } mode...\n`);

  const results = [];
  for (const plan of PLANS) {
    const product = await stripe.products.create({ name: `Boughtopia ${plan.name}` });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: plan.eur * 100,
      recurring: { interval: "month" },
    });
    results.push({ ...plan, priceId: price.id });
  }

  console.log("Done. Paste these into .env.local:\n");
  for (const r of results) {
    console.log(`STRIPE_PRICE_${r.key.toUpperCase()}=${r.priceId}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`'s `"scripts"` block, add (matching the existing `create-tenant-user` entry's style, right after it):

```json
    "stripe:setup": "node --env-file=.env.local scripts/stripe-setup.mjs"
```

- [ ] **Step 4: Document the new env vars**

In `.env.local.example`, immediately after the existing `STRIPE_WEBHOOK_SECRET=your-stripe-webhook-signing-secret` line, add:

```
# From `npm run stripe:setup` (scripts/stripe-setup.mjs) — one Price ID per
# plan. Test-mode and live-mode values differ; re-run the script in live
# mode when going to production.
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_BUSINESS=price_...
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: silent (the script is plain `.mjs`, outside TypeScript's scope — `stripe.ts`'s new type is what's being checked).

- [ ] **Step 6: Commit**

```bash
git add src/lib/stripe.ts scripts/stripe-setup.mjs package.json .env.local.example
git commit -m "feat(billing): real price IDs from env, drop annual, add setup script

Price IDs move from hardcoded placeholder literals to env vars — test-mode
and live-mode IDs are different values in Stripe, so hardcoding them would
force a code change per mode switch. scripts/stripe-setup.mjs creates the
three Products/Prices via the Stripe API (run once per mode) and prints the
IDs to paste into .env.local, following this repo's existing script
convention (scrape:aliexpress, create-tenant-user)."
```

---

### Task 3: Fix the checkout route

**Files:**
- Modify: `src/app/api/billing/checkout/route.ts`

**Interfaces:**
- Consumes: `getStripe`, `PLANS` (Task 2, `@/lib/stripe`); `type PaidPlan` (Task 1, `@/lib/utils/pricing`)
- Produces: `POST /api/billing/checkout` with body `{ plan: "starter" | "pro" | "business" }` → `200 { url: string }` or `{ error: string }` with 400/401/404/409/500. Called by Task 6's `PlanPicker` consumers (Tasks 7 and 8).

- [ ] **Step 1: Rewrite the route**

Replace the full content of `src/app/api/billing/checkout/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import type { PaidPlan } from "@/lib/utils/pricing";

const VALID_PLANS: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — String(err) on those yields "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const { plan } = (await req.json()) as { plan?: string };
  if (!plan || !VALID_PLANS.includes(plan as PaidPlan)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = PLANS[plan as PaidPlan];

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("*")
    .eq("schema_name", tenantSchema)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (tenant.stripe_subscription_id && tenant.status === "active") {
    return NextResponse.json(
      { error: "Already subscribed — manage your plan from Settings." },
      { status: 409 }
    );
  }

  try {
    const stripe = getStripe();

    // Create or reuse Stripe customer
    let stripeCustomerId = tenant.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { tenant_schema: tenantSchema, tenant_id: tenant.id as string },
      });
      stripeCustomerId = customer.id;
      await control
        .schema("control")
        .from("tenants")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", tenant.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?billing=cancelled`,
      // The session's own `metadata` does NOT propagate to the subscription
      // Stripe creates from it — `subscription_data.metadata` is what the
      // webhook's `sub.metadata.plan` read (customer.subscription.created/
      // updated) actually sees. Without this, every new subscription
      // silently defaults to "starter" in the webhook.
      subscription_data: {
        metadata: { tenant_id: tenant.id as string, plan },
      },
      metadata: { tenant_id: tenant.id as string },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error("[billing/checkout] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/billing/checkout/route.ts
git commit -m "fix(billing): checkout takes a plan key, fixes subscription metadata, guards double-subscribe

Three fixes to the existing scaffold: (1) the route now takes {plan} instead
of a raw {priceId} from the client, looking up the real price ID
server-side — the client can no longer hand Stripe an arbitrary price
string; (2) subscription_data.metadata now carries the plan, fixing a bug
where the webhook's sub.metadata.plan read was always empty (session
metadata doesn't propagate to the subscription it creates) and every new
subscription silently defaulted to starter; (3) a tenant with an active
subscription already gets a 409 instead of accidentally starting a second
one."
```

---

### Task 4: `change-plan`, `cancel`, and `status` routes

Three small, same-shape new routes, grouped into one task since none has independent design complexity beyond Task 3's already-established patterns.

**Files:**
- Create: `src/app/api/billing/change-plan/route.ts`
- Create: `src/app/api/billing/cancel/route.ts`
- Create: `src/app/api/billing/status/route.ts`

**Interfaces:**
- Consumes: `getStripe`, `PLANS` (Task 2); `type PaidPlan` (Task 1)
- Produces:
  - `POST /api/billing/change-plan` body `{ plan }` → `200 { ok: true }` or `{ error }` with 400/401/500.
  - `POST /api/billing/cancel` (no body) → `200 { ok: true, cancelAtPeriodEnd: true }` or `{ error }` with 400/401/500.
  - `GET /api/billing/status` → `200 { plan: TenantPlan, hasSubscription: boolean, cancelAtPeriodEnd: boolean }` or `{ error }` with 401/404.
  All three consumed by Task 8's `BillingSection`.

- [ ] **Step 1: Create the change-plan route**

Create `src/app/api/billing/change-plan/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import type { PaidPlan } from "@/lib/utils/pricing";

const VALID_PLANS: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const { plan } = (await req.json()) as { plan?: string };
  if (!plan || !VALID_PLANS.includes(plan as PaidPlan)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = PLANS[plan as PaidPlan];

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ stripe_subscription_id: string | null }>();

  const subscriptionId = tenant?.stripe_subscription_id ?? undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription to change." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0].id;

    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      // Default proration: the price difference lands on the next invoice
      // rather than being charged immediately.
      proration_behavior: "create_prorations",
      metadata: { plan },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[billing/change-plan] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not change plan. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create the cancel route**

Create `src/app/api/billing/cancel/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ stripe_subscription_id: string | null }>();

  const subscriptionId = tenant?.stripe_subscription_id ?? undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription to cancel." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: true });
  } catch (err: unknown) {
    console.error("[billing/cancel] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "Could not cancel subscription. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create the status route**

Create `src/app/api/billing/status/route.ts`. This reads `cancel_at_period_end` live from Stripe rather than from a DB column, since `control.tenants` doesn't track it and this design adds no new migration:

```ts
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import type { TenantPlan } from "@/types";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan, status, stripe_subscription_id")
    .eq("schema_name", tenantSchema)
    .single<{ plan: TenantPlan; status: string; stripe_subscription_id: string | null }>();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const hasSubscription = Boolean(tenant.stripe_subscription_id) && tenant.status === "active";

  let cancelAtPeriodEnd = false;
  if (hasSubscription && tenant.stripe_subscription_id) {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
    cancelAtPeriodEnd = subscription.cancel_at_period_end;
  }

  return NextResponse.json({ plan: tenant.plan, hasSubscription, cancelAtPeriodEnd });
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: silent.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/change-plan/route.ts src/app/api/billing/cancel/route.ts src/app/api/billing/status/route.ts
git commit -m "feat(billing): change-plan, cancel, and status routes

change-plan updates the existing subscription's price with Stripe's default
proration (charged on the next invoice, not immediately) rather than
creating a second subscription. cancel sets cancel_at_period_end rather
than cancelling immediately, so access continues through what was already
paid for. status is a thin read the client needs because it can't query
control.tenants directly — cancelAtPeriodEnd comes from a live Stripe read
since there's no DB column tracking it (no new migration in this design)."
```

---

### Task 5: Webhook refinement

**Files:**
- Modify: `src/app/api/billing/webhook/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace the full content of `src/app/api/billing/webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import type Stripe from "stripe";

// Disable body parsing — Stripe needs the raw body to verify the signature
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const control = createControlClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = (sub.metadata?.plan as string) ?? "starter";

      const patch: { stripe_subscription_id: string; plan: string; status?: string } = {
        stripe_subscription_id: sub.id,
        plan,
      };

      // Only touch status for unambiguous outcomes. "incomplete" (payment
      // still processing) and "trialing" (this app never sets
      // trial_period_days on a subscription — Boughtopia's own 14-day trial
      // is unrelated to Stripe's "trialing" status — so this shouldn't
      // occur, but the mapping stays defensive rather than assuming) are
      // deliberately left alone rather than prematurely deactivating a
      // tenant that wasn't deactivated a moment ago.
      if (sub.status === "active") {
        patch.status = "active";
      } else if (
        sub.status === "past_due" ||
        sub.status === "unpaid" ||
        sub.status === "canceled" ||
        sub.status === "incomplete_expired" ||
        sub.status === "paused"
      ) {
        patch.status = "deactivated";
      }

      await logIfUnmatched(
        control
          .schema("control")
          .from("tenants")
          .update(patch)
          .eq("stripe_customer_id", sub.customer as string)
          .select("id"),
        sub.customer as string
      );
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await logIfUnmatched(
        control
          .schema("control")
          .from("tenants")
          .update({ status: "deactivated" })
          .eq("stripe_customer_id", sub.customer as string)
          .select("id"),
        sub.customer as string
      );
      break;
    }
  }

  // Always 200 to Stripe, even when nothing matched — a stripe_customer_id
  // with no tenant row is not a transient failure Stripe should retry.
  return NextResponse.json({ received: true });
}

async function logIfUnmatched(
  query: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>,
  stripeCustomerId: string
): Promise<void> {
  const { data, error } = await query;
  if (error) {
    console.error("[billing/webhook] update failed:", error.message);
  } else if (!data || data.length === 0) {
    console.error(`[billing/webhook] no tenant found for stripe_customer_id=${stripeCustomerId}`);
  }
}
```

Note what changed from the previous version: the `invoice.payment_failed` case is removed entirely (Stripe's own retry schedule runs before a subscription's `status` actually changes to `past_due`/`unpaid` — reacting to the *first* failed attempt would deactivate a tenant whose card succeeds on retry a day or two later), the blunt `sub.status === "active" ? "active" : "deactivated"` ternary is replaced with the three-way mapping above, and both update paths now go through `logIfUnmatched` so an update that silently affects zero rows (a `stripe_customer_id` with no matching tenant) is actually logged rather than disappearing — per the spec's error-handling table.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/billing/webhook/route.ts
git commit -m "fix(billing): refine webhook status mapping, drop premature payment-failure deactivation

Removes the invoice.payment_failed handler, which deactivated a tenant on
the FIRST failed payment attempt — before Stripe's own automatic retry
schedule has a chance to succeed on a temporarily-declined card.
customer.subscription.updated (which fires whenever Stripe's own
subscription status actually changes) is now the sole trigger for
deactivation. Also stops writing status at all for incomplete/trialing
subscriptions, so a checkout still processing payment doesn't get flagged
deactivated before it's even had a first outcome."
```

---

### Task 6: `PlanPicker` shared component

**Files:**
- Create: `src/components/billing/PlanPicker.tsx`

**Interfaces:**
- Consumes: `pricedPlans()`, `type PaidPlan` (Task 1, `@/lib/utils/pricing`)
- Produces: `<PlanPicker onSelectPlan={(plan: PaidPlan) => void} currentPlan?: PaidPlan loadingPlan?: PaidPlan | null />` — consumed by Task 7 (`/trial-expired`) and Task 8 (Settings `BillingSection`).

- [ ] **Step 1: Create the component**

Create `src/components/billing/PlanPicker.tsx`:

```tsx
"use client";

import { pricedPlans, type PaidPlan } from "@/lib/utils/pricing";

interface PlanPickerProps {
  /** Called with the plan the visitor picked. The caller decides whether
   * that means starting a fresh checkout or changing an existing
   * subscription — this component doesn't know which. */
  onSelectPlan: (plan: PaidPlan) => void;
  /** The tenant's current plan, if they already have one. Rendered as a
   * disabled "Current plan" card instead of a button. */
  currentPlan?: PaidPlan;
  /** The plan currently mid-request, if any — disables its button and
   * shows a loading label instead of "Subscribe"/"Switch to X". */
  loadingPlan?: PaidPlan | null;
}

export function PlanPicker({ onSelectPlan, currentPlan, loadingPlan }: PlanPickerProps) {
  const plans = pricedPlans();

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = plan.plan === currentPlan;
        return (
          <div
            key={plan.plan}
            className={`rounded-[var(--radius-card)] border p-6 ${
              isCurrent ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
            } bg-[var(--color-surface)]`}
          >
            <h3 className="text-lg font-bold text-[var(--color-text-strong)]">{plan.name}</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{plan.tagline}</p>
            <p className="mt-4">
              <span className="text-3xl font-bold text-[var(--color-text-strong)]">
                €{plan.monthlyEur}
              </span>
              <span className="text-sm text-[var(--color-text-muted)]"> / month</span>
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--color-text-base)]">{plan.users}</p>

            {isCurrent ? (
              <p className="mt-6 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-center text-sm font-semibold text-[var(--color-text-muted)]">
                Current plan
              </p>
            ) : (
              <button
                type="button"
                onClick={() => onSelectPlan(plan.plan)}
                disabled={loadingPlan === plan.plan}
                className="mt-6 w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingPlan === plan.plan
                  ? "Redirecting…"
                  : currentPlan
                    ? `Switch to ${plan.name}`
                    : "Subscribe"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npx eslint src/components/billing`
Expected: tsc silent; eslint clean (no `<img>` in this file, nothing to warn about).

- [ ] **Step 3: Commit**

```bash
git add src/components/billing/PlanPicker.tsx
git commit -m "feat(billing): shared PlanPicker component

Renders the three plan cards from pricedPlans() with a subscribe/switch
button per card. Shared rather than feature-private from the start, since
it's needed by two independent route trees (/trial-expired, Settings) with
no single natural owner."
```

---

### Task 7: Wire `/trial-expired` to real checkout

**Files:**
- Modify: `src/app/trial-expired/page.tsx`
- Modify: `src/app/dashboard/CLAUDE.md`

**Interfaces:**
- Consumes: `<PlanPicker>` (Task 6); `POST /api/billing/checkout` (Task 3)

- [ ] **Step 1: Rewrite the page**

Replace the full content of `src/app/trial-expired/page.tsx`. This becomes a Client Component (it wasn't one before) to handle the plan-selection click and redirect:

```tsx
"use client";

import { useState } from "react";
import { PlanPicker } from "@/components/billing/PlanPicker";
import type { PaidPlan } from "@/lib/utils/pricing";

export default function TrialExpiredPage() {
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectPlan(plan: PaidPlan) {
    setError(null);
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start checkout. Please try again.");
        setLoadingPlan(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error — please try again.");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4 py-12">
      <div className="w-full max-w-4xl text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Your free trial has ended
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your 14-day Boughtopia trial is over. All of your data is safe and
          will be exactly as you left it as soon as you choose a plan.
        </p>

        {error && <p className="mt-4 text-sm text-(--color-danger-text)">{error}</p>}

        <div className="mt-8">
          <PlanPicker onSelectPlan={handleSelectPlan} loadingPlan={loadingPlan} />
        </div>
      </div>
    </div>
  );
}
```

Note this keeps the file's pre-existing `(--color-x)` parenthesis-shorthand Tailwind syntax throughout (both the untouched parts and the new parts) rather than mixing in the bracket `[var(--color-x)]` style `PlanPicker` itself uses — cosmetic only, both compile identically, kept for a minimal diff against this file's own established convention. The old static "Contact Boughtopia to pick a plan" paragraph and the "View plans & pricing →" link back to `/` are both removed — the plan cards are the more direct path now.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx tsc --noEmit && npx eslint src/app/trial-expired`
Expected: both silent/clean.

- [ ] **Step 3: Update the dashboard feature doc's trial-expiry note**

In `src/app/dashboard/CLAUDE.md`, find the "Trial expiry" paragraph (added 2026-08-28, describing `proxy.ts`'s redirect to `/trial-expired`) and add one sentence noting the page is no longer a dead end:

Find:
```markdown
**Trial expiry (2026-08-28):** `src/proxy.ts` locks out expired trials by
reusing the same `control.tenants` row it already fetches for the
deactivation check — the `select` carries `status, plan, trial_ends_at` and
feeds `isTrialExpired` (`lib/utils/trial.ts`). Expired trials land on
`/trial-expired`. That page, like `/account-deactivated`, **must stay out of
`proxy.ts`'s matcher** or it redirects to itself forever. Tenant data is
never touched at expiry; restoring access is a plan change in `/admin`.
```

Append a sentence:

```markdown
**Trial expiry (2026-08-28):** `src/proxy.ts` locks out expired trials by
reusing the same `control.tenants` row it already fetches for the
deactivation check — the `select` carries `status, plan, trial_ends_at` and
feeds `isTrialExpired` (`lib/utils/trial.ts`). Expired trials land on
`/trial-expired`. That page, like `/account-deactivated`, **must stay out of
`proxy.ts`'s matcher** or it redirects to itself forever. Tenant data is
never touched at expiry; restoring access is a plan change in `/admin` OR
(2026-08-29) a real Stripe checkout from `/trial-expired`'s own `PlanPicker`
— the webhook flips `plan`/`status` once the subscription is created.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/trial-expired/page.tsx src/app/dashboard/CLAUDE.md
git commit -m "feat(billing): /trial-expired offers real checkout instead of \"contact us\"

Replaces the static contact-us copy with PlanPicker, wired to
POST /api/billing/checkout. Becomes a Client Component to handle the
click-and-redirect."
```

---

### Task 8: Settings Billing section

**Files:**
- Create: `src/app/dashboard/settings/_components/BillingSection.tsx`
- Modify: `src/app/dashboard/settings/page.tsx`
- Modify: `src/app/dashboard/settings/CLAUDE.md`
- Modify: `src/app/dashboard/settings/SKILL.md`

**Interfaces:**
- Consumes: `<PlanPicker>` (Task 6); `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/change-plan`, `POST /api/billing/cancel` (Tasks 3-4)

- [ ] **Step 1: Create the Billing section**

Create `src/app/dashboard/settings/_components/BillingSection.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PlanPicker } from "@/components/billing/PlanPicker";
import type { PaidPlan } from "@/lib/utils/pricing";
import type { TenantPlan } from "@/types";

interface BillingStatus {
  plan: TenantPlan;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
}

export function BillingSection() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((res) => res.json())
      .then((data: BillingStatus) => setStatus(data))
      .catch(() => setError("Could not load billing status."));
  }, []);

  async function handleSelectPlan(plan: PaidPlan) {
    if (!status) return;
    setError(null);
    setLoadingPlan(plan);
    const endpoint = status.hasSubscription ? "/api/billing/change-plan" : "/api/billing/checkout";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json()) as { url?: string; ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        setLoadingPlan(null);
        return;
      }
      if (body.url) {
        window.location.href = body.url;
        return;
      }
      // change-plan succeeded (no redirect) — reflect the new plan locally.
      setStatus({ ...status, plan });
      setLoadingPlan(null);
    } catch {
      setError("Network error — please try again.");
      setLoadingPlan(null);
    }
  }

  async function handleCancel() {
    setError(null);
    setCanceling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not cancel subscription.");
        setCanceling(false);
        return;
      }
      setStatus((prev) => (prev ? { ...prev, cancelAtPeriodEnd: true } : prev));
      setCanceling(false);
    } catch {
      setError("Network error — please try again.");
      setCanceling(false);
    }
  }

  if (!status) {
    return (
      <section className="max-w-2xl rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="text-base font-semibold text-[var(--color-text-strong)]">Billing</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading…</p>
      </section>
    );
  }

  const currentPaidPlan = status.plan === "trial" ? undefined : (status.plan as PaidPlan);

  return (
    <section className="max-w-2xl space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="text-base font-semibold text-[var(--color-text-strong)]">Billing</h2>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status.hasSubscription && status.cancelAtPeriodEnd && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Your subscription is set to cancel at the end of the current billing period.
        </p>
      )}

      <PlanPicker
        onSelectPlan={handleSelectPlan}
        currentPlan={status.hasSubscription ? currentPaidPlan : undefined}
        loadingPlan={loadingPlan}
      />

      {status.hasSubscription && !status.cancelAtPeriodEnd && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={canceling}
          className="text-sm font-medium text-[var(--color-danger-text)] hover:underline disabled:opacity-60"
        >
          {canceling ? "Cancelling…" : "Cancel subscription"}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Render it from the Settings page**

In `src/app/dashboard/settings/page.tsx`, add the import at the top alongside the other component imports:

```ts
import { BillingSection } from "./_components/BillingSection";
```

Then in the `return` statement, render it right after `<PageHeader>` and before the `{companyForm && (...)}` form block, so it's visible regardless of whether the company profile has loaded — billing isn't dependent on company-profile data:

```tsx
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your company and invoice details"
      />

      <div className="mb-8">
        <BillingSection />
      </div>

      {companyForm && (
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npx eslint src/app/dashboard/settings`
Expected: both silent/clean.

- [ ] **Step 4: Update the Settings feature's docs**

In `src/app/dashboard/settings/CLAUDE.md`, find the sentence "This feature has **no private `_components`**." and replace it:

```markdown
This feature has one private component: `_components/BillingSection.tsx`
(2026-08-29) — fetches `GET /api/billing/status` and renders `PlanPicker`
(`src/components/billing/`, shared with `/trial-expired`). No subscription
yet → picking a plan calls `POST /api/billing/checkout` and redirects to
Stripe. Has a subscription → `PlanPicker`'s `currentPlan` is set, so picking
a *different* plan calls `POST /api/billing/change-plan` instead
(`PlanPicker` itself doesn't know which — its caller decides), plus a
"Cancel subscription" action (`POST /api/billing/cancel`, sets
`cancel_at_period_end` rather than cancelling immediately). Rendered above
the Company Profile form, not merged into it — billing is a separate
concern with its own loading state, independent of whether
`companyProfile.profile` has loaded.
```

In `src/app/dashboard/settings/SKILL.md`, add a new entry to "Minimal file set for common changes":

```markdown
- **Change billing behavior (plans, checkout, cancellation)**: this
  feature's `_components/BillingSection.tsx` is presentation only — the
  actual logic lives in `src/app/api/billing/*` (routes) and
  `src/components/billing/PlanPicker.tsx` (shared with `/trial-expired`).
  Changing what a plan costs or includes is `src/lib/utils/pricing.ts` +
  `src/lib/utils/planGating.ts`, not this folder.
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/dashboard/settings/_components/BillingSection.tsx" \
        src/app/dashboard/settings/page.tsx \
        src/app/dashboard/settings/CLAUDE.md src/app/dashboard/settings/SKILL.md
git commit -m "feat(billing): Settings Billing section — subscribe, switch plans, cancel

New _components/BillingSection.tsx, rendered above the existing Company
Profile form (separate concern, independent loading state). No subscription
yet routes PlanPicker's selection through checkout; an existing subscription
routes it through change-plan instead — PlanPicker itself is agnostic to
which, its caller decides via the currentPlan prop."
```

---

## Final wiring check

No new code — verifies the full flow compiles and records the manual steps, mirroring the earlier self-serve-signup plan's own final task.

- [ ] **Step 1: Full verification**

Run: `npx jest && npx tsc --noEmit && npx eslint src && npx next build`
Expected: all clean. `next build` catches anything the individual task-level `tsc`/`eslint` runs above wouldn't (e.g. a route collision, though none is expected here since every route in this plan is brand-new).

- [ ] **Step 2: Update AGENTS.md's stale Stripe notes**

`AGENTS.md`'s intro currently ends with "Stripe is also outstanding." Once this plan lands, that's no longer true. Replace it with:

```markdown
Stripe billing (2026-08-29) is wired end-to-end — self-serve checkout,
plan changes, and cancellation, with the webhook as the sole writer of
`plan`/`status`. See `src/app/api/billing/` and
`docs/superpowers/specs/2026-08-29-stripe-billing-design.md`.
```

In the same file's "New shared code from the migration" list, find:

```markdown
- `src/lib/stripe.ts` + `src/lib/utils/planGating.ts` — billing helpers
```

and:

```markdown
- `src/app/api/billing/` — Stripe checkout + webhook routes
```

Replace both with:

```markdown
- `src/lib/stripe.ts` (Stripe client + `PLANS` price-ID map) +
  `src/lib/utils/planGating.ts` (feature gates) +
  `src/lib/utils/pricing.ts` (the three paid plans' prices/copy, feature
  ticks derived from `planGating.ts`) — billing helpers
- `src/app/api/billing/` — checkout, change-plan, cancel, status, and
  webhook routes. The webhook is the only writer of `control.tenants.plan`/
  `status`; the other four only talk to Stripe.
- `src/components/billing/PlanPicker.tsx` — shared plan-picker cards, used
  by `/trial-expired` and Settings' Billing section
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: Stripe billing is no longer outstanding"
```

- [ ] **Step 4: Hand the manual steps to the user**

These cannot be done from the repo. Present them as a checklist:

1. **Run `npm run stripe:setup`** locally (test mode) and paste the printed
   price IDs into `.env.local` as `STRIPE_PRICE_STARTER`/`_PRO`/`_BUSINESS`.
2. **Stripe Dashboard → Developers → Webhooks**: add an endpoint for
   `https://app.boughtopia.com/api/billing/webhook` once ready for
   production, subscribed to `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy
   its signing secret into the production `STRIPE_WEBHOOK_SECRET`.
3. **Repeat step 1 in live mode** when ready to accept real payments —
   test-mode and live-mode price IDs are different values.
4. **Confirm `NEXT_PUBLIC_APP_URL`** is set to `https://app.boughtopia.com`
   in production (used by `checkout/route.ts`'s success/cancel URLs) — this
   is a separate env var from `NEXT_PUBLIC_SITE_URL` used elsewhere;
   consolidating them into one is a deliberate non-goal of this plan.
5. **End-to-end smoke test** in Stripe test mode: run
   `stripe listen --forward-to localhost:3000/api/billing/webhook` (Stripe
   CLI) for a local webhook secret, then walk through checkout with the
   test card `4242 4242 4242 4242` from `/trial-expired`, confirm
   `control.tenants.plan`/`status` update, then switch plans and cancel
   from Settings and confirm both take effect.

---

## Notes for the executor

- **Task order matters.** Task 1 (pricing relocation) must land before
  Task 6 (`PlanPicker`) can import `pricedPlans()` from its new location.
  Task 2 (`stripe.ts`) must land before Tasks 3-4 (the routes that import
  `PLANS`). Tasks 3-5 (the four routes + webhook) are independent of each
  other and of Task 6, but all must precede Tasks 7-8 (the two UI
  integrations that call them).
- If a step's expected output doesn't match what you see, stop and report
  it rather than adapting — the subscription-metadata fix (Task 3) and the
  webhook's status-mapping refinement (Task 5) both encode non-obvious
  Stripe behavior where "simplifying" the code back to what looks more
  obvious silently reintroduces the bugs this plan fixes.
