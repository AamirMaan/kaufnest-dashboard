# Listing Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard/listings` from a seven-step form wizard into a single-page listing studio with a rich AI-assisted description editor, a sortable image grid, AI-filled item specifics, and a live eBay preview with a quality score.

**Architecture:** Four independent phases. Phase 1 lands the control-plane AI metering table, plan gating and admin toggle — shippable alone. Phase 2 replaces the image step. Phase 3 rewrites the wizard as one scrolling form with a sticky preview. Phase 4 adds the Anthropic routes and the TipTap editor on top. Server routes own all enforcement; the UI only decides what to render.

**Tech Stack:** Next.js 16 App Router, React 19, Redux Toolkit, Supabase (two projects: `control` plane + tenant-schema data plane), `@anthropic-ai/sdk` (Claude Opus 5), TipTap, dnd-kit, isomorphic-dompurify, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-09-01-listing-studio-design.md`

## Global Constraints

- **Branch:** `feat/listing-studio` (already created, spec committed as `cd024bc`). Never commit to `main`.
- **Jest runs in `testEnvironment: "node"`** (`jest.config.ts`) — there is no jsdom. **No React component render tests are possible.** Every test in this plan is pure TypeScript. UI tasks are verified manually in the browser.
- **Test-running policy:** `AGENTS.md` forbids running `npm test`, `npx tsc --noEmit`, or `npm run lint` mid-task. This plan permits **only** the targeted form `npx jest <path>` as the red/green TDD cycle, because a TDD step is meaningless without it. Never run the full suite, `tsc`, or `lint` — the Husky `pre-commit` (tsc + eslint + verifier) and `pre-push` (jest + next build) hooks cover those automatically.
- **Never start a dev server or `curl` routes.** For browser verification, ask the user to exercise the page and report back.
- **Never query `public.*`**; never hardcode a tenant schema name — read it from `user.app_metadata.tenant_schema`.
- **`createControlClient()` is server-only.** Never import it into a `"use client"` file. The PreToolUse verifier denies such edits.
- **`ANTHROPIC_API_KEY` must never be `NEXT_PUBLIC_`.** Everything under `src/lib/ai/` is server-only.
- **Stripe webhooks are the only writer of `control.tenants.plan` / `status`.** This plan writes only `ai_enabled`.
- **Form conventions (`AGENTS.md`):** real `<form id=...>`, `required` on the actual input (not just `<Field required>`), submit button `type="submit" form="<id>"`, `disabled` while saving AND while invalid, busy verb labels, `<Loader2 className="animate-spin" />` for full-page loads.
- **Docs are mandatory and same-commit:** any task that adds/removes/renames a file updates that feature's `CLAUDE.md` file map; any non-obvious constraint discovered goes into its `SKILL.md` as a gotcha.
- **`<img>` triggers an eslint warning** (`@next/next/no-img-element`) — the existing codebase suppresses it with `{/* eslint-disable-next-line @next/next/no-img-element */}`. Match that.
- **Quota value:** `300` generations/month for `business` and `trial`; `0` for `starter` and `pro`.
- **Model:** `claude-opus-5` exactly. Never a date suffix. `output_config: { effort: "low" }`.

---

# Phase 1 — Foundation

### Task 1: Control-plane migration, `Tenant.ai_enabled`, and the quota constant

**Files:**
- Create: `supabase/control-plane/005_tenant_ai_usage.sql`
- Modify: `src/types/index.ts` (the `Tenant` interface)
- Modify: `src/lib/utils/planGating.ts`
- Test: `src/lib/utils/planGating.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing
- Produces: `Tenant.ai_enabled: boolean`; `PlanLimits.aiGenerationsPerMonth: number`; `getAiGenerationLimit(plan: TenantPlan): number`

- [ ] **Step 1: Write the migration**

Create `supabase/control-plane/005_tenant_ai_usage.sql`:

```sql
-- supabase/control-plane/005_tenant_ai_usage.sql
-- ============================================================
-- AI feature visibility + per-tenant, per-user AI usage metering.
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- ai_enabled defaults to TRUE: the plan grants AI (hasAiFeatures), this
-- column only lets a platform admin REVOKE it for one tenant. Defaulting
-- false would hide a capability the Business plan already advertises.
-- ============================================================

alter table control.tenants
  add column if not exists ai_enabled boolean not null default true;

create table if not exists control.tenant_ai_usage (
  tenant_id     uuid not null references control.tenants(id) on delete cascade,
  -- Project B auth user id. Deliberately no FK: auth lives in a different
  -- database, so cross-project referential integrity is unavailable.
  user_id       uuid not null,
  period        date not null,            -- first day of the billing month, UTC
  kind          text not null check (kind in ('describe','aspects')),
  calls         integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, user_id, period, kind)
);

create index if not exists idx_tenant_ai_usage_period
  on control.tenant_ai_usage (tenant_id, period);

-- Service-role key bypasses RLS; this blocks anon/authenticated by default,
-- matching control.tenants and control.admin_users.
alter table control.tenant_ai_usage enable row level security;
```

- [ ] **Step 2: Add `ai_enabled` to the `Tenant` type**

In `src/types/index.ts`, inside `export interface Tenant`, add after `status`:

```typescript
  /** Platform-admin visibility switch for AI features. The plan grants AI;
   * this revokes it per tenant. Defaults true (control-plane migration 005). */
  ai_enabled: boolean;
```

- [ ] **Step 3: Write the failing test for the quota constant**

Create `src/lib/utils/planGating.test.ts`:

```typescript
import { getAiGenerationLimit, hasAiFeatures } from "./planGating";

describe("getAiGenerationLimit", () => {
  it("gives business and trial the full monthly allowance", () => {
    expect(getAiGenerationLimit("business")).toBe(300);
    expect(getAiGenerationLimit("trial")).toBe(300);
  });

  it("gives plans without the AI feature no allowance at all", () => {
    expect(getAiGenerationLimit("starter")).toBe(0);
    expect(getAiGenerationLimit("pro")).toBe(0);
  });

  it("never grants an allowance to a plan that fails the feature gate", () => {
    for (const plan of ["trial", "starter", "pro", "business"] as const) {
      if (!hasAiFeatures(plan)) expect(getAiGenerationLimit(plan)).toBe(0);
    }
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npx jest src/lib/utils/planGating.test.ts`
Expected: FAIL — `getAiGenerationLimit is not a function`.

- [ ] **Step 5: Implement the quota constant**

In `src/lib/utils/planGating.ts`, add `aiGenerationsPerMonth` to the `PlanLimits` interface:

```typescript
interface PlanLimits {
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  /** Monthly pool of AI generations shared by the whole tenant. Enforced in
   * src/lib/ai/quota.ts; 0 wherever aiFeatures is false. */
  aiGenerationsPerMonth: number;
  messagingAndListings: boolean;
}
```

Then extend each row of `PLAN_LIMITS`:

```typescript
const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial:    { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  aiGenerationsPerMonth: 300, messagingAndListings: true  },
  starter:  { maxUsers: 3,        platformIntegrations: false, aiFeatures: false, aiGenerationsPerMonth: 0,   messagingAndListings: false },
  pro:      { maxUsers: 5,        platformIntegrations: true,  aiFeatures: false, aiGenerationsPerMonth: 0,   messagingAndListings: false },
  business: { maxUsers: Infinity, platformIntegrations: true,  aiFeatures: true,  aiGenerationsPerMonth: 300, messagingAndListings: true  },
};
```

And add the accessor next to `hasAiFeatures`:

```typescript
export function getAiGenerationLimit(plan: TenantPlan): number {
  return PLAN_LIMITS[plan].aiGenerationsPerMonth;
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx jest src/lib/utils/planGating.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Update `supabase/SKILL.md`**

Add a row to the control-plane section of the file-map table:

```markdown
| `control-plane/005_tenant_ai_usage.sql` | Project A | ⏳ **apply now** — adds `control.tenants.ai_enabled` (default true) + `control.tenant_ai_usage` (per-tenant, per-user, per-month AI call/token counters, RLS enabled). Backs the Listing Studio AI features; quota constant lives in `lib/utils/planGating.ts` (`aiGenerationsPerMonth`). |
```

- [ ] **Step 8: Commit**

```bash
git add supabase/control-plane/005_tenant_ai_usage.sql src/types/index.ts src/lib/utils/planGating.ts src/lib/utils/planGating.test.ts supabase/SKILL.md
git commit -m "feat(ai): control-plane AI usage table, ai_enabled flag, per-plan quota"
```

- [ ] **Step 9: Ask the user to apply the migration**

Tell the user: "Apply `supabase/control-plane/005_tenant_ai_usage.sql` in the Supabase SQL editor for **Project A** (kaufnest-control), then confirm. Nothing after this task works until it's applied."

---

### Task 2: Quota read/record module

**Files:**
- Create: `src/lib/ai/quota.ts`
- Create: `src/lib/ai/quota.test.ts`

**Interfaces:**
- Consumes: `getAiGenerationLimit` (Task 1), `createControlClient` from `@/lib/supabase/control`
- Produces:
  - `currentPeriod(now?: Date): string` — `"YYYY-MM-01"` in UTC
  - `type AiKind = "describe" | "aspects"`
  - `interface UsageRow { user_id: string; kind: AiKind; calls: number }`
  - `sumCalls(rows: UsageRow[]): number`
  - `callsByUser(rows: UsageRow[]): Record<string, number>`
  - `async readTenantUsage(tenantId: string): Promise<UsageRow[]>`
  - `async recordUsage(args: { tenantId: string; userId: string; kind: AiKind; inputTokens: number; outputTokens: number }): Promise<void>`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/lib/ai/quota.test.ts`:

```typescript
import { currentPeriod, sumCalls, callsByUser, type UsageRow } from "./quota";

describe("currentPeriod", () => {
  it("returns the first day of the month in UTC", () => {
    expect(currentPeriod(new Date("2026-09-17T23:30:00Z"))).toBe("2026-09-01");
  });

  it("uses UTC, not local time, at a month boundary", () => {
    // 23:30 on Aug 31 UTC is already September in some local zones — the
    // billing period must not depend on where the server happens to run.
    expect(currentPeriod(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08-01");
  });

  it("zero-pads single-digit months", () => {
    expect(currentPeriod(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("sumCalls", () => {
  const rows: UsageRow[] = [
    { user_id: "u1", kind: "describe", calls: 3 },
    { user_id: "u1", kind: "aspects", calls: 2 },
    { user_id: "u2", kind: "describe", calls: 5 },
  ];

  it("totals every row regardless of user or kind", () => {
    expect(sumCalls(rows)).toBe(10);
  });

  it("returns zero for no usage", () => {
    expect(sumCalls([])).toBe(0);
  });
});

describe("callsByUser", () => {
  it("collapses both kinds into one total per user", () => {
    const rows: UsageRow[] = [
      { user_id: "u1", kind: "describe", calls: 3 },
      { user_id: "u1", kind: "aspects", calls: 2 },
      { user_id: "u2", kind: "describe", calls: 5 },
    ];
    expect(callsByUser(rows)).toEqual({ u1: 5, u2: 5 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/lib/ai/quota.test.ts`
Expected: FAIL — cannot find module `./quota`.

- [ ] **Step 3: Implement the module**

Create `src/lib/ai/quota.ts`:

```typescript
import { createControlClient } from "@/lib/supabase/control";

export type AiKind = "describe" | "aspects";

export interface UsageRow {
  user_id: string;
  kind: AiKind;
  calls: number;
}

/**
 * The billing period a usage row belongs to: the first day of the current
 * month, in UTC. Always UTC — deriving it from local time would move a
 * tenant's quota reset depending on which region the server runs in.
 */
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/** Total AI calls across every user and both kinds. */
export function sumCalls(rows: UsageRow[]): number {
  return rows.reduce((total, row) => total + row.calls, 0);
}

/** Per-user totals, collapsing `describe` and `aspects` into one number. */
export function callsByUser(rows: UsageRow[]): Record<string, number> {
  const byUser: Record<string, number> = {};
  for (const row of rows) {
    byUser[row.user_id] = (byUser[row.user_id] ?? 0) + row.calls;
  }
  return byUser;
}

/** Every usage row for this tenant in the current period. */
export async function readTenantUsage(tenantId: string): Promise<UsageRow[]> {
  const control = createControlClient();
  const { data } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .select("user_id, kind, calls")
    .eq("tenant_id", tenantId)
    .eq("period", currentPeriod());

  return (data as UsageRow[] | null) ?? [];
}

/**
 * Increment one (tenant, user, period, kind) counter. Read-then-write rather
 * than an atomic RPC: a lost update under concurrency undercounts by one
 * call, which is acceptable for a soft quota and not worth a DB function.
 */
export async function recordUsage(args: {
  tenantId: string;
  userId: string;
  kind: AiKind;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const control = createControlClient();
  const period = currentPeriod();

  const { data: existing } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .select("calls, input_tokens, output_tokens")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .eq("period", period)
    .eq("kind", args.kind)
    .maybeSingle();

  const prev = (existing as
    | { calls: number; input_tokens: number; output_tokens: number }
    | null) ?? { calls: 0, input_tokens: 0, output_tokens: 0 };

  await control
    .schema("control")
    .from("tenant_ai_usage")
    .upsert(
      {
        tenant_id: args.tenantId,
        user_id: args.userId,
        period,
        kind: args.kind,
        calls: prev.calls + 1,
        input_tokens: prev.input_tokens + args.inputTokens,
        output_tokens: prev.output_tokens + args.outputTokens,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id,period,kind" }
    );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/ai/quota.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/quota.ts src/lib/ai/quota.test.ts
git commit -m "feat(ai): quota read/record module against control.tenant_ai_usage"
```

---

### Task 3: Thread `aiEnabled` from the control plane to Redux

**Files:**
- Modify: `src/store/slices/currentUserSlice.ts`
- Modify: `src/store/StoreProvider.tsx`
- Modify: `src/app/dashboard/layout.tsx:169-179` (the tenant fetch) and the `<StoreProvider>` props
- Test: `src/store/slices/currentUserSlice.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `Tenant.ai_enabled` (Task 1)
- Produces: `setAiEnabled` action; `state.currentUser.aiEnabled: boolean` (defaults `false` until hydrated)

- [ ] **Step 1: Write the failing test**

Append to `src/store/slices/currentUserSlice.test.ts`:

```typescript
import { currentUserSlice, setAiEnabled } from "./currentUserSlice";

describe("setAiEnabled", () => {
  it("defaults to false before hydration", () => {
    const state = currentUserSlice.reducer(undefined, { type: "@@INIT" });
    expect(state.aiEnabled).toBe(false);
  });

  it("stores the tenant's AI visibility flag", () => {
    const state = currentUserSlice.reducer(undefined, setAiEnabled(true));
    expect(state.aiEnabled).toBe(true);
  });

  it("can revoke a previously enabled flag", () => {
    const enabled = currentUserSlice.reducer(undefined, setAiEnabled(true));
    const revoked = currentUserSlice.reducer(enabled, setAiEnabled(false));
    expect(revoked.aiEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/store/slices/currentUserSlice.test.ts`
Expected: FAIL — `setAiEnabled` is not exported.

- [ ] **Step 3: Add the reducer**

Rewrite `src/store/slices/currentUserSlice.ts`:

```typescript
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Profile, TenantPlan } from "@/types";

interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
  /** Platform-admin AI visibility switch (control.tenants.ai_enabled).
   * False until hydrated, so AI controls never flash before we know. */
  aiEnabled: boolean;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  aiEnabled: false,
};

export const currentUserSlice = createSlice({
  name: "currentUser",
  initialState,
  reducers: {
    setCurrentUser(state, action: PayloadAction<Profile>) {
      state.profile = action.payload;
    },
    setTenantPlan(state, action: PayloadAction<TenantPlan>) {
      state.tenantPlan = action.payload;
    },
    setAiEnabled(state, action: PayloadAction<boolean>) {
      state.aiEnabled = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan, setAiEnabled } = currentUserSlice.actions;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/store/slices/currentUserSlice.test.ts`
Expected: PASS.

- [ ] **Step 5: Accept the prop in `StoreProvider`**

In `src/store/StoreProvider.tsx`: change the import on line 17 to also pull `setAiEnabled`:

```typescript
import { setCurrentUser, setTenantPlan, setAiEnabled } from "@/store/slices/currentUserSlice";
```

Add to `StoreProviderProps` after `tenantPlan`:

```typescript
  aiEnabled?: boolean;
```

Add `aiEnabled,` to the destructured parameter list after `tenantPlan,`, and add this dispatch after the `tenantPlan` line inside `makeStore()`:

```typescript
    if (aiEnabled !== undefined) store.dispatch(setAiEnabled(aiEnabled));
```

Note the `!== undefined` guard rather than a truthiness check: `false` is a meaningful value here, unlike `tenantPlan`.

- [ ] **Step 6: Read the flag in the dashboard layout**

In `src/app/dashboard/layout.tsx`, replace the tenant block at lines 168-179:

```typescript
  // Tenant's subscription plan — drives platform-integrations gating.
  // ai_enabled is the platform-admin AI visibility switch (control-plane 005).
  let tenantPlan: TenantPlan | null = null;
  let aiEnabled = false;
  if (tenantSchema) {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("plan, ai_enabled")
      .eq("schema_name", tenantSchema)
      .single();
    tenantPlan = (tenant?.plan as TenantPlan | undefined) ?? null;
    aiEnabled = (tenant?.ai_enabled as boolean | undefined) ?? false;
  }
```

Then add the prop to `<StoreProvider>`, immediately after `tenantPlan={tenantPlan}`:

```typescript
      aiEnabled={aiEnabled}
```

- [ ] **Step 7: Update `src/app/dashboard/CLAUDE.md`**

In the `layout.tsx` bullet, amend the sentence about fetching the plan so it reads that the select carries `plan, ai_enabled` and that `ai_enabled` is passed as `aiEnabled` into `<StoreProvider>` and hydrated into `currentUserSlice.aiEnabled`, read by the Listings page to decide whether AI controls render at all.

- [ ] **Step 8: Commit**

```bash
git add src/store/slices/currentUserSlice.ts src/store/slices/currentUserSlice.test.ts src/store/StoreProvider.tsx src/app/dashboard/layout.tsx src/app/dashboard/CLAUDE.md
git commit -m "feat(ai): thread tenant ai_enabled flag through to Redux"
```

---

### Task 4: Admin AI visibility toggle

**Files:**
- Modify: `src/app/api/admin/tenants/[id]/route.ts` (PATCH body type + patch builder)
- Modify: `src/app/admin/_components/TenantActions.tsx`
- Modify: `src/app/admin/_components/EditTenantModal.tsx`
- Modify: `src/app/admin/CLAUDE.md`

**Interfaces:**
- Consumes: `Tenant.ai_enabled` (Task 1)
- Produces: `PATCH /api/admin/tenants/[id]` accepts `{ ai_enabled?: boolean }`

- [ ] **Step 1: Accept `ai_enabled` in the PATCH route**

In `src/app/api/admin/tenants/[id]/route.ts`, extend the body type at line 31:

```typescript
  const body = (await req.json()) as {
    plan?: TenantPlan;
    status?: TenantStatus;
    admin_email?: string;
    ai_enabled?: boolean;
  };
```

And add to the patch builder after the `status` line (line 95):

```typescript
  if (body.ai_enabled !== undefined) patch.ai_enabled = body.ai_enabled;
```

The `!== undefined` guard matters — `false` is the whole point of the switch.

- [ ] **Step 2: Add the toggle button to `TenantActions`**

In `src/app/admin/_components/TenantActions.tsx`, add state next to the existing flags:

```typescript
  const [togglingAi, setTogglingAi] = useState(false);
```

Add this handler after `handleResendInvite`:

```typescript
  async function handleToggleAi() {
    setTogglingAi(true);
    try {
      const next = !tenant.ai_enabled;
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_enabled: next }),
      });
      const data = (await res.json()) as { tenant?: Tenant; error?: string };
      if (res.ok) {
        success(
          next ? "AI enabled" : "AI hidden",
          next
            ? `${tenant.name} can now see AI features.`
            : `AI features are now hidden for ${tenant.name}.`
        );
        onRefresh();
      } else {
        toastError("Could not update AI visibility", data.error ?? "Please try again.");
      }
    } finally {
      setTogglingAi(false);
    }
  }
```

Add the button inside the action row, between "Edit" and the `status === "invited"` block:

```tsx
        <Button variant="secondary" onClick={handleToggleAi} disabled={togglingAi}>
          {togglingAi ? "Saving…" : tenant.ai_enabled ? "AI: On" : "AI: Off"}
        </Button>
```

- [ ] **Step 3: Add the checkbox to `EditTenantModal`**

Import `Checkbox` from `@/components/ui/FormFields` alongside the existing form primitives. Add `ai_enabled` to the modal's form state, initialised from `tenant.ai_enabled`, render it below the status field:

```tsx
      <Checkbox
        label="AI features visible to this tenant"
        checked={form.ai_enabled}
        onChange={(e) => setForm({ ...form, ai_enabled: e.target.checked })}
      />
```

and include it in the existing partial diff so it is only sent when changed:

```typescript
      if (form.ai_enabled !== tenant.ai_enabled) patch.ai_enabled = form.ai_enabled;
```

Match the file's existing diff-building style — read it before editing; do not restructure it.

- [ ] **Step 4: Update `src/app/admin/CLAUDE.md`**

In the `TenantActions.tsx` bullet, add the AI toggle to the list of rendered buttons. In the `tenants/[id]/route.ts` PATCH bullet, change the accepted shape to `{ plan?, status?, admin_email?, ai_enabled? }` and note that `ai_enabled` is the AI visibility switch — not a plan field, so it does not touch the Stripe-owns-plan invariant.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tenants/\[id\]/route.ts src/app/admin/_components/TenantActions.tsx src/app/admin/_components/EditTenantModal.tsx src/app/admin/CLAUDE.md
git commit -m "feat(admin): per-tenant AI visibility toggle"
```

- [ ] **Step 6: Ask the user to verify in the browser**

"Open `/admin`. Each tenant row should now show an `AI: On` button. Click it — it should flip to `AI: Off`, show a toast, and survive a page refresh. The Edit modal should show the same setting as a checkbox."

---

### Task 5: Admin AI usage view

**Files:**
- Create: `src/app/api/admin/ai-usage/route.ts`
- Create: `src/app/admin/_components/AiUsageModal.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/CLAUDE.md`

**Interfaces:**
- Consumes: `readTenantUsage`, `sumCalls`, `callsByUser`, `currentPeriod` (Task 2); `getAiGenerationLimit` (Task 1); `verifyPlatformAdmin(email)` from `@/lib/supabase/control` (returns `NextResponse | null`)
- Produces: `GET /api/admin/ai-usage` → `{ period: string; usage: Array<{ tenantId: string; used: number; limit: number; byUser: Record<string, number> }> }`

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/ai-usage/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient, verifyPlatformAdmin } from "@/lib/supabase/control";
import { currentPeriod, sumCalls, callsByUser, type UsageRow } from "@/lib/ai/quota";
import { getAiGenerationLimit } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

/** Current-period AI usage for every tenant, for the platform admin panel. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const forbidden = await verifyPlatformAdmin(user?.email);
  if (forbidden) return forbidden;

  const control = createControlClient();
  const period = currentPeriod();

  const { data: tenants } = await control
    .schema("control")
    .from("tenants")
    .select("id, plan");

  const { data: rows } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .select("tenant_id, user_id, kind, calls")
    .eq("period", period);

  const allRows = (rows as (UsageRow & { tenant_id: string })[] | null) ?? [];

  const usage = ((tenants as { id: string; plan: TenantPlan }[] | null) ?? []).map(
    (tenant) => {
      const mine = allRows.filter((row) => row.tenant_id === tenant.id);
      return {
        tenantId: tenant.id,
        used: sumCalls(mine),
        limit: getAiGenerationLimit(tenant.plan),
        byUser: callsByUser(mine),
      };
    }
  );

  return NextResponse.json({ period, usage });
}
```

- [ ] **Step 2: Create the breakdown modal**

Create `src/app/admin/_components/AiUsageModal.tsx`. Read `DeleteTenantModal.tsx` first and match its `Modal` usage, prop shape and class conventions exactly. It takes:

```typescript
interface Props {
  open: boolean;
  tenant: Tenant;
  used: number;
  limit: number;
  byUser: Record<string, number>;
  onClose: () => void;
}
```

It renders a heading with `tenant.name`, the headline `{used} of {limit} generations this month`, and a table of `userId` → calls sorted descending. User ids are shown raw (font-mono, truncated) — the admin panel has no access to tenant `profiles` names, and adding a cross-project name lookup here is not worth it for an internal tool. Render "No AI usage this month." when `byUser` is empty.

- [ ] **Step 3: Wire the column into the admin table**

In `src/app/admin/page.tsx`:

Add state next to `tenants`:

```typescript
  const [aiUsage, setAiUsage] = useState<Record<string, { used: number; limit: number; byUser: Record<string, number> }>>({});
  const [usageTenant, setUsageTenant] = useState<Tenant | null>(null);
```

Add a fetch effect alongside the existing one, keyed on `refreshKey`:

```typescript
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ai-usage")
      .then((r) => r.json())
      .then((data: { usage?: { tenantId: string; used: number; limit: number; byUser: Record<string, number> }[] }) => {
        if (cancelled) return;
        const map: Record<string, { used: number; limit: number; byUser: Record<string, number> }> = {};
        for (const row of data.usage ?? []) {
          map[row.tenantId] = { used: row.used, limit: row.limit, byUser: row.byUser };
        }
        setAiUsage(map);
      })
      .catch(() => { if (!cancelled) setAiUsage({}); });
    return () => { cancelled = true; };
  }, [refreshKey]);
```

Add `"AI Usage"` to the header array between `"Status"` and `"Trial Ends"`:

```typescript
                  {["Tenant", "Admin Email", "Plan", "Status", "AI Usage", "Trial Ends", "Created", "Actions"].map((h) => (
```

Add the matching cell after the Status `<td>`:

```tsx
                    <td className="py-3 pr-4">
                      {aiUsage[t.id] && aiUsage[t.id].limit > 0 ? (
                        <button
                          type="button"
                          onClick={() => setUsageTenant(t)}
                          className="text-(--color-primary) hover:underline"
                        >
                          {aiUsage[t.id].used} / {aiUsage[t.id].limit}
                        </button>
                      ) : (
                        <span className="text-(--color-text-faint)">—</span>
                      )}
                    </td>
```

And render the modal next to `AddTenantModal`:

```tsx
      {usageTenant && (
        <AiUsageModal
          open={!!usageTenant}
          tenant={usageTenant}
          used={aiUsage[usageTenant.id]?.used ?? 0}
          limit={aiUsage[usageTenant.id]?.limit ?? 0}
          byUser={aiUsage[usageTenant.id]?.byUser ?? {}}
          onClose={() => setUsageTenant(null)}
        />
      )}
```

- [ ] **Step 4: Update `src/app/admin/CLAUDE.md`**

Add `_components/AiUsageModal.tsx` to the file map, add `ai-usage/route.ts` to the API routes list, and note the new "AI Usage" column on `page.tsx` (a link showing `used / limit`, `—` for plans with no allowance).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/ai-usage src/app/admin/_components/AiUsageModal.tsx src/app/admin/page.tsx src/app/admin/CLAUDE.md
git commit -m "feat(admin): per-tenant AI usage column and breakdown modal"
```

- [ ] **Step 6: Ask the user to verify**

"`/admin` should now show an 'AI Usage' column reading `0 / 300` for Business and trial tenants, and `—` for Starter/Pro. Clicking a number opens a modal (empty until Phase 4 makes real calls)."

---

# Phase 2 — Image pipeline

### Task 6: Image resize maths

**Files:**
- Create: `src/app/dashboard/listings/_lib/imageResize.ts`
- Create: `src/app/dashboard/listings/_lib/imageResize.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_IMAGE_EDGE = 1600`, `JPEG_QUALITY = 0.85`, `MAX_UPLOAD_BYTES = 15 * 1024 * 1024`, `ALLOWED_IMAGE_TYPES: readonly string[]`
  - `fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number }`
  - `async compressImage(file: File): Promise<Blob>` (browser-only; untested)

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard/listings/_lib/imageResize.test.ts`:

```typescript
import { fitWithin, MAX_IMAGE_EDGE } from "./imageResize";

describe("fitWithin", () => {
  it("leaves an image smaller than the cap untouched", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image by its long edge", () => {
    expect(fitWithin(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait image by its long edge", () => {
    expect(fitWithin(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("rounds to whole pixels", () => {
    // 3000x2001 → scale 0.5333…; height must not come back fractional.
    const { width, height } = fitWithin(3000, 2001, 1600);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(1600);
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const { width, height } = fitWithin(5000, 3, 1600);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("handles an exactly-at-cap image as a no-op", () => {
    expect(fitWithin(MAX_IMAGE_EDGE, 900, MAX_IMAGE_EDGE)).toEqual({
      width: MAX_IMAGE_EDGE,
      height: 900,
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/app/dashboard/listings/_lib/imageResize.test.ts`
Expected: FAIL — cannot find module `./imageResize`.

- [ ] **Step 3: Implement**

Create `src/app/dashboard/listings/_lib/imageResize.ts`:

```typescript
/** eBay requires a 500px minimum long edge and renders zoom from ~1600px.
 * Anything larger is bandwidth we pay for twice — once on upload, once when
 * eBay and the vision model fetch it. */
export const MAX_IMAGE_EDGE = 1600;
export const JPEG_QUALITY = 0.85;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Scale a width/height pair down so its longest edge is at most `maxEdge`,
 * preserving aspect ratio. Returns whole pixels, never smaller than 1.
 * Pure — the canvas work that uses this lives in `compressImage`.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Browser-only: decode, downscale and re-encode as JPEG. Not unit-tested —
 * canvas and createImageBitmap do not exist in the node test environment.
 * The dimension maths it depends on is tested via `fitWithin`.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file; // no canvas support — upload the original rather than fail
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );

  return blob ?? file;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/app/dashboard/listings/_lib/imageResize.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_lib/imageResize.ts src/app/dashboard/listings/_lib/imageResize.test.ts
git commit -m "feat(listings): client-side image resize helper"
```

---

### Task 7: Storage path helper

**Files:**
- Create: `src/app/dashboard/listings/_lib/storagePath.ts`
- Create: `src/app/dashboard/listings/_lib/storagePath.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `LISTING_IMAGES_BUCKET = "listing-images"`
  - `buildImagePath(tenantSchema: string, draftId: string, fileName: string): string`
  - `pathFromPublicUrl(url: string): string | null`

**This task's edge case is the most dangerous in the plan.** Listings synced from eBay carry eBay CDN URLs. If `pathFromPublicUrl` returns a path for one of those, the app issues storage deletes against images it does not own. It must return `null` for anything outside our bucket.

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard/listings/_lib/storagePath.test.ts`:

```typescript
import { buildImagePath, pathFromPublicUrl, LISTING_IMAGES_BUCKET } from "./storagePath";

describe("buildImagePath", () => {
  it("puts the tenant schema first — the bucket RLS policy matches on it", () => {
    const path = buildImagePath("tenant_kaufnest", "draft-1", "photo.jpg");
    expect(path.startsWith("tenant_kaufnest/draft-1/")).toBe(true);
  });

  it("discards the user's filename, keeping only the extension", () => {
    const path = buildImagePath("tenant_kaufnest", "draft-1", "my holiday photo (2).JPG");
    expect(path).not.toContain("holiday");
    expect(path).not.toContain(" ");
    expect(path.endsWith(".jpg")).toBe(true);
  });

  it("defaults to .jpg when the filename has no extension", () => {
    expect(buildImagePath("tenant_a", "d1", "noextension").endsWith(".jpg")).toBe(true);
  });

  it("never collides for two files uploaded in the same millisecond", () => {
    const a = buildImagePath("tenant_a", "d1", "x.jpg");
    const b = buildImagePath("tenant_a", "d1", "x.jpg");
    expect(a).not.toBe(b);
  });
});

describe("pathFromPublicUrl", () => {
  const base = `https://abc.supabase.co/storage/v1/object/public/${LISTING_IMAGES_BUCKET}`;

  it("extracts the object path from one of our public URLs", () => {
    expect(pathFromPublicUrl(`${base}/tenant_kaufnest/draft-1/abc.jpg`)).toBe(
      "tenant_kaufnest/draft-1/abc.jpg"
    );
  });

  it("returns null for an eBay CDN URL — we must never delete eBay's images", () => {
    expect(pathFromPublicUrl("https://i.ebayimg.com/images/g/abc/s-l1600.jpg")).toBeNull();
  });

  it("returns null for a different Supabase bucket", () => {
    expect(
      pathFromPublicUrl("https://abc.supabase.co/storage/v1/object/public/avatars/x.png")
    ).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(pathFromPublicUrl("not a url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(pathFromPublicUrl("")).toBeNull();
  });

  it("strips a query string from a signed-looking URL", () => {
    expect(pathFromPublicUrl(`${base}/tenant_a/d1/x.jpg?token=abc`)).toBe("tenant_a/d1/x.jpg");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/app/dashboard/listings/_lib/storagePath.test.ts`
Expected: FAIL — cannot find module `./storagePath`.

- [ ] **Step 3: Implement**

Create `src/app/dashboard/listings/_lib/storagePath.ts`:

```typescript
export const LISTING_IMAGES_BUCKET = "listing-images";

/**
 * Object path for a listing image: `{tenant_schema}/{draftId}/{uuid}.{ext}`.
 *
 * The tenant-schema prefix is load-bearing — the bucket's write/delete RLS
 * policies (022_listing_images_bucket.sql) compare
 * `(storage.foldername(name))[1]` against the caller's JWT tenant_schema
 * claim. The user's filename is discarded entirely: it can contain spaces,
 * unicode and slashes, and two files picked in the same millisecond used to
 * collide under the old `Date.now()-name` scheme.
 */
export function buildImagePath(
  tenantSchema: string,
  draftId: string,
  fileName: string
): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = match ? match[1].toLowerCase() : "jpg";
  return `${tenantSchema}/${draftId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Object path for a URL that points into our own bucket, or `null` for any
 * other URL.
 *
 * Returning null is the important half. Listings imported from eBay hold
 * eBay CDN URLs (i.ebayimg.com); a caller that treated those as our paths
 * would issue storage deletes against images this app does not own. Callers
 * must treat null as "remove from the array only, delete nothing".
 */
export function pathFromPublicUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const marker = `/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/`;
  const index = parsed.pathname.indexOf(marker);
  if (index === -1) return null;

  const path = parsed.pathname.slice(index + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/app/dashboard/listings/_lib/storagePath.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_lib/storagePath.ts src/app/dashboard/listings/_lib/storagePath.test.ts
git commit -m "feat(listings): storage path helpers, guarding eBay CDN URLs"
```

---

### Task 8: Sortable image grid

**Files:**
- Create: `src/app/dashboard/listings/_components/ImageGrid.tsx`
- Delete: `src/app/dashboard/listings/_components/ImagesStep.tsx`
- Modify: `src/app/dashboard/listings/_lib/wizardValidation.ts` + its test
- Modify: `src/app/dashboard/listings/_components/ListingWizard.tsx` (swap the import until Task 12 replaces it)
- Modify: `package.json`

**Interfaces:**
- Consumes: `compressImage`, `MAX_UPLOAD_BYTES`, `ALLOWED_IMAGE_TYPES` (Task 6); `buildImagePath`, `pathFromPublicUrl`, `LISTING_IMAGES_BUCKET` (Task 7)
- Produces: `MAX_LISTING_IMAGES = 24`; `<ImageGrid draft setDraft draftId onDraftCreated />`

- [ ] **Step 1: Install dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable
```

- [ ] **Step 2: Write the failing validation test**

In `src/app/dashboard/listings/_lib/wizardValidation.test.ts`, add:

```typescript
import { validateImagesStep, MAX_LISTING_IMAGES } from "./wizardValidation";

function draftWith(imageCount: number) {
  return {
    ...baseDraft, // reuse whatever factory this file already defines
    image_urls: Array.from({ length: imageCount }, (_, i) => `https://x/${i}.jpg`),
  };
}

describe("validateImagesStep image cap", () => {
  it("accepts exactly the eBay maximum", () => {
    expect(validateImagesStep(draftWith(MAX_LISTING_IMAGES))).toBeNull();
  });

  it("rejects one image over the eBay maximum", () => {
    expect(validateImagesStep(draftWith(MAX_LISTING_IMAGES + 1))).toMatch(/24/);
  });

  it("still requires at least one image", () => {
    expect(validateImagesStep(draftWith(0))).toMatch(/at least one/i);
  });
});
```

Read the existing test file first and reuse its draft factory rather than inventing `baseDraft`.

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx jest src/app/dashboard/listings/_lib/wizardValidation.test.ts`
Expected: FAIL — `MAX_LISTING_IMAGES` is not exported.

- [ ] **Step 4: Implement the cap**

In `src/app/dashboard/listings/_lib/wizardValidation.ts`:

```typescript
/** eBay's per-listing picture limit. */
export const MAX_LISTING_IMAGES = 24;

export function validateImagesStep(draft: DraftFormState): string | null {
  if (draft.image_urls.length === 0) return "Add at least one image.";
  if (draft.image_urls.length > MAX_LISTING_IMAGES) {
    return `eBay allows at most ${MAX_LISTING_IMAGES} images per listing.`;
  }
  return null;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx jest src/app/dashboard/listings/_lib/wizardValidation.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `ImageGrid.tsx`**

Create `src/app/dashboard/listings/_components/ImageGrid.tsx`. Requirements, all of which matter:

- `"use client"`.
- Props: `{ draft: DraftFormState; setDraft: (patch: Partial<DraftFormState>) => void; draftId: string | null; onDraftCreated: (id: string) => Promise<string> }`.
- **Lazy draft creation.** When `draftId` is `null` and the user drops files, `await onDraftCreated()` first and upload under the returned id. This removes the old `"unsaved"` folder entirely — never upload to a literal `"unsaved"` path again.
- **Per-file validation before upload:** reject a file whose `type` is not in `ALLOWED_IMAGE_TYPES` or whose `size` exceeds `MAX_UPLOAD_BYTES`, with a per-file error message. One bad file must not abort the others — collect failures, upload the rest.
- **Cap enforcement:** refuse files that would take the total past `MAX_LISTING_IMAGES`, naming the limit.
- **Compress then upload:** `const blob = await compressImage(file)`, then `supabase.storage.from(LISTING_IMAGES_BUCKET).upload(buildImagePath(tenantSchema, id, file.name), blob, { contentType: "image/jpeg" })`.
- **Read `tenantSchema` from the session** exactly as the old `ImagesStep` did: `session?.user.app_metadata?.tenant_schema`. Do not default to `"public"` — if it is missing, show an error and upload nothing.
- **Sortable grid** via `DndContext` + `SortableContext` from dnd-kit, `rectSortingStrategy`. On drag end, reorder `draft.image_urls` and call `setDraft({ image_urls: reordered })`.
- **Slot 1 carries a visible "Gallery image" badge** — it is eBay's search thumbnail.
- **Remove deletes the object:**

```typescript
  async function removeImage(url: string) {
    setDraft({ image_urls: draft.image_urls.filter((u) => u !== url) });

    // Imported eBay listings hold eBay CDN URLs — pathFromPublicUrl returns
    // null for those and we must not attempt a delete.
    const path = pathFromPublicUrl(url);
    if (!path) return;

    const { error } = await createClient()
      .storage.from(LISTING_IMAGES_BUCKET)
      .remove([path]);
    // A failed cleanup must never block the seller — the row is already updated.
    if (error) console.warn("Failed to delete listing image", path, error);
  }
```

- Keep the empty state ("At least one image is required.") and show `{draft.image_urls.length} / 24` alongside it.

- [ ] **Step 7: Swap the import and delete the old step**

In `ListingWizard.tsx`, replace the `ImagesStep` import and its render site with `ImageGrid`, passing an `onDraftCreated` callback that runs the existing insert path in `toPayload()` and returns the new row's id. Then delete `_components/ImagesStep.tsx`.

- [ ] **Step 8: Update docs**

`listings/CLAUDE.md`: replace `ImagesStep.tsx` with `ImageGrid.tsx` in the file map, describing drag-reorder, the 24 cap, compression and delete-on-remove.

`listings/SKILL.md`: replace the "Unsaved-draft image orphaning" gotcha — it is now fixed — with two new ones: (a) `pathFromPublicUrl` returns `null` for eBay CDN URLs and callers must treat that as remove-only, never delete; (b) the draft row is created lazily on first upload, which is not autosave — later field edits still need Save Draft.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/app/dashboard/listings/
git commit -m "feat(listings): sortable image grid with compression and cleanup"
```

- [ ] **Step 10: Ask the user to verify**

"On `/dashboard/listings/new`, upload several images. Check: they compress (inspect the stored file size), drag-reorder works and slot 1 is badged 'Gallery image', removing one deletes it from Storage, a 25th image is refused, and a `.pdf` is rejected without breaking the other uploads in the same batch."

---

# Phase 3 — Form rewrite and preview

### Task 9: Listing quality score

**Files:**
- Create: `src/app/dashboard/listings/_lib/listingQuality.ts`
- Create: `src/app/dashboard/listings/_lib/listingQuality.test.ts`

**Interfaces:**
- Consumes: `DraftFormState` from `./wizardValidation`
- Produces:
  - `interface QualityCheck { id: string; label: string; weight: number; passed: boolean; hint: string }`
  - `scoreListing(draft: DraftFormState): { score: number; checks: QualityCheck[] }`

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard/listings/_lib/listingQuality.test.ts`:

```typescript
import { scoreListing } from "./listingQuality";
import type { DraftFormState } from "./wizardValidation";

const emptyDraft: DraftFormState = {
  source_type: "inventory", product_id: "", source_url: "",
  title: "", description: "", price: "0", currency: "EUR",
  quantity: "1", condition: "new", category_id: "", category_name: "",
  image_urls: [], aspects: {}, required_aspect_names: [],
  fulfillment_policy_id: "", payment_policy_id: "",
  return_policy_id: "", merchant_location_key: "",
};

const goodDraft: DraftFormState = {
  ...emptyDraft,
  title: "Logitech MX Master 3S Wireless Mouse Bluetooth USB-C Graphite Boxed",
  description: "x".repeat(400),
  price: "79.99",
  category_id: "12345",
  image_urls: Array.from({ length: 8 }, (_, i) => `https://x/${i}.jpg`),
  required_aspect_names: ["Brand"],
  aspects: { Brand: "Logitech" },
  fulfillment_policy_id: "f1", payment_policy_id: "p1",
  return_policy_id: "r1", merchant_location_key: "loc1",
};

describe("scoreListing", () => {
  it("scores an empty draft at zero", () => {
    expect(scoreListing(emptyDraft).score).toBe(0);
  });

  it("scores a complete, well-formed draft at 100", () => {
    expect(scoreListing(goodDraft).score).toBe(100);
  });

  it("never returns a score outside 0-100", () => {
    for (const draft of [emptyDraft, goodDraft]) {
      const { score } = scoreListing(draft);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("fails the title check for a short title", () => {
    const { checks } = scoreListing({ ...goodDraft, title: "Mouse" });
    expect(checks.find((c) => c.id === "title")?.passed).toBe(false);
  });

  it("passes the title check at exactly 60 characters", () => {
    const { checks } = scoreListing({ ...goodDraft, title: "x".repeat(60) });
    expect(checks.find((c) => c.id === "title")?.passed).toBe(true);
  });

  it("fails the images check below six images", () => {
    const { checks } = scoreListing({
      ...goodDraft,
      image_urls: ["a", "b", "c", "d", "e"],
    });
    expect(checks.find((c) => c.id === "images")?.passed).toBe(false);
  });

  it("fails the aspects check when a required aspect is blank", () => {
    const { checks } = scoreListing({ ...goodDraft, aspects: { Brand: "  " } });
    expect(checks.find((c) => c.id === "aspects")?.passed).toBe(false);
  });

  it("passes the aspects check when the category requires none", () => {
    const { checks } = scoreListing({
      ...goodDraft,
      required_aspect_names: [],
      aspects: {},
    });
    expect(checks.find((c) => c.id === "aspects")?.passed).toBe(true);
  });

  it("gives every failing check an actionable hint", () => {
    for (const check of scoreListing(emptyDraft).checks) {
      expect(check.hint.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/app/dashboard/listings/_lib/listingQuality.test.ts`
Expected: FAIL — cannot find module `./listingQuality`.

- [ ] **Step 3: Implement**

Create `src/app/dashboard/listings/_lib/listingQuality.ts`:

```typescript
import type { DraftFormState } from "./wizardValidation";

export interface QualityCheck {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  hint: string;
}

/** eBay indexes the whole 80-character title; most sellers stop around 40
 * and lose search coverage for it. 60 is the point where that stops hurting. */
const GOOD_TITLE_MIN = 60;
const GOOD_IMAGE_COUNT = 6;
const GOOD_DESCRIPTION_CHARS = 300;

/**
 * Score a draft 0-100 on how well it will perform as an eBay listing —
 * distinct from `wizardValidation`, which answers whether it can be
 * published at all. Every check carries a hint saying what to do about it.
 */
export function scoreListing(draft: DraftFormState): {
  score: number;
  checks: QualityCheck[];
} {
  const requiredAspectsFilled = draft.required_aspect_names.every((name) =>
    draft.aspects[name]?.trim()
  );

  const checks: QualityCheck[] = [
    {
      id: "title",
      label: "Descriptive title",
      weight: 25,
      passed: draft.title.trim().length >= GOOD_TITLE_MIN,
      hint: `Use at least ${GOOD_TITLE_MIN} of the 80 characters — eBay searches the whole title, so brand, model, size and colour all earn their place.`,
    },
    {
      id: "images",
      label: "Enough photos",
      weight: 20,
      passed: draft.image_urls.length >= GOOD_IMAGE_COUNT,
      hint: `Add at least ${GOOD_IMAGE_COUNT} photos. Buyers who cannot see an angle assume the worst about it.`,
    },
    {
      id: "aspects",
      label: "Item specifics complete",
      weight: 20,
      passed: requiredAspectsFilled,
      hint: "Fill every required item specific — eBay filters search results on these, so a blank one hides your listing.",
    },
    {
      id: "description",
      label: "Substantial description",
      weight: 15,
      passed: draft.description.trim().length >= GOOD_DESCRIPTION_CHARS,
      hint: `Write at least ${GOOD_DESCRIPTION_CHARS} characters covering condition, what is included, and dimensions.`,
    },
    {
      id: "category",
      label: "Category chosen",
      weight: 10,
      passed: !!draft.category_id,
      hint: "Pick the most specific category that fits — it decides which item specifics eBay asks for.",
    },
    {
      id: "price",
      label: "Price set",
      weight: 5,
      passed: Number(draft.price) > 0,
      hint: "Set a price above zero.",
    },
    {
      id: "policies",
      label: "Policies selected",
      weight: 5,
      passed:
        !!draft.fulfillment_policy_id &&
        !!draft.payment_policy_id &&
        !!draft.return_policy_id &&
        !!draft.merchant_location_key,
      hint: "Choose a fulfillment, payment and return policy plus an inventory location — eBay rejects a publish without all four.",
    },
  ];

  const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return { score, checks };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/app/dashboard/listings/_lib/listingQuality.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_lib/listingQuality.ts src/app/dashboard/listings/_lib/listingQuality.test.ts
git commit -m "feat(listings): listing quality scoring"
```

---

### Task 10: eBay-safe HTML sanitization

**Files:**
- Create: `src/lib/utils/sanitizeListingHtml.ts`
- Create: `src/lib/utils/sanitizeListingHtml.test.ts`
- Modify: `src/lib/integrations/ebay/publishPayloads.ts`
- Modify: `src/lib/integrations/ebay/publishPayloads.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `sanitizeListingHtml(html: string): string`

- [ ] **Step 1: Install the sanitizer**

```bash
npm install isomorphic-dompurify
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/utils/sanitizeListingHtml.test.ts`:

```typescript
import { sanitizeListingHtml } from "./sanitizeListingHtml";

describe("sanitizeListingHtml", () => {
  it("keeps the formatting eBay allows", () => {
    const html = "<p>A <strong>great</strong> <em>mouse</em></p><ul><li>USB-C</li></ul>";
    expect(sanitizeListingHtml(html)).toBe(html);
  });

  it("strips script tags — eBay blocks active content", () => {
    const out = sanitizeListingHtml('<p>Hi</p><script>alert("x")</script>');
    expect(out).not.toContain("script");
    expect(out).toContain("<p>Hi</p>");
  });

  it("strips inline event handlers", () => {
    expect(sanitizeListingHtml('<p onclick="steal()">Hi</p>')).not.toContain("onclick");
  });

  it("strips iframes and forms", () => {
    const out = sanitizeListingHtml("<iframe src='x'></iframe><form><input/></form><p>ok</p>");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("form");
    expect(out).toContain("<p>ok</p>");
  });

  it("strips javascript: URLs from links", () => {
    expect(sanitizeListingHtml('<a href="javascript:evil()">x</a>')).not.toContain("javascript:");
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeListingHtml("")).toBe("");
  });

  it("escapes a plain-text description rather than dropping it", () => {
    expect(sanitizeListingHtml("Just plain text")).toContain("Just plain text");
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx jest src/lib/utils/sanitizeListingHtml.test.ts`
Expected: FAIL — cannot find module `./sanitizeListingHtml`.

- [ ] **Step 4: Implement**

Create `src/lib/utils/sanitizeListingHtml.ts`:

```typescript
import DOMPurify from "isomorphic-dompurify";

/**
 * eBay accepts HTML in item descriptions but blocks active content
 * (JavaScript, forms, iframes) — listings containing it are rejected or
 * stripped. This is the enforcement point: descriptions are written straight
 * to `ebay_listing_drafts` from the browser, so the editor's own restrictions
 * are cosmetic and this must run server-side before anything reaches eBay.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u",
  "ul", "ol", "li", "h2", "h3", "a", "span",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel"];

export function sanitizeListingHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx jest src/lib/utils/sanitizeListingHtml.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing payload test**

Add to `src/lib/integrations/ebay/publishPayloads.test.ts` (reuse the file's existing draft factory):

```typescript
describe("description sanitization", () => {
  it("strips active content from the inventory item description", () => {
    const draft = { ...baseDraft, description: '<p>Nice</p><script>evil()</script>' };
    const payload = buildInventoryItemPayload(draft);
    expect(payload.product.description).not.toContain("script");
    expect(payload.product.description).toContain("Nice");
  });

  it("strips active content from the offer listing description", () => {
    const draft = { ...baseDraft, description: '<p onclick="evil()">Nice</p>' };
    const payload = buildOfferPayload(draft, "EBAY_DE", "loc1");
    expect(payload.listingDescription).not.toContain("onclick");
  });

  it("still falls back to the title when the description is null", () => {
    const draft = { ...baseDraft, description: null };
    expect(buildOfferPayload(draft, "EBAY_DE", "loc1").listingDescription).toBe(draft.title);
  });
});
```

- [ ] **Step 7: Run and confirm it fails**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: FAIL — script tag still present.

- [ ] **Step 8: Sanitize in both payload builders**

In `src/lib/integrations/ebay/publishPayloads.ts`, import the helper and wrap both description fields:

```typescript
import { sanitizeListingHtml } from "@/lib/utils/sanitizeListingHtml";
```

In `buildInventoryItemPayload`, change the description line to:

```typescript
      description: sanitizeListingHtml(draft.description ?? ""),
```

In `buildOfferPayload`:

```typescript
    listingDescription: draft.description
      ? sanitizeListingHtml(draft.description)
      : draft.title,
```

Note the fallback moves from `??` to a truthiness check so an empty-after-sanitization description still falls back to the title.

- [ ] **Step 9: Run and confirm it passes**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: PASS.

- [ ] **Step 10: Update `listings/SKILL.md`**

Add a gotcha: description HTML is sanitized in `publishPayloads.ts`, not in the editor, because drafts are written to Supabase directly from the browser — the client is not a security boundary. Both eBay description fields go through it.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/lib/utils/sanitizeListingHtml.ts src/lib/utils/sanitizeListingHtml.test.ts src/lib/integrations/ebay/publishPayloads.ts src/lib/integrations/ebay/publishPayloads.test.ts src/app/dashboard/listings/SKILL.md
git commit -m "feat(listings): sanitize description HTML before it reaches eBay"
```

---

### Task 11: Listing preview panel

**Files:**
- Create: `src/app/dashboard/listings/_components/ListingPreview.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`

**Interfaces:**
- Consumes: `scoreListing` (Task 9), `sanitizeListingHtml` (Task 10), `DraftFormState`
- Produces: `<ListingPreview draft={draft} />`

- [ ] **Step 1: Build the component**

Create `src/app/dashboard/listings/_components/ListingPreview.tsx`, `"use client"`. It renders, in order:

1. A heading `Approximate eBay preview` in muted text — it is not pixel-identical and must not claim to be.
2. The gallery: `draft.image_urls[0]` large, the rest as thumbnails; a neutral placeholder when empty. Use `<img>` with the `eslint-disable-next-line @next/next/no-img-element` comment the codebase already uses.
3. `draft.title` (or "Untitled listing" in faint text), then price via `formatCurrency(Number(draft.price), draft.currency)` from `@/lib/utils/currency`, then the condition.
4. An item-specifics table from `Object.entries(draft.aspects).filter(([, v]) => v.trim())`, hidden entirely when empty.
5. The description via `dangerouslySetInnerHTML={{ __html: sanitizeListingHtml(draft.description) }}`. Sanitize here too — this is cosmetic defence-in-depth; Task 10 is the real gate.
6. The quality meter: `scoreListing(draft)` → a percentage bar coloured by band (`<50` danger, `<80` warning, else success, using the existing `--color-danger` / `--color-warning` / `--color-success` tokens), followed by the failing checks as a list of `label` + `hint`. Passing checks are not listed — a checklist of things already done is noise.

- [ ] **Step 2: Update `listings/CLAUDE.md`**

Add `ListingPreview.tsx` and `_lib/listingQuality.ts` to the file map.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/listings/_components/ListingPreview.tsx src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): eBay preview panel with quality score"
```

---

### Task 12: Single-page form rewrite

**Files:**
- Create: `src/app/dashboard/listings/_components/ListingForm.tsx`
- Delete: `src/app/dashboard/listings/_components/ListingWizard.tsx`
- Modify: `src/app/dashboard/listings/new/page.tsx`, `src/app/dashboard/listings/[id]/page.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`, `SKILL.md`

**Interfaces:**
- Consumes: every step component, `ImageGrid` (Task 8), `ListingPreview` (Task 11), all validators
- Produces: `<ListingForm draftId={string | null} />`

- [ ] **Step 1: Read `ListingWizard.tsx` end to end**

Before writing anything, read the whole file. `ListingForm` must preserve: the draft-loading effect, `toPayload()`, `created_by` set **only** on insert, the audit-log write, the `status === "published"` → `[id]/live` redirect, the `status === "inactive"` → list redirect with toast, and the publish call to `POST /api/listings/[id]/publish`. This task changes layout, not behaviour.

- [ ] **Step 2: Build the layout**

`ListingForm.tsx`, `"use client"`, two columns at `lg` and above (`lg:grid-cols-[1fr_380px]`), single column below:

Left column — one `<form id="listing-form" onSubmit={handlePublish}>` containing three `<section>`s with headings:

- **Item** — `SourceStep`, title `<Input required maxLength={80}>`, description (`<Textarea>` for now; Task 17 swaps in the editor), `ImageGrid`
- **Listing** — `CategoryStep`, `AspectsStep`, price / currency / quantity / condition
- **Shipping** — `PoliciesStep`

Right column — `<ListingPreview draft={draft} />` inside a `lg:sticky lg:top-6` wrapper.

Bottom — a sticky action bar with Save Draft and Publish.

- [ ] **Step 3: Get the two button states right**

This is the part most likely to be done wrong. Compute:

```typescript
  // Publish requires every validator to pass. Save Draft deliberately does
  // not: drafts are allowed to be incomplete (see SKILL.md) and a Save Draft
  // that can always succeed must never render as disabled.
  const publishError =
    validateSourceStep(draft) ??
    validateDetailsStep(draft) ??
    validateCategoryStep(draft) ??
    validateAspectsStep(draft) ??
    validateImagesStep(draft) ??
    validatePoliciesStep(draft);

  const isPublishable = publishError === null;
```

Then:

```tsx
        <Button variant="secondary" onClick={handleSaveDraft} disabled={saving || publishing}>
          {saving ? "Saving…" : "Save Draft"}
        </Button>
        <Button type="submit" form="listing-form" disabled={publishing || saving || !isPublishable}>
          {publishing ? "Publishing…" : "Publish to eBay"}
        </Button>
```

When `!isPublishable`, render `publishError` as muted helper text next to the button so a disabled Publish always explains itself.

- [ ] **Step 4: Add `required` to the real inputs**

`<Field required>` only draws the asterisk. Every field marked required must also carry the attribute on the control itself — title, price, quantity at minimum.

- [ ] **Step 5: Point both routes at the new component**

`new/page.tsx` renders `<ListingForm draftId={null} />`; `[id]/page.tsx` renders `<ListingForm draftId={id} />`. Keep both wrapped in `BusinessEbayGate` exactly as they are now. Delete `ListingWizard.tsx`.

- [ ] **Step 6: Update docs**

`CLAUDE.md`: replace every `ListingWizard.tsx` reference with `ListingForm.tsx`, describe the three-section single-page layout with the sticky preview, and remove the step/`STEPS` description.

`SKILL.md`: rewrite the "validators only run on Next" gotcha — validators now run continuously and gate Publish, while Save Draft stays permissive by design. Note that this reconciles the form convention with the documented incomplete-draft behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/listings/
git commit -m "feat(listings): single-page listing form with sticky preview"
```

- [ ] **Step 8: Ask the user to verify**

"Open `/dashboard/listings/new`. Everything should be on one page in three sections with a live preview on the right that updates as you type, and a quality score that climbs as you fill fields in. Publish should be disabled with an explanation until the listing is complete; Save Draft should always be clickable. Then open an existing draft and confirm it still loads, saves and publishes."

---

# Phase 4 — AI

### Task 13: Anthropic client and prompt builders

**Files:**
- Create: `src/lib/ai/client.ts`, `src/lib/ai/prompts.ts`, `src/lib/ai/prompts.test.ts`
- Modify: `package.json`, `.env.local.example`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `anthropic` client, `AI_MODEL = "claude-opus-5"`
  - `DESCRIBE_SYSTEM_PROMPT`, `ASPECTS_SYSTEM_PROMPT` (frozen strings)
  - `buildAspectSchema(requiredAspectNames: string[]): object`
  - `buildDescribeUserPrompt(input: DescribeInput): string`

- [ ] **Step 1: Install the SDK and add the env var**

```bash
npm install @anthropic-ai/sdk
```

Add to `.env.local.example`:

```
# Anthropic API key for AI listing assistance (server-only — never NEXT_PUBLIC_)
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/ai/prompts.test.ts`:

```typescript
import {
  buildAspectSchema,
  buildDescribeUserPrompt,
  DESCRIBE_SYSTEM_PROMPT,
  ASPECTS_SYSTEM_PROMPT,
} from "./prompts";

describe("buildAspectSchema", () => {
  it("declares one string property per required aspect", () => {
    const schema = buildAspectSchema(["Brand", "Colour"]) as {
      properties: Record<string, { type: string }>;
    };
    expect(Object.keys(schema.properties)).toEqual(["Brand", "Colour"]);
    expect(schema.properties.Brand.type).toBe("string");
  });

  it("forbids extra properties so eBay never sees an invented aspect", () => {
    const schema = buildAspectSchema(["Brand"]) as { additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
  });

  it("requires every aspect key to be present, so blanks are explicit", () => {
    const schema = buildAspectSchema(["Brand", "Colour"]) as { required: string[] };
    expect(schema.required).toEqual(["Brand", "Colour"]);
  });

  it("handles aspect names containing spaces and slashes", () => {
    const schema = buildAspectSchema(["Model Number", "Height/Width"]) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(["Model Number", "Height/Width"]);
  });

  it("produces a valid empty schema when no aspects are required", () => {
    const schema = buildAspectSchema([]) as { properties: object; required: string[] };
    expect(schema.properties).toEqual({});
    expect(schema.required).toEqual([]);
  });
});

describe("system prompts", () => {
  // Prompt caching is a prefix match: any byte change invalidates the cache
  // and silently multiplies cost. These assert the prompts are constants,
  // not templates built per request.
  it("are non-empty constants", () => {
    expect(DESCRIBE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(ASPECTS_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("are byte-stable across reads", () => {
    expect(DESCRIBE_SYSTEM_PROMPT).toBe(DESCRIBE_SYSTEM_PROMPT);
    expect(DESCRIBE_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamp
  });

  it("tell the model which HTML tags are permitted", () => {
    expect(DESCRIBE_SYSTEM_PROMPT).toContain("<p>");
  });

  it("tell the aspect model to return empty rather than guess", () => {
    expect(ASPECTS_SYSTEM_PROMPT.toLowerCase()).toContain("empty string");
  });
});

describe("buildDescribeUserPrompt", () => {
  it("includes the title and category", () => {
    const prompt = buildDescribeUserPrompt({
      mode: "generate",
      title: "Logitech MX Master 3S",
      condition: "new",
      categoryName: "Mice & Trackballs",
      aspects: { Brand: "Logitech" },
    });
    expect(prompt).toContain("Logitech MX Master 3S");
    expect(prompt).toContain("Mice & Trackballs");
    expect(prompt).toContain("Brand: Logitech");
  });

  it("includes the current description when improving", () => {
    const prompt = buildDescribeUserPrompt({
      mode: "improve",
      title: "T", condition: "used", categoryName: "C", aspects: {},
      currentHtml: "<p>existing copy</p>",
    });
    expect(prompt).toContain("existing copy");
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `npx jest src/lib/ai/prompts.test.ts`
Expected: FAIL — cannot find module `./prompts`.

- [ ] **Step 4: Implement the client**

Create `src/lib/ai/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

/** Server-only. Never import from a "use client" file. */
export const anthropic = new Anthropic();

export const AI_MODEL = "claude-opus-5";

/** Description writing and aspect extraction are short structured tasks, not
 * reasoning problems — low effort is the cost lever that costs no quality. */
export const AI_EFFORT = "low" as const;
```

- [ ] **Step 5: Implement the prompts**

Create `src/lib/ai/prompts.ts`. The two system prompts must be module-level `const` strings with **no interpolation** — a single interpolated value would break prompt caching on every request.

```typescript
export interface DescribeInput {
  mode: "generate" | "improve";
  title: string;
  condition: string;
  categoryName: string;
  aspects: Record<string, string>;
  currentHtml?: string;
}

export const DESCRIBE_SYSTEM_PROMPT = `You write eBay item descriptions for third-party sellers.

Output rules:
- Return ONLY an HTML fragment. No markdown, no code fences, no commentary.
- Permitted tags: <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>, <h2>, <h3>.
- Never emit <script>, <style>, <iframe>, <form>, or any on* attribute — eBay rejects active content.
- Never emit inline styles, tables, or fixed widths. Most eBay buyers are on mobile.

Content rules:
- Lead with one short paragraph covering what the item is and who it suits.
- Follow with a bulleted list of concrete specifications.
- Close with a short paragraph on condition and what is included in the box.
- State only what the seller's data supports. Never invent measurements, model numbers, compatibility or warranty terms.
- No shipping, returns or payment claims — those come from the seller's eBay policies, and a contradiction here creates a dispute.
- Plain, factual British English. No hype, no exclamation marks, no "must-have".`;

export const ASPECTS_SYSTEM_PROMPT = `You extract eBay item specifics from a product listing.

You receive a title, a description, and up to four product photos. Return a value for each requested aspect.

Rules:
- Return an empty string for any aspect you cannot determine with confidence from the evidence given.
- Never guess a brand, model number, or size. A wrong item specific gets a listing demoted or removed, which is far worse for the seller than a blank field.
- Use the exact spelling and capitalisation a manufacturer would use.
- Values must be short — a word or two, not a sentence.`;

/**
 * JSON schema for structured output, built from the aspect names eBay's
 * Taxonomy API says this category requires. `additionalProperties: false`
 * means the model physically cannot return an aspect eBay did not ask for.
 */
export function buildAspectSchema(requiredAspectNames: string[]): object {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const name of requiredAspectNames) {
    properties[name] = {
      type: "string",
      description: `Value for the eBay item specific "${name}", or an empty string if it cannot be determined.`,
    };
  }

  return {
    type: "object",
    properties,
    required: [...requiredAspectNames],
    additionalProperties: false,
  };
}

export function buildDescribeUserPrompt(input: DescribeInput): string {
  const aspectLines = Object.entries(input.aspects)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `- ${name}: ${value}`)
    .join("\n");

  const parts = [
    `Title: ${input.title}`,
    `Category: ${input.categoryName || "(not set)"}`,
    `Condition: ${input.condition}`,
    aspectLines ? `Item specifics:\n${aspectLines}` : "Item specifics: (none provided)",
  ];

  if (input.mode === "improve" && input.currentHtml) {
    parts.push(
      `\nRewrite the seller's existing description below. Keep every fact it states; improve structure, completeness and clarity.\n\n${input.currentHtml}`
    );
  } else {
    parts.push("\nWrite a new description for this item.");
  }

  return parts.join("\n");
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx jest src/lib/ai/prompts.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.local.example src/lib/ai/client.ts src/lib/ai/prompts.ts src/lib/ai/prompts.test.ts
git commit -m "feat(ai): Anthropic client and cache-stable prompt builders"
```

- [ ] **Step 8: Ask the user for the key**

"Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` and to the deployment environment. Nothing in Phase 4 works without it."

---

### Task 14: Shared AI route guard

**Files:**
- Create: `src/lib/ai/authGuard.ts`

**Interfaces:**
- Consumes: `hasPermission` (`@/lib/utils/permissions`), `hasAiFeatures` + `getAiGenerationLimit` (Task 1), `readTenantUsage` + `sumCalls` (Task 2), `createControlClient`
- Produces:

```typescript
export interface AiAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
  tenantId: string;
  used: number;
  limit: number;
}
export type AiAuthResult =
  | { context: AiAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };
export async function requireAiAccess(): Promise<AiAuthResult>;
```

- [ ] **Step 1: Implement the guard**

Create `src/lib/ai/authGuard.ts`, modelled directly on `src/lib/integrations/authGuard.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { hasPermission } from "@/lib/utils/permissions";
import { hasAiFeatures, getAiGenerationLimit } from "@/lib/utils/planGating";
import { readTenantUsage, sumCalls } from "@/lib/ai/quota";
import type { Profile, TenantPlan } from "@/types";

export interface AiAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
  tenantId: string;
  used: number;
  limit: number;
}

export type AiAuthResult =
  | { context: AiAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Guard for `/api/listings/ai/*`. Checks, in order: signed in, has a tenant,
 * holds `manage_listings`, the plan includes AI, the platform admin has not
 * hidden AI for this tenant, and the tenant has quota left.
 *
 * The UI hides AI controls when the plan or tenant flag says so, but hidden
 * chrome is presentation — this is the enforcement.
 */
export async function requireAiAccess(): Promise<AiAuthResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role, permission_overrides")
    .eq("id", user.id)
    .single<Pick<Profile, "role" | "permission_overrides">>();

  if (!profile?.role || !hasPermission(profile.role, "manage_listings", profile.permission_overrides)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("id, plan, ai_enabled")
    .eq("schema_name", tenantSchema)
    .single();

  const row = tenant as { id: string; plan: TenantPlan; ai_enabled: boolean } | null;
  if (!row) {
    return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }

  if (!hasAiFeatures(row.plan) || !row.ai_enabled) {
    return {
      error: NextResponse.json({ error: "AI features are not available on this account." }, { status: 403 }),
    };
  }

  const limit = getAiGenerationLimit(row.plan);
  const used = sumCalls(await readTenantUsage(row.id));

  if (used >= limit) {
    return {
      error: NextResponse.json(
        { error: `Your team has used all ${limit} AI generations for this month.`, used, limit },
        { status: 429 }
      ),
    };
  }

  return {
    context: { client, userId: user.id, tenantSchema, tenantId: row.id, used, limit },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/authGuard.ts
git commit -m "feat(ai): shared guard for AI routes"
```

---

### Task 15: Describe and aspects routes

**Files:**
- Create: `src/app/api/listings/ai/describe/route.ts`
- Create: `src/app/api/listings/ai/aspects/route.ts`
- Create: `src/app/api/listings/ai/usage/route.ts`

**Interfaces:**
- Consumes: `requireAiAccess` (Task 14), `anthropic`/`AI_MODEL`/`AI_EFFORT` (Task 13), prompts (Task 13), `recordUsage`/`readTenantUsage`/`callsByUser`/`sumCalls` (Task 2), `sanitizeListingHtml` (Task 10)
- Produces: the three routes described in the spec

- [ ] **Step 1: Write the shared error mapper**

Create `src/lib/ai/errors.ts` — both routes use it, so it starts here rather than being extracted later:

```typescript
import Anthropic from "@anthropic-ai/sdk";

/**
 * Map provider errors to copy a seller can act on. Raw provider errors must
 * never reach the client — the same rule this codebase applies to Postgres
 * errors, and the verifier flags violations of it.
 */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "The AI service is busy. Try again in a moment.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "AI is not configured correctly. Contact support.";
  }
  if (err instanceof Anthropic.APIError) {
    return "The AI service could not complete this request. Try again.";
  }
  return "Something went wrong. Try again.";
}
```

- [ ] **Step 2: Write the describe route**

Create `src/app/api/listings/ai/describe/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAiAccess } from "@/lib/ai/authGuard";
import { anthropic, AI_MODEL, AI_EFFORT } from "@/lib/ai/client";
import { DESCRIBE_SYSTEM_PROMPT, buildDescribeUserPrompt, type DescribeInput } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/quota";
import { aiErrorMessage } from "@/lib/ai/errors";
import { sanitizeListingHtml } from "@/lib/utils/sanitizeListingHtml";

export async function POST(req: NextRequest) {
  const auth = await requireAiAccess();
  if (auth.error) return auth.error;
  const { userId, tenantId } = auth.context;

  const body = (await req.json()) as DescribeInput;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "A title is required before writing a description." }, { status: 400 });
  }

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      output_config: { effort: AI_EFFORT },
      system: [
        {
          type: "text",
          text: DESCRIBE_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildDescribeUserPrompt(body) }],
    });

    // Tokens are billed whatever the stop reason, including a refusal.
    await recordUsage({
      tenantId,
      userId,
      kind: "describe",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant declined to write this description. Try rephrasing the title." },
        { status: 422 }
      );
    }

    const html = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return NextResponse.json({ html: sanitizeListingHtml(html) });
  } catch (err) {
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Write the aspects route**

Create `src/app/api/listings/ai/aspects/route.ts`. Same guard, same usage recording, same `aiErrorMessage` import from `@/lib/ai/errors`. Differences:

- Body: `{ requiredAspectNames: string[]; title: string; description: string; imageUrls: string[] }`.
- Return `{ aspects: {} }` immediately when `requiredAspectNames` is empty — no API call, no quota spend.
- Build content blocks with **at most the first 4 images**:

```typescript
    const images = body.imageUrls.slice(0, 4).map((url) => ({
      type: "image" as const,
      source: { type: "url" as const, url },
    }));

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1000,
      output_config: {
        effort: AI_EFFORT,
        format: {
          type: "json_schema" as const,
          schema: buildAspectSchema(body.requiredAspectNames),
        },
      },
      system: [
        { type: "text", text: ASPECTS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `Title: ${body.title}\n\nDescription:\n${body.description}\n\nExtract these item specifics: ${body.requiredAspectNames.join(", ")}`,
            },
          ],
        },
      ],
    });
```

- Parse the JSON response with `JSON.parse` (never string matching — escaping varies), and drop any key not in `requiredAspectNames` as belt-and-braces on top of `additionalProperties: false`.

- [ ] **Step 4: Write the usage route**

Create `src/app/api/listings/ai/usage/route.ts`. It must NOT use `requireAiAccess` — that guard 429s when quota is exhausted, which is exactly when the UI most needs to read usage. Instead: resolve the user, read the tenant row, and return

```typescript
{ limit, tenantUsed, mine: { calls }, perUser?: [{ userId, name, calls }] }
```

`perUser` only when the caller's role is `admin` or `super_admin`. Resolve names by reading `profiles` (`id, full_name`) through the caller's tenant client for the ids present in `callsByUser`, then map; ids with no matching profile fall back to `"Unknown user"`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/listings/ai src/lib/ai/errors.ts
git commit -m "feat(ai): describe, aspects and usage routes"
```

---

### Task 16: Description editor with AI actions

**Files:**
- Create: `src/app/dashboard/listings/_components/DescriptionEditor.tsx`
- Create: `src/app/dashboard/listings/_components/AiUsageNote.tsx`
- Modify: `src/app/dashboard/listings/_components/ListingForm.tsx`
- Modify: `src/app/dashboard/listings/_components/AspectsStep.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `/api/listings/ai/describe`, `/api/listings/ai/aspects`, `/api/listings/ai/usage`
- Produces: `<DescriptionEditor value onChange draft aiVisible />`, `<AiUsageNote />`

- [ ] **Step 1: Install TipTap**

```bash
npm install @tiptap/react @tiptap/starter-kit
```

- [ ] **Step 2: Build the editor**

`DescriptionEditor.tsx`, `"use client"`. Configure `StarterKit` with only the marks the sanitizer allows — disable `codeBlock`, `blockquote`, `horizontalRule` and `image`. A toolbar of bold / italic / bullet list / ordered list / H2 / H3. `onUpdate` emits `editor.getHTML()`.

Two AI buttons, rendered **only when `aiVisible`** — not disabled, absent:

```tsx
  {aiVisible && (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => runAi("generate")} disabled={aiBusy}>
        {aiBusy ? <><Loader2 size={14} className="animate-spin" /> Writing…</> : "Write with AI"}
      </Button>
      {hasContent && (
        <Button variant="secondary" onClick={() => runAi("improve")} disabled={aiBusy}>
          {aiBusy ? "Improving…" : "Improve with AI"}
        </Button>
      )}
    </div>
  )}
```

`runAi` posts to `/api/listings/ai/describe`, and on success calls `editor.commands.setContent(json.html)`. On failure it shows `toastError` and leaves the editor untouched — never a partial write. A `429` shows the quota message from the response body.

`aiVisible` is computed in `ListingForm` as:

```typescript
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const aiEnabled = useAppSelector((s) => s.currentUser.aiEnabled);
  const aiVisible = !!tenantPlan && hasAiFeatures(tenantPlan) && aiEnabled;
```

- [ ] **Step 3: Add AI fill to `AspectsStep`**

Add a "Fill with AI" button above the aspect fields, shown only when `aiVisible` and `required_aspect_names.length > 0`. It posts the title, description and `image_urls` to `/api/listings/ai/aspects`, then merges non-empty values into `draft.aspects` and records which names came from AI in local state:

```typescript
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
```

Each AI-filled field renders a small "AI" badge, and the name is removed from `aiFilled` on the field's first `onChange` — once the seller edits it, it is theirs. Empty strings returned by the model are **not** merged: a blank means "could not determine", and writing it would look like a confident answer.

- [ ] **Step 4: Build `AiUsageNote`**

Fetches `/api/listings/ai/usage` on mount. Renders `You've used {mine.calls} of your team's {limit} AI generations this month.` For admins, adds a per-user breakdown list. Renders nothing when `aiVisible` is false. Place it under the AI buttons in `ListingForm`.

- [ ] **Step 5: Update docs**

`CLAUDE.md`: add `DescriptionEditor.tsx` and `AiUsageNote.tsx` to the file map, plus `src/lib/ai/` and `src/app/api/listings/ai/` to shared dependencies.

`SKILL.md`: add gotchas — (a) AI controls are hidden, not disabled, when the plan or tenant flag says no, but routes still enforce it; (b) an empty aspect value from the model means "could not determine" and must not be merged; (c) the describe route is deliberately non-streaming because sanitization needs a complete document.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app/dashboard/listings/
git commit -m "feat(listings): AI description editor and item-specifics fill"
```

- [ ] **Step 7: Ask the user to verify**

"On a Business tenant with AI enabled: 'Write with AI' should produce a formatted description; 'Fill with AI' on the aspects section should populate specifics with an 'AI' badge that clears when you edit one; the usage note should count up. Then set the tenant to `AI: Off` in `/admin` and reload — every AI control should vanish entirely, not appear greyed out."

---

### Task 17: AI usage section in Settings

The spec requires usage to be "surfaced as a small section in Settings so it is findable without opening a draft". `AiUsageNote` only appears inside the listing form, so a seller who wants to check their allowance has to start a listing to see it.

**Files:**
- Modify: `src/app/dashboard/settings/page.tsx`
- Modify: `src/app/dashboard/settings/CLAUDE.md`

**Interfaces:**
- Consumes: `<AiUsageNote />` (Task 16), `hasAiFeatures` (Task 1), `state.currentUser.aiEnabled` (Task 3)
- Produces: nothing

- [ ] **Step 1: Read `settings/page.tsx` and its `CLAUDE.md`**

Find how existing sections are structured (the Billing section is the closest analogue) and match that shape rather than inventing a new one.

- [ ] **Step 2: Add the section**

Render an "AI usage" section using the same card/heading pattern as its neighbours, containing `<AiUsageNote />`. Gate the whole section on the same computed flag the form uses:

```typescript
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const aiEnabled = useAppSelector((s) => s.currentUser.aiEnabled);
  const aiVisible = !!tenantPlan && hasAiFeatures(tenantPlan) && aiEnabled;
```

When `aiVisible` is false the section does not render at all — same hidden-not-disabled rule as everywhere else.

`AiUsageNote` lives in `listings/_components/`. Importing a component across feature folders is against the usual convention, so if this is its second consumer, move it to `src/components/ui/AiUsageNote.tsx` and update both import sites — a component used by two features is shared by the repo's own 3+-or-owned rule being borderline; prefer the move over a cross-feature import.

- [ ] **Step 3: Update `settings/CLAUDE.md`**

Add the AI usage section to the page description, noting its visibility gate and where `AiUsageNote` now lives.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/settings/ src/components/ui/AiUsageNote.tsx src/app/dashboard/listings/
git commit -m "feat(settings): surface AI usage outside the listing form"
```

- [ ] **Step 5: Ask the user to verify**

"`/dashboard/settings` should show an AI usage section with your team's monthly count. It should disappear entirely when the tenant is set to `AI: Off` in `/admin`."

---

### Task 18: Final documentation pass

**Files:**
- Modify: `src/app/dashboard/listings/CLAUDE.md`, `src/app/dashboard/listings/SKILL.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Reconcile the listings docs against the final code**

Re-read both files end to end against the code as it now stands. Every removed file (`ListingWizard.tsx`, `ImagesStep.tsx`) must be gone from the file map; every added file present; every stale reference to steps or `STEPS` removed.

- [ ] **Step 2: Add the new shared code to `AGENTS.md`**

In the "New shared code from the migration" list, add:

```markdown
- `src/lib/ai/` — Anthropic client, prompt builders, quota metering and the
  AI route guard (server-only, never imported client-side). Quota lives in
  `control.tenant_ai_usage` (Project A); the per-plan allowance is
  `aiGenerationsPerMonth` in `lib/utils/planGating.ts`. AI visibility is
  `control.tenants.ai_enabled`, toggled per tenant from `/admin`.
- `src/app/api/listings/ai/` — describe, aspects and usage routes.
- `src/lib/utils/sanitizeListingHtml.ts` — eBay-safe HTML allowlist, applied
  in `publishPayloads.ts` before either description field reaches eBay.
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/listings/CLAUDE.md src/app/dashboard/listings/SKILL.md AGENTS.md
git commit -m "docs(listings): reconcile feature docs with Listing Studio"
```

- [ ] **Step 4: Ask the user to run the full verification**

"Please run `npm test` and `npx tsc --noEmit` and paste the output — this is the point where the whole suite should be green before we open a PR."

---

## Deferred (not in this plan)

Photo-to-draft, listing templates, price guidance from comparable listings, multi-variation listings, autosave, and the `listing-images` bucket's public-enumeration policy — accepted by the product owner on 2026-09-01, see the spec's "Known tension" section.
