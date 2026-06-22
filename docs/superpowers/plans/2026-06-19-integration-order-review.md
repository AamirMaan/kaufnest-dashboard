# Integration Order Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace eBay/Amazon auto-sync with a manual order review page where users fetch, preview, and selectively import platform orders as sales.

**Architecture:** Two new API routes handle fetching (GET `/api/integrations/review` — live fetch from platform APIs, diffed against existing sales) and importing (POST `/api/integrations/review/import` — upsert selected orders). A new page at `/dashboard/integrations/review` renders a tabbed table with checkboxes. The cron is removed and `ConnectionCard`'s "Sync now" is replaced with a "Review orders" link.

**Tech Stack:** Next.js 16 App Router, Supabase JS v2, Redux Toolkit, TypeScript, Tailwind CSS (CSS custom property pattern), existing `PlatformAdapter`/`normalizedOrderToSaleRow` from `src/lib/integrations/`.

## Global Constraints

- Always work on a branch — `git checkout -b feat/integration-order-review` before touching any files.
- Next.js 16: `params` is `Promise<...>` in route handlers — always `await params`.
- Never import server-only modules (`requireIntegrationAdmin`, `createControlClient`, `getConnection`, etc.) in Client Components. Use `import type` for type-only cross-boundary imports.
- Auth guard: every `/api/integrations/*` route calls `requireIntegrationAdmin()` first. Plan gate (Pro/Business) follows immediately after.
- Error shape: `{ error: string, detail?: string }` on all failure responses.
- No unit tests — all code paths involve Supabase/network calls (working agreement).
- `Button` component (`src/components/ui/Button.tsx`) renders a `<button>` — no `asChild` prop. Use a styled `<Link>` for navigation-as-button.
- After every task, CLAUDE.md and SKILL.md must be updated in the same commit (Task 5 covers the final pass once all code is in place).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/integrations/review/route.ts` | **Create** | GET — fetch orders from platform APIs, diff against `sales`, return with `imported` flag |
| `src/app/api/integrations/review/import/route.ts` | **Create** | POST — upsert selected orders into `sales`, update `last_synced_at` |
| `src/app/dashboard/integrations/review/page.tsx` | **Create** | Review UI — platform tabs, order table, checkbox selection, import button |
| `src/app/dashboard/integrations/_components/ConnectionCard.tsx` | **Modify** | Remove "Sync now" + `handleSync` + `syncing` state; add "Review orders" link |
| `vercel.json` | **Modify** | Remove `crons` array entirely |
| `src/app/dashboard/integrations/CLAUDE.md` | **Modify** | Update file map, data-flow, and shared deps |
| `src/app/dashboard/integrations/SKILL.md` | **Modify** | Add review-page minimal-file-set entry and gotchas |

---

## Task 1: GET /api/integrations/review

**Files:**
- Create: `src/app/api/integrations/review/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin` from `@/lib/integrations/authGuard`; `getAdapter` from `@/lib/integrations/registry`; `ensureValidAccessToken`, `getConnection` from `@/lib/integrations/tokenStore`; `createControlClient` from `@/lib/supabase/control`; `hasPlatformIntegrations` from `@/lib/utils/planGating`; `NormalizedOrder` from `@/lib/integrations/types`; `IntegrationPlatform`, `TenantPlan` from `@/types`
- Produces: exports `ReviewOrder` and `ReviewResponse` types (imported by the review page via `import type`)

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/integration-order-review
```

- [ ] **Step 2: Create the GET route**

Create `src/app/api/integrations/review/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, getConnection } from "@/lib/integrations/tokenStore";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { IntegrationPlatform, TenantPlan } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export type ReviewOrder = NormalizedOrder & { imported: boolean };
export type ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & {
  errors?: Record<string, string>;
};

const REVIEW_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

export async function GET(_req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  if (!hasPlatformIntegrations((tenant?.plan ?? "trial") as TenantPlan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  // Load connections for all platforms to find which are active
  const connections = await Promise.all(
    PLATFORMS.map(async (p) => ({ platform: p, conn: await getConnection(client, p) }))
  );
  const active = connections.filter((c) => c.conn?.status === "connected");

  if (active.length === 0) return NextResponse.json({});

  // Fetch existing external_order_ids from sales for dedup
  const activePlatforms = active.map((c) => c.platform);
  const { data: existingSales } = await client
    .from("sales")
    .select("platform, external_order_id")
    .in("platform", activePlatforms)
    .not("external_order_id", "is", null);

  const importedSet = new Set(
    (existingSales ?? []).map(
      (s: { platform: string; external_order_id: string }) =>
        `${s.platform}:${s.external_order_id}`
    )
  );

  const result: ReviewResponse = {};
  const errors: Record<string, string> = {};

  // Fetch orders from each active platform in parallel
  await Promise.all(
    active.map(async ({ platform, conn }) => {
      try {
        const adapter = getAdapter(platform);
        const token = await ensureValidAccessToken(client, conn!, adapter);
        const orders = await adapter.fetchOrders(token, since, conn!.marketplace_id);
        result[platform] = {
          orders: orders.map((o) => ({
            ...o,
            imported: importedSet.has(`${platform}:${o.external_order_id}`),
          })),
        };
      } catch (err) {
        errors[platform] = err instanceof Error ? err.message : String(err);
      }
    })
  );

  if (Object.keys(errors).length > 0) result.errors = errors;
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/integrations/review/route.ts
git commit -m "feat(integrations): add GET /api/integrations/review — fetch + diff orders"
```

---

## Task 2: POST /api/integrations/review/import

**Files:**
- Create: `src/app/api/integrations/review/import/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin`, `createControlClient`, `upsertConnection`, `normalizedOrderToSaleRow`, `hasPlatformIntegrations`; `ReviewOrder` type from `../route` (via `import type`)
- Produces: `POST /api/integrations/review/import` → `{ imported: number }` or `{ error, detail }`

- [ ] **Step 1: Create the POST import route**

Create `src/app/api/integrations/review/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { upsertConnection } from "@/lib/integrations/tokenStore";
import { normalizedOrderToSaleRow } from "@/lib/integrations/mapToSale";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { IntegrationPlatform, TenantPlan } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  if (!hasPlatformIntegrations((tenant?.plan ?? "trial") as TenantPlan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  const body = (await req.json()) as {
    items: { platform: IntegrationPlatform; order: NormalizedOrder }[];
  };

  if (!body.items?.length) {
    return NextResponse.json({ imported: 0 });
  }

  const rows = body.items.map(({ platform, order }) =>
    normalizedOrderToSaleRow(order, platform, userId)
  );

  const { error } = await client
    .from("sales")
    .upsert(rows, { onConflict: "platform,external_order_id" });

  if (error) {
    return NextResponse.json(
      { error: "Import failed", detail: error.message },
      { status: 500 }
    );
  }

  // Update last_synced_at for each platform that had items
  const platforms = [...new Set(body.items.map((i) => i.platform))];
  await Promise.all(
    platforms.map((platform) =>
      upsertConnection(client, platform, {
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      })
    )
  );

  return NextResponse.json({ imported: rows.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/integrations/review/import/route.ts
git commit -m "feat(integrations): add POST /api/integrations/review/import"
```

---

## Task 3: Review page UI

**Files:**
- Create: `src/app/dashboard/integrations/review/page.tsx`

**Interfaces:**
- Consumes: `ReviewOrder`, `ReviewResponse` from `@/app/api/integrations/review/route` (type-only import — safe across server/client boundary); `formatCurrency` from `@/lib/utils/currency`; `Badge`, `Button` from `@/components/ui`; `useToast` from `@/components/ui/Toast`; `useAppSelector` from `@/store/hooks`; `hasPermission`, `hasPlatformIntegrations`, `useRouter`, `Link`
- Produces: page rendered at `/dashboard/integrations/review`

- [ ] **Step 1: Create the review page**

Create `src/app/dashboard/integrations/review/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector } from "@/store/hooks";
import { hasPermission } from "@/lib/utils/permissions";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { formatCurrency } from "@/lib/utils/currency";
import type { Currency, IntegrationPlatform } from "@/types";
import type { ReviewOrder, ReviewResponse } from "@/app/api/integrations/review/route";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const ALL_PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

export default function ReviewPage() {
  const router = useRouter();
  const toast = useToast();
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);

  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<IntegrationPlatform | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (role === undefined) return;
    if (
      !role ||
      !tenantPlan ||
      !hasPlatformIntegrations(tenantPlan) ||
      !hasPermission(role, "manage_integrations")
    ) {
      router.replace("/dashboard/integrations");
    }
  }, [role, tenantPlan, router]);

  useEffect(() => {
    fetch("/api/integrations/review")
      .then((r) => r.json())
      .then((d: ReviewResponse) => {
        setData(d);
        const first = ALL_PLATFORMS.find((p) => d[p]);
        if (first) setActiveTab(first);
      })
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, []);

  const platforms = data
    ? ALL_PLATFORMS.filter((p) => data[p])
    : [];

  const activeOrders: ReviewOrder[] = activeTab
    ? (data?.[activeTab]?.orders ?? [])
    : [];

  const unimportedOnTab = activeOrders.filter((o) => !o.imported);

  const allSelectedOnTab =
    unimportedOnTab.length > 0 &&
    unimportedOnTab.every((o) =>
      selected.has(`${activeTab}:${o.external_order_id}`)
    );

  function toggleSelectAll() {
    if (!activeTab) return;
    const next = new Set(selected);
    if (allSelectedOnTab) {
      unimportedOnTab.forEach((o) =>
        next.delete(`${activeTab}:${o.external_order_id}`)
      );
    } else {
      unimportedOnTab.forEach((o) =>
        next.add(`${activeTab}:${o.external_order_id}`)
      );
    }
    setSelected(next);
  }

  function toggleOrder(platform: IntegrationPlatform, orderId: string) {
    const key = `${platform}:${orderId}`;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  async function handleImport() {
    if (!data) return;
    setImportError(null);
    setImporting(true);

    const items: { platform: IntegrationPlatform; order: ReviewOrder }[] = [];
    for (const platform of platforms) {
      for (const order of data[platform]?.orders ?? []) {
        if (selected.has(`${platform}:${order.external_order_id}`)) {
          items.push({ platform, order });
        }
      }
    }

    try {
      const res = await fetch("/api/integrations/review/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const result = (await res.json()) as {
        imported?: number;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        const message = result.detail ?? result.error ?? "Import failed";
        setImportError(message);
        toast.error("Import failed", message);
        return;
      }

      toast.success(
        "Import complete",
        `${result.imported} order${result.imported === 1 ? "" : "s"} imported.`
      );

      // Flip imported rows in local state so they grey out immediately
      setData((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        for (const platform of platforms) {
          if (updated[platform]) {
            updated[platform] = {
              orders: updated[platform]!.orders.map((o) =>
                selected.has(`${platform}:${o.external_order_id}`)
                  ? { ...o, imported: true }
                  : o
              ),
            };
          }
        }
        return updated;
      });
      setSelected(new Set());
      router.refresh();
    } catch {
      const message = "Network error — please try again";
      setImportError(message);
      toast.error("Import failed", message);
    } finally {
      setImporting(false);
    }
  }

  const cardCls =
    "rounded-[var(--radius-card)] border border-(--color-border) bg-(--color-surface)";

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <p className="text-sm text-(--color-text-muted) py-8 text-center">
          Loading orders…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/integrations"
          className="inline-flex items-center gap-1 text-sm text-(--color-text-muted) hover:text-(--color-text-base) mb-3"
        >
          <ChevronLeft size={14} />
          Integrations
        </Link>
        <h1 className="text-2xl font-bold text-(--color-text-strong)">
          Review Orders
        </h1>
        <p className="text-sm text-(--color-text-muted) mt-1">
          Select orders to import into your dashboard. Last 90 days shown.
        </p>
      </div>

      {/* Platform API errors */}
      {data?.errors && Object.keys(data.errors).length > 0 && (
        <div className="rounded-[var(--radius-btn)] bg-(--color-danger-bg) px-4 py-3 text-sm text-(--color-danger)">
          {Object.entries(data.errors).map(([p, msg]) => (
            <p key={p}>
              {PLATFORM_LABELS[p as IntegrationPlatform] ?? p}: {msg}
            </p>
          ))}
        </div>
      )}

      {platforms.length === 0 ? (
        <div className={`${cardCls} p-8 text-center`}>
          <p className="text-sm text-(--color-text-muted)">
            No connected platforms. Connect eBay or Amazon first.
          </p>
        </div>
      ) : (
        <>
          {/* Platform tabs */}
          <div className="flex gap-1 border-b border-(--color-border)">
            {platforms.map((platform) => {
              const unimported =
                data?.[platform]?.orders.filter((o) => !o.imported).length ?? 0;
              return (
                <button
                  key={platform}
                  onClick={() => {
                    setActiveTab(platform);
                    setSelected(new Set());
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === platform
                      ? "border-(--color-primary) text-(--color-text-strong)"
                      : "border-transparent text-(--color-text-muted) hover:text-(--color-text-base)"
                  }`}
                >
                  {PLATFORM_LABELS[platform]}
                  {unimported > 0 && (
                    <span className="ml-1.5 text-xs font-normal">
                      ({unimported})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Import error banner */}
          {importError && (
            <p className="text-sm text-(--color-danger) bg-(--color-danger-bg) rounded-[var(--radius-btn)] px-3 py-2">
              {importError}
            </p>
          )}

          {/* Orders table */}
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border)">
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelectedOnTab}
                      onChange={toggleSelectAll}
                      disabled={unimportedOnTab.length === 0}
                      className="cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  {["Date", "Order ID", "Product", "Qty", "Amount", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) py-3 pr-4"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border)">
                {activeOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-sm text-(--color-text-muted)"
                    >
                      No orders found in the last 90 days.
                    </td>
                  </tr>
                ) : (
                  activeOrders.map((order) => {
                    const key = `${activeTab}:${order.external_order_id}`;
                    return (
                      <tr
                        key={order.external_order_id}
                        className={
                          order.imported
                            ? "opacity-40"
                            : "hover:bg-(--color-surface-subtle) transition-colors"
                        }
                      >
                        <td className="p-3">
                          {order.imported ? (
                            <span className="text-xs text-(--color-text-faint)">
                              ✓
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              onChange={() =>
                                activeTab &&
                                toggleOrder(activeTab, order.external_order_id)
                              }
                              className="cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="py-3 pr-4 text-(--color-text-muted)">
                          {order.date}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs text-(--color-text-faint)">
                          {order.external_order_id}
                        </td>
                        <td className="py-3 pr-4 text-(--color-text-base)">
                          {order.product_name}
                        </td>
                        <td className="py-3 pr-4 text-(--color-text-muted)">
                          {order.quantity}
                        </td>
                        <td className="py-3 pr-4 text-(--color-text-base)">
                          {formatCurrency(
                            order.total_amount,
                            (order.currency as Currency) ?? "EUR"
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge label={order.status} variant="default" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Import button */}
          <div className="flex justify-end">
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing
                ? "Importing…"
                : `Import selected (${selected.size})`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/integrations/review/page.tsx
git commit -m "feat(integrations): add order review page at /dashboard/integrations/review"
```

---

## Task 4: ConnectionCard + vercel.json

**Files:**
- Modify: `src/app/dashboard/integrations/_components/ConnectionCard.tsx`
- Modify: `vercel.json`

**Interfaces:**
- Produces: Connected platforms show "Review orders" link instead of "Sync now" button; cron is removed

- [ ] **Step 1: Update ConnectionCard.tsx**

Replace the full contents of `src/app/dashboard/integrations/_components/ConnectionCard.tsx`:

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { formatDateTime } from "@/lib/utils/date";
import { setConnectionStatus } from "../_store/integrationsSlice";
import type { IntegrationPlatform, PlatformConnection } from "@/types";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const STATUS_VARIANTS: Record<PlatformConnection["status"], "default" | "success" | "danger"> = {
  connected: "success",
  disconnected: "default",
  error: "danger",
};

interface ConnectionCardProps {
  platform: IntegrationPlatform;
  connection?: PlatformConnection;
  canManage: boolean;
}

export function ConnectionCard({ platform, connection, canManage }: ConnectionCardProps) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [disconnecting, setDisconnecting] = useState(false);

  const status = connection?.status ?? "disconnected";
  const label = PLATFORM_LABELS[platform];

  async function handleDisconnect() {
    setDisconnecting(true);
    const res = await fetch(`/api/integrations/${platform}/disconnect`, { method: "POST" });
    setDisconnecting(false);

    if (!res.ok) {
      toastError("Failed to disconnect", `${label} could not be disconnected.`);
      return;
    }

    dispatch(setConnectionStatus({ platform, status: "disconnected" }));
    success(`${label} disconnected`);
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-surface-subtle)]">
            <Plug size={18} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-strong)]">{label}</h3>
            {connection?.external_account_id && (
              <p className="text-xs text-[var(--color-text-muted)]">{connection.external_account_id}</p>
            )}
          </div>
        </div>
        <Badge label={status.charAt(0).toUpperCase() + status.slice(1)} variant={STATUS_VARIANTS[status]} />
      </div>

      <div className="text-xs text-[var(--color-text-muted)] space-y-1">
        <p>Last synced: {connection?.last_synced_at ? formatDateTime(connection.last_synced_at) : "Never"}</p>
        {connection?.last_sync_error && <p className="text-[var(--color-danger-text)]">{connection.last_sync_error}</p>}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <>
              <Link
                href="/dashboard/integrations/review"
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] font-semibold transition-colors cursor-pointer px-3 py-1.5 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-text-base)] border border-[var(--color-border)]"
              >
                Review orders
              </Link>
              <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => window.location.assign(`/api/integrations/${platform}/connect`)}>
              Connect {label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove crons from vercel.json**

Read `vercel.json` (currently has a `crons` array), then replace the full contents with:

```json
{
  "regions": ["fra1"],
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/integrations/_components/ConnectionCard.tsx vercel.json
git commit -m "feat(integrations): replace Sync Now with Review Orders link, remove cron"
```

---

## Task 5: Update docs

**Files:**
- Modify: `src/app/dashboard/integrations/CLAUDE.md`
- Modify: `src/app/dashboard/integrations/SKILL.md`

- [ ] **Step 1: Update CLAUDE.md**

In the **Files in this folder** section, add after the `_components/ConnectionCard.tsx` bullet:

```
- `review/page.tsx` — "Review Orders" page at `/dashboard/integrations/review`.
  Fetches `GET /api/integrations/review` on mount, renders platform tabs (eBay /
  Amazon), an order table with checkbox selection (already-imported rows greyed
  out with ✓), and an "Import selected (N)" button that posts to
  `POST /api/integrations/review/import`. On success: toasts, flips imported
  rows in local state, calls `router.refresh()` to re-hydrate `salesSlice`.
  Applies the same plan/role guards as `page.tsx` — redirects to
  `/dashboard/integrations` if not eligible.
```

Update the **`_components/ConnectionCard.tsx`** bullet to reflect the removal of "Sync now":

```
- `_components/ConnectionCard.tsx` — per-platform card: status `Badge`,
  `external_account_id` (if set), "Last synced" (`formatDateTime` or "Never"),
  `last_sync_error` (if present). When `canManage` and connected: a "Review
  orders" `<Link>` (navigates to `/dashboard/integrations/review`) and a
  "Disconnect" button. When disconnected: a "Connect {label}" button that does
  `window.location.assign(...)`. The "Sync now" button and `handleSync` logic
  have been removed — syncing is now manual via the review page.
```

In the **API routes** section, add:

```
- **`/api/integrations/review/route.ts`** (`GET`) — fetches orders from all
  connected platforms (90-day lookback via `adapter.fetchOrders`), queries
  `sales` for existing `external_order_id` values, attaches `imported: boolean`
  to each `NormalizedOrder`, and returns `{ ebay?, amazon?, errors? }`.
  Exports `ReviewOrder` and `ReviewResponse` types (used by `review/page.tsx`
  via `import type`).
- **`/api/integrations/review/import/route.ts`** (`POST`) — accepts
  `{ items: { platform, order }[] }`, maps each to a `SaleInsert` via
  `normalizedOrderToSaleRow`, upserts into `sales` with
  `onConflict: "platform,external_order_id"`, updates `last_synced_at` per
  platform. Returns `{ imported: number }`.
```

Remove any reference to the cron job from the file map (the `vercel.json` `crons` key is gone).

- [ ] **Step 2: Update SKILL.md**

Add to **Minimal file set for common changes**:

```
- **Change the review page** (table columns, selection behaviour, import
  logic): `review/page.tsx` + optionally `api/integrations/review/route.ts`
  (if changing what fields are fetched or how `imported` is determined).
- **Add pagination to the review page**: `api/integrations/review/route.ts`
  (add `page`/`cursor` query param, thread through to `adapter.fetchOrders`)
  + `review/page.tsx` (add "Load more" button).
```

Add to **Gotchas**:

```
- **`import type` across server/client boundary for `ReviewOrder`/`ReviewResponse`**:
  `review/page.tsx` imports these types from the API route file using
  `import type { ... } from "@/app/api/integrations/review/route"`. TypeScript
  erases `import type` at runtime — no server modules are bundled into the
  client. Do NOT change this to a value import.
- **Review page redirects on ineligible plan/role** — the guard in the `useEffect`
  fires after hydration. On first render with `role === undefined` (still
  loading from Redux), the guard skips to avoid a premature redirect. The page
  renders a loading state during that window.
- **Cron is removed** — `vercel.json` no longer has a `crons` key. Both eBay
  and Amazon are now manual-review only. Do not re-add auto-sync without
  updating the review flow to handle already-synced orders correctly.
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/integrations/CLAUDE.md src/app/dashboard/integrations/SKILL.md
git commit -m "docs(integrations): update CLAUDE.md and SKILL.md for order review feature"
```

---

## Browser Verification Checklist

Ask the user to exercise these scenarios after deployment:

1. **Connected eBay** — integrations page shows "Review orders" link (not "Sync now"). Click it → lands on `/dashboard/integrations/review`.
2. **Tabs** — only connected platform tabs appear. Tab label shows unimported count.
3. **Select all** — "Select all" checkbox selects all unimported rows; already-imported rows stay non-selectable.
4. **Import** — select a few orders, click "Import selected (N)". Toast appears, rows grey out with ✓.
5. **Re-review** — re-open review page; previously imported rows show ✓ from the start.
6. **Empty state** — if no orders in last 90 days, table shows "No orders found" message.
7. **Cron removed** — `vercel.json` has no `crons` key; Vercel deployment does not schedule any cron jobs.
