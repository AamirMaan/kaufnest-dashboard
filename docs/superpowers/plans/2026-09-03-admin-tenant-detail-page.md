# Admin Tenant Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the `/admin` tenants table down to Tenant/Admin Email/Plan/Status/AI Usage plus a hamburger-icon link, and move Trial Ends/Created/all mutating actions to a new per-tenant detail page (`/admin/tenants/[id]`) with icons, semantic colors, and confirmation modals for Impersonate and Toggle AI.

**Architecture:** Bottom-up build — shared pieces first (badge-variant maps, an extracted AI-usage breakdown, a generic confirm modal), then the consumers that use them (a new `TenantDetailActions` component, a new detail-page route), then the main table is slimmed to point at the new route, then the now-dead `TenantActions.tsx` is removed and docs updated.

**Tech Stack:** Next.js App Router (client components), React 19 (`use()` for route params — see Task 5), Tailwind v4 CSS-variable utility syntax (`bg-(--color-surface)`), `lucide-react` icons, existing `Modal`/`Button`/`Badge`/`Toast` primitives from `src/components/ui/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-03-admin-tenant-detail-page-design.md` — read it if any task here is ambiguous.
- Branch: work happens on `feat/admin-tenant-detail-page` (already checked out). Never commit to `main`.
- No new API routes — both the table and the detail page reuse the existing `GET /api/admin/tenants` and `GET /api/admin/ai-usage` responses.
- No new `Button` variants — semantic color comes from tinting icons with existing theme tokens (`--color-success-text`, `--color-warning-text`, `--color-info-text`, `--color-text-faint`), never from new button backgrounds.
- Per this project's working agreement (`AGENTS.md`): **do not** run `npm run dev`, `curl`, `npx tsc --noEmit`, `npm test`, or `npm run lint` mid-task to "check your work" — those cost the user tokens they can capture in one shot locally. Verify each step by **reading the file back** (confirming the edit landed as written) and, where relevant, a `grep` to confirm no stale references remain. The final task ends by asking the user to verify in the browser themselves.
- Per `AGENTS.md`'s mandatory-docs rule: `src/app/admin/CLAUDE.md` and `SKILL.md` must be updated in the **same commit** as the code that changes the file map — that update is Task 8, done last (once the final file map is settled) rather than repeated after every task.
- Existing `Tenant` type (`src/types/index.ts:250`), for reference across all tasks:
  ```ts
  export type TenantPlan = "trial" | "starter" | "pro" | "business";
  export type TenantStatus = "active" | "invited" | "deactivated" | "provisioning";
  export interface Tenant {
    id: string;
    name: string;
    slug: string;
    schema_name: string;
    admin_email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    plan: TenantPlan;
    status: TenantStatus;
    ai_enabled: boolean;
    trial_ends_at: string | null;
    created_at: string;
    updated_at: string;
  }
  ```

---

### Task 1: Shared tenant badge-variant map

**Files:**
- Create: `src/app/admin/_components/tenantVariants.ts`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Produces: `PLAN_VARIANT: Record<TenantPlan, "info"|"success"|"warning"|"danger">`, `STATUS_VARIANT: Record<TenantStatus, "success"|"warning"|"danger"|"default">` — consumed by Task 5 (detail page) and this task's own `page.tsx` edit.

Both `page.tsx` (table) and the new detail page (Task 5) need to render the same Plan/Status badges. Extracting this now avoids defining it twice.

- [ ] **Step 1: Create the shared variant map**

Write `src/app/admin/_components/tenantVariants.ts`:

```ts
import type { TenantPlan, TenantStatus } from "@/types";

export const PLAN_VARIANT: Record<TenantPlan, "info" | "success" | "warning" | "danger"> = {
  trial:    "warning",
  starter:  "info",
  pro:      "success",
  business: "danger",
};

export const STATUS_VARIANT: Record<TenantStatus, "success" | "warning" | "danger" | "default"> = {
  active:       "success",
  invited:      "warning",
  provisioning: "warning",
  deactivated:  "danger",
};
```

- [ ] **Step 2: Point `page.tsx` at the shared map**

In `src/app/admin/page.tsx`, replace:

```tsx
import type { Tenant, TenantPlan, TenantStatus } from "@/types";
import { Plus, Building2 } from "lucide-react";

const PLAN_VARIANT: Record<TenantPlan, "info" | "success" | "warning" | "danger"> = {
  trial:    "warning",
  starter:  "info",
  pro:      "success",
  business: "danger",
};

const STATUS_VARIANT: Record<TenantStatus, "success" | "warning" | "danger" | "default"> = {
  active:       "success",
  invited:      "warning",
  provisioning: "warning",
  deactivated:  "danger",
};
```

with:

```tsx
import type { Tenant } from "@/types";
import { Plus, Building2 } from "lucide-react";
import { PLAN_VARIANT, STATUS_VARIANT } from "./_components/tenantVariants";
```

- [ ] **Step 3: Verify**

Read `src/app/admin/page.tsx` back and confirm: the `PLAN_VARIANT`/`STATUS_VARIANT` consts are gone from the file body, the new import line is present, and every existing usage (`PLAN_VARIANT[t.plan]`, `STATUS_VARIANT[t.status]` in the table body) is untouched and still resolves against the imported names.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/_components/tenantVariants.ts src/app/admin/page.tsx
git commit -m "refactor(admin): extract tenant badge-variant maps to a shared module"
```

---

### Task 2: Extract `AiUsageBreakdown` from `AiUsageModal`

**Files:**
- Create: `src/app/admin/_components/AiUsageBreakdown.tsx`
- Modify: `src/app/admin/_components/AiUsageModal.tsx`

**Interfaces:**
- Produces: `AiUsageBreakdown({ used: number, limit: number, byUser: Record<string, number> })` — a presentational component, no `Modal` wrapper. Consumed by `AiUsageModal.tsx` (this task) and the detail page (Task 5).
- `AiUsageModal`'s own props (`{ open, tenant, used, limit, byUser, onClose }`) are unchanged — the table's existing call site in `page.tsx` needs no edit.

- [ ] **Step 1: Create the presentational breakdown component**

Write `src/app/admin/_components/AiUsageBreakdown.tsx`:

```tsx
interface Props {
  used: number;
  limit: number;
  byUser: Record<string, number>;
}

export function AiUsageBreakdown({ used, limit, byUser }: Props) {
  const rows = Object.entries(byUser).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-[var(--color-text-strong)]">
        {used} of {limit} generations this month
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No AI usage this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] pb-2 pr-4">
                  User
                </th>
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] pb-2">
                  Calls
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map(([userId, calls]) => (
                <tr key={userId}>
                  <td className="py-2 pr-4 font-mono text-xs text-[var(--color-text-muted)] truncate max-w-[220px]">
                    {userId}
                  </td>
                  <td className="py-2 text-[var(--color-text-strong)]">{calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

This is byte-for-byte the body `AiUsageModal.tsx` already renders (the design spec calls for lifting it out unchanged, not redesigning it).

- [ ] **Step 2: Slim `AiUsageModal.tsx` down to a thin wrapper**

Replace the full contents of `src/app/admin/_components/AiUsageModal.tsx` with:

```tsx
"use client";

import { Modal } from "@/components/ui/Modal";
import { AiUsageBreakdown } from "./AiUsageBreakdown";
import type { Tenant } from "@/types";

interface Props {
  open: boolean;
  tenant: Tenant;
  used: number;
  limit: number;
  byUser: Record<string, number>;
  onClose: () => void;
}

export function AiUsageModal({ open, tenant, used, limit, byUser, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={`AI Usage — ${tenant.name}`}>
      <AiUsageBreakdown used={used} limit={limit} byUser={byUser} />
    </Modal>
  );
}
```

- [ ] **Step 3: Verify**

Read both files back. Confirm `AiUsageModal.tsx` no longer contains the `rows`/table JSX (that logic now lives only in `AiUsageBreakdown.tsx`), and that its exported `Props` shape is unchanged from before this task (so `page.tsx`'s existing `<AiUsageModal ... />` call site still type-checks without modification).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/_components/AiUsageBreakdown.tsx src/app/admin/_components/AiUsageModal.tsx
git commit -m "refactor(admin): extract AiUsageBreakdown for reuse on the tenant detail page"
```

---

### Task 3: Generic `ConfirmActionModal`

**Files:**
- Create: `src/app/admin/_components/ConfirmActionModal.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ConfirmTone = "warning" | "success" | "info";
  interface ConfirmActionModalProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    confirmingLabel: string;
    tone: ConfirmTone;
    loading: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }
  export function ConfirmActionModal(props: ConfirmActionModalProps): JSX.Element;
  ```
  Consumed by Task 4 (`TenantDetailActions`), twice (Toggle AI, Impersonate).
- Consumes: `Modal` (`src/components/ui/Modal.tsx`, props `{ title, open, onClose, children, footer }`), `Button` (`src/components/ui/Button.tsx`, `variant`/`disabled`/`onClick`/`type` props).

This is distinct from the shared `src/components/modals/DeleteConfirmModal.tsx`, which forces a typed reason (used by Sales/Expenses/Purchases delete flows) — Impersonate and Toggle AI don't need a reason, just a yes/no. Do not reuse `DeleteConfirmModal` here.

- [ ] **Step 1: Write the component**

Write `src/app/admin/_components/ConfirmActionModal.tsx`:

```tsx
"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export type ConfirmTone = "warning" | "success" | "info";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmingLabel: string;
  tone: ConfirmTone;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const TONE_CLASSES: Record<ConfirmTone, string> = {
  warning: "border-[var(--color-warning-text)]/30 bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  success: "border-[var(--color-success-text)]/30 bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  info:    "border-[var(--color-info-text)]/30 bg-[var(--color-info-bg)] text-[var(--color-info-text)]",
};

export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel,
  confirmingLabel,
  tone,
  loading,
  onConfirm,
  onClose,
}: Props) {
  function handleClose() {
    if (loading) return;
    onClose();
  }

  return (
    <Modal
      title={title}
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? confirmingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
        {message}
      </div>
    </Modal>
  );
}
```

Note: `handleClose` guards against closing while `loading` is true (Escape key, backdrop click, and the header's X button all route through `Modal`'s `onClose` prop) — same convention `DeleteTenantModal.tsx` uses for its own `handleClose`. The confirm button is always `variant="primary"` (the `Button` default) regardless of `tone` — `tone` only colors the informational banner, matching `EditTenantModal`'s "Save Changes" convention of a primary commit button.

- [ ] **Step 2: Verify**

Read the file back. Confirm it has no dependency on `Tenant` or any admin-specific type — it must stay generic so it's reusable for both Toggle AI and Impersonate in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/_components/ConfirmActionModal.tsx
git commit -m "feat(admin): add generic ConfirmActionModal for yes/no confirmations"
```

---

### Task 4: `TenantDetailActions` — icons, colors, confirmations

**Files:**
- Create: `src/app/admin/_components/TenantDetailActions.tsx`

**Interfaces:**
- Consumes: `ConfirmActionModal` (Task 3), `EditTenantModal`/`DeleteTenantModal` (existing, unchanged props: `{ open, tenant, onClose }` and `{ open, tenant, onClose, onDeleted }` respectively), `useToast()` (`src/components/ui/Toast.tsx`, returns `{ success, error, ... }`).
- Produces: `TenantDetailActions({ tenant: Tenant, onRefresh: () => void })` — consumed by Task 5 (detail page). Same prop shape as the old `TenantActions`, so Task 5 can wire it exactly the way `page.tsx` wired `TenantActions` today.

This is a new file — the existing `TenantActions.tsx` is left untouched until Task 7, so the table (still using `TenantActions`) keeps working throughout Tasks 4–5.

Behavior per the design spec's action table:

| Action | Icon | Button variant | Icon tint | Confirmation |
|---|---|---|---|---|
| Edit | `Pencil` | `secondary` | none (inherits) | none — opens `EditTenantModal` |
| Toggle AI | `Sparkles` | `secondary` | `text-(--color-success-text)` when `ai_enabled`, else `text-(--color-text-faint)` | `ConfirmActionModal` |
| Resend Invite | `Mail` | `secondary`, only when `status === "invited"` | `text-(--color-info-text)` | none |
| Impersonate | `UserCog` | `secondary` | `text-(--color-warning-text)` | `ConfirmActionModal` |
| Delete | `Trash2` | `danger` | inherits | existing `DeleteTenantModal` |

- [ ] **Step 1: Write the component**

Write `src/app/admin/_components/TenantDetailActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EditTenantModal } from "./EditTenantModal";
import { DeleteTenantModal } from "./DeleteTenantModal";
import { ConfirmActionModal } from "./ConfirmActionModal";
import { Pencil, Sparkles, Mail, UserCog, Trash2 } from "lucide-react";
import type { Tenant } from "@/types";

interface Props {
  tenant: Tenant;
  onRefresh: () => void;
}

export function TenantDetailActions({ tenant, onRefresh }: Props) {
  const { success, error: toastError } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resending, setResending] = useState(false);

  const [aiConfirmOpen, setAiConfirmOpen] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);

  const [impersonateConfirmOpen, setImpersonateConfirmOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  async function handleResendInvite() {
    setResending(true);
    try {
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok) {
        success("Invite resent", `A new invite link was sent to ${tenant.admin_email}.`);
      } else {
        toastError("Resend failed", data.error ?? "Could not resend invite.");
      }
    } finally {
      setResending(false);
    }
  }

  async function handleConfirmToggleAi() {
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
        setAiConfirmOpen(false);
        onRefresh();
      } else {
        toastError("Could not update AI visibility", data.error ?? "Please try again.");
      }
    } finally {
      setTogglingAi(false);
    }
  }

  async function handleConfirmImpersonate() {
    setImpersonating(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });

      const data = (await res.json()) as { ok?: boolean; magicLink?: string; error?: string };

      if (!res.ok || !data.magicLink) {
        toastError("Impersonation failed", data.error ?? "Please try again.");
        setImpersonating(false);
        return;
      }

      window.location.href = data.magicLink;
    } catch {
      toastError("Impersonation failed", "Network error — please try again.");
      setImpersonating(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          <Pencil size={14} />
          Edit
        </Button>

        <Button variant="secondary" onClick={() => setAiConfirmOpen(true)}>
          <Sparkles
            size={14}
            className={tenant.ai_enabled ? "text-(--color-success-text)" : "text-(--color-text-faint)"}
          />
          {tenant.ai_enabled ? "AI: On" : "AI: Off"}
        </Button>

        {tenant.status === "invited" && (
          <Button variant="secondary" onClick={handleResendInvite} disabled={resending}>
            <Mail size={14} className="text-(--color-info-text)" />
            {resending ? "Sending…" : "Resend Invite"}
          </Button>
        )}

        <Button variant="secondary" onClick={() => setImpersonateConfirmOpen(true)}>
          <UserCog size={14} className="text-(--color-warning-text)" />
          Impersonate
        </Button>

        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={14} />
          Delete
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
      <DeleteTenantModal
        open={deleteOpen}
        tenant={tenant}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          onRefresh();
        }}
      />
      <ConfirmActionModal
        open={aiConfirmOpen}
        title={tenant.ai_enabled ? "Hide AI features" : "Enable AI features"}
        message={
          tenant.ai_enabled
            ? `Hide AI features from ${tenant.name}? Their users will lose access to AI-assisted listing tools immediately.`
            : `Enable AI features for ${tenant.name}? Their users will be able to use AI-assisted listing tools immediately.`
        }
        confirmLabel={tenant.ai_enabled ? "Hide AI" : "Enable AI"}
        confirmingLabel="Saving…"
        tone={tenant.ai_enabled ? "warning" : "success"}
        loading={togglingAi}
        onConfirm={handleConfirmToggleAi}
        onClose={() => setAiConfirmOpen(false)}
      />
      <ConfirmActionModal
        open={impersonateConfirmOpen}
        title="Impersonate tenant admin"
        message={`Impersonate ${tenant.admin_email ?? "this tenant's admin"} for tenant "${tenant.name}"? You will be signed in as them until you exit impersonation.`}
        confirmLabel="Impersonate"
        confirmingLabel="Loading…"
        tone="warning"
        loading={impersonating}
        onConfirm={handleConfirmImpersonate}
        onClose={() => setImpersonateConfirmOpen(false)}
      />
    </>
  );
}
```

Two behavior changes versus the old `TenantActions.tsx`, both intentional (from the design spec):
1. Impersonate's failure path now uses `toastError(...)` instead of `alert(...)` — consistent with every other action here.
2. Impersonate and Toggle AI no longer fire on click — they open a `ConfirmActionModal` first; the actual fetch happens in `handleConfirmToggleAi`/`handleConfirmImpersonate`, called from the modal's confirm button.

- [ ] **Step 2: Verify**

Read the file back. Confirm: all five buttons render with an icon before their label; the two `ConfirmActionModal` instances have distinct `open`/`loading` state pairs (`aiConfirmOpen`/`togglingAi` vs. `impersonateConfirmOpen`/`impersonating`) so opening one doesn't affect the other; `handleResendInvite` is unchanged from the original (still no confirmation, still gated on `tenant.status === "invited"`).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/_components/TenantDetailActions.tsx
git commit -m "feat(admin): add TenantDetailActions with icons, colors, and confirm modals"
```

---

### Task 5: Tenant detail page route

**Files:**
- Create: `src/app/admin/tenants/[id]/page.tsx`

**Interfaces:**
- Consumes: `AiUsageBreakdown` (Task 2, `{ used, limit, byUser }`), `TenantDetailActions` (Task 4, `{ tenant, onRefresh }`), `PLAN_VARIANT`/`STATUS_VARIANT` (Task 1), `Badge` (`src/components/ui/Badge.tsx`, `{ label, variant }`).
- No new API routes: fetches `GET /api/admin/tenants` (`{ tenants?: Tenant[] }`) and `GET /api/admin/ai-usage` (`{ usage?: { tenantId, used, limit, byUser }[] }`) — the exact same two endpoints `page.tsx` already calls — and finds the current tenant by `id`.

This project pins dynamic-route params as a `Promise` resolved via React's `use()` — confirmed from the existing `src/app/dashboard/sales/[id]/page.tsx` pattern (`params: Promise<{ id: string }>`, `const { id } = use(params);`). Follow that exact shape here, not `useParams()`.

- [ ] **Step 1: Write the detail page**

Write `src/app/admin/tenants/[id]/page.tsx`:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { AiUsageBreakdown } from "../../_components/AiUsageBreakdown";
import { TenantDetailActions } from "../../_components/TenantDetailActions";
import { PLAN_VARIANT, STATUS_VARIANT } from "../../_components/tenantVariants";
import type { Tenant } from "@/types";
import { ArrowLeft, Building2 } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function TenantDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [aiUsage, setAiUsage] = useState<Record<string, { used: number; limit: number; byUser: Record<string, number> }>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/tenants")
      .then((r) => r.json())
      .then((data: { tenants?: Tenant[] }) => {
        if (!cancelled) setTenants(data.tenants ?? []);
      })
      .catch(() => { if (!cancelled) setTenants([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

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

  const loading = tenants === null;
  const tenant = tenants?.find((t) => t.id === id) ?? null;
  const usage = aiUsage[id];

  const cardCls = "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-5";

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors mb-6"
      >
        <ArrowLeft size={15} />
        Back to Tenant Management
      </Link>

      {loading ? (
        <p className="text-sm text-(--color-text-muted) py-8 text-center">Loading…</p>
      ) : !tenant ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Building2 size={32} className="text-(--color-text-faint) mb-3" />
          <p className="text-sm text-(--color-text-muted)">Tenant not found.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-(--color-text-strong)">{tenant.name}</h1>
              <p className="text-xs text-(--color-text-faint) font-mono">{tenant.schema_name}</p>
            </div>
            <Badge label={tenant.plan} variant={PLAN_VARIANT[tenant.plan]} />
            <Badge label={tenant.status} variant={STATUS_VARIANT[tenant.status]} />
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Admin Email</dt>
                <dd className="text-(--color-text-strong)">{tenant.admin_email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Trial Ends</dt>
                <dd className="text-(--color-text-strong)">
                  {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString("de-DE") : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Created</dt>
                <dd className="text-(--color-text-strong)">
                  {new Date(tenant.created_at).toLocaleDateString("de-DE")}
                </dd>
              </div>
            </dl>
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">AI Usage</h2>
            {usage && usage.limit > 0 ? (
              <AiUsageBreakdown used={usage.used} limit={usage.limit} byUser={usage.byUser} />
            ) : (
              <p className="text-sm text-(--color-text-faint)">
                AI usage tracking is not available on this plan.
              </p>
            )}
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Actions</h2>
            <TenantDetailActions tenant={tenant} onRefresh={() => setRefreshKey((k) => k + 1)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Read the file back. Confirm the relative import paths resolve correctly: from `src/app/admin/tenants/[id]/page.tsx`, `_components/` is two levels up (`../../_components/...`), landing on `src/app/admin/_components/...`. Confirm the not-found branch renders when `tenant` is `null` (garbage `id` in the URL) rather than crashing on `tenant.name` etc.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/tenants/[id]/page.tsx"
git commit -m "feat(admin): add tenant detail page at /admin/tenants/[id]"
```

---

### Task 6: Slim the tenants table in `page.tsx`

**Files:**
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- No new interfaces — this task only removes columns/imports and adds a `Link` to the route Task 5 created.

At this point both the old `TenantActions` (still imported by `page.tsx`) and the new `TenantDetailActions`/detail page exist side by side. This task cuts `page.tsx` over to the new route and drops `TenantActions` from it — `TenantActions.tsx` itself is deleted in Task 7, once nothing imports it.

- [ ] **Step 1: Update imports**

In `src/app/admin/page.tsx`, replace:

```tsx
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TenantActions } from "./_components/TenantActions";
import { AddTenantModal } from "./_components/AddTenantModal";
import { AiUsageModal } from "./_components/AiUsageModal";
import type { Tenant } from "@/types";
import { Plus, Building2 } from "lucide-react";
import { PLAN_VARIANT, STATUS_VARIANT } from "./_components/tenantVariants";
```

with:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AddTenantModal } from "./_components/AddTenantModal";
import { AiUsageModal } from "./_components/AiUsageModal";
import type { Tenant } from "@/types";
import { Plus, Building2, Menu } from "lucide-react";
import { PLAN_VARIANT, STATUS_VARIANT } from "./_components/tenantVariants";
```

(This assumes Task 1 already landed, so the `PLAN_VARIANT`/`STATUS_VARIANT` import line already exists in the file — only the `TenantActions` import line is dropped and `Link`/`Menu` are added.)

- [ ] **Step 2: Slim the table header**

Replace:

```tsx
                  {["Tenant", "Admin Email", "Plan", "Status", "AI Usage", "Trial Ends", "Created", "Actions"].map((h) => (
```

with:

```tsx
                  {["Tenant", "Admin Email", "Plan", "Status", "AI Usage", ""].map((h) => (
```

- [ ] **Step 3: Remove Trial Ends / Created cells, replace the Actions cell**

Replace:

```tsx
                    <td className="py-3 pr-4 text-(--color-text-muted)">
                      {t.trial_ends_at
                        ? new Date(t.trial_ends_at).toLocaleDateString("de-DE")
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-(--color-text-muted)">
                      {new Date(t.created_at).toLocaleDateString("de-DE")}
                    </td>
                    <td className="py-3">
                      <TenantActions tenant={t} onRefresh={() => setRefreshKey((k) => k + 1)} />
                    </td>
```

with:

```tsx
                    <td className="py-3">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        aria-label={`View ${t.name} details`}
                        className="inline-flex items-center justify-center rounded-(--radius-btn) p-1.5 text-(--color-text-muted) hover:text-(--color-text-base) hover:bg-(--color-surface-subtle) transition-colors"
                      >
                        <Menu size={16} />
                      </Link>
                    </td>
```

`setRefreshKey` is no longer referenced from the table row now that actions live on the detail page — it stays in `page.tsx` because `AddTenantModal`'s `onClose` still bumps it (unchanged, further down in the file).

- [ ] **Step 4: Verify**

Read the full file back. Confirm: no remaining reference to `TenantActions` anywhere in `page.tsx`; the table's `<thead>` renders 6 header cells (last one empty); each row renders exactly one `<Menu>` icon link and no Trial Ends/Created cells; `setRefreshKey` is still used elsewhere in the file (the `AddTenantModal onClose` and the AI-usage fetch's `refreshKey` dependency), so removing it from the table row doesn't produce an unused-variable situation.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): slim tenants table to a hamburger link into the detail page"
```

---

### Task 7: Remove the now-dead `TenantActions.tsx`

**Files:**
- Delete: `src/app/admin/_components/TenantActions.tsx`

- [ ] **Step 1: Confirm nothing still imports it**

```bash
grep -rn "TenantActions" src/app/admin --include="*.tsx" --include="*.ts"
```

Expected: no matches (Task 6 already removed `page.tsx`'s import; `TenantDetailActions.tsx` is a different, unrelated filename and won't match this grep since it doesn't contain the exact substring `TenantActions` followed by a word boundary — but does contain `TenantDetailActions`, so also check by eye that any hits are `TenantDetailActions`, not the old `TenantActions`, before deleting).

- [ ] **Step 2: Delete the file**

```bash
rm src/app/admin/_components/TenantActions.tsx
```

- [ ] **Step 3: Verify**

```bash
git status --short
```

Expected: only the deletion shows (`D  src/app/admin/_components/TenantActions.tsx`), nothing else changed.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/_components/TenantActions.tsx
git commit -m "refactor(admin): remove TenantActions.tsx, superseded by TenantDetailActions"
```

---

### Task 8: Update `CLAUDE.md` and `SKILL.md`

**Files:**
- Modify: `src/app/admin/CLAUDE.md`
- Modify: `src/app/admin/SKILL.md`

Per `AGENTS.md`'s mandatory-docs rule, these must land in the same commit as the last code change that affects the file map — done here, now that the file map (Tasks 1–7) is final.

- [ ] **Step 1: Update `CLAUDE.md`'s `page.tsx` bullet**

Replace:

```markdown
- `page.tsx` — "Tenant Management" page: stats cards (Total/Active/Invited/
  Deactivated) + tenants table (Tenant, **Admin Email**, Plan, Status,
  **AI Usage**, Trial Ends, Created, Actions), fetched client-side from
  `GET /api/admin/tenants`. "Add Tenant" button opens `AddTenantModal`;
  closing it bumps `refreshKey` to refetch the list. The **AI Usage** column
  is populated by a second fetch effect (also keyed on `refreshKey`) against
  `GET /api/admin/ai-usage`, kept in an `aiUsage: Record<tenantId, {used,
  limit, byUser}>` state map. Cell shows a `used / limit` link (opens
  `AiUsageModal`, stores the clicked row in `usageTenant`) when the tenant's
  plan has a nonzero `limit`, otherwise `—` (Starter/Pro have no AI
  allowance — see `getAiGenerationLimit` in `planGating.ts`).
```

with:

```markdown
- `page.tsx` — "Tenant Management" page: stats cards (Total/Active/Invited/
  Deactivated) + a slim tenants table (Tenant, **Admin Email**, Plan, Status,
  **AI Usage**, and a final unlabeled column holding a hamburger-icon `Link`
  to `/admin/tenants/[id]`), fetched client-side from `GET /api/admin/tenants`.
  Trial Ends, Created, and all mutating actions live on the detail page now
  (2026-09-03) — this table is read-mostly navigation. "Add Tenant" button
  opens `AddTenantModal`; closing it bumps `refreshKey` to refetch the list.
  The **AI Usage** column is populated by a second fetch effect (also keyed
  on `refreshKey`) against `GET /api/admin/ai-usage`, kept in an
  `aiUsage: Record<tenantId, {used, limit, byUser}>` state map. Cell shows a
  `used / limit` link (opens `AiUsageModal`, stores the clicked row in
  `usageTenant`) when the tenant's plan has a nonzero `limit`, otherwise `—`
  (Starter/Pro have no AI allowance — see `getAiGenerationLimit` in
  `planGating.ts`). Plan/Status badge variants come from the shared
  `_components/tenantVariants.ts` (also used by the detail page) rather than
  being defined here.
- `tenants/[id]/page.tsx` — tenant detail page (2026-09-03). Client component;
  fetches the same `GET /api/admin/tenants` + `GET /api/admin/ai-usage`
  responses as `page.tsx` and finds the row by `id` (from
  `params: Promise<{ id: string }>`, resolved via React's `use()` — same
  pattern as `dashboard/sales/[id]/page.tsx`; **not** `useParams()`). Renders
  a back-link to `/admin`, the name/schema/Plan/Status header, a Details card
  (Admin Email, Trial Ends, Created — moved off the main table), an AI Usage
  card (`AiUsageBreakdown` inline, or a "not available on this plan" note
  when `limit` is 0), and an Actions card (`TenantDetailActions`). A
  `refreshKey` bumped by `TenantDetailActions.onRefresh` re-runs both fetches
  in place, mirroring `page.tsx`'s own refresh pattern.
```

- [ ] **Step 2: Update the `AiUsageModal.tsx` bullet**

Replace:

```markdown
- `_components/AiUsageModal.tsx` — read-only breakdown modal for the AI
  Usage column. Accepts `{ open, tenant, used, limit, byUser, onClose }`.
  Modeled directly on `DeleteTenantModal.tsx`'s `Modal` usage/class
  conventions (non-destructive, so no confirmation input). Renders
  `{used} of {limit} generations this month` plus a `userId → calls` table
  sorted descending by calls; `userId`s are shown raw (font-mono, truncated)
  since the admin panel has no access to tenant `profiles` names and a
  cross-project lookup isn't worth it for an internal tool. Renders "No AI
  usage this month." when `byUser` is empty.
```

with:

```markdown
- `_components/AiUsageModal.tsx` — thin `Modal` wrapper (2026-09-03) around
  `AiUsageBreakdown`, kept only so the table's AI Usage cell can open it in a
  popup. Accepts `{ open, tenant, used, limit, byUser, onClose }`, unchanged
  since before the split.
- `_components/AiUsageBreakdown.tsx` — presentational (2026-09-03): the
  actual `{used} of {limit} generations this month` line + `userId → calls`
  table (sorted descending by calls, "No AI usage this month." when empty),
  extracted out of `AiUsageModal.tsx` so the detail page can render the same
  markup inline, without a `Modal` wrapper. `userId`s are shown raw
  (font-mono, truncated) since the admin panel has no access to tenant
  `profiles` names and a cross-project lookup isn't worth it for an internal
  tool.
```

- [ ] **Step 3: Replace the `TenantActions.tsx` bullet with `TenantDetailActions.tsx` + `ConfirmActionModal.tsx` + `tenantVariants.ts`**

Replace:

```markdown
- `_components/TenantActions.tsx` — per-row action buttons. Accepts
  `{ tenant: Tenant, onRefresh: () => void }`. Renders an "Edit" button
  (opens `EditTenantModal`; calls `onRefresh` on close), an **"AI: On"/"AI:
  Off" toggle button** (PATCHes `{ ai_enabled: !tenant.ai_enabled }` to
  `/api/admin/tenants/[tenant.id]`, toasts "AI enabled"/"AI hidden", then
  calls `onRefresh`), a "Resend Invite" button (only shown when
  `tenant.status === "invited"`; posts to `/api/admin/resend-invite`), an
  "Impersonate" button (confirm dialog naming `tenant.admin_email`, posts
  `{ tenantId }` only to `/api/admin/impersonate` — the target email is
  never client-supplied, see that route below — redirects to the returned
  magic link), and a **"Delete" button** (danger variant) that opens
  `DeleteTenantModal`.
```

with:

```markdown
- `_components/TenantDetailActions.tsx` — per-tenant action buttons
  (2026-09-03, replaces `TenantActions.tsx`), rendered only on
  `tenants/[id]/page.tsx`. Accepts `{ tenant: Tenant, onRefresh: () => void }`.
  Every button carries a `lucide-react` icon and a semantic icon tint (no new
  `Button` variants): "Edit" (`Pencil`, opens `EditTenantModal`, calls
  `onRefresh` on close, no pre-confirmation — Save Changes is the commit
  point), "AI: On"/"AI: Off" (`Sparkles`, tinted
  `--color-success-text`/`--color-text-faint`, opens a `ConfirmActionModal`
  before PATCHing `{ ai_enabled: !tenant.ai_enabled }` to
  `/api/admin/tenants/[tenant.id]`), "Resend Invite" (`Mail`, tinted
  `--color-info-text`, only shown when `tenant.status === "invited"`, posts
  to `/api/admin/resend-invite` directly — **no confirmation**, unchanged
  from before), "Impersonate" (`UserCog`, tinted `--color-warning-text`,
  opens a `ConfirmActionModal` — replacing the previous `window.confirm()` —
  naming `tenant.admin_email`, then posts `{ tenantId }` only to
  `/api/admin/impersonate` and redirects to the returned magic link; a
  failure now toasts via `useToast().error(...)` instead of `alert(...)`),
  and "Delete" (`Trash2`, danger variant, opens the existing
  `DeleteTenantModal`, unchanged).
- `_components/ConfirmActionModal.tsx` — generic yes/no confirmation dialog
  (2026-09-03). `{ open, title, message, confirmLabel, confirmingLabel, tone:
  "warning"|"success"|"info", loading, onConfirm, onClose }`. Distinct from
  the shared `src/components/modals/DeleteConfirmModal.tsx`, which forces a
  typed reason for delete-style flows elsewhere in the app — this one is for
  actions (Toggle AI, Impersonate) that need a plain confirm, no reason
  field. `tone` colors an informational banner only; the confirm button is
  always `variant="primary"` regardless of tone.
- `_components/tenantVariants.ts` — `PLAN_VARIANT`/`STATUS_VARIANT` badge
  maps (2026-09-03), shared between `page.tsx`'s table and
  `tenants/[id]/page.tsx`'s header badges. Extracted so the two don't define
  the same maps twice.
```

- [ ] **Step 4: Update the "Shared dependencies" bullet list**

In the `## Shared dependencies` section, replace:

```markdown
- `components/ui/{Button,Badge,Modal,FormFields}`, `types` (`Tenant` — incl.
  `admin_email`, `TenantPlan`, `TenantStatus`).
```

with:

```markdown
- `components/ui/{Button,Badge,Modal,FormFields}`, `types` (`Tenant` — incl.
  `admin_email`, `TenantPlan`, `TenantStatus`).
- `next/link` — the tenants table's hamburger-icon cell and the detail
  page's back link both use `Link`, not `Button` (`Button` renders a plain
  `<button>`, so navigation-as-a-link is styled by copying its ghost-variant
  classes directly rather than extending `Button` to accept `as="a"`).
```

- [ ] **Step 5: Update `SKILL.md`'s "Edit an existing tenant" and "Change impersonation" entries**

Replace:

```markdown
- **Edit an existing tenant** (plan, status, admin email):
  `_components/EditTenantModal.tsx` (form) + `api/admin/tenants/[id]/route.ts`
  (backend). `_components/TenantActions.tsx` and `page.tsx` are already wired
  — only touch them if you need to change the button layout or refresh
  behaviour.
- **Change impersonation**: `_components/TenantActions.tsx` +
  `api/admin/impersonate/route.ts` / `exit-impersonation/route.ts`. The
  `kaufnest_impersonating` cookie is read by `DashboardShell` — check that
  component if you rename the cookie.
```

with:

```markdown
- **Edit an existing tenant** (plan, status, admin email):
  `_components/EditTenantModal.tsx` (form) + `api/admin/tenants/[id]/route.ts`
  (backend). `_components/TenantDetailActions.tsx` and
  `tenants/[id]/page.tsx` are already wired — only touch them if you need to
  change the button layout or refresh behaviour. (2026-09-03: action buttons
  moved off the main table onto the per-tenant detail page — see
  `CLAUDE.md`.)
- **Change impersonation**: `_components/TenantDetailActions.tsx` +
  `api/admin/impersonate/route.ts` / `exit-impersonation/route.ts`. The
  confirmation dialog is a `ConfirmActionModal`, not `window.confirm()` — see
  the gotcha below before reaching for `DeleteConfirmModal` instead. The
  `kaufnest_impersonating` cookie is read by `DashboardShell` — check that
  component if you rename the cookie.
```

- [ ] **Step 6: Add a gotcha distinguishing `ConfirmActionModal` from `DeleteConfirmModal`**

At the end of the `## Gotchas` section in `SKILL.md`, after the last existing bullet (the one ending "...silently move them out of their original tenant. Same check exists in `/api/users/invite`..."), append:

```markdown
- **`ConfirmActionModal` vs. the shared `DeleteConfirmModal`**: this folder's
  `_components/ConfirmActionModal.tsx` is a plain yes/no confirm (Toggle AI,
  Impersonate) — no reason field. `src/components/modals/DeleteConfirmModal.tsx`
  (shared with Sales/Expenses/Purchases) forces a typed reason and is scoped
  to delete-style flows; `DeleteTenantModal.tsx` in this folder uses a
  type-the-schema-name confirmation instead of either, since dropping a
  tenant schema is destructive enough to warrant more friction than a typed
  reason would add. Don't reach for `DeleteConfirmModal` for a new
  non-destructive admin-panel confirmation — use `ConfirmActionModal`.
```

- [ ] **Step 7: Verify**

Read both files back in full. Confirm: no remaining mention of `TenantActions.tsx` (the old filename) anywhere in either doc; every new/renamed file from Tasks 1–7 (`tenantVariants.ts`, `AiUsageBreakdown.tsx`, `ConfirmActionModal.tsx`, `TenantDetailActions.tsx`, `tenants/[id]/page.tsx`) is mentioned at least once; the "Minimal file set" and "Gotchas" sections in `SKILL.md` read coherently top to bottom (no orphaned references).

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/CLAUDE.md src/app/admin/SKILL.md
git commit -m "docs(admin): update CLAUDE.md/SKILL.md for the tenant detail page split"
```

- [ ] **Step 9: Hand off for manual verification**

Per the working agreement, don't start the dev server or curl routes yourself. Tell the user the branch is ready and ask them to check, in the browser (with `npm run dev` already running):
- `/admin` shows the 6-column table (Tenant, Admin Email, Plan, Status, AI Usage, hamburger link) and the AI Usage cell still opens its modal.
- Clicking the hamburger icon navigates to `/admin/tenants/[id]` and shows the right tenant's name/schema/badges/Admin Email/Trial Ends/Created/AI Usage.
- Visiting `/admin/tenants/does-not-exist` shows the "Tenant not found." state instead of crashing.
- Edit, Delete, Resend Invite (on an invited tenant) all still work as before.
- Toggle AI and Impersonate each open a `ConfirmActionModal` with the right tone/message before doing anything, cancel cleanly, and perform the same mutation as before on confirm.
