# Stripe Billing Integration — Design

## Goal

Turn the existing (partially-scaffolded, non-functional) Stripe code into a
working self-serve billing system for the three paid plans — Starter (€20),
Pro (€30), Business (€50), monthly only — with two entry points: a first-time
subscribe flow (trial-expired page, and Settings for someone who wants to pay
before their trial ends), and an in-app plan-switch/cancel flow for someone
who already has a subscription.

## Context: what already exists

`src/lib/stripe.ts`, `src/app/api/billing/{checkout,webhook}/route.ts`, and
`control.tenants.stripe_customer_id`/`stripe_subscription_id` columns
(`supabase/control-plane/001_schema.sql`) already exist from an earlier
scaffolding pass. They are not wired to anything and have real bugs (see
Decisions). This design fixes and completes that scaffold rather than
starting over.

## Decisions

| Question | Decision |
|---|---|
| Checkout entry points | `/trial-expired` (first-time subscribe, replaces "contact us") and `/dashboard/settings` (a new Billing section — subscribe before trial ends, or manage an existing subscription). **Not** the public pricing page — that stays trial-first, no card, per the self-serve signup design. |
| Plan changes for an existing subscriber | Custom in-app flow (`POST /api/billing/change-plan`), not Stripe's Billing Portal. Uses `stripe.subscriptions.update()` with Stripe's default proration (difference lands on the next invoice, not charged immediately). |
| Cancellation | Included: `POST /api/billing/cancel` sets `cancel_at_period_end: true` (access continues through the paid period) rather than canceling immediately. |
| Payment-failure handling | Drop the scaffold's `invoice.payment_failed` handler (reacts to the *first* failed attempt, before Stripe's own retry schedule runs). `customer.subscription.updated` — which fires whenever Stripe's own subscription `status` changes — is the sole trigger for deactivation. |
| Price ID storage | Env vars (`STRIPE_PRICE_STARTER`/`_PRO`/`_BUSINESS`), not hardcoded literals in `stripe.ts`. Test-mode and live-mode price IDs are different values in Stripe; hardcoding would force a code change on every mode switch. Annual price IDs are dropped entirely — monthly only, matching the pricing page. |
| Existing manually-managed tenants (`tenant_kaufnest` on Business, 3 others on Pro) | Left alone. No Stripe customer is created for them; they stay editable via `/admin`'s existing plan dropdown. Stripe only applies going forward — new trial-to-paid conversions, or anyone who proactively starts a subscription through the new billing UI. |
| Webhook as source of truth | Unchanged from `AGENTS.md`'s existing rule: `control.tenants.plan`/`status` are written only by the webhook, never directly by the new checkout/change-plan/cancel routes (those only talk to Stripe; the webhook reacts to what Stripe reports back). `/admin`'s manual override is a separate, pre-existing "break glass" tool for platform staff and is out of scope for this change. |

## Architecture

### Routes

- **`POST /api/billing/checkout`** (existing, two fixes) — for a tenant with no active Stripe subscription. Body: `{ plan: "starter" | "pro" | "business" }` (not a raw `priceId` — the client shouldn't be able to hand Stripe an arbitrary price string; the server looks up the real price ID from `PLANS[plan]`). Creates/reuses a Stripe customer, creates a Checkout Session with **`subscription_data: { metadata: { tenant_id, plan } }`** (the actual fix — today's scaffold sets metadata only on the *session*, which does not propagate to the resulting *subscription*, so the webhook's `sub.metadata?.plan` read is always empty and every new subscription silently defaults to `"starter"`). Returns `{ url: string }`; the caller redirects the browser there. Rejects with 409 if the tenant already has an active subscription (`stripe_subscription_id IS NOT NULL AND control.tenants.status = 'active'`) — points them at Settings to change plan instead.
- **`POST /api/billing/change-plan`** (new) — for a tenant with an active subscription. Body: `{ plan: "starter" | "pro" | "business" }`. Retrieves the subscription, updates its single item to the new price with Stripe's default proration, and sets `metadata: { plan }` on the same update call (so the resulting `customer.subscription.updated` event carries the new plan correctly). Returns `{ ok: true }`.
- **`POST /api/billing/cancel`** (new) — no body. Sets `cancel_at_period_end: true` on the tenant's subscription. Returns `{ ok: true, cancelAtPeriodEnd: true }`.
- **`GET /api/billing/status`** (new) — returns `{ plan: TenantPlan, hasSubscription: boolean, cancelAtPeriodEnd: boolean }` for the calling user's tenant. Exists because the client can't query `control.tenants` directly (`createControlClient` is server-only); this is the minimal read the Settings UI needs.
- **`POST /api/billing/webhook`** (existing, refined) — stays the only writer of `plan`/`status`. Handles:
  - `customer.subscription.created` / `customer.subscription.updated`: always updates `stripe_subscription_id` and `plan` (from `sub.metadata.plan`, unchanged from the scaffold's read — now actually populated thanks to the checkout/change-plan fixes above). **Status is only touched when `sub.status` is unambiguous**: `"active"` → `status: "active"`; `"past_due" | "unpaid" | "canceled" | "incomplete_expired" | "paused"` → `status: "deactivated"`; `"incomplete" | "trialing"` → status is left untouched (a brand-new subscription whose payment hasn't cleared yet shouldn't prematurely deactivate a tenant that wasn't deactivated a moment ago). This app never sets `trial_period_days` on a Stripe subscription — Boughtopia's own 14-day trial is unrelated to Stripe's "trialing" subscription status — so in practice `trialing` should never occur here, but the mapping stays defensive rather than assuming.
  - `customer.subscription.deleted`: `status: "deactivated"` (unchanged — the subscription is genuinely gone).
  - `invoice.payment_failed` is removed (see Decisions).

### New shared component: `PlanPicker`

`src/components/billing/PlanPicker.tsx` (Client Component) — renders the
three plan cards from `pricedPlans()` with a "Subscribe"/"Switch to this
plan" button per card, taking an `onSelectPlan(plan: PaidPlan)` callback and
an optional `currentPlan` prop (greys out / relabels that card "Current
plan" instead of showing a button). Used by both `/trial-expired` and the
new Settings Billing section — this is a first-class shared component, not
a feature-private one, since two independent route trees need it.

**Necessary refactor this surfaces:** `pricedPlans()` currently lives in
`src/app/(marketing)/_lib/pricing.ts` — feature-private, by this project's
own convention, to the marketing route group. With `PlanPicker` as a third
consumer, it crosses this project's "shared once 3+ things use it"
threshold. Moves to `src/lib/utils/pricing.ts` (same derivation-from-
`PLAN_LIMITS` logic and its colocated test, no behavior change) and the
marketing `Pricing.tsx`'s import path updates accordingly.

### UI changes

- **`/trial-expired`** (`src/app/trial-expired/page.tsx`) — replaces the
  static "Contact Boughtopia to pick a plan" paragraph with
  `<PlanPicker onSelectPlan={...} />`; selecting a plan calls `POST
  /api/billing/checkout` and redirects to the returned Stripe URL. Becomes
  a Client Component (it wasn't one before) to handle the button click and
  redirect.
- **Settings** (`src/app/dashboard/settings/`) — new
  `_components/BillingSection.tsx` (Client Component), rendered by
  `page.tsx` alongside (not merged into) the existing Company Profile form.
  Fetches `GET /api/billing/status` on mount. No subscription yet → same
  `PlanPicker` → checkout. Has a subscription → shows the current plan,
  `PlanPicker` again but with `currentPlan` set (so switching plans calls
  `POST /api/billing/change-plan` instead of checkout — `PlanPicker`'s
  `onSelectPlan` callback is wired differently by each caller, the
  component itself doesn't know which route it's driving), plus a "Cancel
  subscription" action if not already `cancelAtPeriodEnd`.

## Data model

No new migration. `control.tenants.stripe_customer_id` and
`stripe_subscription_id` already exist (`supabase/control-plane/001_schema.sql`).

## `stripe.ts` changes

```ts
export const PLANS: Record<PaidPlan, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  pro: process.env.STRIPE_PRICE_PRO!,
  business: process.env.STRIPE_PRICE_BUSINESS!,
};
```

`PaidPlan` (a `TenantPlan` excluding `"trial"`) is already defined in
`src/lib/utils/pricing.ts` per the relocation above — `stripe.ts` imports
it rather than redefining it. The `annual` key and its placeholder price
IDs are removed entirely.

## Error handling

| Case | Behavior |
|---|---|
| Checkout called with an unknown `plan` value | 400, generic error — never reaches Stripe |
| Checkout called by a tenant with an active subscription already | 409, "Already subscribed — manage your plan from Settings" |
| Change-plan/cancel called by a tenant with no subscription | 400, generic error |
| Stripe API call throws (any route) | 500, generic error to the client; full detail `console.error`'d server-side only — matches this project's verifier rule (no raw provider errors returned to clients) |
| Webhook signature invalid | 400, `{ error: "Invalid signature" }` (unchanged from scaffold — correct) |
| Webhook event for a `stripe_customer_id` with no matching tenant row | Logged, 200 returned to Stripe regardless (returning non-200 makes Stripe retry indefinitely; a customer with no tenant row is not a transient failure) |

## Testing approach

Route handlers stay untested per this codebase's existing convention (no
unit tests for `/api/*` routes — see `src/app/api/admin/provision-tenant`
and `/api/signup/provision`, neither has a test file). `PlanPicker` is
presentation-only (same convention as the marketing page's components) —
no test file expected. The pricing.ts relocation carries its existing test
file unchanged (same assertions, new path).

Real verification is manual, in Stripe test mode:
1. Run `stripe listen --forward-to localhost:3000/api/billing/webhook`
   (Stripe CLI) to get a local webhook signing secret for
   `STRIPE_WEBHOOK_SECRET`.
2. Sign up (or use an existing trial tenant), let the trial-expired page's
   `PlanPicker` drive a real Checkout Session in test mode (Stripe's test
   card `4242 4242 4242 4242`), confirm `control.tenants.plan`/`status`
   update correctly after the webhook fires.
3. From Settings, switch plans and confirm the subscription's price and
   `control.tenants.plan` both update.
4. Cancel and confirm `cancel_at_period_end` is reflected in
   `GET /api/billing/status`, and that access doesn't drop immediately.

## Manual steps (cannot be done from the repo)

1. Run `npm run stripe:setup` locally (new script, see below) to create
   the three Products + monthly EUR Prices in test mode, and paste the
   printed price IDs into `.env.local` as `STRIPE_PRICE_STARTER`/`_PRO`/
   `_BUSINESS`.
2. Stripe Dashboard → Developers → Webhooks: add an endpoint for
   `https://app.boughtopia.com/api/billing/webhook` (production) once
   ready to go live, subscribed to `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy
   its signing secret into the production `STRIPE_WEBHOOK_SECRET`.
3. Repeat step 1's Product/Price creation in **live mode** when ready to
   accept real payments — test-mode and live-mode price IDs are different
   values, so this is not a one-time step.
4. Confirm `NEXT_PUBLIC_APP_URL` (used by `checkout/route.ts`'s
   success/cancel URLs) is set to `https://app.boughtopia.com` in
   production — this is a second, differently-named site-URL env var from
   `NEXT_PUBLIC_SITE_URL` (used elsewhere, e.g. email confirmation links);
   confirming both point at the same real domain is a manual config check,
   not a code change, since consolidating them into one var is a separate,
   unrelated cleanup this design doesn't take on.

## `scripts/stripe-setup.mjs`

Following this project's existing script convention
(`scrape:aliexpress`, `create-tenant-user` — plain `.mjs`, run via
`node --env-file=.env.local`, no new dependency). Creates three Stripe
Products (Starter/Pro/Business) each with one recurring monthly EUR Price
(€20/€30/€50) via the Stripe SDK, using the already-configured
`STRIPE_SECRET_KEY`, and prints the three resulting price IDs to the
console for manual pasting into `.env.local`. Idempotency is not handled —
running it twice creates duplicate Products; the script's own output
tells the user to run it once per Stripe mode (test/live) and warns
against re-running carelessly.

## File structure

| File | Change |
|---|---|
| `src/lib/stripe.ts` | Modify — env-var price IDs, drop `annual` |
| `src/lib/utils/pricing.ts` (+ `.test.ts`) | Create (moved from `src/app/(marketing)/_lib/pricing.ts`) |
| `src/app/(marketing)/_components/Pricing.tsx` | Modify — import path only |
| `src/app/api/billing/checkout/route.ts` | Modify — `plan` body, subscription metadata fix, 409 guard |
| `src/app/api/billing/change-plan/route.ts` | Create |
| `src/app/api/billing/cancel/route.ts` | Create |
| `src/app/api/billing/status/route.ts` | Create |
| `src/app/api/billing/webhook/route.ts` | Modify — status-mapping refinement, drop `invoice.payment_failed` |
| `src/components/billing/PlanPicker.tsx` | Create |
| `src/app/trial-expired/page.tsx` | Modify — real `PlanPicker`, becomes a Client Component |
| `src/app/dashboard/settings/_components/BillingSection.tsx` | Create |
| `src/app/dashboard/settings/page.tsx` | Modify — render `BillingSection` |
| `scripts/stripe-setup.mjs` | Create |
| `package.json` | Modify — `stripe:setup` script entry |
| `.env.local.example` | Modify — new `STRIPE_PRICE_*` vars, drop nothing (existing `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` stay) |
| `src/app/dashboard/settings/CLAUDE.md`, `SKILL.md` | Modify — document the Billing section |
| `src/app/trial-expired/*` docs (if any exist outside `dashboard/CLAUDE.md`'s existing note) | Modify as needed |
| `supabase/CLAUDE.md` or relevant docs | Modify — note the webhook's refined status mapping if documented elsewhere |

## Out of scope

- Annual billing (monthly only, matching the pricing page).
- Stripe's Billing Portal (custom in-app flow chosen instead).
- Migrating the 4 existing manually-managed tenants onto real Stripe subscriptions.
- Usage-based billing, add-ons, or seat-based pricing beyond the existing flat per-plan price.
- Consolidating `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL` into one variable.
- Enforcing the per-plan user caps this session's earlier work flagged as advertised-but-unenforced (`canAddUser` has no caller) — orthogonal to billing itself.
