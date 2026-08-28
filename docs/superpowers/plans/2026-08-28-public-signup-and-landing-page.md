# Public Landing Page + Self-Serve Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Boughtopia a public marketing page at `/` and a self-serve signup flow that lets a visitor create their own tenant and start a 14-day full-featured trial without any platform admin involvement.

**Architecture:** Signup creates only an unconfirmed Supabase auth user (company name in `user_metadata`); the expensive, globally-risky tenant provisioning runs **after** email confirmation, from an authenticated API route. Trial expiry is enforced in `proxy.ts` using the tenant row it already fetches. The marketing page derives its pricing table's feature marks from `PLAN_LIMITS` so it can never advertise a gated-off capability.

**Tech Stack:** Next.js App Router (this version uses `src/proxy.ts`, **not** `middleware.ts`), TypeScript, Tailwind CSS v4, Supabase (two projects: control plane + data plane), Jest.

**Spec:** `docs/superpowers/specs/2026-08-28-public-signup-and-landing-page-design.md`

## Global Constraints

- **Branch:** `feat/public-signup-and-landing`. Never commit to `main`.
- **Pricing (exact):** Starter €20/mo (3 users), Pro €30/mo (5 users), Business €50/mo (unlimited users). Monthly only — no annual.
- **Trial:** 14 days, no credit card, unlocks everything (mirrors Business). At expiry: lock out, data preserved.
- **Language:** English. No i18n.
- **Out of scope — do not build:** Stripe/checkout/price IDs, annual pricing, German translation, a job runner.
- **Never query `public.*`**; never hardcode a tenant schema name — read it from `user.app_metadata.tenant_schema`.
- **`createControlClient` is server-only** — never import it into a Client Component.
- **Do NOT create `src/middleware.ts`** — this Next.js version uses `src/proxy.ts`; having both crashes the dev server. The project verifier blocks this.
- **Per-feature docs are mandatory** (`AGENTS.md`): every task that adds/renames a file or a gotcha updates the relevant `CLAUDE.md`/`SKILL.md` **in the same commit**.
- **Do not run `npm test` / `tsc` / `lint` yourself mid-task** unless a step says to — ask the user to run it and paste output. Do not start a dev server or `curl` routes.
- Husky hooks run `tsc --noEmit` + `eslint` + verifier on commit, and `jest` + `next build` on push.

---

### Task 1: Trial plan limits + expiry predicate

Pure logic only. Makes a full-featured trial safe to give away by first making expiry computable.

**Files:**
- Create: `src/lib/utils/trial.ts`
- Create: `src/lib/utils/trial.test.ts`
- Modify: `src/lib/utils/planGating.ts`
- Modify: `src/lib/utils/planGating.test.ts`

**Interfaces:**
- Consumes: `TenantPlan` from `@/types` (`"trial" | "starter" | "pro" | "business"`).
- Produces: `isTrialExpired(plan: TenantPlan, trialEndsAt: string | null, now?: Date): boolean` — used by Task 2's proxy change.

- [ ] **Step 1: Write the failing test for `isTrialExpired`**

Create `src/lib/utils/trial.test.ts`:

```ts
import { isTrialExpired } from "./trial";

describe("isTrialExpired", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");

  it("is false for a non-trial plan even with a past trial_ends_at", () => {
    expect(isTrialExpired("pro", "2020-01-01T00:00:00.000Z", now)).toBe(false);
    expect(isTrialExpired("business", "2020-01-01T00:00:00.000Z", now)).toBe(false);
    expect(isTrialExpired("starter", "2020-01-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is false for a trial that has not reached its end date", () => {
    expect(isTrialExpired("trial", "2026-09-11T12:00:00.000Z", now)).toBe(false);
  });

  it("is true for a trial whose end date has passed", () => {
    expect(isTrialExpired("trial", "2026-08-27T12:00:00.000Z", now)).toBe(true);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isTrialExpired("trial", "2026-08-28T12:00:00.000Z", now)).toBe(true);
  });

  // Fail-open, matching proxy.ts's existing posture: a missing date must not
  // lock a paying-in-progress tenant out of their own dashboard.
  it("is false when trial_ends_at is null", () => {
    expect(isTrialExpired("trial", null, now)).toBe(false);
  });

  it("is false when trial_ends_at is unparseable", () => {
    expect(isTrialExpired("trial", "not-a-date", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Ask the user to run:
```bash
npx jest src/lib/utils/trial.test.ts
```
Expected: FAIL — `Cannot find module './trial'`.

- [ ] **Step 3: Implement `isTrialExpired`**

Create `src/lib/utils/trial.ts`:

```ts
import type { TenantPlan } from "@/types";

/**
 * True when a tenant is on the trial plan and its trial window has closed.
 *
 * Fail-open on missing/garbage dates: `proxy.ts` already treats an
 * unreachable control plane as "let them through", and locking a tenant out
 * of their own data because a timestamp failed to parse is a far worse
 * outcome than a trial running slightly long.
 */
export function isTrialExpired(
  plan: TenantPlan,
  trialEndsAt: string | null,
  now: Date = new Date()
): boolean {
  if (plan !== "trial") return false;
  if (!trialEndsAt) return false;

  const endsAt = new Date(trialEndsAt).getTime();
  if (Number.isNaN(endsAt)) return false;

  return endsAt <= now.getTime();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Ask the user to run:
```bash
npx jest src/lib/utils/trial.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Update `PLAN_LIMITS`**

In `src/lib/utils/planGating.ts`, replace the `trial` and `starter` lines of `PLAN_LIMITS` (leave `pro` and `business` untouched):

```ts
const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  // Trial mirrors business: the product is sold as multi-platform
  // bookkeeping, so a trial that cannot connect eBay/Amazon cannot
  // demonstrate the product. Safe only because proxy.ts enforces
  // trial_ends_at — see isTrialExpired in lib/utils/trial.ts.
  trial:    { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  messagingAndListings: true  },
  starter:  { maxUsers: 3,        platformIntegrations: false, aiFeatures: false, messagingAndListings: false },
  pro:      { maxUsers: 5,        platformIntegrations: true,  aiFeatures: false, messagingAndListings: false },
  business: { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  messagingAndListings: true  },
};
```

- [ ] **Step 6: Update the existing planGating test**

`src/lib/utils/planGating.test.ts` currently asserts `hasMessagingAndListings("trial")` is `false`, which is now wrong. Replace the whole file:

```ts
import { hasMessagingAndListings, hasPlatformIntegrations, canAddUser } from "./planGating";

describe("hasMessagingAndListings", () => {
  it("is true for business and for trial (trial mirrors business)", () => {
    expect(hasMessagingAndListings("business")).toBe(true);
    expect(hasMessagingAndListings("trial")).toBe(true);
  });

  it("is false for pro and starter", () => {
    expect(hasMessagingAndListings("pro")).toBe(false);
    expect(hasMessagingAndListings("starter")).toBe(false);
  });
});

describe("hasPlatformIntegrations", () => {
  it("is true for trial, pro and business", () => {
    expect(hasPlatformIntegrations("trial")).toBe(true);
    expect(hasPlatformIntegrations("pro")).toBe(true);
    expect(hasPlatformIntegrations("business")).toBe(true);
  });

  it("is false for starter", () => {
    expect(hasPlatformIntegrations("starter")).toBe(false);
  });
});

describe("canAddUser", () => {
  it("caps starter at 3 users", () => {
    expect(canAddUser("starter", 2)).toBe(true);
    expect(canAddUser("starter", 3)).toBe(false);
  });

  it("caps pro at 5 users", () => {
    expect(canAddUser("pro", 4)).toBe(true);
    expect(canAddUser("pro", 5)).toBe(false);
  });

  it("never caps business or trial", () => {
    expect(canAddUser("business", 9999)).toBe(true);
    expect(canAddUser("trial", 9999)).toBe(true);
  });
});
```

- [ ] **Step 7: Run the full suite**

Ask the user to run:
```bash
npx jest
```
Expected: PASS. Existing suite is 813 tests; this task adds 12 and rewrites 1, so expect ~824 passing, 0 failing. **If any other suite fails, stop** — something else depended on trial being feature-less.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/trial.ts src/lib/utils/trial.test.ts \
        src/lib/utils/planGating.ts src/lib/utils/planGating.test.ts
git commit -m "feat(plans): trial mirrors business, add isTrialExpired predicate

Trial previously unlocked nothing — no integrations, listings or messages —
so a trial user could not use the multi-platform features the product is
sold on. Trial now mirrors Business.

That is only safe because expiry becomes enforceable: isTrialExpired is the
pure predicate proxy.ts will use to lock out expired trials. It fails open on
a null or unparseable trial_ends_at, matching proxy.ts's existing posture of
letting users through when the control plane can't answer.

Starter moves from 1 to 3 users — it is being sold as a multi-user plan."
```

---

### Task 2: Trial lockout page + proxy enforcement

Makes Task 1's predicate actually bite.

**Files:**
- Create: `src/app/trial-expired/page.tsx`
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: `isTrialExpired(plan, trialEndsAt, now?)` from `@/lib/utils/trial`.
- Produces: the `/trial-expired` route, linked to later by Task 11's pricing section.

- [ ] **Step 1: Create the lockout page**

Create `src/app/trial-expired/page.tsx`. This deliberately mirrors `src/app/account-deactivated/page.tsx` — same shell, same tokens — because that page is the proven lockout pattern in this codebase:

```tsx
import Link from "next/link";

export default function TrialExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4">
      <div className="w-full max-w-md bg-(--color-surface) border border-(--color-border) rounded-[var(--radius-card)] p-8 text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Your free trial has ended
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your 14-day Boughtopia trial is over. All of your data is safe and
          will be exactly as you left it as soon as you choose a plan.
        </p>
        <p className="mt-4 text-sm text-(--color-text-muted)">
          Contact Boughtopia to pick a plan and get straight back in.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-(--color-primary) hover:underline"
        >
          View plans &amp; pricing →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Extend the proxy's tenant query**

In `src/proxy.ts`, inside the `if (user && isDashboardRoute)` block, replace the existing tenant lookup and deactivation check. It currently reads:

```ts
    const { data: tenantRow } = await control
      .schema("control")
      .from("tenants")
      .select("status")
      .eq("schema_name", tenantSchema)
      .single<{ status: string }>();

    // Fail-open: if control plane is unreachable or tenant row missing,
    // tenantRow is null and the check passes — user proceeds to RBAC.
    if (tenantRow?.status === "deactivated") {
      const url = request.nextUrl.clone();
      url.pathname = "/account-deactivated";
      return NextResponse.redirect(url);
    }
```

Replace with:

```ts
    const { data: tenantRow } = await control
      .schema("control")
      .from("tenants")
      .select("status, plan, trial_ends_at")
      .eq("schema_name", tenantSchema)
      .single<{ status: string; plan: TenantPlan; trial_ends_at: string | null }>();

    // Fail-open: if control plane is unreachable or tenant row missing,
    // tenantRow is null and the check passes — user proceeds to RBAC.
    if (tenantRow?.status === "deactivated") {
      const url = request.nextUrl.clone();
      url.pathname = "/account-deactivated";
      return NextResponse.redirect(url);
    }

    // Expired trial — same lockout shape as deactivation. Reuses the row
    // already fetched above, so this costs no extra round-trip.
    if (tenantRow && isTrialExpired(tenantRow.plan, tenantRow.trial_ends_at)) {
      const url = request.nextUrl.clone();
      url.pathname = "/trial-expired";
      return NextResponse.redirect(url);
    }
```

- [ ] **Step 3: Add the imports**

At the top of `src/proxy.ts`, the existing type import line is:

```ts
import type { UserRole } from "@/types";
```

Replace it with, and add the `isTrialExpired` import beneath the existing `createControlClient` import:

```ts
import { isTrialExpired } from "@/lib/utils/trial";
import type { UserRole, TenantPlan } from "@/types";
```

- [ ] **Step 4: Verify `/trial-expired` is NOT in the proxy matcher**

Read the bottom of `src/proxy.ts` and confirm the matcher is unchanged:

```ts
export const config = {
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/login"],
};
```

`/trial-expired` must **not** appear here. If it did, the proxy would run on the lockout page, re-detect the expired trial, and redirect to itself forever. This is the same reason `/account-deactivated` is absent. **Do not add it.**

- [ ] **Step 5: Add the gotcha to the docs**

In `src/app/dashboard/CLAUDE.md`, find the "Cross-cutting state & infra" section and append this paragraph at the end of it:

```markdown
**Trial expiry (2026-08-28):** `src/proxy.ts` locks out expired trials by
reusing the same `control.tenants` row it already fetches for the
deactivation check — the `select` carries `status, plan, trial_ends_at` and
feeds `isTrialExpired` (`lib/utils/trial.ts`). Expired trials land on
`/trial-expired`. That page, like `/account-deactivated`, **must stay out of
`proxy.ts`'s matcher** or it redirects to itself forever. Tenant data is
never touched at expiry; restoring access is a plan change in `/admin`.
```

- [ ] **Step 6: Run the suite**

Ask the user to run:
```bash
npx jest && npx tsc --noEmit
```
Expected: tests PASS, tsc silent. `tsc` is the real check here — it catches a mistyped `select` result shape.

- [ ] **Step 7: Commit**

```bash
git add src/app/trial-expired/page.tsx src/proxy.ts src/app/dashboard/CLAUDE.md
git commit -m "feat(trial): lock out expired trials at the proxy

trial_ends_at has been written at provision time since the SaaS migration but
never read by anything. With trials now unlocking the full product, an
unenforced expiry means free Business forever for anyone with an email.

The check reuses the control.tenants row proxy.ts already fetches for the
deactivation check, so it adds no round-trip. /trial-expired mirrors
/account-deactivated and is deliberately outside the proxy matcher — adding
it there would make it redirect to itself."
```

---

### Task 3: Shared tenant-slug helper

Self-serve and admin provisioning must produce byte-identical schema names, so the sanitiser becomes one shared, tested unit instead of two drifting copies.

**Files:**
- Create: `src/lib/utils/tenantSlug.ts`
- Create: `src/lib/utils/tenantSlug.test.ts`
- Modify: `src/app/api/admin/provision-tenant/route.ts`

**Interfaces:**
- Produces, all used by Task 7's provisioning route:
  - `sanitizeSlug(input: string): string`
  - `slugForCompany(companyName: string, email: string): string`
  - `schemaNameFor(slug: string): string`
  - `nextAvailableSlug(base: string, taken: readonly string[]): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/utils/tenantSlug.test.ts`:

```ts
import {
  sanitizeSlug,
  slugForCompany,
  schemaNameFor,
  nextAvailableSlug,
} from "./tenantSlug";

describe("sanitizeSlug", () => {
  // Locked to the exact behaviour /api/admin/provision-tenant has always had:
  // strip anything outside [a-z0-9-], THEN turn hyphens into underscores.
  // Spaces are removed, not replaced — "Acme GmbH" is one word afterwards.
  it("lowercases and strips characters outside [a-z0-9-]", () => {
    expect(sanitizeSlug("Acme GmbH")).toBe("acmegmbh");
    expect(sanitizeSlug("Müller & Sohn!")).toBe("mllersohn");
  });

  it("converts hyphens to underscores", () => {
    expect(sanitizeSlug("k2-textil")).toBe("k2_textil");
  });

  it("truncates to 40 characters", () => {
    expect(sanitizeSlug("a".repeat(60))).toHaveLength(40);
  });

  it("returns an empty string when nothing survives", () => {
    expect(sanitizeSlug("株式会社")).toBe("");
  });
});

describe("slugForCompany", () => {
  it("uses the company name when it sanitises to something usable", () => {
    expect(slugForCompany("Acme GmbH", "owner@acme.de")).toBe("acmegmbh");
  });

  // Without this, "株式会社" produces the schema `tenant_` — which passes
  // provision_tenant_schema's `LIKE 'tenant_%'` check and creates a real,
  // wrongly-named schema that every later signup would collide with.
  it("falls back to the email local part when the company name is unusable", () => {
    expect(slugForCompany("株式会社", "owner@acme.de")).toBe("owner");
  });

  it("falls back to a constant when both are unusable", () => {
    expect(slugForCompany("株式会社", "!!!@example.com")).toBe("tenant");
  });

  it("never returns an empty string", () => {
    expect(slugForCompany("", "")).not.toBe("");
  });
});

describe("schemaNameFor", () => {
  it("prefixes the slug", () => {
    expect(schemaNameFor("acme")).toBe("tenant_acme");
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when it is free", () => {
    expect(nextAvailableSlug("acme", ["other"])).toBe("acme");
  });

  it("suffixes _2 on the first collision", () => {
    expect(nextAvailableSlug("acme", ["acme"])).toBe("acme_2");
  });

  it("keeps counting past consecutive collisions", () => {
    expect(nextAvailableSlug("acme", ["acme", "acme_2", "acme_3"])).toBe("acme_4");
  });

  it("throws rather than looping forever", () => {
    const taken = ["acme", ...Array.from({ length: 100 }, (_, i) => `acme_${i + 2}`)];
    expect(() => nextAvailableSlug("acme", taken)).toThrow(/no available slug/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Ask the user to run:
```bash
npx jest src/lib/utils/tenantSlug.test.ts
```
Expected: FAIL — `Cannot find module './tenantSlug'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/utils/tenantSlug.ts`:

```ts
const MAX_SLUG_LENGTH = 40;
const MAX_COLLISION_ATTEMPTS = 100;

/**
 * The exact sanitisation /api/admin/provision-tenant has always applied.
 * Extracted so self-serve signup and admin provisioning cannot drift into
 * producing different schema names for the same company name.
 *
 * Note the order: characters outside [a-z0-9-] are stripped FIRST, so spaces
 * vanish rather than becoming separators ("Acme GmbH" → "acmegmbh").
 */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-/g, "_")
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * A slug guaranteed to be non-empty.
 *
 * Self-serve signup accepts arbitrary company names from the open internet.
 * A name with no ASCII alphanumerics sanitises to "", which would build the
 * schema name `tenant_` — and that passes provision_tenant_schema's
 * `schema_name LIKE 'tenant_%'` guard, silently creating a real schema with
 * a name every subsequent unusable-name signup would also want. Falls back to
 * the email local part, then to a constant.
 */
export function slugForCompany(companyName: string, email: string): string {
  const fromCompany = sanitizeSlug(companyName);
  if (fromCompany) return fromCompany;

  const fromEmail = sanitizeSlug(email.split("@")[0] ?? "");
  if (fromEmail) return fromEmail;

  return "tenant";
}

export function schemaNameFor(slug: string): string {
  return `tenant_${slug}`;
}

/**
 * First free slug in the `base`, `base_2`, `base_3` … sequence.
 * Bounded so a pathological `taken` list can never hang a request.
 */
export function nextAvailableSlug(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;

  for (let n = 2; n <= MAX_COLLISION_ATTEMPTS; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error(`No available slug for "${base}" after ${MAX_COLLISION_ATTEMPTS} attempts`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Ask the user to run:
```bash
npx jest src/lib/utils/tenantSlug.test.ts
```
Expected: PASS, 13 tests.

- [ ] **Step 5: Point the admin route at the shared helper**

In `src/app/api/admin/provision-tenant/route.ts`, add to the imports:

```ts
import { sanitizeSlug, schemaNameFor } from "@/lib/utils/tenantSlug";
```

Then replace this block:

```ts
  const safeSlug = body.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-/g, "_")
    .slice(0, 40);
  const schemaName = `tenant_${safeSlug}`;
```

with:

```ts
  const safeSlug = sanitizeSlug(body.slug);
  const schemaName = schemaNameFor(safeSlug);
```

Behaviour is identical — the tests in Step 1 pin exactly what this route did. Do **not** switch this route to `slugForCompany`: an admin supplies the slug explicitly and a silent fallback would hide their typo.

- [ ] **Step 6: Run the suite**

Ask the user to run:
```bash
npx jest && npx tsc --noEmit
```
Expected: PASS, tsc silent.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/tenantSlug.ts src/lib/utils/tenantSlug.test.ts \
        src/app/api/admin/provision-tenant/route.ts
git commit -m "refactor(tenants): extract slug sanitisation into a shared helper

Self-serve signup needs the same slug rules the admin provisioning route
applies. Two copies would drift and produce different schema names for the
same company, so this extracts one tested unit and points the admin route at
it — behaviour unchanged, pinned by tests.

Adds slugForCompany for the self-serve path: a company name with no ASCII
alphanumerics sanitises to empty, which would build the schema name
'tenant_' — and that passes provision_tenant_schema's LIKE 'tenant_%' guard,
so it would create a real, wrongly-named schema. Falls back to the email
local part instead."
```

---

### Task 4: Harden `addExposedSchema` against lost updates

Fixes a latent race in the **existing** admin flow, and a prerequisite for letting signups provision.

**Files:**
- Modify: `src/lib/supabase/managementApi.ts`
- Modify: `src/lib/supabase/SKILL.md`

**Interfaces:**
- Produces: `addExposedSchema(schemaName: string): Promise<void>` — unchanged signature, now self-verifying. Used by Task 7.

- [ ] **Step 1: Replace the body of `addExposedSchema`**

In `src/lib/supabase/managementApi.ts`, replace the entire existing `addExposedSchema` function (keep `projectRefFromUrl`, the `PostgrestConfig` interface, and `removeExposedSchema` exactly as they are) with:

```ts
const EXPOSE_MAX_ATTEMPTS = 4;
const POSTGREST_RELOAD_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds `schemaName` to Project B's PostgREST "Exposed schemas" list via the
 * Supabase Management API, so `db.schema`/`.schema()` calls against a newly
 * provisioned tenant schema don't get rejected with 404/406.
 *
 * No-op if the schema is already exposed. Requires `SUPABASE_ACCESS_TOKEN`
 * (a personal access token from supabase.com/dashboard/account/tokens) —
 * server-only.
 *
 * This is a read-modify-write on a SINGLE GLOBAL config string shared by
 * every tenant, so two concurrent provisions can lose one another's update:
 * both read the same list, both append their own schema, and the second PATCH
 * overwrites the first. The loser's schema is silently never exposed and
 * their entire app returns 404/406 with no error logged anywhere.
 *
 * Rather than assume the PATCH stuck, this re-reads the config and retries
 * until it can see its own schema in the list. That converges under
 * concurrency because every attempt re-reads the current value. Self-serve
 * signup (2026-08-28) made concurrent provisions realistic; the same race was
 * always present in admin provisioning, just far less likely to fire.
 */
export async function addExposedSchema(schemaName: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set — required to expose new tenant schemas");
  }

  const ref = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const endpoint = `${MANAGEMENT_API_BASE}/projects/${ref}/postgrest`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  for (let attempt = 1; attempt <= EXPOSE_MAX_ATTEMPTS; attempt++) {
    const getRes = await fetch(endpoint, { headers });
    if (!getRes.ok) {
      throw new Error(`Failed to read PostgREST config: ${getRes.status} ${await getRes.text()}`);
    }
    const config = (await getRes.json()) as PostgrestConfig;
    const schemas = config.db_schema.split(",").map((s) => s.trim());

    // Verified present — either it already was, or our previous attempt's
    // PATCH survived. Safe to return.
    if (schemas.includes(schemaName)) {
      return;
    }

    const patchRes = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ db_schema: [...schemas, schemaName].join(",") }),
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to update PostgREST config: ${patchRes.status} ${await patchRes.text()}`);
    }

    // PostgREST reloads its schema cache asynchronously after a config
    // change. This also gives a racing writer time to settle before we
    // re-read and check whether our entry survived.
    await sleep(POSTGREST_RELOAD_MS);
  }

  throw new Error(
    `Failed to expose schema "${schemaName}" after ${EXPOSE_MAX_ATTEMPTS} attempts — ` +
      `a concurrent provision may be repeatedly overwriting the exposed-schema list`
  );
}
```

- [ ] **Step 2: Document the gotcha**

In `src/lib/supabase/SKILL.md`, add this to its "Gotchas" section (create the section at the end of the file if it has none):

```markdown
- **`addExposedSchema` is a read-modify-write on one global string, and it
  self-verifies for that reason (hardened 2026-08-28).** Project B's PostgREST
  "Exposed schemas" setting is a single comma-separated list shared by every
  tenant. Two concurrent provisions can lose an update — both read, both
  append, the second PATCH wins and the first schema is silently never
  exposed, leaving that tenant's whole app returning 404/406 with nothing in
  any log. The function now re-reads after PATCHing and retries until it sees
  its own schema (4 attempts, 2s apart), which converges because each attempt
  re-reads the current value. **Do not "simplify" this back into a single
  read-then-PATCH.** Note the blast radius that makes this worth the care:
  `removeExposedSchema`'s own docs record that a malformed list makes
  PostgREST fail its schema-cache load (`3F000`) and return `PGRST002` for
  *every* tenant.
```

- [ ] **Step 3: Run the suite**

Ask the user to run:
```bash
npx jest && npx tsc --noEmit
```
Expected: PASS, tsc silent. (No unit test here — the function is pure network I/O against the Supabase Management API, which the working agreement keeps out of unit tests.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/managementApi.ts src/lib/supabase/SKILL.md
git commit -m "fix(supabase): verify addExposedSchema's write actually stuck

The exposed-schemas setting is one global comma-separated string shared by
every tenant, and addExposedSchema read-modify-writes it. Two concurrent
provisions lose an update: both read the same list, both append, the second
PATCH overwrites the first — and the loser's schema is silently never
exposed, so that tenant's entire app 404s with nothing logged.

Now re-reads after PATCHing and retries until it can see its own schema.
Converges under concurrency because each attempt re-reads current state.

Latent in admin provisioning all along; self-serve signup makes concurrent
provisions realistic enough to fix before shipping it."
```

---

### Task 5: Control-plane migration + `provisioning` status

The idempotency lock Task 7 depends on.

**Files:**
- Create: `supabase/control-plane/005_tenants_admin_email_unique.sql`
- Modify: `src/types/index.ts`
- Modify: `supabase/SKILL.md`

**Interfaces:**
- Produces: `TenantStatus` now includes `"provisioning"`; a unique index on `control.tenants.admin_email`.

- [ ] **Step 1: Write the migration**

Create `supabase/control-plane/005_tenants_admin_email_unique.sql`:

```sql
-- ============================================================
-- 005 — unique admin_email on control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (control plane).
--
-- This index is the idempotency lock for self-serve signup. The provisioning
-- route (/api/signup/provision) inserts its control.tenants row with
-- status = 'provisioning' BEFORE doing any expensive work, so a double-click,
-- a page refresh, or two concurrent requests collide here (23505) instead of
-- creating two tenant schemas for one person.
--
-- Postgres treats multiple NULLs as distinct, so a plain unique index is
-- correct — existing rows with no admin_email (including tenant_kaufnest)
-- are unaffected and no partial predicate is needed.
--
-- Verified against Project A on 2026-08-28: zero duplicate non-null
-- admin_email values, so this applies cleanly to live data.
--
-- No CHECK constraint exists on control.tenants.status (001_schema.sql
-- declares it `text not null default 'active'` with an explanatory comment
-- only), so the new 'provisioning' value needs no schema change.
-- ============================================================

create unique index if not exists idx_tenants_admin_email
  on control.tenants (admin_email);
```

- [ ] **Step 2: Add `provisioning` to the `TenantStatus` type**

In `src/types/index.ts`, replace:

```ts
export type TenantStatus = "active" | "invited" | "deactivated";
```

with:

```ts
// "provisioning" is a transient state written by /api/signup/provision before
// it creates the tenant schema, so a crash mid-provision leaves a visible row
// in /admin rather than an invisible half-tenant. It flips to "active" on
// success. Self-serve signups never pass through "invited" — that state
// belongs to the admin invite flow, where the tenant exists before the
// person accepts.
export type TenantStatus = "active" | "invited" | "deactivated" | "provisioning";
```

- [ ] **Step 3: Record the migration in the supabase docs**

In `supabase/SKILL.md`, add a row to the file-map table, immediately after the `control-plane/003_add_admin_email.sql` row:

```markdown
| `control-plane/005_tenants_admin_email_unique.sql` | `control.tenants` (Project A) | ⏳ **pending** — unique index on `admin_email`; the idempotency lock for self-serve signup's provisioning route, which claims its tenant row before doing expensive work so a refresh or concurrent request collides (23505) instead of creating a second schema. Plain (non-partial) index: Postgres treats multiple NULLs as distinct, so existing rows without an `admin_email` are unaffected. Verified live 2026-08-28 — no duplicate non-null values, applies cleanly. |
```

- [ ] **Step 4: Verify nothing switch-exhausts on `TenantStatus`**

Ask the user to run:
```bash
npx tsc --noEmit
```
Expected: silent. If it errors, some code exhaustively switches on `TenantStatus` and needs a `provisioning` branch — most likely `/admin`'s status badge. Handle it by rendering `provisioning` with the same treatment as `invited`.

- [ ] **Step 5: Commit**

```bash
git add supabase/control-plane/005_tenants_admin_email_unique.sql \
        src/types/index.ts supabase/SKILL.md
git commit -m "feat(control-plane): unique admin_email + provisioning status

Self-serve signup's provisioning route claims its control.tenants row before
doing any expensive work, so a refresh, double-click or concurrent request
collides on this unique index rather than creating a second tenant schema for
one person.

Plain rather than partial index: Postgres treats multiple NULLs as distinct,
so existing rows with no admin_email are unaffected. Verified live against
Project A — no duplicate non-null values.

status = 'provisioning' needs no DB change (the column has no CHECK
constraint) but does need adding to the TenantStatus union."
```

---

### Task 6: Signup page

**Files:**
- Create: `src/app/(auth)/signup/page.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/CLAUDE.md`

**Interfaces:**
- Produces: `/signup`, which writes `company_name` and `full_name` into `user_metadata` — read by Task 7's route and Task 8's `/auth/confirm` branch. **These two key names are load-bearing across three files; do not rename them.**

- [ ] **Step 1: Create the signup page**

Create `src/app/(auth)/signup/page.tsx`. It inherits `(auth)/layout.tsx`'s dark centered-card shell, so it matches `/login` with no new styling:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Creates an UNCONFIRMED auth user and nothing else — no tenant, no
    // schema, no Management API call. Provisioning happens only after the
    // email is confirmed (see /api/signup/provision), so anonymous traffic
    // can never reach it.
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { company_name: companyName.trim(), full_name: fullName.trim() } },
    });

    if (signUpError) {
      setError(
        signUpError.message.toLowerCase().includes("already")
          ? "An account with this email already exists. Try signing in instead."
          : signUpError.message
      );
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/brand/boughtopia-icon-bag-mono-light.svg" alt="" aria-hidden="true" width={40} height={40} className="mx-auto mb-2" />
          <span className="text-3xl font-bold text-white tracking-tight">
            Bought<span className="text-[var(--color-primary-hover)]">opia</span>
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <h1 className="text-lg font-semibold text-white mb-2">Check your email</h1>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <strong className="text-slate-200">{email}</strong>.
            Click it and we&rsquo;ll set up your workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <img src="/brand/boughtopia-icon-bag-mono-light.svg" alt="" aria-hidden="true" width={40} height={40} className="mx-auto mb-2" />
        <span className="text-3xl font-bold text-white tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-slate-400">14 days free · no credit card</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-5"
      >
        <h1 className="text-lg font-semibold text-white mb-1">Start your free trial</h1>

        {error && (
          <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="company" className="block text-sm font-medium text-slate-300">
            Company name
          </label>
          <input
            id="company"
            type="text"
            autoComplete="organization"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="Acme GmbH"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="fullName" className="block text-sm font-medium text-slate-300">
            Your name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="Jane Doe"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium text-slate-300">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium text-slate-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="At least 8 characters"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          {loading ? "Creating your account…" : "Start free trial"}
        </button>

        <p className="text-center text-xs text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-slate-200 hover:text-white transition-colors">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Link signup from the login page**

In `src/app/(auth)/login/page.tsx`, add this immediately after the closing `</button>` of the submit button, still inside the `<form>`:

```tsx
        <p className="text-center text-xs text-slate-400">
          Don&rsquo;t have an account?{" "}
          <Link href="/signup" className="text-slate-200 hover:text-white transition-colors">
            Start a free trial
          </Link>
        </p>
```

`Link` is already imported in that file — do not add a duplicate import.

- [ ] **Step 3: Update the auth docs**

In `src/app/(auth)/CLAUDE.md`, add to the "Files in this folder" list, after the `login/page.tsx` bullet:

```markdown
- `signup/page.tsx` — self-serve signup (2026-08-28). Calls
  `supabase.auth.signUp()` directly from the browser with `company_name` and
  `full_name` in `options.data` (i.e. `user_metadata`). This creates an
  **unconfirmed auth user and nothing else** — no tenant, no schema, no
  Supabase Management API call — which is the whole point: anonymous traffic
  must never be able to trigger tenant provisioning (see
  `src/app/api/signup/provision/route.ts` for why that path is dangerous).
  On success it swaps to a "check your email" panel rather than redirecting.
  **The `company_name`/`full_name` metadata keys are load-bearing** — read by
  `app/auth/confirm/route.ts` to detect a self-serve signup and by
  `api/signup/provision/route.ts` to name the tenant. Renaming them in one
  place silently breaks the flow.
```

- [ ] **Step 4: Verify it compiles**

Ask the user to run:
```bash
npx tsc --noEmit && npx eslint src/app/\(auth\)
```
Expected: tsc silent; eslint reports only the pre-existing `<img>` LCP warnings (no errors).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/signup/page.tsx" "src/app/(auth)/login/page.tsx" "src/app/(auth)/CLAUDE.md"
git commit -m "feat(auth): self-serve signup form

Creates an unconfirmed Supabase auth user carrying company_name and full_name
in user_metadata — and nothing else. No tenant row, no schema, no Management
API call, so an anonymous submit cannot reach the provisioning path.

Reuses the existing (auth) layout so it matches /login without new styling.
Shows a check-your-email panel on success rather than redirecting, since
there is nothing to log into until the email is confirmed."
```

---

### Task 7: Provisioning API route

The core of the feature.

**Files:**
- Create: `src/app/api/signup/provision/route.ts`

**Interfaces:**
- Consumes: `slugForCompany`, `nextAvailableSlug`, `schemaNameFor` (Task 3); `addExposedSchema` (Task 4); the unique `admin_email` index (Task 5); `company_name`/`full_name` metadata (Task 6).
- Produces: `POST /api/signup/provision` → `200 {ok: true}` or `{error: string}` with 4xx/5xx. Called by Task 8's `/welcome`.

- [ ] **Step 1: Create the route**

Create `src/app/api/signup/provision/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { addExposedSchema } from "@/lib/supabase/managementApi";
import { slugForCompany, nextAvailableSlug, schemaNameFor } from "@/lib/utils/tenantSlug";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Provisioning creates ~13 tables with RLS, triggers and indexes, then waits
// on a PostgREST schema-cache reload. Comfortably past a default serverless
// timeout, so the budget is raised explicitly.
export const maxDuration = 60;

const TRIAL_DAYS = 14;

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — String(err) on those yields "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // Already has a tenant — nothing to do. Covers a user re-visiting /welcome
  // after a successful run.
  if (user.app_metadata?.tenant_schema) {
    return NextResponse.json({ ok: true, alreadyProvisioned: true });
  }

  const companyName = (user.user_metadata?.company_name as string | undefined)?.trim();
  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim() ?? "";

  if (!companyName) {
    // Not a self-serve signup (an admin-invited user has no company_name),
    // so there is nothing this route can safely provision.
    return NextResponse.json(
      { error: "This account is not a self-serve signup." },
      { status: 400 }
    );
  }

  const control = createControlClient();

  // Claim a slug. The unique index on admin_email (control-plane/005) — not
  // this read — is what actually prevents double-provisioning; this only
  // picks a name that is free right now.
  const { data: takenRows } = await control
    .schema("control")
    .from("tenants")
    .select("slug");

  const base = slugForCompany(companyName, user.email);
  let slug: string;
  try {
    slug = nextAvailableSlug(base, (takenRows ?? []).map((r) => r.slug as string));
  } catch (err) {
    console.error("[signup/provision] slug allocation failed:", errorMessage(err));
    return NextResponse.json({ error: "Could not allocate a workspace name." }, { status: 500 });
  }
  let schemaName = schemaNameFor(slug);

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  // Claim BEFORE any expensive work, so a refresh or a concurrent request
  // collides on the unique admin_email index instead of building a second
  // schema. Status stays 'provisioning' until every step below succeeds, so a
  // crash leaves a visible row in /admin rather than an invisible half-tenant.
  const { error: claimError } = await control
    .schema("control")
    .from("tenants")
    .insert({
      name: companyName,
      slug,
      schema_name: schemaName,
      admin_email: user.email,
      plan: "trial",
      status: "provisioning",
      trial_ends_at: trialEnd.toISOString(),
    });

  if (claimError) {
    if (claimError.code !== "23505") {
      console.error("[signup/provision] claim failed:", claimError.message);
      return NextResponse.json({ error: "Could not start setting up your workspace." }, { status: 500 });
    }

    // 23505 = unique_violation on admin_email. Either a concurrent request,
    // or an earlier attempt that died partway. Resume that row rather than
    // reporting success for a workspace that was never finished.
    const { data: existing } = await control
      .schema("control")
      .from("tenants")
      .select("schema_name, status")
      .eq("admin_email", user.email)
      .single<{ schema_name: string; status: string }>();

    if (!existing) {
      return NextResponse.json({ error: "Could not start setting up your workspace." }, { status: 500 });
    }
    if (existing.status === "active") {
      return NextResponse.json({ ok: true, alreadyProvisioned: true });
    }
    schemaName = existing.schema_name;
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Every step below is written to be safely re-runnable, because a resumed
    // attempt (above) re-executes all of them.
    const { error: schemaError } = await service.rpc("provision_tenant_schema", {
      schema_name: schemaName,
    });
    if (schemaError) throw schemaError;

    // MUST precede the tenant-scoped writes below: PostgREST rejects requests
    // against a schema that isn't in the exposed list with 404/406.
    await addExposedSchema(schemaName);

    const tenantService = createServiceClientForTenant(schemaName);

    const { data: existingProfileRow } = await tenantService
      .from("company_profile")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!existingProfileRow) {
      const { error: seedError } = await tenantService
        .from("company_profile")
        .insert({ name: companyName, currency: "EUR", timezone: "UTC" });
      if (seedError) throw seedError;
    }

    const { data: existingUserProfile } = await tenantService
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!existingUserProfile) {
      const { error: profileError } = await tenantService.from("profiles").insert({
        id: user.id,
        email: user.email,
        full_name: fullName,
        role: "super_admin",
      });
      if (profileError) throw profileError;
    }

    // Canonical writer for app_metadata.tenant_schema. The caller MUST
    // refresh its session afterwards — see /welcome.
    const { error: stampError } = await service.rpc("set_user_tenant", {
      user_id: user.id,
      schema_name: schemaName,
    });
    if (stampError) throw stampError;

    const { error: activateError } = await control
      .schema("control")
      .from("tenants")
      .update({ status: "active" })
      .eq("schema_name", schemaName);
    if (activateError) throw activateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Row stays 'provisioning' — visible in /admin, and the retry path above
    // resumes it. Detail is logged, never returned (project verifier rule).
    console.error("[signup/provision] failed:", errorMessage(err));
    return NextResponse.json(
      { error: "We couldn't finish setting up your workspace. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify it compiles and passes the verifier**

Ask the user to run:
```bash
npx tsc --noEmit && uv run .claude/verifiers/verify_changes.py
```
Expected: tsc silent. The verifier must not flag this file — it checks for raw Postgres errors returned to clients (this route returns only generic strings) and for route handlers with no auth guard (this one returns 401 when there's no user).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/signup/provision/route.ts
git commit -m "feat(signup): tenant provisioning route for self-serve signup

Runs only for an authenticated, email-confirmed user — the expensive and
globally-risky work (schema creation, PostgREST exposed-schema mutation)
is never reachable by anonymous traffic.

Claims its control.tenants row with status='provisioning' before doing any
work, so the unique admin_email index turns a refresh, double-click or
concurrent request into a 23505 rather than a second tenant schema. A 23505
resumes the existing row instead of reporting success, because a previous
attempt may have died partway; every subsequent step is written to be
safely re-runnable for that reason.

A crash leaves a visible 'provisioning' row in /admin rather than an
invisible half-tenant. Errors are logged server-side and returned generic."
```

---

### Task 8: Confirm routing + `/welcome`

Connects Task 6's signup to Task 7's route, completing the flow.

**Files:**
- Create: `src/app/welcome/page.tsx`
- Modify: `src/app/auth/confirm/route.ts`

**Interfaces:**
- Consumes: `POST /api/signup/provision` (Task 7); `company_name` metadata (Task 6).

- [ ] **Step 1: Add the self-serve branch to `/auth/confirm`**

In `src/app/auth/confirm/route.ts`, inside `if (!error) {`, insert this **before** the existing `const tenantSchema = ...` line:

```ts
      // Self-serve signup: confirmed, but no tenant exists yet. Provisioning
      // takes ~10s (schema + RLS + triggers + a PostgREST cache wait), which
      // would risk a serverless timeout inside this redirect handler with no
      // way to tell the user what happened — so /welcome does it instead.
      const pendingCompany = user?.user_metadata?.company_name as string | undefined;
      const alreadyProvisioned = user?.app_metadata?.tenant_schema as string | undefined;
      if (!alreadyProvisioned && pendingCompany) {
        return NextResponse.redirect(`${origin}/welcome`);
      }
```

The existing invited → active logic below it is unchanged: it is already guarded by `if (tenantSchema)`, which a self-serve signup does not have at this point.

- [ ] **Step 2: Create `/welcome`**

Create `src/app/welcome/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function WelcomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function provision() {
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    let body: { ok?: boolean; error?: string };
    try {
      const res = await fetch("/api/signup/provision", { method: "POST" });
      body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "We couldn't finish setting up your workspace.");
        return;
      }
    } catch {
      setError("Network error — please try again.");
      return;
    }

    // set_user_tenant wrote app_metadata.tenant_schema, but the JWT this
    // browser holds was issued BEFORE that write. Every RLS policy reads the
    // claim from the token itself (auth.jwt() -> 'app_metadata' ->>
    // 'tenant_schema'), not from the auth server, so without this refresh the
    // dashboard loads with a stale token and every single query fails.
    await supabase.auth.refreshSession();
    router.replace("/dashboard");
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Deferred via a microtask rather than called directly: provision()'s
    // first statement is a synchronous setState, which trips
    // react-hooks/set-state-in-effect when invoked straight from an effect
    // body. Same pattern as dashboard/messages/page.tsx's auto-sync.
    Promise.resolve().then(() => provision());
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm text-center">
        <img
          src="/brand/boughtopia-icon-bag-mono-light.svg"
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          className="mx-auto mb-2"
        />
        <span className="text-3xl font-bold text-white tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>

        {error ? (
          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => Promise.resolve().then(() => provision())}
              className="mt-4 w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="mt-8 text-sm text-slate-400">
            Setting up your workspace… this takes a few seconds.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Confirm `/welcome` is NOT in the proxy matcher**

Read the bottom of `src/proxy.ts` and confirm:

```ts
export const config = {
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/login"],
};
```

`/welcome` must **not** be there. A user on `/welcome` has a session but no `tenant_schema` yet — if the proxy ran, its tenant lookup would find nothing and bounce them, making provisioning permanently unreachable. **Do not add it.**

- [ ] **Step 4: Document the flow**

In `src/app/(auth)/CLAUDE.md`, add to the "Related files outside this folder" list:

```markdown
- `src/app/welcome/page.tsx` — where a self-serve signup lands after
  confirming their email. Calls `POST /api/signup/provision`, then
  **`supabase.auth.refreshSession()`**, then redirects to `/dashboard`. The
  refresh is not optional: `set_user_tenant` writes
  `app_metadata.tenant_schema`, but every RLS policy reads that claim from
  the JWT, and this browser's JWT predates the write — without a refresh the
  dashboard loads with a stale token and every query fails. Deliberately
  outside `proxy.ts`'s matcher: a user here has a session but no tenant yet,
  so the proxy's tenant lookup would bounce them and make provisioning
  unreachable.
```

- [ ] **Step 5: Verify**

Ask the user to run:
```bash
npx tsc --noEmit && npx eslint src/app/welcome src/app/auth
```
Expected: tsc silent; eslint reports only the `<img>` LCP warning, **no `react-hooks/set-state-in-effect` error**. If that rule fires, the microtask deferral in Step 2 was dropped.

- [ ] **Step 6: Commit**

```bash
git add src/app/welcome/page.tsx src/app/auth/confirm/route.ts "src/app/(auth)/CLAUDE.md"
git commit -m "feat(signup): route confirmed signups through /welcome

/auth/confirm gains one branch: a confirmed user with no tenant_schema but a
company_name in metadata is a self-serve signup, so it redirects to /welcome
instead of /dashboard. The existing invited->active path is untouched.

/welcome runs provisioning rather than doing it inline in the redirect
handler, because ~10s of schema creation inside a redirect risks a serverless
timeout with no way to show the user what happened. It then refreshes the
session — mandatory, because set_user_tenant writes app_metadata but RLS
reads tenant_schema from the JWT, and this browser's token predates the
write, so a stale token fails every query."
```

---

### Task 9: Branded confirm-signup email template

**Files:**
- Create: `email-templates/confirm-signup.html`
- Modify: `email-templates/README.md` (create it if absent)

- [ ] **Step 1: Create the template**

Create `email-templates/confirm-signup.html`, matching the existing `invite.html` structure exactly (same table layout, colours and `{{ .SiteURL }}`/`{{ .TokenHash }}` variables):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm your Boughtopia account</title>
</head>
<body style="margin:0;padding:0;background-color:#020817;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#020817;">
    <tr>
      <td align="center" style="padding:48px 16px;">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:36px;">
              <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                Bought<span style="color:#6366f1;">opia</span>
              </span>
              <p style="margin:6px 0 0;font-size:13px;color:#64748b;">Business Dashboard</p>
            </td>
          </tr>

          <!-- Body card -->
          <tr>
            <td style="background-color:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:40px 40px 36px;">

              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f1f5f9;line-height:1.3;">
                Confirm your email
              </h1>
              <p style="margin:0 0 28px;font-size:14px;color:#94a3b8;line-height:1.6;">
                Welcome to Boughtopia. Confirm your email address and we&rsquo;ll set up your
                workspace — your 14-day free trial starts right away, with no credit card needed.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td style="border-radius:8px;background-color:#6366f1;">
                    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup"
                       target="_blank"
                       style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;letter-spacing:0.1px;">
                      Confirm and get started &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #1e293b;margin:0 0 20px;" />

              <p style="margin:0 0 6px;font-size:12px;color:#475569;">
                If the button doesn&rsquo;t work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;word-break:break-all;">
                <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup" style="color:#6366f1;text-decoration:none;">
                  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#334155;line-height:1.6;">
                This email was sent from Boughtopia.
                If you didn&rsquo;t create an account, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

Note there is **no `next=` parameter**: `/auth/confirm` decides where to send a self-serve signup on its own (Task 8), and defaulting to `/dashboard` before the tenant exists would break the flow.

- [ ] **Step 2: Write the setup note**

Create or append to `email-templates/README.md`:

```markdown
# Email templates

These files are **not** loaded by the app. They are pasted by hand into
Supabase Dashboard → Authentication → Email Templates, which is the only
place they take effect. Keep this directory in sync with what is live there.

| File | Supabase template | Notes |
| --- | --- | --- |
| `invite.html` | Invite user | Admin-provisioned tenants (`/admin` → Add Tenant) |
| `reset-password.html` | Reset password | |
| `confirm-signup.html` | Confirm signup | Self-serve signup (2026-08-28). **Requires email confirmations to be enabled** under Authentication → Providers → Email, or `signUp()` returns a live session and the whole deferred-provisioning guarantee is lost. |

All of them link to `{{ .SiteURL }}/auth/confirm?...` rather than Supabase's
own `{{ .ConfirmationURL }}` — corporate email scanners pre-fetch
`*.supabase.co` verify links and burn the single-use token before the real
user clicks. See `src/app/auth/confirm/route.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add email-templates/confirm-signup.html email-templates/README.md
git commit -m "feat(email): branded confirm-signup template

Matches invite.html's structure and the Boughtopia wordmark. Links to
{{ .SiteURL }}/auth/confirm rather than Supabase's ConfirmationURL, for the
same reason the other templates do — corporate scanners pre-fetch
*.supabase.co links and burn the single-use token.

Carries no next= parameter on purpose: /auth/confirm routes self-serve
signups to /welcome itself, and defaulting to /dashboard before the tenant
exists would break the flow.

Documents that email confirmations must be ON — without that, signUp()
returns a live session and provisioning is no longer gated behind a
verified inbox."
```

---

### Task 10: Pricing module

Pure logic, so the landing page in Task 11 is pure presentation.

**Files:**
- Create: `src/app/(marketing)/_lib/pricing.ts`
- Create: `src/app/(marketing)/_lib/pricing.test.ts`

**Interfaces:**
- Produces: `pricedPlans(): PricedPlan[]`, consumed by Task 11's `Pricing` component.

- [ ] **Step 1: Write the failing tests**

Create `src/app/(marketing)/_lib/pricing.test.ts`:

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

- [ ] **Step 2: Run the tests to verify they fail**

Ask the user to run:
```bash
npx jest marketing
```
Expected: FAIL — `Cannot find module './pricing'`.

- [ ] **Step 3: Implement the module**

Create `src/app/(marketing)/_lib/pricing.ts`:

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

- [ ] **Step 4: Run the tests to verify they pass**

Ask the user to run:
```bash
npx jest marketing
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(marketing)/_lib/pricing.ts" "src/app/(marketing)/_lib/pricing.test.ts"
git commit -m "feat(marketing): pricing data derived from PLAN_LIMITS

Prices are declared here; the feature ticks are computed from PLAN_LIMITS,
so the pricing page cannot advertise a capability the app actually gates off.
Editing the plan matrix updates the page, and a test pins the two together.

Starter EUR20 (3 users), Pro EUR30 (5 users, integrations), Business EUR50
(unlimited, plus listings/messages/AI). Monthly only."
```

---

### Task 11: Landing page

**Files:**
- Create: `src/app/(marketing)/layout.tsx`
- Create: `src/app/(marketing)/page.tsx`
- Create: `src/app/(marketing)/_components/{MarketingNav,Hero,Features,Pricing,TrialInfo,MarketingFooter}.tsx`
- Create: `src/app/(marketing)/CLAUDE.md`
- Create: `src/app/(marketing)/SKILL.md`
- Delete: `src/app/page.tsx`

**Interfaces:**
- Consumes: `pricedPlans()` (Task 10); `/signup` (Task 6); `/login`.

- [ ] **Step 1: Delete the old root page and add the marketing layout**

```bash
git rm src/app/page.tsx
```

Create `src/app/(marketing)/layout.tsx`:

```tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-(--color-bg)">{children}</div>;
}
```

- [ ] **Step 2: Build the nav and footer**

Create `src/app/(marketing)/_components/MarketingNav.tsx`:

```tsx
import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="border-b border-(--color-border)">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="flex items-center gap-2">
          <img src="/brand/boughtopia-icon-bag.svg" alt="" aria-hidden="true" width={26} height={26} />
          <span className="text-lg font-bold tracking-tight text-(--color-text-strong)">
            Bought<span className="text-(--color-primary)">opia</span>
          </span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-(--color-text-base) hover:text-(--color-text-strong)">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-(--radius-btn) bg-(--color-primary) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--color-primary-hover)"
          >
            Start free trial
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

Create `src/app/(marketing)/_components/MarketingFooter.tsx`:

```tsx
import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-(--color-text-muted) sm:flex-row">
        <span>&copy; {new Date().getFullYear()} Boughtopia</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-(--color-text-strong)">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-(--color-text-strong)">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Build the hero, features and trial sections**

Create `src/app/(marketing)/_components/Hero.tsx`:

```tsx
import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-(--color-text-strong) sm:text-5xl">
        Bookkeeping for multi-platform sellers
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-lg text-(--color-text-muted)">
        Track every sale, expense and unit of stock across eBay, Amazon, Etsy and
        Shopify — with VAT, invoices and a full audit trail in one place.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/signup"
          className="rounded-(--radius-btn) bg-(--color-primary) px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-(--color-primary-hover)"
        >
          Start your free trial
        </Link>
        <Link
          href="#pricing"
          className="rounded-(--radius-btn) border border-(--color-border) px-6 py-3 text-sm font-semibold text-(--color-text-base) transition-colors hover:text-(--color-text-strong)"
        >
          See pricing
        </Link>
      </div>
      <p className="mt-4 text-sm text-(--color-text-muted)">
        14 days free · full access · no credit card
      </p>
    </section>
  );
}
```

Create `src/app/(marketing)/_components/Features.tsx`:

```tsx
const FEATURES: { title: string; body: string }[] = [
  {
    title: "Every platform, one ledger",
    body: "Sales, expenses and purchases across eBay, Amazon, Etsy and Shopify — with per-platform balances and payout tracking.",
  },
  {
    title: "Orders pulled in automatically",
    body: "Connect your eBay and Amazon seller accounts and review orders before importing them. No copy-paste.",
  },
  {
    title: "VAT and invoices, handled",
    body: "VAT positions calculated as you go, and branded PDF invoices generated straight from your records.",
  },
  {
    title: "Inventory that stays honest",
    body: "Stock levels move themselves as sales and purchases land, with low-stock alerts before you run out.",
  },
  {
    title: "Sell and reply without leaving",
    body: "Create eBay listings and answer buyer messages from the same dashboard as your books.",
  },
  {
    title: "Built for a team",
    body: "Roles, per-user permissions and a complete audit trail of who changed what, and when.",
  },
];

export function Features() {
  return (
    <section className="border-t border-(--color-border) bg-(--color-surface)">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-(--color-text-strong)">
          Everything the books need
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <h3 className="text-sm font-semibold text-(--color-text-strong)">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-(--color-text-muted)">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Create `src/app/(marketing)/_components/TrialInfo.tsx`:

```tsx
import Link from "next/link";

export function TrialInfo() {
  return (
    <section className="border-t border-(--color-border) bg-(--color-surface)">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-(--color-text-strong)">
          Try the whole thing for 14 days
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-(--color-text-muted)">
          Your trial is not a stripped-down version. You get every feature — including
          the eBay and Amazon integrations, listings and buyer messages — for the full
          fourteen days. No credit card, and nothing to cancel if you decide against it.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-(--color-text-muted)">
          When the trial ends your data stays exactly where it is, waiting for you to
          pick a plan.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-(--radius-btn) bg-(--color-primary) px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-(--color-primary-hover)"
        >
          Start your free trial
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Build the pricing section**

Create `src/app/(marketing)/_components/Pricing.tsx`:

```tsx
import Link from "next/link";
import { Check, X } from "lucide-react";
import { pricedPlans } from "../_lib/pricing";

export function Pricing() {
  const plans = pricedPlans();

  return (
    <section id="pricing" className="border-t border-(--color-border)">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-(--color-text-strong)">
          Simple monthly pricing
        </h2>
        <p className="mt-3 text-center text-sm text-(--color-text-muted)">
          Every plan starts with the same 14-day free trial.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.plan}
              className={`rounded-(--radius-card) border bg-(--color-surface) p-6 ${
                plan.highlighted
                  ? "border-(--color-primary) shadow-lg"
                  : "border-(--color-border)"
              }`}
            >
              {plan.highlighted && (
                <span className="mb-3 inline-block rounded-full bg-(--color-primary-muted) px-2.5 py-0.5 text-xs font-semibold text-(--color-primary-text)">
                  Most popular
                </span>
              )}
              <h3 className="text-base font-bold text-(--color-text-strong)">{plan.name}</h3>
              <p className="mt-1 text-sm text-(--color-text-muted)">{plan.tagline}</p>

              <p className="mt-5">
                <span className="text-3xl font-bold text-(--color-text-strong)">
                  €{plan.monthlyEur}
                </span>
                <span className="text-sm text-(--color-text-muted)"> / month</span>
              </p>
              <p className="mt-1 text-sm font-medium text-(--color-text-base)">{plan.users}</p>

              <Link
                href="/signup"
                className={`mt-6 block rounded-(--radius-btn) px-4 py-2 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? "bg-(--color-primary) text-white hover:bg-(--color-primary-hover)"
                    : "border border-(--color-border) text-(--color-text-base) hover:text-(--color-text-strong)"
                }`}
              >
                Start free trial
              </Link>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2 text-sm">
                    {feature.included ? (
                      <Check size={16} className="mt-0.5 shrink-0 text-(--color-success)" aria-hidden="true" />
                    ) : (
                      <X size={16} className="mt-0.5 shrink-0 text-(--color-text-faint)" aria-hidden="true" />
                    )}
                    <span
                      className={
                        feature.included ? "text-(--color-text-base)" : "text-(--color-text-faint)"
                      }
                    >
                      {feature.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Assemble the page**

Create `src/app/(marketing)/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarketingNav } from "./_components/MarketingNav";
import { Hero } from "./_components/Hero";
import { Features } from "./_components/Features";
import { Pricing } from "./_components/Pricing";
import { TrialInfo } from "./_components/TrialInfo";
import { MarketingFooter } from "./_components/MarketingFooter";

export default async function HomePage() {
  // Signed-in visitors go straight to the app — the same behaviour the old
  // src/app/page.tsx redirect gave them. Keeping this means the marketing
  // page only ever renders logged-out, so it needs no signed-in header state.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <MarketingNav />
      <main>
        <Hero />
        <Features />
        <Pricing />
        <TrialInfo />
      </main>
      <MarketingFooter />
    </>
  );
}
```

- [ ] **Step 6: Write the feature docs**

Create `src/app/(marketing)/CLAUDE.md`:

```markdown
# Marketing feature

Route: `/` — the public landing page. A route group (`(marketing)`) rather
than a bare `src/app/page.tsx` so the page, its sections and its pricing
logic sit together, mirroring how `(auth)` is organised.

Renders **only for logged-out visitors**: `page.tsx` redirects an
authenticated user to `/dashboard`, preserving what the old
`src/app/page.tsx` redirect did. That is why no component here has a
signed-in state.

## Files in this folder

- `layout.tsx` — full-height page background. No app chrome (no sidebar,
  no `DashboardShell`).
- `page.tsx` — Server Component. Auth redirect, then composes the sections.
- `_components/MarketingNav.tsx` — logo + "Sign in" + "Start free trial".
- `_components/Hero.tsx` — headline, CTA, the "14 days free · no credit
  card" line.
- `_components/Features.tsx` — six feature cards from a local `FEATURES`
  array. **Only describe things that actually ship.**
- `_components/Pricing.tsx` — three plan cards, rendered from
  `_lib/pricing.ts`. Anchored at `#pricing` (the hero's secondary CTA links
  to it).
- `_components/TrialInfo.tsx` — what the trial includes and what happens
  when it ends.
- `_components/MarketingFooter.tsx` — copyright, privacy, sign in.
- `_lib/pricing.ts` (+ colocated test) — prices and plan copy. See below.

## Pricing is derived, not transcribed

`_lib/pricing.ts` declares the € amounts, but every ✓/✗ in the table is
computed from `PLAN_LIMITS` (`lib/utils/planGating.ts`). The page therefore
**cannot advertise a feature the application gates off** — change the plan
matrix and the page follows. `pricing.test.ts` pins the two together.

**To change a price:** edit `MONTHLY_EUR` in `_lib/pricing.ts`, nothing else.
**To change what a plan includes:** edit `PLAN_LIMITS`, not this folder.

## Shared dependencies

- `public/brand/boughtopia-icon-bag.svg` — the navy icon, used directly
  rather than via `BrandMark`, because this page has a fixed light
  background and no theme toggle.
- `lib/supabase/server` (`createClient`) — the logged-in redirect.
- `lib/utils/planGating` (`getPlanLimits`) — via `_lib/pricing.ts`.
- `lucide-react` — `Check`/`X` for the pricing table.

## Tests

`npx jest marketing` runs `_lib/pricing.test.ts`.
```

Create `src/app/(marketing)/SKILL.md`:

```markdown
---
name: marketing-feature
description: Agent playbook for the public landing page at / (src/app/(marketing)) — pricing changes, adding sections, and why the pricing table derives its feature marks.
---

# Marketing feature playbook

## Minimal file set per change type

- **Change a price**: `_lib/pricing.ts` → `MONTHLY_EUR`. Nothing else. The
  cards read it.
- **Change what a plan includes**: `src/lib/utils/planGating.ts` →
  `PLAN_LIMITS`. Do **not** hand-edit the ✓/✗ list in `_lib/pricing.ts` —
  it is derived, and `pricing.test.ts` will fail if the two disagree.
- **Add a feature bullet to the pricing cards**: add it to the `features`
  array in `_lib/pricing.ts`, sourcing `included` from a `limits.*` field so
  it stays derived. Add a matching assertion in `pricing.test.ts`.
- **Add a page section**: a new component in `_components/`, composed into
  `page.tsx`. Keep it a Server Component unless it genuinely needs state.
- **Change marketing copy**: the relevant `_components/*.tsx` — copy lives
  next to the markup, not in a shared constants file.

## Gotchas

- **The page renders only for logged-out visitors.** `page.tsx` redirects
  authenticated users to `/dashboard`. Don't add signed-in header states;
  they are unreachable.
- **Never claim a feature the plan matrix gates off.** The ✓/✗ marks are
  derived from `PLAN_LIMITS` precisely so this can't happen by accident, but
  the hero and feature copy are free text — those you have to keep honest
  yourself.
- **Uses the navy icon directly, not `BrandMark`.** `BrandMark` switches on
  `useTheme()`, which would force this Server Component to become a Client
  Component for no benefit — this page has a fixed light background and no
  theme toggle.
- **`/` is in `proxy.ts`'s matcher.** The proxy runs on this route but falls
  through (it only acts on `/login` and `/dashboard/*`). The redirect for
  signed-in users happens in the page, not the proxy.
```

- [ ] **Step 7: Verify**

Ask the user to run:
```bash
npx jest && npx tsc --noEmit && npx eslint src
```
Expected: tests PASS, tsc silent, eslint reports only pre-existing warnings and the new `<img>` LCP warnings from the nav (no errors).

Then ask them to confirm in a browser that `/` renders logged-out, `/signup` is reachable from both CTAs, and a signed-in user is still redirected to `/dashboard`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(marketing)" && git add -u src/app/page.tsx
git commit -m "feat(marketing): public landing page at /

Replaces the bare redirect that was src/app/page.tsx. Route group mirrors
(auth) so the page, its sections and its pricing logic live together.

Signed-in visitors still redirect to /dashboard, so the page only ever
renders logged-out and needs no signed-in header state.

The pricing table's feature ticks come from PLAN_LIMITS rather than being
written out, so it cannot advertise something the app gates off."
```

---

### Task 12: Final wiring check

No new code — verifies the three phases compose, and records the manual steps.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README's feature list**

In `README.md`, under `## Features`, add as the first bullet:

```markdown
- Public landing page (`/`) with self-serve signup and a 14-day full-access
  free trial — no credit card, no admin involvement
```

- [ ] **Step 2: Full verification**

Ask the user to run:
```bash
npx jest && npx tsc --noEmit && npx eslint src && npx next build
```
Expected: all clean. `next build` is the one that catches a route-group collision (two files resolving to `/`), which nothing else would.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note self-serve signup and free trial in the README"
```

- [ ] **Step 4: Hand the manual steps to the user**

These cannot be done from the repo. Present them as a checklist:

1. **Supabase Dashboard → Authentication → Providers → Email:** enable
   "Confirm email". **Without this, `signUp()` returns a live session
   immediately** and provisioning is no longer gated behind a verified
   inbox — the central security property of this design.
2. **Supabase Dashboard → Authentication → Email Templates → Confirm signup:**
   paste in `email-templates/confirm-signup.html`.
3. **Supabase Dashboard → Authentication → URL Configuration:** confirm the
   redirect allow-list covers `https://app.boughtopia.com/auth/confirm**`.
4. **Apply** `supabase/control-plane/005_tenants_admin_email_unique.sql` to
   **Project A** (control plane), in the Supabase SQL editor.
5. **Replace the placeholder contact address.** `src/app/privacy/page.tsx`
   still shows `privacy@boughtopia.example`. It is now two clicks from the
   landing page.
6. **End-to-end smoke test**, ideally with a real inbox: sign up → receive
   the email → click → land on `/welcome` → get dropped into `/dashboard`
   with a working workspace. Then check `/admin` shows the new tenant as
   `active` on the `trial` plan.

---

## Notes for the executor

- **Task order matters.** Tasks 1–2 (trial enforcement) must land before
  anything ships, because Task 1 makes trials full-featured and Task 2 is what
  stops that being permanent. Tasks 3–9 are the signup flow. Tasks 10–11 are
  the page.
- **Tasks 3, 4 and 5 are independent of each other** and can be reviewed in
  any order, but all three must precede Task 7.
- If a step's expected output doesn't match what you see, stop and report it
  rather than adapting — several steps encode non-obvious constraints
  (proxy matcher exclusions, the session refresh, the metadata key names)
  where "fixing" the symptom breaks the flow silently.
