# Tenant Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow platform admins to update a tenant's `plan`, `status`, and `admin_email` from `/admin`, with email changes also propagated to Supabase Auth (Project B).

**Architecture:** A new `PATCH /api/admin/tenants/[id]` route handles all three fields — it updates `control.tenants` and, if `admin_email` changed, looks up the user in Project B Auth by old email and calls `updateUserById` to trigger re-verification. A new `EditTenantModal` component mirrors `AddTenantModal` in structure. `TenantActions` gains an Edit button that opens the modal; `page.tsx` passes `onRefresh` down to trigger a list reload on success.

**Tech Stack:** Next.js 16 App Router (params is a `Promise` — always `await params`), Supabase JS v2 (`auth.admin.*`), React, TypeScript, Tailwind CSS (CSS custom properties pattern used throughout).

## Global Constraints

- `params` in route handlers is `Promise<{ id: string }>` — always `await params` before destructuring (Next.js 16).
- Never import `createControlClient` or any server-only Supabase client in Client Components (`"use client"`).
- Auth guard: every `/api/admin/*` route calls `verifyPlatformAdmin()` as its first step.
- Error response shape: `{ error: string, detail?: string }` — always surface `detail` (raw Supabase/Postgres message), not just `error` (generic string), so admins can see why something failed.
- No `src/middleware.ts` — route protection lives in `src/proxy.ts`. Do not add middleware.
- No unit tests for this change — all code paths involve Supabase network calls, which the working agreement keeps out of unit tests. Browser verification is the acceptance test.
- After every task, update `src/app/admin/CLAUDE.md` and `src/app/admin/SKILL.md` in the **same commit** as the code. (Task 4 covers the final doc pass once all code is in place.)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/admin/tenants/[id]/route.ts` | **Create** | PATCH handler — auth guard, tenant fetch, optional Auth email update, control plane update |
| `src/app/admin/_components/EditTenantModal.tsx` | **Create** | Edit modal — pre-filled form for plan/status/admin_email, partial-patch diff logic, PATCH call |
| `src/app/admin/_components/TenantActions.tsx` | **Modify** | Add `onRefresh` prop, Edit button, `EditTenantModal` mount |
| `src/app/admin/page.tsx` | **Modify** | Pass `onRefresh` callback to `<TenantActions>` |
| `src/app/admin/CLAUDE.md` | **Modify** | Update file map and shared-deps section |
| `src/app/admin/SKILL.md` | **Modify** | Add minimal-file-set entry for "edit tenant" |

---

## Task 1: PATCH API route

**Files:**
- Create: `src/app/api/admin/tenants/[id]/route.ts`

**Interfaces:**
- Consumes: `verifyPlatformAdmin` exported from `src/app/api/admin/tenants/route.ts`; `createControlClient` from `@/lib/supabase/control`; `createClient as createServiceClient` from `@supabase/supabase-js`; types `TenantPlan`, `TenantStatus` from `@/types`
- Produces: `PATCH /api/admin/tenants/[id]` — accepts `{ plan?: TenantPlan, status?: TenantStatus, admin_email?: string }`, returns `{ tenant: Tenant }` (200) or `{ error: string, detail?: string }` (404/500)

- [ ] **Step 1: Create the route file with the full implementation**

  Create `src/app/api/admin/tenants/[id]/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { createControlClient } from "@/lib/supabase/control";
  import { createClient as createServiceClient } from "@supabase/supabase-js";
  import { verifyPlatformAdmin } from "../route";
  import type { TenantPlan, TenantStatus } from "@/types";

  function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "object" && err !== null && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const check = await verifyPlatformAdmin();
    if (!check.ok) return check.response;

    const { id } = await params;
    const body = (await req.json()) as {
      plan?: TenantPlan;
      status?: TenantStatus;
      admin_email?: string;
    };

    const control = createControlClient();

    // 1. Fetch current tenant to compare old email and confirm existence
    const { data: tenant, error: fetchError } = await control
      .schema("control")
      .from("tenants")
      .select("admin_email, plan, status")
      .eq("id", id)
      .single();

    if (fetchError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // 2. If admin_email changed, update in Project B Auth first.
    // Auth update happens before control update so that if it fails,
    // we return an error before writing anything to control.tenants.
    if (body.admin_email && body.admin_email !== tenant.admin_email) {
      try {
        const service = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // No getUserByEmail in the Supabase JS admin API — scan all users.
        // Acceptable: user count is small in this SaaS admin context.
        const { data: { users }, error: listError } = await service.auth.admin.listUsers();
        if (listError) throw listError;

        const authUser = users.find((u) => u.email === tenant.admin_email);
        if (!authUser) {
          throw new Error(
            `No auth user found for current email "${tenant.admin_email}"`
          );
        }

        const { error: updateEmailError } = await service.auth.admin.updateUserById(
          authUser.id,
          { email: body.admin_email }
        );
        if (updateEmailError) throw updateEmailError;
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to update admin email", detail: errorMessage(err) },
          { status: 500 }
        );
      }
    }

    // 3. Build partial patch — only include fields that were sent
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.plan !== undefined) patch.plan = body.plan;
    if (body.status !== undefined) patch.status = body.status;
    if (body.admin_email !== undefined) patch.admin_email = body.admin_email;

    const { data: updated, error: patchError } = await control
      .schema("control")
      .from("tenants")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (patchError) {
      return NextResponse.json(
        { error: "Failed to update tenant", detail: errorMessage(patchError) },
        { status: 500 }
      );
    }

    return NextResponse.json({ tenant: updated });
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/app/api/admin/tenants/[id]/route.ts
  git commit -m "feat(admin): add PATCH /api/admin/tenants/[id] for plan/status/email updates"
  ```

---

## Task 2: EditTenantModal component

**Files:**
- Create: `src/app/admin/_components/EditTenantModal.tsx`

**Interfaces:**
- Consumes: `PATCH /api/admin/tenants/[id]` from Task 1; `Modal`, `Button`, `Field`, `Input` from `@/components/ui/*`; `useToast` from `@/components/ui/Toast`; `Tenant`, `TenantPlan`, `TenantStatus` from `@/types`
- Produces: `EditTenantModal({ open, tenant, onClose })` — exported named component, calls `onClose()` on success or cancel

- [ ] **Step 1: Create the modal component**

  Create `src/app/admin/_components/EditTenantModal.tsx`:

  ```typescript
  "use client";

  import { useState } from "react";
  import { Modal } from "@/components/ui/Modal";
  import { Button } from "@/components/ui/Button";
  import { Field, Input } from "@/components/ui/FormFields";
  import { useToast } from "@/components/ui/Toast";
  import type { Tenant, TenantPlan, TenantStatus } from "@/types";

  interface Props {
    open: boolean;
    tenant: Tenant;
    onClose: () => void;
  }

  const labelCls =
    "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
  const selectCls =
    "w-full rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-2 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

  export function EditTenantModal({ open, tenant, onClose }: Props) {
    const toast = useToast();
    const [plan, setPlan] = useState<TenantPlan>(tenant.plan);
    const [status, setStatus] = useState<TenantStatus>(tenant.status);
    const [adminEmail, setAdminEmail] = useState(tenant.admin_email ?? "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const emailChanged = adminEmail !== (tenant.admin_email ?? "");

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      setError(null);
      setLoading(true);

      const patch: { plan?: TenantPlan; status?: TenantStatus; admin_email?: string } = {};
      if (plan !== tenant.plan) patch.plan = plan;
      if (status !== tenant.status) patch.status = status;
      if (emailChanged) patch.admin_email = adminEmail;

      // Nothing changed — close without a network call
      if (Object.keys(patch).length === 0) {
        onClose();
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        const data = (await res.json()) as {
          tenant?: Tenant;
          error?: string;
          detail?: string;
        };

        if (!res.ok) {
          const message = data.detail ?? data.error ?? "Update failed";
          setError(message);
          toast.error("Failed to update tenant", message);
          return;
        }

        toast.success("Tenant updated", `${tenant.name} has been updated.`);
        onClose();
      } catch {
        const message = "Network error — please try again";
        setError(message);
        toast.error("Failed to update tenant", message);
      } finally {
        setLoading(false);
      }
    }

    function handleClose() {
      // Reset local state back to the tenant's current values on cancel
      setPlan(tenant.plan);
      setStatus(tenant.status);
      setAdminEmail(tenant.admin_email ?? "");
      setError(null);
      onClose();
    }

    return (
      <Modal
        title={`Edit ${tenant.name}`}
        open={open}
        onClose={handleClose}
        footer={
          <div className="flex items-center gap-2 justify-end">
            <Button variant="secondary" type="button" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" form="edit-tenant-form" disabled={loading}>
              {loading ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        }
      >
        <form id="edit-tenant-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-(--color-danger) bg-(--color-danger-bg) rounded-[var(--radius-btn)] px-3 py-2">
              {error}
            </p>
          )}

          <Field label="Admin Email" required>
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@example.com"
            />
            {emailChanged && (
              <p className="text-xs text-(--color-text-faint) mt-1">
                A verification email will be sent to the new address.
              </p>
            )}
          </Field>

          <div>
            <span className={labelCls}>Plan</span>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as TenantPlan)}
              className={selectCls}
            >
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="business">Business</option>
            </select>
          </div>

          <div>
            <span className={labelCls}>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TenantStatus)}
              className={selectCls}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </form>
      </Modal>
    );
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/app/admin/_components/EditTenantModal.tsx
  git commit -m "feat(admin): add EditTenantModal for plan/status/email editing"
  ```

---

## Task 3: Wire up TenantActions and page.tsx

**Files:**
- Modify: `src/app/admin/_components/TenantActions.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `EditTenantModal` from `./EditTenantModal` (Task 2); existing `Tenant` type from `@/types`
- Produces: `TenantActions({ tenant, onRefresh })` — new `onRefresh: () => void` prop; `page.tsx` passes `() => setRefreshKey(k => k + 1)`

- [ ] **Step 1: Replace TenantActions.tsx**

  Replace the full contents of `src/app/admin/_components/TenantActions.tsx`:

  ```typescript
  "use client";

  import { useState } from "react";
  import { Button } from "@/components/ui/Button";
  import { EditTenantModal } from "./EditTenantModal";
  import type { Tenant } from "@/types";

  interface Props {
    tenant: Tenant;
    onRefresh: () => void;
  }

  export function TenantActions({ tenant, onRefresh }: Props) {
    const [editOpen, setEditOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleImpersonate() {
      const email = window.prompt(
        `Enter the super_admin email address for tenant "${tenant.name}":`
      );
      if (!email) return;

      setLoading(true);
      try {
        const res = await fetch("/api/admin/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId: tenant.id, adminEmail: email }),
        });

        const data = (await res.json()) as { ok?: boolean; magicLink?: string; error?: string };

        if (!res.ok || !data.magicLink) {
          alert(data.error ?? "Impersonation failed");
          return;
        }

        window.location.href = data.magicLink;
      } finally {
        setLoading(false);
      }
    }

    return (
      <>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="secondary" onClick={handleImpersonate} disabled={loading}>
            {loading ? "Loading…" : "Impersonate"}
          </Button>
        </div>

        <EditTenantModal
          open={editOpen}
          tenant={tenant}
          onClose={() => {
            setEditOpen(false);
            onRefresh();
          }}
        />
      </>
    );
  }
  ```

- [ ] **Step 2: Update page.tsx — pass onRefresh to TenantActions**

  In `src/app/admin/page.tsx`, find the `<TenantActions tenant={t} />` call (line 132) and replace it:

  ```tsx
  // Before
  <TenantActions tenant={t} />

  // After
  <TenantActions tenant={t} onRefresh={() => setRefreshKey((k) => k + 1)} />
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/admin/_components/TenantActions.tsx src/app/admin/page.tsx
  git commit -m "feat(admin): wire Edit button in TenantActions, pass onRefresh from page"
  ```

---

## Task 4: Update docs

**Files:**
- Modify: `src/app/admin/CLAUDE.md`
- Modify: `src/app/admin/SKILL.md`

- [ ] **Step 1: Update CLAUDE.md**

  In `src/app/admin/CLAUDE.md`, make the following changes:

  1. In the **Files in this folder** section, add a new bullet for `EditTenantModal` after the `AddTenantModal` bullet:

     ```
     - `_components/EditTenantModal.tsx` — "Edit Tenant" modal: pre-filled form
       for `plan`, `status`, and `admin_email`. Computes a partial diff against
       the current tenant and sends only changed fields to `PATCH
       /api/admin/tenants/[tenant.id]`. Shows inline note when email changes.
       Calls `onClose()` on success (parent bumps `refreshKey`).
     ```

  2. Update the `_components/TenantActions.tsx` bullet to reflect the new `onRefresh` prop and Edit button:

     ```
     - `_components/TenantActions.tsx` — per-row action buttons. Accepts
       `{ tenant: Tenant, onRefresh: () => void }`. Renders an "Edit" button
       (opens `EditTenantModal`; calls `onRefresh` on close) and an
       "Impersonate" button (prompts for super_admin email, posts to
       `/api/admin/impersonate`, redirects to magic link).
     ```

  3. In the **API routes** section, add a new bullet for the PATCH route after the `tenants/route.ts` bullet:

     ```
     - **`tenants/[id]/route.ts`** (`PATCH`) — partial update for an existing
       tenant. Accepts `{ plan?, status?, admin_email? }`. Steps: (1) fetch
       current row from `control.tenants` (404 if missing); (2) if
       `admin_email` changed, scan Project B Auth users with
       `service.auth.admin.listUsers()`, find the user by old email, call
       `updateUserById({ email: newEmail })` — returns 500 if this fails,
       before touching `control.tenants`; (3) `.update(patch).eq("id", id)`
       on `control.tenants` with only the fields that were sent. Returns
       `{ tenant: updatedRow }`. This is a **platform-admin override** —
       it writes `plan`/`status` directly, bypassing Stripe webhooks.
     ```

- [ ] **Step 2: Update SKILL.md**

  In `src/app/admin/SKILL.md`, add a new entry to the **Minimal file set for common changes** section:

  ```
  - **Edit an existing tenant** (plan, status, admin email):
    `_components/EditTenantModal.tsx` (form) + `api/admin/tenants/[id]/route.ts`
    (backend). `_components/TenantActions.tsx` and `page.tsx` are already wired
    — only touch them if you need to change the button layout or refresh
    behaviour.
  ```

  And add a new entry to the **Gotchas** section:

  ```
  - **`auth.admin.listUsers()` to find by email**: The Supabase JS admin API
    has no `getUserByEmail` — `listUsers()` returns all users as an array,
    filter client-side by `.find(u => u.email === oldEmail)`. Acceptable at
    this user count; if the tenant base grows large, replace with a direct
    `auth.users` table query via service role.
  - **Plan/status edit bypasses Stripe**: `PATCH /api/admin/tenants/[id]`
    writes `plan` and `status` directly to `control.tenants` without touching
    Stripe. It's a manual admin override. Stripe webhooks continue to be the
    authoritative writer for production billing events.
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/admin/CLAUDE.md src/app/admin/SKILL.md
  git commit -m "docs(admin): update CLAUDE.md and SKILL.md for tenant edit feature"
  ```

---

## Browser Verification Checklist

Ask the user to run the app and verify these scenarios before calling the feature done:

1. **Edit plan only** — open Edit on a tenant, change plan, save. Confirm the badge in the table updates and a success toast appears.
2. **Edit status only** — set a tenant to `inactive`, save. Confirm the badge updates.
3. **Edit email** — enter a new email address. Confirm the "A verification email will be sent" note appears while typing. Save and confirm the table shows the new email.
4. **No-op save** — open Edit, change nothing, click Save. Confirm it closes without a network call (no loading spinner, no toast).
5. **Cancel resets state** — change fields, hit Cancel, reopen. Confirm fields are back to the original values.
6. **Error path** — if testable, confirm the inline red banner and error toast both appear on a failed save.
