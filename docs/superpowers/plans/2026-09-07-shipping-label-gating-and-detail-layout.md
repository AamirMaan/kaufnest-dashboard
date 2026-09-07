# Shipping label gating + order-detail layout fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn EasyPost shipping-label purchasing off by default (gated per-tenant, like the AI feature switch), fall back to a free plain sender/receiver PDF label while it's off, and fix the order-detail Details card so every row is label-left/data-right.

**Architecture:** A new `control.tenants.shipping_labels_enabled` boolean (default `false`) is hydrated into Redux the same way `ai_enabled` already is, enforced server-side by a new `requireShippingLabelAccess()` guard on both `/api/shipping/*` routes, and read client-side to switch the order-detail Shipping card between the existing EasyPost flow and a new client-only jsPDF label generator that reuses the existing address mappers. The Details card gets one new local layout helper (`DetailRow`) used only where the current stacked layout doesn't match the rest of the card.

**Tech Stack:** Next.js App Router, Supabase (Project A control-plane + Project B tenant schemas), Redux Toolkit, `jsPDF` (already a dependency), Tailwind.

## Global Constraints

- `control.tenants.shipping_labels_enabled boolean NOT NULL DEFAULT false` — per-tenant only, no plan tie (EasyPost purchasing isn't part of the pricing tiers).
- Server enforcement (`requireShippingLabelAccess()`) is the real gate; client hiding is presentation only — same split as `requireAiAccess()`.
- The existing EasyPost code path (`GenerateLabelModal.tsx`, `/api/shipping/rates`, `/api/shipping/buy`, the 3-state Shipping card body for a purchased shipment) is **unchanged** — it just becomes reachable only when the flag is on.
- The plain label uses `jsPDF` (already a dependency — see `src/lib/utils/generateInvoice.ts`) — **no new package**.
- The plain label reuses the existing `addressFromCompanyProfile`/`addressFromSale` mappers from `src/lib/shipping/addressMappers.ts` unchanged — do not duplicate their field-mapping/validation logic.
- The plain "Download Shipping Label" button is **not** gated by `canGenerateLabel` — it's open to any order viewer, matching "Download Invoice"'s access level.
- A **real, already-purchased** `shipments` row (from before a tenant's flag was turned off, or from a tenant that has it on) is always displayed when it exists — the flag only decides what happens when there is **no** shipment yet.
- `DetailRow` (new helper) is used only for **Description** and **Shipping Address** in the Details card. `FinRow` (existing) is untouched and keeps rendering Linked Product/Created By/Created At exactly as today.
- Every task that touches a file covered by a `CLAUDE.md`/`SKILL.md` updates that doc in the same commit (repo's mandatory-docs rule).
- Never query `public.*`, never hardcode a tenant schema name, `control.tenants.plan`/`status` stay Stripe-webhook-only (none of this plan's tasks touch those, but the rule stands for anyone extending it).

---

### Task 1: Control-plane migration + `Tenant` type + docs

**Files:**
- Create: `supabase/control-plane/010_tenant_shipping_labels.sql`
- Modify: `src/types/index.ts` (the `Tenant` interface, ~line 300)
- Modify: `supabase/CLAUDE.md` (migration file-map list, after the `009_tenants_referral.sql` entry)
- Modify: `supabase/SKILL.md` (apply-status table, after the `009` row)

**Interfaces:**
- Produces: `Tenant.shipping_labels_enabled: boolean` — every later task that reads a tenant row's shipping flag relies on this field name.
- Produces: the live DB column `control.tenants.shipping_labels_enabled` — Task 3's admin route, Task 4's guard, and Task 2's layout-hydration query all `select`/`update` this exact column name.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- Add shipping_labels_enabled to control.tenants
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Per-tenant on/off switch for EasyPost shipping-label purchasing
-- (src/lib/shipping/), mirroring the ai_enabled pattern (007). Defaults to
-- FALSE: EasyPost purchasing has no plan tie and no per-tenant credential
-- yet (every tenant currently shares one platform EASYPOST_API_KEY) — see
-- docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md.
-- A platform admin flips this on per tenant from /admin once that tenant is
-- ready to purchase real labels. Until then, the order-detail page falls
-- back to a free plain sender/receiver PDF label instead.
-- ============================================================

alter table control.tenants
  add column if not exists shipping_labels_enabled boolean not null default false;
```

- [ ] **Step 2: Apply the migration to the live control-plane DB**

Use the `mcp__supabase-control__execute_sql` tool against Project A
(kaufnest-control) with the `alter table ...` statement above. If that
connection is read-only for DDL (this has happened before — see
`supabase/SKILL.md`'s note on migration `006`), apply it manually via the
Supabase SQL editor for Project A instead. Either way, confirm it applied by
querying `select column_name from information_schema.columns where
table_schema = 'control' and table_name = 'tenants' and column_name =
'shipping_labels_enabled';` — expect one row back.

- [ ] **Step 3: Add the field to the `Tenant` type**

In `src/types/index.ts`, inside `export interface Tenant { ... }`, right
after the existing `ai_enabled` field:

```ts
  /** Platform-admin visibility switch for AI features. The plan grants AI;
   * this revokes it per tenant. Defaults true (control-plane migration 007). */
  ai_enabled: boolean;
  /** Platform-admin per-tenant switch for EasyPost shipping-label
   * purchasing (src/lib/shipping/). No plan tie — every tenant currently
   * shares one platform EasyPost account. Defaults false (control-plane
   * migration 010); the order-detail page falls back to a free plain
   * sender/receiver PDF label while this is off. */
  shipping_labels_enabled: boolean;
```

- [ ] **Step 4: Update `supabase/CLAUDE.md`**

Insert this new bullet immediately after the existing
`control-plane/009_tenants_referral.sql` bullet (before the
`migrations/001_init.sql` bullet):

```markdown
- `control-plane/010_tenant_shipping_labels.sql` — adds
  `control.tenants.shipping_labels_enabled` (default false), the
  platform-admin per-tenant switch for EasyPost shipping-label purchasing.
  No plan tie — mirrors `ai_enabled`'s shape (007) but is a pure on/off
  toggle, not plan-gated. See
  `docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md`.
```

- [ ] **Step 5: Update `supabase/SKILL.md`'s apply-status table**

Insert this new row immediately after the `control-plane/009_tenants_referral.sql`
row:

```markdown
| `control-plane/010_tenant_shipping_labels.sql` | `control.tenants` (Project A) | ✅ **applied** — adds `shipping_labels_enabled` boolean (default false), the per-tenant EasyPost purchasing switch. See `docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md`. |
```

(Only mark it `✅ applied` if Step 2 actually confirmed the column exists — otherwise mark it `⏳ pending` and say why.)

- [ ] **Step 6: Commit**

```bash
git add supabase/control-plane/010_tenant_shipping_labels.sql src/types/index.ts supabase/CLAUDE.md supabase/SKILL.md
git commit -m "$(cat <<'EOF'
feat: add control.tenants.shipping_labels_enabled

Per-tenant on/off switch for EasyPost shipping-label purchasing, mirroring
the ai_enabled pattern. Defaults false — later tasks wire the hydration,
server guard, admin toggle, and client fallback.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Redux hydration (`currentUserSlice`, `StoreProvider`, `dashboard/layout.tsx`)

**Files:**
- Modify: `src/store/slices/currentUserSlice.ts`
- Modify: `src/store/slices/currentUserSlice.test.ts`
- Modify: `src/store/StoreProvider.tsx`
- Modify: `src/app/dashboard/layout.tsx` (~lines 168-196)

**Interfaces:**
- Consumes: `Tenant.shipping_labels_enabled` (Task 1).
- Produces: `state.currentUser.shippingLabelsEnabled: boolean` (Redux) — Task 5's page wiring and Task 3's docs both reference this exact selector path (`s.currentUser.shippingLabelsEnabled`).
- Produces: `setShippingLabelsEnabled(boolean)` action, exported from `currentUserSlice.ts`.

- [ ] **Step 1: Write the failing reducer test**

In `src/store/slices/currentUserSlice.test.ts`, add this block after the
existing `describe("setAiEnabled", ...)` block:

```ts
describe("setShippingLabelsEnabled", () => {
  it("defaults to false before hydration", () => {
    const state = currentUserSlice.reducer(undefined, { type: "@@INIT" });
    expect(state.shippingLabelsEnabled).toBe(false);
  });

  it("stores the tenant's shipping-label visibility flag", () => {
    const state = currentUserSlice.reducer(undefined, setShippingLabelsEnabled(true));
    expect(state.shippingLabelsEnabled).toBe(true);
  });

  it("can revoke a previously enabled flag", () => {
    const enabled = currentUserSlice.reducer(undefined, setShippingLabelsEnabled(true));
    const revoked = currentUserSlice.reducer(enabled, setShippingLabelsEnabled(false));
    expect(revoked.shippingLabelsEnabled).toBe(false);
  });
});
```

Update the import at the top of the file:

```ts
import { currentUserSlice, setCurrentUser, setTenantPlan, setAiEnabled, setShippingLabelsEnabled } from "./currentUserSlice";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest currentUserSlice -t "setShippingLabelsEnabled"`
Expected: FAIL — `setShippingLabelsEnabled` is not exported yet (TypeScript/import error).

- [ ] **Step 3: Implement the reducer in `currentUserSlice.ts`**

```ts
interface CurrentUserState {
  profile: Profile | null;
  tenantPlan: TenantPlan | null;
  /** Platform-admin AI visibility switch (control.tenants.ai_enabled).
   * False until hydrated, so AI controls never flash before we know. */
  aiEnabled: boolean;
  /** Platform-admin per-tenant switch for EasyPost shipping-label
   * purchasing (control.tenants.shipping_labels_enabled). False until
   * hydrated — the order-detail page falls back to a plain PDF label
   * while this is false, so nothing needs to "flash" here the way AI
   * controls do, but the same fail-closed default is kept for consistency. */
  shippingLabelsEnabled: boolean;
}

const initialState: CurrentUserState = {
  profile: null,
  tenantPlan: null,
  aiEnabled: false,
  shippingLabelsEnabled: false,
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
    setShippingLabelsEnabled(state, action: PayloadAction<boolean>) {
      state.shippingLabelsEnabled = action.payload;
    },
  },
});

export const { setCurrentUser, setTenantPlan, setAiEnabled, setShippingLabelsEnabled } = currentUserSlice.actions;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest currentUserSlice`
Expected: PASS — all tests in the file, including the new
`setShippingLabelsEnabled` block.

- [ ] **Step 5: Wire it through `StoreProvider.tsx`**

Add the import (extend the existing named import from `currentUserSlice`):

```ts
import { setCurrentUser, setTenantPlan, setAiEnabled, setShippingLabelsEnabled } from "@/store/slices/currentUserSlice";
```

Add the prop to `StoreProviderProps` right after `aiEnabled?: boolean;`:

```ts
  aiEnabled?: boolean;
  shippingLabelsEnabled?: boolean;
```

Add it to the function's destructured params (after `aiEnabled,`):

```ts
  aiEnabled,
  shippingLabelsEnabled,
```

Add the dispatch line right after the existing `aiEnabled` dispatch:

```ts
    if (aiEnabled !== undefined) store.dispatch(setAiEnabled(aiEnabled));
    if (shippingLabelsEnabled !== undefined) store.dispatch(setShippingLabelsEnabled(shippingLabelsEnabled));
```

- [ ] **Step 6: Hydrate from the control-plane query in `dashboard/layout.tsx`**

Replace this block (~lines 168-182):

```tsx
  // Tenant's subscription plan — drives platform-integrations gating.
  // ai_enabled is the platform-admin AI visibility switch (control-plane 007).
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

with:

```tsx
  // Tenant's subscription plan — drives platform-integrations gating.
  // ai_enabled is the platform-admin AI visibility switch (control-plane 007).
  // shipping_labels_enabled is the platform-admin EasyPost visibility switch
  // (control-plane 010) — no plan tie, defaults false.
  let tenantPlan: TenantPlan | null = null;
  let aiEnabled = false;
  let shippingLabelsEnabled = false;
  if (tenantSchema) {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("plan, ai_enabled, shipping_labels_enabled")
      .eq("schema_name", tenantSchema)
      .single();
    tenantPlan = (tenant?.plan as TenantPlan | undefined) ?? null;
    aiEnabled = (tenant?.ai_enabled as boolean | undefined) ?? false;
    shippingLabelsEnabled = (tenant?.shipping_labels_enabled as boolean | undefined) ?? false;
  }
```

Then add the prop to the `<StoreProvider>` call (right after `aiEnabled={aiEnabled}`):

```tsx
      tenantPlan={tenantPlan}
      aiEnabled={aiEnabled}
      shippingLabelsEnabled={shippingLabelsEnabled}
```

- [ ] **Step 7: Commit**

```bash
git add src/store/slices/currentUserSlice.ts src/store/slices/currentUserSlice.test.ts src/store/StoreProvider.tsx src/app/dashboard/layout.tsx
git commit -m "$(cat <<'EOF'
feat: hydrate control.tenants.shipping_labels_enabled into Redux

Mirrors the existing ai_enabled hydration chain (dashboard/layout.tsx ->
StoreProvider -> currentUserSlice) so client components can read
state.currentUser.shippingLabelsEnabled to decide which shipping-label
flow to show.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Admin toggle (`/admin/tenants/[id]`)

**Files:**
- Modify: `src/app/api/admin/tenants/[id]/route.ts` (PATCH body handling)
- Modify: `src/app/admin/_components/TenantDetailActions.tsx`
- Modify: `src/app/admin/CLAUDE.md`

**Interfaces:**
- Consumes: `Tenant.shipping_labels_enabled` (Task 1).
- Produces: `PATCH /api/admin/tenants/[id]` accepts `{ shipping_labels_enabled?: boolean }` in its body — Task 4's guard does not call this route, but any future admin UI relies on this exact field name matching the DB column.

- [ ] **Step 1: Add the field to the PATCH route's body type and diff logic**

In `src/app/api/admin/tenants/[id]/route.ts`, update the body type (~line 31):

```ts
  const body = (await req.json()) as {
    plan?: TenantPlan;
    status?: TenantStatus;
    admin_email?: string;
    ai_enabled?: boolean;
    shipping_labels_enabled?: boolean;
    referral?: string;
  };
```

And add one line to the partial-patch builder, right after the `ai_enabled` line (~line 99):

```ts
  if (body.ai_enabled !== undefined) patch.ai_enabled = body.ai_enabled;
  if (body.shipping_labels_enabled !== undefined) patch.shipping_labels_enabled = body.shipping_labels_enabled;
```

- [ ] **Step 2: Add the toggle button + confirm modal to `TenantDetailActions.tsx`**

Update the lucide-react import line:

```ts
import { Pencil, Sparkles, Mail, UserCog, Trash2, Truck } from "lucide-react";
```

Add state, right after the existing `aiConfirmOpen`/`togglingAi` state:

```ts
  const [aiConfirmOpen, setAiConfirmOpen] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);

  const [shippingConfirmOpen, setShippingConfirmOpen] = useState(false);
  const [togglingShipping, setTogglingShipping] = useState(false);
```

Add the handler, right after `handleConfirmToggleAi`:

```ts
  async function handleConfirmToggleShipping() {
    setTogglingShipping(true);
    try {
      const next = !tenant.shipping_labels_enabled;
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipping_labels_enabled: next }),
      });
      const data = (await res.json()) as { tenant?: Tenant; error?: string };
      if (res.ok) {
        success(
          next ? "Shipping labels enabled" : "Shipping labels disabled",
          next
            ? `${tenant.name} can now purchase real shipping labels via EasyPost.`
            : `${tenant.name} is back to the plain sender/receiver label.`
        );
        setShippingConfirmOpen(false);
        onRefresh();
      } else {
        toastError("Could not update shipping label access", data.error ?? "Please try again.");
      }
    } catch {
      toastError("Could not update shipping label access", "Network error — please try again.");
    } finally {
      setTogglingShipping(false);
    }
  }
```

Add the button, right after the "AI: On/Off" `Button` in the render's button
row:

```tsx
        <Button variant="secondary" onClick={() => setAiConfirmOpen(true)}>
          <Sparkles
            size={14}
            className={tenant.ai_enabled ? "text-(--color-success-text)" : "text-(--color-text-faint)"}
          />
          {tenant.ai_enabled ? "AI: On" : "AI: Off"}
        </Button>

        <Button variant="secondary" onClick={() => setShippingConfirmOpen(true)}>
          <Truck
            size={14}
            className={tenant.shipping_labels_enabled ? "text-(--color-success-text)" : "text-(--color-text-faint)"}
          />
          {tenant.shipping_labels_enabled ? "Shipping Labels: On" : "Shipping Labels: Off"}
        </Button>
```

Add the confirm modal, right after the existing `aiConfirmOpen`
`ConfirmActionModal`:

```tsx
      <ConfirmActionModal
        open={shippingConfirmOpen}
        title={tenant.shipping_labels_enabled ? "Disable shipping labels" : "Enable shipping labels"}
        message={
          tenant.shipping_labels_enabled
            ? `Disable EasyPost shipping labels for ${tenant.name}? They'll fall back to the free plain sender/receiver label immediately.`
            : `Enable EasyPost shipping labels for ${tenant.name}? Their users will be able to purchase real, trackable labels immediately.`
        }
        confirmLabel={tenant.shipping_labels_enabled ? "Disable" : "Enable"}
        confirmingLabel="Saving…"
        tone={tenant.shipping_labels_enabled ? "warning" : "success"}
        loading={togglingShipping}
        onConfirm={handleConfirmToggleShipping}
        onClose={() => setShippingConfirmOpen(false)}
      />
```

- [ ] **Step 3: Update `src/app/admin/CLAUDE.md`**

In the `_components/TenantDetailActions.tsx` bullet, add this sentence right
after the existing "AI: On/Off" description (which ends "...matching
Impersonate's error handling)"), before the "Resend Invite" clause:

```markdown
  "Shipping Labels: On/Off" (`Truck`, same tint/confirm-modal shape as the
  AI toggle, PATCHes `{ shipping_labels_enabled: !tenant.shipping_labels_enabled }`
  — see `src/lib/shipping/SKILL.md` for what this actually gates),
```

In the `tenants/[id]/route.ts` (`PATCH`, `DELETE`) bullet's `PATCH`
description, update:

```markdown
  - `PATCH`: partial update for `{ plan?, status?, admin_email?, ai_enabled?, referral? }`.
```

to:

```markdown
  - `PATCH`: partial update for `{ plan?, status?, admin_email?, ai_enabled?, shipping_labels_enabled?, referral? }`.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/tenants/[id]/route.ts src/app/admin/_components/TenantDetailActions.tsx src/app/admin/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: add Shipping Labels admin toggle

Per-tenant on/off switch for EasyPost purchasing, same button/confirm-modal
shape as the existing AI toggle on /admin/tenants/[id].

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual verification (per this repo's working agreement — no dev server start from this session)**

Ask the user to open `/admin/tenants/[id]` for a test tenant in their
browser, confirm the "Shipping Labels: Off" button renders, click it,
confirm the modal, and confirm the button flips to "Shipping Labels: On"
and the toast appears.

---

### Task 4: Server-side enforcement (`requireShippingLabelAccess`)

**Files:**
- Create: `src/lib/shipping/authGuard.ts`
- Modify: `src/app/api/shipping/rates/route.ts`
- Modify: `src/app/api/shipping/buy/route.ts`
- Modify: `src/lib/shipping/SKILL.md`

**Interfaces:**
- Consumes: `IntegrationAuthContext.tenantSchema` (from `requireIntegrationAdmin()`, already returned by both routes' existing guard call).
- Produces: `requireShippingLabelAccess(tenantSchema: string): Promise<{ error?: NextResponse }>` — both routes call this immediately after `requireIntegrationAdmin()`.

- [ ] **Step 1: Write `src/lib/shipping/authGuard.ts`**

```ts
import { NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";

export interface ShippingLabelAccessResult {
  error?: NextResponse;
}

/**
 * Guard for `/api/shipping/rates` and `/api/shipping/buy`. Checks
 * `control.tenants.shipping_labels_enabled` — the platform-admin per-tenant
 * switch for EasyPost purchasing (no plan tie, control-plane migration 010).
 *
 * Called AFTER `requireIntegrationAdmin()` in both routes, which already
 * confirms the caller is signed in, belongs to a tenant, and holds
 * admin/super_admin. This guard only adds the tenant-visibility check on
 * top — it does not re-check auth.
 *
 * The order-detail page hides the "Generate Shipping Label" (EasyPost)
 * button when the flag is off and shows a free plain PDF label instead,
 * but hidden chrome is presentation — this is the enforcement.
 */
export async function requireShippingLabelAccess(
  tenantSchema: string
): Promise<ShippingLabelAccessResult> {
  try {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("shipping_labels_enabled")
      .eq("schema_name", tenantSchema)
      .single();

    if (!tenant) {
      return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
    }

    if (!tenant.shipping_labels_enabled) {
      return {
        error: NextResponse.json(
          { error: "Shipping label purchasing is not enabled for this account." },
          { status: 403 }
        ),
      };
    }

    return {};
  } catch (err) {
    // createControlClient() throws synchronously on missing env vars; the
    // Supabase call can also throw on a genuine DB error. Either way, this
    // must surface as a clean 500, not an unhandled exception.
    console.error("requireShippingLabelAccess failed", err);
    return {
      error: NextResponse.json(
        { error: "Failed to verify shipping label access." },
        { status: 500 }
      ),
    };
  }
}
```

- [ ] **Step 2: Wire it into `src/app/api/shipping/rates/route.ts`**

Add the import:

```ts
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { requireShippingLabelAccess } from "@/lib/shipping/authGuard";
```

Add the check right after the existing guard, before the `client` is used:

```ts
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const labelAccess = await requireShippingLabelAccess(tenantSchema);
  if (labelAccess.error) return labelAccess.error;
```

- [ ] **Step 3: Wire it into `src/app/api/shipping/buy/route.ts`**

Add the import:

```ts
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { requireShippingLabelAccess } from "@/lib/shipping/authGuard";
```

Add the check right after the existing guard:

```ts
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  const labelAccess = await requireShippingLabelAccess(tenantSchema);
  if (labelAccess.error) return labelAccess.error;
```

- [ ] **Step 4: Update `src/lib/shipping/SKILL.md`**

Replace the "Shared platform EasyPost account" gotcha (which currently
says neither route has a plan gate) with:

```markdown
- **Per-tenant gate (control-plane migration 010, 2026-09-07):**
  `requireShippingLabelAccess()` (`authGuard.ts`) checks
  `control.tenants.shipping_labels_enabled` — called by both API routes
  right after `requireIntegrationAdmin()`. Defaults **false** for every
  tenant; a platform admin flips it on per tenant from
  `/admin/tenants/[id]` (`TenantDetailActions.tsx`'s "Shipping Labels:
  On/Off" button). No plan tie — this is a pure visibility switch, same
  shape as `ai_enabled` but without `hasAiFeatures(plan)`'s plan check,
  since EasyPost purchasing isn't part of the pricing tiers. While the flag
  is off, the order-detail page's Shipping card shows a free plain
  sender/receiver PDF label instead (`generatePlainLabel.ts`, no API call)
  — see `dashboard/sales/CLAUDE.md`'s Shipping labels section.
- **Shared platform EasyPost account (still true):** all tenants that DO
  have the flag on purchase against the same platform `EASYPOST_API_KEY` —
  there is still no per-tenant EasyPost credential. Per-tenant credentials
  remain accepted future work.
```

Also update the file's opening description line (currently "Server-only
shared code (never imported from a Client Component...)") to:

```markdown
Mostly server-only shared code. `easypost.ts` (calls EasyPost with a
server-side API key) and `authGuard.ts` (reads `control.tenants` with the
control-plane client) are never imported from a Client Component.
`addressMappers.ts` is pure and has no such restriction — it's reused
client-side by `generatePlainLabel.ts` (see `dashboard/sales/CLAUDE.md`),
which is a Client Component's direct dependency, not consumed only via
`fetch` like the EasyPost flow.
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/shipping/authGuard.ts src/app/api/shipping/rates/route.ts src/app/api/shipping/buy/route.ts src/lib/shipping/SKILL.md
git commit -m "$(cat <<'EOF'
feat: enforce shipping_labels_enabled on both EasyPost routes

requireShippingLabelAccess() 403s /api/shipping/rates and
/api/shipping/buy when the tenant's flag is off, mirroring
requireAiAccess()'s split between server enforcement and client-side
presentation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Plain label generator (`generatePlainLabel.ts`)

**Files:**
- Create: `src/lib/shipping/generatePlainLabel.ts`

**Interfaces:**
- Consumes: `addressFromCompanyProfile(profile: CompanyProfile): EasyPostAddress`, `addressFromSale(sale: Sale): EasyPostAddress` (existing, `src/lib/shipping/addressMappers.ts`), `EasyPostAddress` type (existing, `src/lib/shipping/easypost.ts`).
- Produces: `generatePlainShippingLabel(sale: Sale, companyProfile: CompanyProfile): Promise<void>` — Task 6's page wiring calls this exact function by this exact name.

No colocated test for this file, matching this repo's own precedent:
`src/lib/utils/generateInvoice.ts` (the file this pattern is copied from)
has no direct unit test either — a jsPDF document's rendered output isn't
practically assertable, and the two pure functions it depends on
(`addressFromCompanyProfile`/`addressFromSale`) are already covered by
`addressMappers.test.ts`.

- [ ] **Step 1: Write the file**

```ts
import type { Sale, CompanyProfile } from "@/types";
import { addressFromCompanyProfile, addressFromSale } from "./addressMappers";
import type { EasyPostAddress } from "./easypost";

// jsPDF is loaded dynamically to avoid SSR issues — same pattern as
// src/lib/utils/generateInvoice.ts.
const getJsPDF = () => import("jspdf").then((m) => m.default);

function addressLines(address: EasyPostAddress): string[] {
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.name, address.street1, address.street2, cityLine, address.country, address.phone].filter(
    (line): line is string => !!line
  );
}

/**
 * Generates a plain, no-cost shipping label PDF (sender/receiver info
 * only — no tracking number, carrier, or rate) and triggers a browser
 * download. This is the default label-generation path while a tenant's
 * `shipping_labels_enabled` flag is off — see
 * docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md.
 *
 * Throws if either address is incomplete (via the shared
 * `addressFromCompanyProfile`/`addressFromSale` mappers' own
 * throw-on-missing-field checks) — callers must only invoke this once both
 * addresses are known complete (see `[id]/page.tsx`'s `addressesComplete`).
 */
export async function generatePlainShippingLabel(
  sale: Sale,
  companyProfile: CompanyProfile
): Promise<void> {
  const fromAddress = addressFromCompanyProfile(companyProfile);
  const toAddress = addressFromSale(sale);

  const jsPDF = await getJsPDF();
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Outer label border
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.5);
  doc.rect(10, 10, pageW - 20, pageH - 20);

  // ── Ship From (small, top) ────────────────────────────────────────────
  let y = 22;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("SHIP FROM", 18, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  addressLines(fromAddress).forEach((line) => {
    doc.text(line, 18, y);
    y += 5;
  });

  // Divider
  y += 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(18, y, pageW - 18, y);
  y += 14;

  // ── Ship To (large, prominent) ──────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("SHIP TO", 18, y);
  y += 10;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 20, 20);
  addressLines(toAddress).forEach((line) => {
    doc.text(line, 18, y);
    y += 9;
  });

  // ── Footer: order reference ─────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200);
  doc.line(18, pageH - 24, pageW - 18, pageH - 24);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);
  doc.text(`Order: ${sale.external_order_id ?? sale.id}   ·   ${sale.product_name}`, 18, pageH - 16);

  doc.save(`shipping-label-${sale.id.slice(0, 8)}.pdf`);
}
```

- [ ] **Step 2: Type-check it compiles**

This file has no test to run, so verification is `tsc`/`eslint` via the
commit hook in the next step — do not run `npx tsc --noEmit` manually
(per this repo's working agreement; the pre-commit hook already does this
and will fail the commit if something's wrong).

- [ ] **Step 3: Commit**

```bash
git add src/lib/shipping/generatePlainLabel.ts
git commit -m "$(cat <<'EOF'
feat: add plain sender/receiver PDF shipping label generator

Client-only jsPDF label (no tracking/carrier/cost — just Ship From/Ship
To addresses), reusing the existing address mappers unchanged. This is
the default label-generation path while a tenant's shipping_labels_enabled
flag is off.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Order-detail page wiring (Shipping card)

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/sales/SKILL.md`

**Interfaces:**
- Consumes: `state.currentUser.shippingLabelsEnabled` (Task 2), `generatePlainShippingLabel(sale, companyProfile)` (Task 5).
- Produces: nothing new consumed elsewhere — this is a leaf UI change.

- [ ] **Step 1: Import the plain-label generator**

Add to the import block at the top of `[id]/page.tsx`, right after the
`generateOrderInvoice` import:

```ts
import { generateOrderInvoice } from "@/lib/utils/generateInvoice";
import { generatePlainShippingLabel } from "@/lib/shipping/generatePlainLabel";
```

- [ ] **Step 2: Add the `shippingLabelsEnabled` selector — same hooks-ordering constraint as `canGenerateLabel`**

`SKILL.md`'s "Shipping card / role gate — hooks-ordering trap" gotcha
applies to this new selector too: it must sit **above** the page's two
early `return`s (loading, then not-found), in the fixed hook block near the
top of the component — not inside "Derived values" further down. Add it
right after the existing `canGenerateLabel` line (~line 58):

```ts
  const canGenerateLabel = isAdmin || hasManageIntegrationsOverride;
  // Decides which Shipping-card body renders when no shipment exists yet —
  // the real EasyPost flow (gated further by canGenerateLabel above) when
  // true, or the free plain PDF label when false. Same hooks-ordering
  // constraint as every other selector in this block — see SKILL.md.
  const shippingLabelsEnabled = useAppSelector((s) => s.currentUser.shippingLabelsEnabled);
```

- [ ] **Step 3: Add the plain-label download handler**

Add this function right after the existing `handleDownloadInvoice`
(~line 210):

```ts
  async function handleDownloadInvoice() {
    if (!sale || !companyProfile) return;
    await generateOrderInvoice(sale, companyProfile);
  }

  async function handleDownloadPlainLabel() {
    if (!sale || !companyProfile) return;
    await generatePlainShippingLabel(sale, companyProfile);
  }
```

- [ ] **Step 4: Restructure the Shipping card's conditional branches**

Replace the Shipping card's body (currently ~lines 624-667, the
`{shipmentLoading ? (...) : shipment ? (...) : !addressesComplete ? (...) :
canGenerateLabel ? (...) : (...)}` chain) with:

```tsx
        {shipmentLoading ? (
          <p className="text-sm text-(--color-text-muted)">Loading…</p>
        ) : shipment ? (
          <dl className="space-y-2">
            <FinRow label="Carrier" value={`${shipment.carrier} — ${shipment.service}`} />
            <FinRow label="Tracking Number" value={shipment.tracking_number} />
            {shipment.cost != null && (
              <FinRow
                label="Label Cost"
                value={formatCurrency(
                  shipment.cost,
                  (shipment.cost_currency ?? sale.currency) as Currency
                )}
              />
            )}
            <div className="pt-2">
              <a
                href={shipment.label_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
              >
                <Download size={14} />
                Download Label
              </a>
            </div>
          </dl>
        ) : !addressesComplete ? (
          <p className="text-sm text-(--color-text-muted)">
            Add a sender address in{" "}
            <Link href="/dashboard/settings" className="text-(--color-primary) hover:underline">
              Settings
            </Link>{" "}
            and a buyer address on this order to generate a shipping label.
          </p>
        ) : shippingLabelsEnabled ? (
          canGenerateLabel ? (
            <Button variant="secondary" onClick={() => setGenerateLabelOpen(true)}>
              Generate Shipping Label
            </Button>
          ) : (
            <p className="text-sm text-(--color-text-muted)">
              No label generated for this order yet.
            </p>
          )
        ) : (
          <Button variant="secondary" onClick={handleDownloadPlainLabel}>
            <Download size={15} />
            Download Shipping Label
          </Button>
        )}
```

Note what changed and what didn't: `shipmentLoading`, an existing
`shipment` (real, already purchased — shown regardless of the current flag
state, since it's a historical record), and the incomplete-addresses
message are all **unchanged**. Only the final branch — no shipment yet,
addresses complete — now checks `shippingLabelsEnabled` first: `true` keeps
today's exact `canGenerateLabel ? <Button>Generate...` behavior, `false`
shows the new plain-label button with no additional role gate.

- [ ] **Step 5: Update `src/app/dashboard/sales/CLAUDE.md`**

In the "## Shipping labels (`src/lib/shipping/`)" section, replace the
opening sentence:

```markdown
`[id]/page.tsx` has a third card, **Shipping**, below Financials/Details,
rendered for every sale in one of three states: (1) no shipment yet and
either the tenant's `CompanyProfile.ship_from_*` fields or the sale's
`shipping_*`/`buyer_*` fields are incomplete — a muted message + link to
Settings, no button; (2) no shipment yet, both addresses complete — a
"Generate Shipping Label" `Button` for `canGenerateLabel` users (opens
`_components/GenerateLabelModal.tsx`), else a muted "No label generated for
this order yet." message; (3) a shipment exists — read-only
carrier/service/tracking number/cost + a "Download Label" link.
```

with:

```markdown
`[id]/page.tsx` has a third card, **Shipping**, below Financials/Details,
rendered for every sale in one of four states: (1) a shipment exists — a
real, already-purchased EasyPost label — shown **regardless of the current
`shippingLabelsEnabled` flag** (it's a historical record; a tenant can have
one from before the flag was turned off), read-only
carrier/service/tracking number/cost + a "Download Label" link; (2) no
shipment yet and either the tenant's `CompanyProfile.ship_from_*` fields or
the sale's `shipping_*`/`buyer_*` fields are incomplete — a muted message +
link to Settings, no button; (3) no shipment yet, both addresses complete,
`state.currentUser.shippingLabelsEnabled` true (2026-09-07,
control-plane migration 010 — platform-admin per-tenant switch, defaults
false, no plan tie) — a "Generate Shipping Label" `Button` for
`canGenerateLabel` users (opens `_components/GenerateLabelModal.tsx`), else
a muted "No label generated for this order yet." message — this branch is
the pre-2026-09-07 behavior, now reachable only when the tenant's flag is
on; (4) no shipment yet, addresses complete,
`shippingLabelsEnabled` **false** (the default) — a "Download Shipping
Label" `Button` that calls `generatePlainShippingLabel(sale,
companyProfile)` (`src/lib/shipping/generatePlainLabel.ts`) directly, no
modal, no API call, **not** gated by `canGenerateLabel` — open to anyone
who can view the order, same access level as "Download Invoice".
```

Add this new paragraph right after it (before the existing
`canGenerateLabel = isAdmin || hasManageIntegrationsOverride` paragraph):

```markdown
`shippingLabelsEnabled` is read from
`state.currentUser.shippingLabelsEnabled`, hydrated the same way as
`aiEnabled` — see `dashboard/CLAUDE.md`'s hydration description and
`src/lib/shipping/SKILL.md`'s per-tenant gate section for the full chain
(the actual enforcement is server-side, in
`src/lib/shipping/authGuard.ts`'s `requireShippingLabelAccess()`, called by
both `/api/shipping/*` routes — this client flag only decides which button
renders).
```

- [ ] **Step 6: Update `src/app/dashboard/sales/SKILL.md`**

Update the "Shipping card / 'Generate Shipping Label' role gate" gotcha
(the one describing the hooks-ordering trap) to mention the new selector.
Find this sentence:

```markdown
This is why `canGenerateLabel`'s `currentRole` selector lives right next to
`isSuperAdmin`/`hasDeleteOverride` at the top, and why `shipment`/
`shipmentLoading`/`generateLabelOpen` state + the shipment-fetch
`useEffect` sit right after the linked-purchase effect, both still above
the loading/not-found returns
```

and replace it with:

```markdown
This is why `canGenerateLabel`'s `currentRole` selector AND the newer
`shippingLabelsEnabled` selector (2026-09-07 — reads
`state.currentUser.shippingLabelsEnabled`, decides which Shipping-card body
renders when no shipment exists yet) both live right next to
`isSuperAdmin`/`hasDeleteOverride` at the top, and why `shipment`/
`shipmentLoading`/`generateLabelOpen` state + the shipment-fetch
`useEffect` sit right after the linked-purchase effect, both still above
the loading/not-found returns
```

Also update the "Change the shipping-label-generation modal (rates/buy
flow)" bullet (~line 39) — add this sentence to the end of it:

```markdown
  component is wired into `[id]/page.tsx`'s Shipping card (Task 7,
  2026-09-06) — see "Gotchas — detail page" below for the role-gate
  selector's hooks-ordering constraint. As of 2026-09-07 this modal/flow is
  reachable only when `state.currentUser.shippingLabelsEnabled` is true —
  the plain-label fallback (`src/lib/shipping/generatePlainLabel.ts`) has
  no modal at all, it's a direct `onClick` call, same shape as "Download
  Invoice".
```

- [ ] **Step 7: Commit**

```bash
git add "src/app/dashboard/sales/[id]/page.tsx" src/app/dashboard/sales/CLAUDE.md src/app/dashboard/sales/SKILL.md
git commit -m "$(cat <<'EOF'
feat: gate the EasyPost shipping-label flow behind shippingLabelsEnabled

The order-detail Shipping card now shows a free plain sender/receiver PDF
label by default; the real EasyPost purchase flow only renders once a
tenant's shipping_labels_enabled flag is on. An already-purchased shipment
still always displays, regardless of the current flag state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Manual verification (per this repo's working agreement)**

Ask the user to open an order with complete sender/buyer addresses in their
browser and confirm: with the tenant's flag off (the default), a "Download
Shipping Label" button appears and downloads a PDF showing Ship From/Ship
To addresses; after a platform admin turns the flag on (Task 3), the same
order instead shows the original "Generate Shipping Label" button that
opens the EasyPost modal.

---

### Task 7: Details card layout — label-left, data-right

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DetailRow` local helper — not consumed outside this file.

- [ ] **Step 1: Add the `DetailRow` helper next to `FinRow`**

At the bottom of `[id]/page.tsx`, right after the existing `FinRow`
function:

```tsx
function FinRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-(--color-text-muted) shrink-0">{label}</dt>
      <dd className="text-(--color-text-base) text-right">{value}</dd>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-(--color-text-muted) shrink-0 w-32">{label}</dt>
      <dd className="text-(--color-text-base) text-left flex-1">{children}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Use `DetailRow` for Description and Shipping Address in the Details card**

Replace the Description block (currently ~lines 529-538):

```tsx
            {sale.description && (
              <div>
                <dt className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider mb-1">
                  Description
                </dt>
                <dd className="text-sm text-(--color-text-base)">
                  {sale.description}
                </dd>
              </div>
            )}
```

with:

```tsx
            {sale.description && (
              <DetailRow label="Description">{sale.description}</DetailRow>
            )}
```

Replace the Shipping Address block (currently ~lines 577-607):

```tsx
            {hasShippingAddress && (
              <div>
                <dt className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider mb-1">
                  Shipping Address
                </dt>
                <dd className="text-sm text-(--color-text-base) space-y-0.5">
                  {sale.buyer_name && (
                    <p className="font-semibold">{sale.buyer_name}</p>
                  )}
                  {sale.shipping_address_line1 && <p>{sale.shipping_address_line1}</p>}
                  {sale.shipping_address_line2 && <p>{sale.shipping_address_line2}</p>}
                  {(sale.shipping_city || sale.shipping_state || sale.shipping_postal_code) && (
                    <p>
                      {[
                        sale.shipping_city,
                        [sale.shipping_state, sale.shipping_postal_code].filter(Boolean).join(" "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {sale.shipping_country && <p>{sale.shipping_country}</p>}
                  {sale.buyer_phone && (
                    <p className="text-xs text-(--color-text-muted) pt-1">{sale.buyer_phone}</p>
                  )}
                  {sale.buyer_email && (
                    <p className="text-xs text-(--color-text-muted)">{sale.buyer_email}</p>
                  )}
                </dd>
              </div>
            )}
```

with:

```tsx
            {hasShippingAddress && (
              <DetailRow label="Shipping Address">
                <div className="space-y-0.5">
                  {sale.buyer_name && (
                    <p className="font-semibold">{sale.buyer_name}</p>
                  )}
                  {sale.shipping_address_line1 && <p>{sale.shipping_address_line1}</p>}
                  {sale.shipping_address_line2 && <p>{sale.shipping_address_line2}</p>}
                  {(sale.shipping_city || sale.shipping_state || sale.shipping_postal_code) && (
                    <p>
                      {[
                        sale.shipping_city,
                        [sale.shipping_state, sale.shipping_postal_code].filter(Boolean).join(" "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {sale.shipping_country && <p>{sale.shipping_country}</p>}
                  {sale.buyer_phone && (
                    <p className="text-xs text-(--color-text-muted) pt-1">{sale.buyer_phone}</p>
                  )}
                  {sale.buyer_email && (
                    <p className="text-xs text-(--color-text-muted)">{sale.buyer_email}</p>
                  )}
                </div>
              </DetailRow>
            )}
```

Leave every other row in the Details card (`FinRow` for Linked
Product/Created By/Created At, and the `sale.restock`/`sale.ebay_sync_error`
notice boxes) exactly as-is — they're unchanged by this task.

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/sales/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
fix: label-left/data-right layout for the order-detail Details card

Description and Shipping Address were the only two rows still using a
stacked label-above-value layout while every other row in the card
(Linked Product, Created By, Created At) was already label-left/value-
right. New DetailRow helper brings them in line — FinRow is untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Manual verification (per this repo's working agreement)**

Ask the user to open an order with a description and a shipping address in
their browser and confirm every row in the Details card now shows its
label on the left and its value on the right, matching the Financials
card's rows next to it.

---

## Testing summary

- Task 2 is TDD'd (reducer test, mirrors the existing `setAiEnabled` block).
- Tasks 1, 3, 4, 5, 6, 7 have no colocated unit tests — they're
  Supabase-network code (Tasks 1, 3, 4), a jsPDF renderer with no testable
  output beyond its already-tested pure dependencies (Task 5), or page-level
  JSX wiring/layout (Tasks 6, 7) — all consistent with this repo's working
  agreement (no dev-server start/curl from this session; verify pure
  logic with tests, verify everything else by asking the user to check the
  browser) and with the precedent set by the code each task extends
  (`requireAiAccess`/`requireIntegrationAdmin` have no tests;
  `generateInvoice.ts` has no test).
- Every task's final commit goes through `.husky/pre-commit`
  (`tsc --noEmit`, `eslint`, the project verifier) automatically — do not
  run those manually mid-task.
