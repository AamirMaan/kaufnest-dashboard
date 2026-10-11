# Multi-Account Integrations (Sub-project 1: Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant connect several eBay and Amazon accounts (capped per plan), sync orders per account, and filter/assign orders by account.

**Architecture:** `platform_connections` becomes one row per account (unique on `(platform, external_account_id)`), `sales` gets a nullable `connection_id`. A pure, client-safe rule (`lib/utils/activeAccounts.ts`) decides which connected accounts are active under the plan cap; server routes enforce it, the UI renders it. A compatibility shim keeps `getConnection(client, platform)` working for listings/messages until sub-projects 2/3.

**Tech Stack:** Next.js App Router (this repo's version — see `node_modules/next/dist/docs/`), Supabase (Postgres + PostgREST), Redux Toolkit, Jest.

**Spec:** `docs/superpowers/specs/2026-10-08-multi-account-integrations-design.md`

## Global Constraints

- Branch: `feat/multi-account-integrations` (already created off `main`). Never commit to `main`.
- Plan caps per platform: `starter: 0`, `pro: 2`, `business: Infinity`, `trial: Infinity`.
- Sentinels (keep in sync between SQL and TS): unassigned account = `'__unassigned__'`.
- Tenant DDL only via `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)`; mirror every change in `provision_tenant_schema()` (`supabase/migrations/005_tenant_provisioning.sql`).
- Never import `@/lib/integrations/*` or `@/lib/supabase/control` from a `"use client"` file (verifier blocks it). Client-shared logic goes in `src/lib/utils/`.
- Never return a raw Postgres error to the client.
- Every mutation: busy label, disabled while in flight, `useToast()` on success AND failure.
- Every modal form: `<form id>` + `type="submit" form="id"`, `required` on the control, `disabled={saving || !isFormValid}`.
- Run focused tests with `npx jest <path>`. Do NOT run `tsc`/`lint` by hand — the pre-commit hook does.
- Docs (`CLAUDE.md`/`SKILL.md`) updated in the same commit as the code they describe.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- The migration is NOT applied by the implementer. The user applies it live after merge.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `supabase/migrations/056_multi_account_connections.sql` | create | columns, constraint swap, backfill, `get_sales_summary` + `get_platform_accounts` |
| `supabase/migrations/005_tenant_provisioning.sql` | modify | same for new tenants |
| `src/types/index.ts` | modify | `PlatformConnection`, `PlatformAccount`, `Sale.connection_id` |
| `src/lib/utils/planGating.ts` | modify | `maxAccountsPerPlatform`, `getMaxAccountsPerPlatform`, `canAddAccount` |
| `src/lib/utils/activeAccounts.ts` | create | pure active/paused rule, resume check, shim ordering |
| `src/lib/utils/platformAccounts.ts` | create | pure UI helpers: sentinel, options, names, row assignment |
| `src/lib/utils/integrationErrors.ts` | create | client-safe `INTEGRATION_*` codes + copy |
| `src/lib/integrations/ebay.ts` | modify | identity scope + `fetchEbayIdentity`, `exchangeCode` returns ids |
| `src/lib/integrations/types.ts` | modify | `ExchangeCodeResult.externalUsername` |
| `src/lib/integrations/connectionSave.ts` | create | pure decision: update / adopt legacy / insert / limit |
| `src/lib/integrations/tokenStore.ts` | modify | list/byId/save/update, shim, `requireActiveConnection` |
| `src/lib/integrations/tenantPlan.ts` | create | `getTenantPlan(tenantSchema)` control lookup |
| `src/lib/integrations/mapToSale.ts` | modify | `connectionId` arg |
| `src/lib/integrations/mergeImportedSale.ts` | modify | `connection_id` fill-only |
| `src/lib/integrations/ebay/deletionMatch.ts` | create | pure matcher for the deletion webhook |
| `src/app/api/integrations/[platform]/{connect,callback,disconnect}/route.ts` | modify | cap, save, per-account disconnect |
| `src/app/api/integrations/connections/[id]/route.ts` | create | PATCH rename / pause / resume |
| `src/app/api/integrations/review/route.ts`, `review/import/route.ts` | modify | per-account fetch + stamp |
| `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts` | modify | use sale's account |
| `src/app/api/notifications/ebay-account-deletion/route.ts` | modify | scoped delete |
| `src/app/dashboard/layout.tsx`, `src/store/StoreProvider.tsx` | modify | hydrate new columns + accounts |
| `src/app/dashboard/integrations/_store/integrationsSlice.ts` | modify | id-keyed actions, `accounts` |
| `src/app/dashboard/integrations/page.tsx`, `_components/ConnectionCard.tsx`, `_components/PlatformAccountsSection.tsx` | modify/create | multi-account UI |
| `src/app/dashboard/integrations/review/page.tsx` | modify | account column/filter, paused note |
| `src/lib/utils/filters.ts`, `src/app/dashboard/sales/_store/{salesFilterParams,salesSlice}.ts`, `sales/page.tsx`, `sales/[id]/page.tsx` | modify | account filter/column/detail |
| `src/app/dashboard/sales/_components/{AddSaleModal,EditSaleModal,ImportSalesModal}.tsx` | modify | account pickers |

---

### Task 1: Migration 056 (+ provisioning)

**Files:**
- Create: `supabase/migrations/056_multi_account_connections.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (platform_connections table ~L305-327, sales table ~L160, indexes ~L905, `get_sales_summary` ~L1056-1100)
- Modify: `supabase/SKILL.md` (file-map table: add a `056` row, status "not applied")

**Interfaces:**
- Produces (DB): `platform_connections.{display_name,external_username,is_active}`, unique `platform_connections_platform_account_key (platform, external_account_id)`, `sales.connection_id`, `get_sales_summary(date,date,text,text,text,text,text,text)` with trailing `p_connection_id`, `get_platform_accounts()`.

No Jest test (SQL). Verification is the review of the SQL plus the live apply after merge.

- [ ] **Step 1: Write `056_multi_account_connections.sql`**

```sql
-- ============================================================
-- 056 — multiple eBay/Amazon accounts per tenant (sub-project 1)
--
-- platform_connections: one row per ACCOUNT, not per platform.
--   UNIQUE (platform) → UNIQUE (platform, external_account_id). Legacy eBay
--   rows have external_account_id NULL (the adapter never stored one); NULLs
--   are distinct, so they don't conflict. They're adopted on reconnect.
--   display_name: admin-editable label. external_username: eBay username,
--   used by the account-deletion webhook to match legacy rows.
--   is_active = false means the admin paused the account; the plan cap is
--   applied on top in app code (src/lib/utils/activeAccounts.ts).
--
-- sales.connection_id: which account an order came from. NULL = Unassigned.
--   Backfilled for synced orders when the platform has exactly one row.
--
-- get_sales_summary gains trailing p_connection_id (DEFAULT NULL;
-- '__unassigned__' = connection_id IS NULL — keep in sync with
-- UNASSIGNED_ACCOUNT in src/lib/utils/platformAccounts.ts). Old 7-arg
-- signature dropped first, as in 052.
--
-- get_platform_accounts(): SECURITY DEFINER, token-free account list for any
-- tenant member (platform_connections RLS is admin-only).
--
-- Also baked into provision_tenant_schema() (005, same commit).
-- Spec: docs/superpowers/specs/2026-10-08-multi-account-integrations-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.platform_connections
    ADD COLUMN IF NOT EXISTS display_name text,
    ADD COLUMN IF NOT EXISTS external_username text,
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

  ALTER TABLE {{schema}}.platform_connections
    DROP CONSTRAINT IF EXISTS platform_connections_platform_key;

  DO $do$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'platform_connections_platform_account_key'
        AND n.nspname = '{{schema}}'
    ) THEN
      ALTER TABLE {{schema}}.platform_connections
        ADD CONSTRAINT platform_connections_platform_account_key
        UNIQUE (platform, external_account_id);
    END IF;
  END
  $do$;

  CREATE INDEX IF NOT EXISTS idx_platform_connections_platform_created
    ON {{schema}}.platform_connections (platform, created_at);

  UPDATE {{schema}}.platform_connections
     SET display_name = CASE platform
           WHEN 'ebay'   THEN coalesce(external_account_id, 'eBay account')
           WHEN 'amazon' THEN 'Amazon – ' || coalesce(right(external_account_id, 6), 'account')
         END
   WHERE display_name IS NULL;

  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS connection_id uuid
      REFERENCES {{schema}}.platform_connections(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_sales_connection_id ON {{schema}}.sales (connection_id);

  UPDATE {{schema}}.sales s
     SET connection_id = pc.id
    FROM {{schema}}.platform_connections pc
   WHERE s.connection_id IS NULL
     AND s.external_order_id IS NOT NULL
     AND s.platform = pc.platform
     AND (SELECT count(*) FROM {{schema}}.platform_connections x WHERE x.platform = pc.platform) = 1;

  DROP FUNCTION IF EXISTS {{schema}}.get_sales_summary(date, date, text, text, text, text, text);

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
    p_marketplace text DEFAULT NULL,
    p_connection_id text DEFAULT NULL
  )
  RETURNS TABLE (
    currency text, order_count int, gross numeric, vat numeric,
    fees numeric, shipping_charged numeric, excluded_count int, vat_base numeric
  )
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT s.*,
             (p_status IS NOT NULL OR s.status NOT IN ('returned', 'cancelled')) AS counts
      FROM sales s
      WHERE (p_from IS NULL OR s.date >= p_from)
        AND (p_to IS NULL OR s.date <= p_to)
        AND (p_platform IS NULL OR s.platform = p_platform)
        AND (p_currency IS NULL OR s.currency = p_currency)
        AND (p_status IS NULL OR s.status = p_status)
        AND (p_marketplace IS NULL
             OR (p_marketplace = '__unknown__' AND s.marketplace IS NULL)
             OR s.marketplace = p_marketplace)
        AND (p_connection_id IS NULL
             OR (p_connection_id = '__unassigned__' AND s.connection_id IS NULL)
             OR s.connection_id::text = p_connection_id)
        AND (p_pattern IS NULL
             OR s.product_name ILIKE p_pattern
             OR s.external_order_id ILIKE p_pattern
             OR s.description ILIKE p_pattern)
    )
    SELECT
      f.currency,
      count(*)::int,
      coalesce(sum(f.total_amount) FILTER (WHERE f.counts), 0),
      coalesce(sum(coalesce(f.vat_amount, 0)) FILTER (WHERE f.counts), 0),
      coalesce(sum(coalesce(f.platform_fee, 0) + coalesce(f.advertising_fee, 0) + coalesce(f.shipping_cost, 0))
               FILTER (WHERE f.counts), 0),
      coalesce(sum(coalesce(f.shipping_charged, 0)) FILTER (WHERE f.counts), 0),
      (count(*) FILTER (WHERE NOT f.counts))::int,
      coalesce(sum(f.total_amount + coalesce(f.shipping_charged, 0) - f.vat_amount)
               FILTER (WHERE f.counts AND coalesce(f.vat_amount, 0) > 0), 0)
    FROM filtered f
    GROUP BY f.currency
    ORDER BY f.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_platform_accounts()
  RETURNS TABLE (
    id uuid, platform text, display_name text, status text,
    is_active boolean, created_at timestamptz
  )
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = {{schema}}
  AS $func$
    SELECT pc.id, pc.platform, pc.display_name, pc.status, pc.is_active, pc.created_at
    FROM platform_connections pc
    WHERE {{schema}}.is_tenant_member()
    ORDER BY pc.platform, pc.created_at;
  $func$;

  REVOKE ALL ON FUNCTION {{schema}}.get_platform_accounts() FROM public;
  GRANT EXECUTE ON FUNCTION {{schema}}.get_platform_accounts() TO authenticated;
$$);
```

Note: `run_on_all_tenant_schemas` (`012_tenant_migration_helper.sql:31`) does a plain `replace(sql, '{{schema}}', schema_name)` with the unquoted schema name, so `'{{schema}}'` in the `DO` block becomes the literal `'tenant_x'` string the `pg_namespace` comparison needs. The live constraint name `platform_connections_platform_key` was confirmed on all five tenant schemas on 2026-10-08.

- [ ] **Step 2: Mirror into `005_tenant_provisioning.sql`**

In the `platform_connections` `CREATE TABLE` (~L311): replace `UNIQUE (platform)` with:

```sql
      display_name         text,
      external_username    text,
      is_active            boolean NOT NULL DEFAULT true,
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT platform_connections_platform_account_key UNIQUE (platform, external_account_id)
```
(keep the existing `created_at`/`updated_at` lines — just don't duplicate them; the new columns go before them). Update the comment above it: "one row per connected seller account (multiple per platform since 056)".

`sales` is created before `platform_connections` in 005, so do NOT add `connection_id` inline on `sales`. Instead, next to the `idx_sales_marketplace` line (~L905), add:

```sql
  EXECUTE format('ALTER TABLE %1$I.sales ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES %1$I.platform_connections(id) ON DELETE SET NULL', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_connection_id ON %1$I.sales (connection_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_platform_connections_platform_created ON %1$I.platform_connections (platform, created_at)', schema_name);
```

Confirm `platform_connections` is created before that line (it is created ~L311; the index block is ~L905).

In the `get_sales_summary` block (~L1056): change the `DROP FUNCTION` to drop the 7-arg signature too (keep the existing 6-arg drop):
```sql
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.get_sales_summary(date, date, text, text, text, text, text)', schema_name);
```
add `p_connection_id text DEFAULT NULL` after `p_marketplace text DEFAULT NULL`, add the same `p_connection_id` `AND (…)` predicate as Step 1 after the marketplace predicate, and update its `GRANT` to the 8-arg signature.

Directly after it, add `get_platform_accounts()` as a `format(...)`-wrapped `CREATE OR REPLACE FUNCTION %1$I.get_platform_accounts() …` with the same body as Step 1 (`%1$I.is_tenant_member()`, `SET search_path = %1$I`), plus the `REVOKE`/`GRANT` lines.

- [ ] **Step 3: Add the `056` row to `supabase/SKILL.md`'s file-map table**

Follow the format of the `055` row. Status: "written, NOT applied". One line: "multi-account connections: per-account `platform_connections` (unique `(platform, external_account_id)`, `display_name`/`external_username`/`is_active`), `sales.connection_id` (+ backfill), `get_sales_summary` + `p_connection_id`, `get_platform_accounts()`".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/056_multi_account_connections.sql supabase/migrations/005_tenant_provisioning.sql supabase/SKILL.md
git commit -m "feat(integrations): migration 056 — per-account platform connections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Types, plan caps, active-account rule, error copy

**Files:**
- Modify: `src/types/index.ts:522-532` (`PlatformConnection`), `src/types/index.ts` `Sale` (~L166)
- Modify: `src/lib/utils/planGating.ts`, `src/lib/utils/planGating.test.ts`
- Create: `src/lib/utils/activeAccounts.ts`, `src/lib/utils/activeAccounts.test.ts`
- Create: `src/lib/utils/integrationErrors.ts`, `src/lib/utils/integrationErrors.test.ts`

**Interfaces:**
- Produces:
  - `PlatformConnection` gains `display_name: string | null; external_username: string | null; is_active: boolean; created_at: string`
  - `interface PlatformAccount { id: string; platform: IntegrationPlatform; display_name: string | null; status: PlatformConnectionStatus; is_active: boolean; created_at: string }`
  - `Sale.connection_id?: string | null`
  - `getMaxAccountsPerPlatform(plan: TenantPlan): number`, `canAddAccount(plan: TenantPlan, connectedCount: number): boolean`
  - `type AccountLike = Pick<PlatformAccount, "id" | "platform" | "status" | "is_active" | "created_at">`
  - `resolveActiveAccounts<T extends AccountLike>(rows: T[], plan: TenantPlan): { active: T[]; paused: T[] }`
  - `accountState(rows: AccountLike[], id: string, plan: TenantPlan): "active" | "paused" | "plan_limit" | "disconnected" | "error"`
  - `canResumeAccount(rows: AccountLike[], id: string, plan: TenantPlan): boolean`
  - `connectedCount(rows: AccountLike[], platform: IntegrationPlatform): number`
  - `firstUsableAccount<T extends AccountLike>(rows: T[], platform: IntegrationPlatform): T | null`
  - `INTEGRATION_ERRORS` and `integrationErrorMessage(code: string | undefined, fallback: string): string`; codes `INTEGRATION_ACCOUNT_LIMIT`, `INTEGRATION_ACCOUNT_PAUSED`, `INTEGRATION_ACCOUNT_UNKNOWN`, `INTEGRATION_ACCOUNT_UNIDENTIFIED`

- [ ] **Step 1: Update types**

In `src/types/index.ts`, replace `PlatformConnection` with:

```ts
export interface PlatformConnection {
  id: string;
  platform: IntegrationPlatform;
  status: PlatformConnectionStatus;
  external_account_id: string | null;
  /** eBay username — used to match legacy rows in the account-deletion webhook (056). */
  external_username: string | null;
  /** Admin-editable label, e.g. "eBay – Main Store" (056). */
  display_name: string | null;
  /** false = paused by an admin. The plan cap applies on top — see lib/utils/activeAccounts.ts. */
  is_active: boolean;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Token-free account row from get_platform_accounts() (056) — readable by every tenant member. */
export interface PlatformAccount {
  id: string;
  platform: IntegrationPlatform;
  display_name: string | null;
  status: PlatformConnectionStatus;
  is_active: boolean;
  created_at: string;
}
```

In `Sale`, after `marketplace`, add:

```ts
  /** platform_connections.id the order came from (056). null/absent = Unassigned. */
  connection_id?: string | null;
```

- [ ] **Step 2: Write failing planGating tests** — append to `src/lib/utils/planGating.test.ts` (and add `getMaxAccountsPerPlatform, canAddAccount` to its import):

```ts
describe("getMaxAccountsPerPlatform", () => {
  it("is 0 for starter, 2 for pro, unlimited for business and trial", () => {
    expect(getMaxAccountsPerPlatform("starter")).toBe(0);
    expect(getMaxAccountsPerPlatform("pro")).toBe(2);
    expect(getMaxAccountsPerPlatform("business")).toBe(Infinity);
    expect(getMaxAccountsPerPlatform("trial")).toBe(Infinity);
  });
});

describe("canAddAccount", () => {
  it("allows pro up to 2 accounts per platform", () => {
    expect(canAddAccount("pro", 0)).toBe(true);
    expect(canAddAccount("pro", 1)).toBe(true);
    expect(canAddAccount("pro", 2)).toBe(false);
  });
  it("never allows starter", () => {
    expect(canAddAccount("starter", 0)).toBe(false);
  });
  it("always allows business", () => {
    expect(canAddAccount("business", 50)).toBe(true);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx jest src/lib/utils/planGating.test.ts`
Expected: FAIL — `getMaxAccountsPerPlatform is not a function` (or TS import error).

- [ ] **Step 4: Implement in `planGating.ts`**

Add to `PlanLimits` (after `platformIntegrations`):
```ts
  /** Connected seller accounts allowed per platform (eBay and Amazon counted separately). */
  maxAccountsPerPlatform: number;
```
Add `maxAccountsPerPlatform` to each `PLAN_LIMITS` row: `trial: Infinity`, `starter: 0`, `pro: 2`, `business: Infinity`. Then:

```ts
export function getMaxAccountsPerPlatform(plan: TenantPlan): number {
  return PLAN_LIMITS[plan].maxAccountsPerPlatform;
}

export function canAddAccount(plan: TenantPlan, connectedCount: number): boolean {
  return connectedCount < PLAN_LIMITS[plan].maxAccountsPerPlatform;
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx jest src/lib/utils/planGating.test.ts` → PASS.

- [ ] **Step 6: Write failing `activeAccounts.test.ts`**

```ts
import {
  resolveActiveAccounts,
  accountState,
  canResumeAccount,
  connectedCount,
  firstUsableAccount,
  type AccountLike,
} from "./activeAccounts";

const acc = (id: string, overrides: Partial<AccountLike> = {}): AccountLike => ({
  id,
  platform: "ebay",
  status: "connected",
  is_active: true,
  created_at: `2026-01-0${id.replace(/\D/g, "") || "1"}T00:00:00.000Z`,
  ...overrides,
});

describe("resolveActiveAccounts", () => {
  it("keeps every account active under the cap", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1"), acc("a2")], "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(paused).toEqual([]);
  });

  it("over the cap, the oldest non-paused accounts stay active", () => {
    const rows = [acc("a3"), acc("a1"), acc("a4"), acc("a2")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(paused.map((a) => a.id).sort()).toEqual(["a3", "a4"]);
  });

  it("an admin pause always holds, and frees a slot for the next oldest", () => {
    const rows = [acc("a1", { is_active: false }), acc("a2"), acc("a3"), acc("a4")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a2", "a3"]);
    expect(paused.map((a) => a.id).sort()).toEqual(["a1", "a4"]);
  });

  it("an admin pause holds even under the cap", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1", { is_active: false }), acc("a2")], "pro");
    expect(active.map((a) => a.id)).toEqual(["a2"]);
    expect(paused.map((a) => a.id)).toEqual(["a1"]);
  });

  it("is unlimited on business and trial", () => {
    const rows = [acc("a1"), acc("a2"), acc("a3"), acc("a4")];
    expect(resolveActiveAccounts(rows, "business").active).toHaveLength(4);
    expect(resolveActiveAccounts(rows, "trial").active).toHaveLength(4);
  });

  it("starter has no active accounts", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1")], "starter");
    expect(active).toEqual([]);
    expect(paused.map((a) => a.id)).toEqual(["a1"]);
  });

  it("ignores disconnected and errored rows", () => {
    const rows = [acc("a1", { status: "disconnected" }), acc("a2", { status: "error" }), acc("a3")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a3"]);
    expect(paused).toEqual([]);
  });

  it("caps each platform independently", () => {
    const rows = [
      acc("a1"), acc("a2"), acc("a3"),
      acc("a4", { platform: "amazon" }), acc("a5", { platform: "amazon" }),
    ];
    const { active } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2", "a4", "a5"]);
  });
});

describe("accountState", () => {
  const rows = [acc("a1"), acc("a2"), acc("a3"), acc("a4", { is_active: false }), acc("a5", { status: "disconnected" }), acc("a6", { status: "error" })];
  it.each([
    ["a1", "active"],
    ["a3", "plan_limit"],
    ["a4", "paused"],
    ["a5", "disconnected"],
    ["a6", "error"],
  ])("%s is %s on pro", (id, expected) => {
    expect(accountState(rows, id, "pro")).toBe(expected);
  });
});

describe("canResumeAccount", () => {
  it("allows resuming when the non-paused count is under the cap", () => {
    expect(canResumeAccount([acc("a1"), acc("a2", { is_active: false })], "a2", "pro")).toBe(true);
  });
  it("refuses resuming when the platform is already full", () => {
    expect(canResumeAccount([acc("a1"), acc("a2"), acc("a3", { is_active: false })], "a3", "pro")).toBe(false);
  });
  it("only counts the target's platform", () => {
    const rows = [acc("a1"), acc("a2"), acc("a3", { platform: "amazon", is_active: false })];
    expect(canResumeAccount(rows, "a3", "pro")).toBe(true);
  });
  it("is false for an unknown id", () => {
    expect(canResumeAccount([acc("a1")], "zzz", "pro")).toBe(false);
  });
});

describe("connectedCount", () => {
  it("counts connected and errored rows of one platform, not disconnected ones", () => {
    const rows = [acc("a1"), acc("a2", { status: "error" }), acc("a3", { status: "disconnected" }), acc("a4", { platform: "amazon" })];
    expect(connectedCount(rows, "ebay")).toBe(2);
  });
});

describe("firstUsableAccount", () => {
  it("returns the oldest connected, non-paused account of the platform", () => {
    const rows = [acc("a3"), acc("a1", { is_active: false }), acc("a2")];
    expect(firstUsableAccount(rows, "ebay")?.id).toBe("a2");
  });
  it("returns null when every account is paused or disconnected", () => {
    expect(firstUsableAccount([acc("a1", { is_active: false }), acc("a2", { status: "disconnected" })], "ebay")).toBeNull();
  });
});
```

- [ ] **Step 7: Run — expect FAIL**

Run: `npx jest src/lib/utils/activeAccounts.test.ts` → FAIL (module not found).

- [ ] **Step 8: Implement `src/lib/utils/activeAccounts.ts`**

```ts
import type { IntegrationPlatform, PlatformAccount, TenantPlan } from "@/types";
import { getMaxAccountsPerPlatform } from "./planGating";

/**
 * Which connected seller accounts are usable under the tenant's plan.
 * Pure and client-safe: the Integrations page and the server routes share it,
 * so they can never disagree (spec: 2026-10-08-multi-account-integrations).
 *
 * Per platform, among status = "connected" rows:
 *  - is_active = false → paused by an admin, always.
 *  - the rest, oldest first, fill up to the plan's cap; beyond it → paused by
 *    the plan limit. After a downgrade the oldest accounts win by default; to
 *    keep others the admin pauses the ones they don't need.
 */
export type AccountLike = Pick<PlatformAccount, "id" | "platform" | "status" | "is_active" | "created_at">;

export type AccountState = "active" | "paused" | "plan_limit" | "disconnected" | "error";

const PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

function byCreatedAt<T extends AccountLike>(a: T, b: T): number {
  return a.created_at.localeCompare(b.created_at);
}

function eligible<T extends AccountLike>(rows: T[], platform: IntegrationPlatform): T[] {
  return rows
    .filter((r) => r.platform === platform && r.status === "connected" && r.is_active)
    .sort(byCreatedAt);
}

export function resolveActiveAccounts<T extends AccountLike>(
  rows: T[],
  plan: TenantPlan
): { active: T[]; paused: T[] } {
  const cap = getMaxAccountsPerPlatform(plan);
  const active: T[] = [];
  const paused: T[] = [];
  for (const platform of PLATFORMS) {
    const candidates = eligible(rows, platform);
    active.push(...candidates.slice(0, cap));
    paused.push(...candidates.slice(cap));
    paused.push(
      ...rows.filter((r) => r.platform === platform && r.status === "connected" && !r.is_active)
    );
  }
  return { active, paused };
}

export function accountState(rows: AccountLike[], id: string, plan: TenantPlan): AccountState {
  const row = rows.find((r) => r.id === id);
  if (!row || row.status === "disconnected") return "disconnected";
  if (row.status === "error") return "error";
  if (!row.is_active) return "paused";
  return resolveActiveAccounts(rows, plan).active.some((r) => r.id === id) ? "active" : "plan_limit";
}

/** Resuming is allowed only while the platform has fewer non-paused connected accounts than the cap. */
export function canResumeAccount(rows: AccountLike[], id: string, plan: TenantPlan): boolean {
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  const others = eligible(rows, row.platform).filter((r) => r.id !== id);
  return others.length < getMaxAccountsPerPlatform(plan);
}

/** Accounts that count against the cap when adding a new one: connected or errored (still holding tokens). */
export function connectedCount(rows: AccountLike[], platform: IntegrationPlatform): number {
  return rows.filter((r) => r.platform === platform && r.status !== "disconnected").length;
}

/**
 * Compatibility shim ordering for getConnection(client, platform): the oldest
 * connected, non-paused account. With any cap ≥ 1 this row is always inside
 * the active set, so no plan lookup is needed.
 */
export function firstUsableAccount<T extends AccountLike>(rows: T[], platform: IntegrationPlatform): T | null {
  return eligible(rows, platform)[0] ?? null;
}
```

- [ ] **Step 9: Run — expect PASS**

Run: `npx jest src/lib/utils/activeAccounts.test.ts` → PASS.

- [ ] **Step 10: Write failing `integrationErrors.test.ts`**

```ts
import { integrationErrorMessage, INTEGRATION_ERRORS } from "./integrationErrors";

describe("integrationErrorMessage", () => {
  it("maps a known code to its copy", () => {
    expect(integrationErrorMessage("INTEGRATION_ACCOUNT_LIMIT", "x")).toBe(INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT);
  });
  it("falls back for unknown or missing codes", () => {
    expect(integrationErrorMessage("SOMETHING_ELSE", "fallback")).toBe("fallback");
    expect(integrationErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});
```

- [ ] **Step 11: Implement `src/lib/utils/integrationErrors.ts`**

```ts
/**
 * Client-safe error codes + copy for the multi-account integration routes.
 * Routes return `{ error: <code> }`; the UI maps it with integrationErrorMessage.
 * Lives in lib/utils (not lib/integrations) so Client Components can import it.
 */
export const INTEGRATION_ERRORS = {
  INTEGRATION_ACCOUNT_LIMIT:
    "Your plan's account limit for this platform is reached. Pause or disconnect an account, or upgrade your plan.",
  INTEGRATION_ACCOUNT_PAUSED:
    "This account is paused. Resume it on the Integrations page, or upgrade your plan.",
  INTEGRATION_ACCOUNT_UNKNOWN: "That account no longer exists. Refresh the page and try again.",
  INTEGRATION_ACCOUNT_UNIDENTIFIED:
    "We couldn't identify which seller account you signed in with. Please try connecting again.",
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_ERRORS;

export function integrationErrorMessage(code: string | undefined, fallback: string): string {
  return code && code in INTEGRATION_ERRORS ? INTEGRATION_ERRORS[code as IntegrationErrorCode] : fallback;
}
```

- [ ] **Step 12: Run — expect PASS**

Run: `npx jest src/lib/utils/integrationErrors.test.ts src/lib/utils/activeAccounts.test.ts src/lib/utils/planGating.test.ts` → PASS.

- [ ] **Step 13: Fix type fallout in existing fixtures**

`PlatformConnection` gained required fields. Update `makeConnection` in `src/app/dashboard/integrations/_store/integrationsSlice.test.ts` to include `external_username: null, display_name: null, is_active: true, created_at: "2026-06-01T10:00:00.000Z"`. Then `grep -rn "PlatformConnection = {\|: PlatformConnection\b" src --include=*.ts --include=*.tsx` and fix any other literal the same way.

Run: `npx jest dashboard/integrations` → PASS.

- [ ] **Step 14: Commit** (pre-commit runs tsc/lint; fix anything it reports and re-run the same commit)

```bash
git add src/types/index.ts src/lib/utils/planGating.ts src/lib/utils/planGating.test.ts src/lib/utils/activeAccounts.ts src/lib/utils/activeAccounts.test.ts src/lib/utils/integrationErrors.ts src/lib/utils/integrationErrors.test.ts src/app/dashboard/integrations/_store/integrationsSlice.test.ts
git commit -m "feat(integrations): plan account caps and active-account rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: eBay account identity

**Files:**
- Modify: `src/lib/integrations/ebay.ts` (scope const ~L21, `ebayAdapter.exchangeCode`)
- Modify: `src/lib/integrations/types.ts` (`ExchangeCodeResult`)
- Test: `src/lib/integrations/ebay.test.ts`

**Interfaces:**
- Produces: `ExchangeCodeResult.externalUsername?: string`; `fetchEbayIdentity(accessToken: string): Promise<{ userId: string; username: string }>` (exported); `ebayAdapter.exchangeCode` resolves with `externalAccountId = userId`, `externalUsername = username`.

- [ ] **Step 1: Write failing tests** — append to `src/lib/integrations/ebay.test.ts` (add `fetchEbayIdentity` to the import):

```ts
describe("fetchEbayIdentity", () => {
  it("GETs the Identity API user endpoint and returns userId + username", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ userId: "u-123", username: "main_store" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchEbayIdentity("tok")).resolves.toEqual({ userId: "u-123", username: "main_store" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/commerce\/identity\/v1\/user\/$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("throws a readable error on a non-OK response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("insufficient scope"),
    }) as unknown as typeof fetch;
    await expect(fetchEbayIdentity("tok")).rejects.toThrow(/eBay account lookup failed: 403/);
  });

  it("throws when the response has no userId", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ username: "x" }),
    }) as unknown as typeof fetch;
    await expect(fetchEbayIdentity("tok")).rejects.toThrow(/no userId/);
  });
});

describe("ebayAdapter.exchangeCode", () => {
  it("returns the eBay userId/username alongside the tokens", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "at", refresh_token: "rt", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ userId: "u-9", username: "second_store" }),
      }) as unknown as typeof fetch;

    const result = await ebayAdapter.exchangeCode("code-1");
    expect(result.access_token).toBe("at");
    expect(result.externalAccountId).toBe("u-9");
    expect(result.externalUsername).toBe("second_store");
  });
});

describe("ebayAdapter.getAuthUrl", () => {
  it("requests the identity scope", () => {
    expect(decodeURIComponent(ebayAdapter.getAuthUrl("s"))).toContain("commerce.identity.readonly");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest src/lib/integrations/ebay.test.ts` → the new tests FAIL.

- [ ] **Step 3: Implement**

`types.ts` — in `ExchangeCodeResult`, fix the comment and add the field:
```ts
  /** Seller's stable account id on the platform (eBay Identity userId, Amazon selling partner id) */
  externalAccountId?: string;
  /** eBay username (display + legacy deletion-webhook matching); Amazon leaves this undefined */
  externalUsername?: string;
```

`ebay.ts` — append to the scope comment: "commerce.identity.readonly (2026-10-08) identifies WHICH eBay account was connected, so a tenant can hold several (multi-account integrations spec)." and add `" https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"` to `EBAY_SCOPE`. Add next to the other URL constants:

```ts
// The Identity API is served from apiz.*, not api.*.
const EBAY_IDENTITY_URL = SANDBOX
  ? "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/"
  : "https://apiz.ebay.com/commerce/identity/v1/user/";
```

Add an exported function (above `ebayAdapter`):

```ts
/** Which eBay account an access token belongs to (needs commerce.identity.readonly). */
export async function fetchEbayIdentity(accessToken: string): Promise<{ userId: string; username: string }> {
  const res = await fetch(EBAY_IDENTITY_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`eBay account lookup failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { userId?: string; username?: string };
  if (!json.userId) throw new Error("eBay account lookup returned no userId");
  return { userId: json.userId, username: json.username ?? json.userId };
}
```

Replace `exchangeCode`:

```ts
  async exchangeCode(code) {
    const tokens = await requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.EBAY_RU_NAME ?? "",
      })
    );
    const identity = await fetchEbayIdentity(tokens.access_token);
    return { ...tokens, externalAccountId: identity.userId, externalUsername: identity.username };
  },
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest src/lib/integrations/ebay.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay.ts src/lib/integrations/types.ts src/lib/integrations/ebay.test.ts
git commit -m "feat(integrations): identify the connected eBay account via the Identity API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Token store — per-account persistence, shim, active check

**Files:**
- Create: `src/lib/integrations/connectionSave.ts`, `src/lib/integrations/connectionSave.test.ts`
- Create: `src/lib/integrations/tenantPlan.ts`
- Modify: `src/lib/integrations/tokenStore.ts`

**Interfaces:**
- Consumes: `canAddAccount`, `connectedCount`, `resolveActiveAccounts`, `firstUsableAccount` (Task 2).
- Produces:
  - `type SaveDecision = { kind: "update"; id: string } | { kind: "adopt"; id: string } | { kind: "insert" } | { kind: "limit" }`
  - `decideConnectionSave(rows: ConnectionSummary[], platform: IntegrationPlatform, externalAccountId: string, plan: TenantPlan): SaveDecision` where `ConnectionSummary = AccountLike & { external_account_id: string | null }`
  - `defaultDisplayName(platform: IntegrationPlatform, externalAccountId: string, username?: string): string`
  - `getTenantPlan(tenantSchema: string): Promise<TenantPlan>` (server-only; `"trial"` when missing, matching existing routes)
  - tokenStore: `ConnectionRow` (now incl. `display_name`, `external_username`, `is_active`, `created_at`), `listConnections(client, platform?)`, `getConnectionById(client, id)`, `getConnection(client, platform)` (shim), `updateConnection(client, id, fields)`, `insertConnection(client, platform, fields): Promise<string>` (returns id), `requireActiveConnection(client, id, plan): Promise<ConnectionRow>` throwing `IntegrationAccountError`, `class IntegrationAccountError extends Error { code: IntegrationErrorCode }`, `ensureValidAccessToken` (unchanged signature, now persists by id). `upsertConnection` is **removed**.

- [ ] **Step 1: Write failing `connectionSave.test.ts`**

```ts
import { decideConnectionSave, defaultDisplayName, type ConnectionSummary } from "./connectionSave";

const row = (id: string, external_account_id: string | null, o: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id,
  platform: "ebay",
  status: "connected",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  external_account_id,
  ...o,
});

describe("decideConnectionSave", () => {
  it("updates the existing row for a reconnect of the same account, even at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "update", id: "c1" });
  });

  it("re-checks the cap when reconnecting a disconnected account", () => {
    const rows = [row("c1", "u1", { status: "disconnected" }), row("c2", "u2"), row("c3", "u3")];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "limit" });
    expect(decideConnectionSave(rows, "ebay", "u1", "business")).toEqual({ kind: "update", id: "c1" });
  });

  it("adopts a legacy null-id row of the same platform", () => {
    const rows = [row("legacy", null), row("amz", null, { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "adopt", id: "legacy" });
  });

  it("inserts a new account under the cap", () => {
    expect(decideConnectionSave([row("c1", "u1")], "ebay", "u2", "pro")).toEqual({ kind: "insert" });
  });

  it("refuses a new account at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(decideConnectionSave(rows, "ebay", "u3", "pro")).toEqual({ kind: "limit" });
  });

  it("does not count disconnected rows against the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2", { status: "disconnected" })];
    expect(decideConnectionSave(rows, "ebay", "u3", "pro")).toEqual({ kind: "insert" });
  });

  it("caps per platform", () => {
    const rows = [row("c1", "a1", { platform: "amazon" }), row("c2", "a2", { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "insert" });
  });
});

describe("defaultDisplayName", () => {
  it("uses the eBay username", () => {
    expect(defaultDisplayName("ebay", "u-1", "main_store")).toBe("main_store");
  });
  it("uses the last 6 characters of the Amazon seller id", () => {
    expect(defaultDisplayName("amazon", "A1B2C3D4E5F6G7")).toBe("Amazon – E5F6G7");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest src/lib/integrations/connectionSave.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `connectionSave.ts`**

```ts
import type { IntegrationPlatform, TenantPlan } from "@/types";
import { canAddAccount } from "@/lib/utils/planGating";
import { connectedCount, type AccountLike } from "@/lib/utils/activeAccounts";

export type ConnectionSummary = AccountLike & { external_account_id: string | null };

export type SaveDecision =
  | { kind: "update"; id: string }
  | { kind: "adopt"; id: string }
  | { kind: "insert" }
  | { kind: "limit" };

/**
 * What the OAuth callback does with a freshly authorised account.
 *  - same (platform, external_account_id) already stored → update it. A
 *    still-connected row is a token refresh and never hits the cap; a
 *    disconnected one is re-checked against the cap.
 *  - a legacy row with external_account_id NULL (pre-056 eBay) → adopt it,
 *    so its sales.connection_id links survive.
 *  - otherwise insert, if the plan allows another account.
 */
export function decideConnectionSave(
  rows: ConnectionSummary[],
  platform: IntegrationPlatform,
  externalAccountId: string,
  plan: TenantPlan
): SaveDecision {
  const samePlatform = rows.filter((r) => r.platform === platform);
  const hasRoom = canAddAccount(plan, connectedCount(rows, platform));

  const existing = samePlatform.find((r) => r.external_account_id === externalAccountId);
  if (existing) {
    if (existing.status !== "disconnected" || hasRoom) return { kind: "update", id: existing.id };
    return { kind: "limit" };
  }

  const legacy = samePlatform.find((r) => r.external_account_id === null);
  if (legacy && (legacy.status !== "disconnected" || hasRoom)) return { kind: "adopt", id: legacy.id };

  return hasRoom ? { kind: "insert" } : { kind: "limit" };
}

export function defaultDisplayName(
  platform: IntegrationPlatform,
  externalAccountId: string,
  username?: string
): string {
  if (platform === "ebay") return username ?? externalAccountId;
  return `Amazon – ${externalAccountId.slice(-6)}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest src/lib/integrations/connectionSave.test.ts` → PASS.

- [ ] **Step 5: Create `src/lib/integrations/tenantPlan.ts`**

```ts
import { createControlClient } from "@/lib/supabase/control";
import type { TenantPlan } from "@/types";

/**
 * The tenant's plan from control.tenants. Defaults to "trial" when the row is
 * missing — the same fallback every integrations route already used inline.
 */
export async function getTenantPlan(tenantSchema: string): Promise<TenantPlan> {
  const control = createControlClient();
  const { data } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  return ((data?.plan as TenantPlan | undefined) ?? "trial");
}
```

- [ ] **Step 6: Rewrite `tokenStore.ts`'s data functions**

Keep the imports of `encryptToken`/`decryptToken` and `ensureValidAccessToken`'s refresh logic. Replace `ConnectionRow`, `getConnection`, `upsertConnection` with:

```ts
import type { IntegrationPlatform, PlatformConnectionStatus, TenantPlan } from "@/types";
import type { IntegrationsClient, PlatformAdapter } from "./types";
import { encryptToken, decryptToken } from "./tokenCrypto";
import { firstUsableAccount, resolveActiveAccounts } from "@/lib/utils/activeAccounts";
import type { IntegrationErrorCode } from "@/lib/utils/integrationErrors";

/** Full `platform_connections` row, including the OAuth tokens — server-only. */
export interface ConnectionRow {
  id: string;
  platform: IntegrationPlatform;
  status: PlatformConnectionStatus;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  external_account_id: string | null;
  external_username: string | null;
  display_name: string | null;
  is_active: boolean;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  connected_by: string | null;
  created_at: string;
}

export type ConnectionFields = Partial<Omit<ConnectionRow, "id" | "platform" | "created_at">>;

export class IntegrationAccountError extends Error {
  constructor(public code: IntegrationErrorCode) {
    super(code);
  }
}

function decryptRow(row: ConnectionRow): ConnectionRow {
  return { ...row, access_token: decryptToken(row.access_token), refresh_token: decryptToken(row.refresh_token) };
}

function encryptFields(fields: ConnectionFields): ConnectionFields {
  const out = { ...fields };
  if ("access_token" in out) out.access_token = encryptToken(out.access_token ?? null);
  if ("refresh_token" in out) out.refresh_token = encryptToken(out.refresh_token ?? null);
  return out;
}

/**
 * Every account row (optionally one platform), tokens decrypted.
 * Bounded: one row per connected seller account, capped by plan (Business is
 * unlimited, but accounts are a handful per tenant, not a growth quantity of
 * business records).
 */
export async function listConnections(
  client: IntegrationsClient,
  platform?: IntegrationPlatform
): Promise<ConnectionRow[]> {
  let query = client.from("platform_connections").select("*").order("created_at", { ascending: true });
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as ConnectionRow[]).map(decryptRow);
}

export async function getConnectionById(client: IntegrationsClient, id: string): Promise<ConnectionRow | null> {
  const { data, error } = await client.from("platform_connections").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? decryptRow(data as ConnectionRow) : null;
}

/**
 * COMPATIBILITY SHIM (multi-account sub-project 1): "the" account for a
 * platform = the oldest connected, non-paused one. Listings, messages and
 * dropshipping still call this; sub-projects 2/3 move them to
 * getConnectionById and then this is deleted. New code must not call it.
 */
export async function getConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform
): Promise<ConnectionRow | null> {
  return firstUsableAccount(await listConnections(client, platform), platform);
}

export async function updateConnection(client: IntegrationsClient, id: string, fields: ConnectionFields): Promise<void> {
  const { error } = await client.from("platform_connections").update(encryptFields(fields)).eq("id", id);
  if (error) throw error;
}

export async function insertConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform,
  fields: ConnectionFields
): Promise<string> {
  const { data, error } = await client
    .from("platform_connections")
    .insert({ platform, ...encryptFields(fields) })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** The account, if it exists and is active under the plan; otherwise throws IntegrationAccountError. */
export async function requireActiveConnection(
  client: IntegrationsClient,
  id: string,
  plan: TenantPlan
): Promise<ConnectionRow> {
  const rows = await listConnections(client);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new IntegrationAccountError("INTEGRATION_ACCOUNT_UNKNOWN");
  if (!resolveActiveAccounts(rows, plan).active.some((r) => r.id === id)) {
    throw new IntegrationAccountError("INTEGRATION_ACCOUNT_PAUSED");
  }
  return row;
}
```

In `ensureValidAccessToken`, replace the `upsertConnection(client, adapter.platform, {...})` call with `updateConnection(client, connection.id, {...})` (same three fields).

Check `encryptToken`'s signature in `tokenCrypto.ts` — if it already accepts `string | null`, drop the `?? null`.

- [ ] **Step 7: Find remaining `upsertConnection` callers**

Run: `grep -rn "upsertConnection" src --include=*.ts --include=*.tsx | grep -v integrationsSlice`
Expected callers: `[platform]/callback`, `[platform]/disconnect`, `review/import`. They are rewritten in Tasks 5 and 6; leave them broken for now **only if** you commit Tasks 4–6 together. Prefer: do Task 5 and 6 before committing this task (the pre-commit `tsc` will otherwise fail). Do not commit yet.

- [ ] **Step 8: Run tests**

Run: `npx jest src/lib/integrations` → PASS (ebay, connectionSave, mapToSale, mergeImportedSale, tokenCrypto).

(Commit happens at the end of Task 6.)

---

### Task 5: Connect / callback / disconnect / PATCH routes

**Files:**
- Modify: `src/app/api/integrations/[platform]/connect/route.ts`
- Modify: `src/app/api/integrations/[platform]/callback/route.ts`
- Modify: `src/app/api/integrations/[platform]/disconnect/route.ts`
- Create: `src/app/api/integrations/connections/[id]/route.ts`
- Create: `src/lib/integrations/connectionPatch.ts`, `src/lib/integrations/connectionPatch.test.ts`

**Interfaces:**
- Consumes: Task 4's tokenStore + `decideConnectionSave`, `defaultDisplayName`, `getTenantPlan`; Task 2's `canResumeAccount`, `connectedCount`, `canAddAccount`.
- Produces:
  - `GET /api/integrations/[platform]/connect` → 403 `{ error: "INTEGRATION_ACCOUNT_LIMIT" }` at the cap (JSON, not a redirect — the UI disables the button at the cap; this is the server backstop).
  - Callback redirects `?connected=<platform>&account=<id>` or `?error=<copy>&platform=<p>`.
  - `POST /api/integrations/[platform]/disconnect` body `{ connectionId: string }` → `{ ok: true }` | 400 | 404.
  - `PATCH /api/integrations/connections/[id]` body `{ display_name?: string; is_active?: boolean }` → `{ ok: true, connection: PlatformConnection }` | 400 `{ error: code|message }` | 404 | 409 `{ error: "INTEGRATION_ACCOUNT_LIMIT" }`.
  - `parseConnectionPatch(body: unknown): { ok: true; patch: { display_name?: string; is_active?: boolean } } | { ok: false; error: string }`

- [ ] **Step 1: Write failing `connectionPatch.test.ts`**

```ts
import { parseConnectionPatch } from "./connectionPatch";

describe("parseConnectionPatch", () => {
  it("accepts a trimmed display name", () => {
    expect(parseConnectionPatch({ display_name: "  Main store " })).toEqual({ ok: true, patch: { display_name: "Main store" } });
  });
  it("rejects an empty or over-long display name", () => {
    expect(parseConnectionPatch({ display_name: "   " }).ok).toBe(false);
    expect(parseConnectionPatch({ display_name: "x".repeat(61) }).ok).toBe(false);
  });
  it("accepts is_active booleans only", () => {
    expect(parseConnectionPatch({ is_active: false })).toEqual({ ok: true, patch: { is_active: false } });
    expect(parseConnectionPatch({ is_active: "no" }).ok).toBe(false);
  });
  it("rejects an empty patch and unknown shapes", () => {
    expect(parseConnectionPatch({}).ok).toBe(false);
    expect(parseConnectionPatch(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement `connectionPatch.ts`:

```ts
export type ConnectionPatch = { display_name?: string; is_active?: boolean };

const MAX_NAME = 60;

/** Validates PATCH /api/integrations/connections/[id] bodies. */
export function parseConnectionPatch(
  body: unknown
): { ok: true; patch: ConnectionPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body." };
  const raw = body as Record<string, unknown>;
  const patch: ConnectionPatch = {};

  if ("display_name" in raw) {
    if (typeof raw.display_name !== "string") return { ok: false, error: "Account name must be text." };
    const name = raw.display_name.trim();
    if (name.length < 1 || name.length > MAX_NAME) {
      return { ok: false, error: `Account name must be 1–${MAX_NAME} characters.` };
    }
    patch.display_name = name;
  }
  if ("is_active" in raw) {
    if (typeof raw.is_active !== "boolean") return { ok: false, error: "Invalid active flag." };
    patch.is_active = raw.is_active;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
```

Run: `npx jest src/lib/integrations/connectionPatch.test.ts` → PASS.

- [ ] **Step 3: `connect/route.ts`** — after the existing `hasPlatformIntegrations` check, before building the auth URL:

```ts
  const connections = await listConnections(auth.context.client, platform);
  if (!canAddAccount(plan, connectedCount(connections, platform))) {
    return NextResponse.json({ error: "INTEGRATION_ACCOUNT_LIMIT" }, { status: 403 });
  }
```
Imports: `listConnections` from `@/lib/integrations/tokenStore`, `canAddAccount` from `@/lib/utils/planGating`, `connectedCount` from `@/lib/utils/activeAccounts`. Replace the inline control lookup with `const plan = await getTenantPlan(tenantSchema);` and drop the now-unused `createControlClient`/`TenantPlan` imports.

Note: the at-cap button is disabled in the UI, but a reconnect of an existing account also goes through here. To allow refreshing an existing account at the cap, the Integrations card's **Reconnect** for a still-listed account passes `?reconnect=1`; when that param is present, skip this cap check (the callback re-checks via `decideConnectionSave`, which allows updating an existing account). Implement:

```ts
  const isReconnect = _req.nextUrl.searchParams.get("reconnect") === "1";
  if (!isReconnect) { /* cap check above */ }
```
(rename `_req` to `req` since it's now used).

- [ ] **Step 4: `callback/route.ts`** — replace the `upsertConnection(...)` block inside the `try` with:

```ts
    const tokens = await adapter.exchangeCode(code);

    // Amazon's SP-API redirect includes the seller's account id in the query
    // string; eBay's comes from the Identity API inside exchangeCode.
    const externalAccountId =
      tokens.externalAccountId ?? req.nextUrl.searchParams.get("selling_partner_id") ?? null;
    if (!externalAccountId) {
      return redirectToIntegrationsWithError(req, platform, INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_UNIDENTIFIED);
    }

    const plan = await getTenantPlan(tenantSchema);
    const rows = await listConnections(client, platform);
    const decision = decideConnectionSave(rows, platform, externalAccountId, plan);
    if (decision.kind === "limit") {
      return redirectToIntegrationsWithError(req, platform, INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT);
    }

    const fields = {
      status: "connected" as const,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokens.expires_at,
      external_account_id: externalAccountId,
      external_username: tokens.externalUsername ?? null,
      marketplace_id: tokens.marketplaceId ?? null,
      last_sync_status: null,
      last_sync_error: null,
      connected_by: userId,
    };
    const name = defaultDisplayName(platform, externalAccountId, tokens.externalUsername);

    let connectionId: string;
    if (decision.kind === "insert") {
      connectionId = await insertConnection(client, platform, { ...fields, display_name: name, is_active: true });
    } else {
      connectionId = decision.id;
      const existing = rows.find((r) => r.id === decision.id);
      await updateConnection(client, connectionId, {
        ...fields,
        // Never overwrite an admin's rename; fill it for adopted legacy rows.
        ...(existing?.display_name ? {} : { display_name: name }),
      });
    }

    const success = redirectToIntegrations(req, { connected: platform, account: connectionId });
```
Destructure `tenantSchema` from `auth.context`. Imports: `listConnections, insertConnection, updateConnection` (tokenStore), `decideConnectionSave, defaultDisplayName` (`@/lib/integrations/connectionSave`), `getTenantPlan`, `INTEGRATION_ERRORS` (`@/lib/utils/integrationErrors`). Remove the `upsertConnection` import.

The existing `catch` passes `err.message` (could be a raw Postgres message) into the redirect. Change it to log and use generic copy:
```ts
  } catch (err) {
    console.error("[integrations/callback] connect failed:", err instanceof Error ? err.message : err);
    return redirectToIntegrationsWithError(req, platform, "Connecting the account failed. Please try again.");
  }
```

- [ ] **Step 5: `disconnect/route.ts`** — replace the body after the auth check:

```ts
  const body = (await req.json().catch(() => null)) as { connectionId?: unknown } | null;
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const conn = await getConnectionById(client, connectionId);
  if (!conn || conn.platform !== platform) {
    return NextResponse.json({ error: "INTEGRATION_ACCOUNT_UNKNOWN" }, { status: 404 });
  }

  // The row is kept (not deleted) so its orders keep their account link and
  // reconnecting the same account reuses it.
  await updateConnection(client, connectionId, {
    status: "disconnected",
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
  });

  return NextResponse.json({ ok: true });
```
Rename `_req` → `req`. Imports: `getConnectionById, updateConnection`.

- [ ] **Step 6: Create `src/app/api/integrations/connections/[id]/route.ts`**

First read `node_modules/next/dist/docs/` for the current route-handler `params` shape (existing routes in this repo use `{ params }: { params: Promise<{ … }> }` — follow them).

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnectionById, listConnections, updateConnection } from "@/lib/integrations/tokenStore";
import { parseConnectionPatch } from "@/lib/integrations/connectionPatch";
import { getTenantPlan } from "@/lib/integrations/tenantPlan";
import { canResumeAccount } from "@/lib/utils/activeAccounts";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { PlatformConnection } from "@/types";

const SAFE_COLUMNS =
  "id, platform, status, external_account_id, external_username, display_name, is_active, marketplace_id, last_synced_at, last_sync_status, last_sync_error, created_at, updated_at";

/** Rename / pause / resume one connected account. Admin (integrations ≥ 2) only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const plan = await getTenantPlan(tenantSchema);
  if (!hasPlatformIntegrations(plan)) {
    return NextResponse.json({ error: "Platform integrations require the Pro or Business plan." }, { status: 403 });
  }

  const parsed = parseConnectionPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const conn = await getConnectionById(client, id);
    if (!conn) return NextResponse.json({ error: "INTEGRATION_ACCOUNT_UNKNOWN" }, { status: 404 });

    if (parsed.patch.is_active === true && !conn.is_active) {
      const rows = await listConnections(client, conn.platform);
      if (!canResumeAccount(rows, id, plan)) {
        return NextResponse.json({ error: "INTEGRATION_ACCOUNT_LIMIT" }, { status: 409 });
      }
    }

    await updateConnection(client, id, parsed.patch);

    const { data, error } = await client
      .from("platform_connections")
      .select(SAFE_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, connection: data as PlatformConnection });
  } catch (err) {
    console.error("[integrations/connections] update failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not update the account. Please try again." }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run tests**

Run: `npx jest src/lib/integrations` → PASS.

(Commit at the end of Task 6.)

---

### Task 6: Review + import routes, sync-status, account stamping

**Files:**
- Modify: `src/lib/integrations/mapToSale.ts`, `src/lib/integrations/mapToSale.test.ts`
- Modify: `src/lib/integrations/mergeImportedSale.ts`, `src/lib/integrations/mergeImportedSale.test.ts`
- Create: `src/lib/integrations/reviewImport.ts`, `src/lib/integrations/reviewImport.test.ts`
- Modify: `src/app/api/integrations/review/route.ts`, `src/app/api/integrations/review/import/route.ts`
- Modify: `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts`

**Interfaces:**
- Consumes: Task 4 tokenStore, `getTenantPlan`; Task 2 `resolveActiveAccounts`.
- Produces:
  - `normalizedOrderToSaleRow(order, platform, connectedBy, fees?, connectionId?: string | null)` — sets `connection_id: connectionId ?? null`.
  - `mergeImportedSale` keeps `connection_id` fill-only.
  - `ReviewOrder = NormalizedOrder & { imported: boolean; connection_id: string; account_name: string }`
  - `ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & { errors?: Record<string, string>; pausedAccounts?: string[] }` (errors keyed by account display name)
  - `invalidImportItems(items: { platform: IntegrationPlatform; order: { connection_id?: string } }[], activeIds: Map<IntegrationPlatform, Set<string>>): number[]` — indexes of items whose account isn't an active account of their platform.

- [ ] **Step 1: Failing tests**

Append to `mapToSale.test.ts` (reuse that file's existing order fixture — read its top for the name; below it's `baseOrder`):

```ts
describe("normalizedOrderToSaleRow — connection_id", () => {
  it("stamps the account the order came from", () => {
    expect(normalizedOrderToSaleRow(baseOrder, "ebay", "user-1", undefined, "conn-1").connection_id).toBe("conn-1");
  });
  it("defaults to null when no account is given", () => {
    expect(normalizedOrderToSaleRow(baseOrder, "ebay", "user-1").connection_id).toBeNull();
  });
});
```

Append to `mergeImportedSale.test.ts` (reuse its existing `Sale` fixture builder):

```ts
describe("mergeImportedSale — connection_id is fill-only", () => {
  it("fills connection_id on a row that had none", () => {
    const merged = mergeImportedSale(makeSale({ connection_id: null }), makeSale({ connection_id: "conn-2" }));
    expect(merged.connection_id).toBe("conn-2");
  });
  it("never overwrites a stored connection_id", () => {
    const merged = mergeImportedSale(makeSale({ connection_id: "conn-1" }), makeSale({ connection_id: "conn-2" }));
    expect(merged.connection_id).toBe("conn-1");
  });
});
```

Create `reviewImport.test.ts`:

```ts
import { invalidImportItems } from "./reviewImport";

const active = new Map([
  ["ebay" as const, new Set(["e1", "e2"])],
  ["amazon" as const, new Set(["a1"])],
]);

describe("invalidImportItems", () => {
  it("accepts items whose account is active on their platform", () => {
    expect(invalidImportItems([{ platform: "ebay", order: { connection_id: "e2" } }], active)).toEqual([]);
  });
  it("rejects a missing, paused/unknown, or cross-platform account", () => {
    const items = [
      { platform: "ebay" as const, order: {} },
      { platform: "ebay" as const, order: { connection_id: "e9" } },
      { platform: "ebay" as const, order: { connection_id: "a1" } },
    ];
    expect(invalidImportItems(items, active)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest src/lib/integrations` → the three new suites FAIL.

- [ ] **Step 3: Implement**

`mapToSale.ts`: add a 5th parameter `connectionId?: string | null` (document it in the JSDoc: "the platform_connections row the order was fetched through (056); null for callers that don't know it") and add `connection_id: connectionId ?? null,` right after `marketplace`.

`mergeImportedSale.ts`: in the returned object, after the `marketplace` line:
```ts
    // Fill-only, like marketplace: a pre-056 row gains its account on the
    // next sync, but an existing link is never moved to another account.
    connection_id: existing.connection_id ?? incoming.connection_id ?? null,
```

`reviewImport.ts`:
```ts
import type { IntegrationPlatform } from "@/types";

/**
 * Indexes of import items whose connection_id is not an ACTIVE account of the
 * item's own platform. The client sends connection_id back from the review
 * payload; the server never trusts it without this check.
 */
export function invalidImportItems(
  items: { platform: IntegrationPlatform; order: { connection_id?: string } }[],
  activeIds: Map<IntegrationPlatform, Set<string>>
): number[] {
  const bad: number[] = [];
  items.forEach((item, i) => {
    const id = item.order.connection_id;
    if (!id || !activeIds.get(item.platform)?.has(id)) bad.push(i);
  });
  return bad;
}
```

Run: `npx jest src/lib/integrations` → PASS.

- [ ] **Step 4: Rewrite `review/route.ts`**

Replace types and the body after the plan check:

```ts
export type ReviewOrder = NormalizedOrder & { imported: boolean; connection_id: string; account_name: string };
export type ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & {
  /** Keyed by account display name. */
  errors?: Record<string, string>;
  /** Display names of connected accounts left out because they're paused. */
  pausedAccounts?: string[];
};
```

```ts
  const plan = await getTenantPlan(tenantSchema);
  if (!hasPlatformIntegrations(plan)) { /* existing 403 */ }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  let active: ConnectionRow[];
  let paused: ConnectionRow[];
  let importedSet: Set<string>;
  try {
    ({ active, paused } = resolveActiveAccounts(await listConnections(client), plan));
    if (active.length === 0) {
      return NextResponse.json(paused.length ? { pausedAccounts: paused.map(accountLabel) } : {});
    }

    const activePlatforms = [...new Set(active.map((c) => c.platform))];
    // existing `existingSales` query + importedSet build, unchanged, using activePlatforms
  } catch (err) {
    console.error("[integrations/review] load failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load connections" }, { status: 500 });
  }

  const result: ReviewResponse = {};
  const errors: Record<string, string> = {};

  await Promise.all(
    active.map(async (conn) => {
      const name = accountLabel(conn);
      try {
        const adapter = getAdapter(conn.platform);
        const token = await ensureValidAccessToken(client, conn, adapter);
        const orders = await adapter.fetchOrders(token, since, conn.marketplace_id);
        const bucket = (result[conn.platform] ??= { orders: [] });
        bucket.orders.push(
          ...orders.map((o) => ({
            ...o,
            imported: importedSet.has(`${conn.platform}:${o.external_order_id}`),
            connection_id: conn.id,
            account_name: name,
          }))
        );
      } catch (err) {
        errors[name] = err instanceof Error ? err.message : String(err);
      }
    })
  );

  if (Object.keys(errors).length > 0) result.errors = errors;
  if (paused.length > 0) result.pausedAccounts = paused.map(accountLabel);
  return NextResponse.json(result);
```

with a module-level helper:
```ts
function accountLabel(c: Pick<ConnectionRow, "display_name" | "platform">): string {
  return c.display_name ?? (c.platform === "ebay" ? "eBay" : "Amazon");
}
```
Imports: `listConnections, ensureValidAccessToken, type ConnectionRow` (tokenStore), `resolveActiveAccounts` (`@/lib/utils/activeAccounts`), `getTenantPlan`. Remove `getConnection`, `createControlClient`, `TenantPlan`, `PLATFORMS`. The old `detail` field on the 500 leaked a raw message — dropped above.

Note on adapter errors: `errors[name]` still carries the adapter's message (eBay/Amazon HTTP text, not Postgres). That's the existing behaviour and is kept.

- [ ] **Step 5: Rewrite `review/import/route.ts`**

- Replace the inline control lookup with `const plan = await getTenantPlan(tenantSchema);`.
- Body type: `items: { platform: IntegrationPlatform; order: NormalizedOrder & { connection_id?: string } }[]`.
- After the empty-items early return, add:

```ts
  const { active } = resolveActiveAccounts(await listConnections(client), plan);
  const activeIds = new Map<IntegrationPlatform, Set<string>>();
  for (const c of active) {
    if (!activeIds.has(c.platform)) activeIds.set(c.platform, new Set());
    activeIds.get(c.platform)!.add(c.id);
  }
  if (invalidImportItems(body.items, activeIds).length > 0) {
    return NextResponse.json({ error: "INTEGRATION_ACCOUNT_PAUSED" }, { status: 409 });
  }
```

- In the `incomingRows` map, pass `order.connection_id ?? null` as the 5th arg to `normalizedOrderToSaleRow`.
- The `.upsert(...)` error branch returns `detail: error.message` — a raw Postgres error. Replace with: log it via `console.error("[integrations/import] upsert failed:", error.message)` and return `{ error: "Import failed" }` (500).
- Replace the trailing "Update last_synced_at for each platform" block with per-account updates:

```ts
  const usedConnectionIds = [...new Set(body.items.map((i) => i.order.connection_id!).filter(Boolean))];
  await Promise.all(
    usedConnectionIds.map((id) =>
      updateConnection(client, id, {
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      })
    )
  );
```
Imports: `listConnections, updateConnection` (remove `upsertConnection`), `resolveActiveAccounts`, `invalidImportItems` (`@/lib/integrations/reviewImport`), `getTenantPlan`. Remove `createControlClient`, `TenantPlan`.

- [ ] **Step 6: `sync-status/route.ts`**

Replace the `conn = await getConnection(client, "ebay");` line (~L86) with:
```ts
    conn = sale.connection_id
      ? await getConnectionById(client, sale.connection_id)
      : await getConnection(client, "ebay");
```
Read the surrounding code to confirm the sale variable's name (the route selects `*` from `sales` at ~L38, so `connection_id` is present). Add `getConnectionById` to the tokenStore import. Leave the rest (status check, token refresh) unchanged. This route does not enforce the plan cap — pushing a status back for an order that already exists is allowed even if its account was later paused (documented in SKILL.md, Task 13).

- [ ] **Step 7: Run tests**

Run: `npx jest src/lib/integrations dashboard/integrations` → PASS.

- [ ] **Step 8: Check no `upsertConnection` (tokenStore) callers remain**

Run: `grep -rn "upsertConnection" src/app/api src/lib`
Expected: no output.

- [ ] **Step 9: Commit Tasks 4–6 together**

```bash
git add src/lib/integrations src/app/api/integrations
git commit -m "feat(integrations): per-account connections, cap enforcement and account-stamped imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If the pre-commit verifier flags `unpaginated-collection-read` on `listConnections`, add `// verifier:allow unpaginated-collection-read — one row per seller account, a handful per tenant` on that query line (same pattern as the deletion webhook's tenants query).

---

### Task 7: eBay account-deletion webhook — scoped cleanup

**Files:**
- Create: `src/lib/integrations/ebay/deletionMatch.ts`, `src/lib/integrations/ebay/deletionMatch.test.ts`
- Modify: `src/app/api/notifications/ebay-account-deletion/route.ts` (`cleanupEbayUser`, ~L90-131)

**Interfaces:**
- Produces: `matchDeletedEbayConnections(rows: { id: string; external_account_id: string | null; external_username: string | null }[], userId?: string, username?: string): string[]` — ids of matching rows.

- [ ] **Step 1: Failing test**

```ts
import { matchDeletedEbayConnections } from "./deletionMatch";

const rows = [
  { id: "c1", external_account_id: "u-1", external_username: "store_one" },
  { id: "c2", external_account_id: "u-2", external_username: "store_two" },
  { id: "legacy", external_account_id: null, external_username: null },
];

describe("matchDeletedEbayConnections", () => {
  it("matches by eBay userId", () => {
    expect(matchDeletedEbayConnections(rows, "u-2", undefined)).toEqual(["c2"]);
  });
  it("matches by username", () => {
    expect(matchDeletedEbayConnections(rows, undefined, "store_one")).toEqual(["c1"]);
  });
  it("never matches on missing identifiers", () => {
    expect(matchDeletedEbayConnections(rows, undefined, undefined)).toEqual([]);
  });
  it("leaves other accounts alone", () => {
    expect(matchDeletedEbayConnections(rows, "u-1", "store_one")).toEqual(["c1"]);
  });
});
```

- [ ] **Step 2: Run — FAIL**, then implement:

```ts
/**
 * Which of a tenant's eBay connections an eBay MARKETPLACE_ACCOUNT_DELETION
 * notification refers to. Matches on the Identity userId, or the username
 * for rows connected before 056 stored the userId. Pure — the route does the I/O.
 */
export function matchDeletedEbayConnections(
  rows: { id: string; external_account_id: string | null; external_username: string | null }[],
  userId?: string,
  username?: string
): string[] {
  return rows
    .filter(
      (r) =>
        (userId && r.external_account_id === userId) ||
        (username && (r.external_username === username || r.external_account_id === username))
    )
    .map((r) => r.id);
}
```
(`external_account_id === username` keeps today's behaviour, which compared the id to both.)

Run: `npx jest src/lib/integrations/ebay/deletionMatch.test.ts` → PASS.

- [ ] **Step 3: Update `cleanupEbayUser`** — replace the per-tenant body inside `try`:

```ts
      const client = createServiceClientForTenant(schema_name as string);

      const { data: connections } = await client
        .from("platform_connections") // verifier:allow unpaginated-collection-read — one row per seller account
        .select("id, external_account_id, external_username")
        .eq("platform", "ebay");

      const ids = matchDeletedEbayConnections(connections ?? [], userId, username);
      if (ids.length === 0) continue;

      // Only this account's synced orders — other eBay accounts of the same
      // tenant are untouched (multi-account, 056).
      await client.from("sales").delete().in("connection_id", ids).not("external_order_id", "is", null);
      await client.from("platform_connections").delete().in("id", ids);
```
Update the route's JSDoc paragraph ("finds any tenant whose eBay connection…") to say it matches per account and deletes only that account's synced sales and connection row. Import `matchDeletedEbayConnections`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/integrations/ebay/deletionMatch.ts src/lib/integrations/ebay/deletionMatch.test.ts src/app/api/notifications/ebay-account-deletion/route.ts
git commit -m "fix(integrations): scope eBay account deletion to the matching account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hydration + integrations slice

**Files:**
- Modify: `src/app/dashboard/integrations/_store/integrationsSlice.ts`, `integrationsSlice.test.ts`
- Modify: `src/app/dashboard/layout.tsx` (platform_connections select ~L126-135, add RPC call, `<StoreProvider>` props)
- Modify: `src/store/StoreProvider.tsx` (~L19, L56, L77, L97)

**Interfaces:**
- Consumes: `PlatformConnection`, `PlatformAccount` (Task 2).
- Produces: `state.integrations = { connections: PlatformConnection[]; accounts: PlatformAccount[] }`; actions `hydrateConnections(PlatformConnection[])`, `hydrateAccounts(PlatformAccount[])`, `upsertConnection(PlatformConnection)` (by `id`), `setConnectionStatus({ id, status })`. `upsertConnection` also mirrors into `accounts` (so a rename/pause shows in Orders without reload).

- [ ] **Step 1: Rewrite `integrationsSlice.test.ts`** (keep `makeConnection` with the Task 2 fields):

```ts
import {
  hydrateAccounts,
  hydrateConnections,
  integrationsSlice,
  setConnectionStatus,
  upsertConnection,
} from "./integrationsSlice";
import type { PlatformAccount, PlatformConnection } from "@/types";

const makeConnection = (overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({
  id: "conn-1",
  platform: "ebay",
  status: "connected",
  external_account_id: "u-1",
  external_username: "store_one",
  display_name: "Store one",
  is_active: true,
  marketplace_id: null,
  last_synced_at: null,
  last_sync_status: null,
  last_sync_error: null,
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const toAccount = (c: PlatformConnection): PlatformAccount => ({
  id: c.id, platform: c.platform, display_name: c.display_name, status: c.status, is_active: c.is_active, created_at: c.created_at,
});

describe("integrationsSlice", () => {
  const { reducer } = integrationsSlice;

  it("starts empty", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state).toEqual({ connections: [], accounts: [] });
  });

  it("hydrates connections and accounts independently", () => {
    const c = makeConnection();
    let state = reducer(undefined, hydrateConnections([c]));
    state = reducer(state, hydrateAccounts([toAccount(c)]));
    expect(state.connections).toEqual([c]);
    expect(state.accounts).toEqual([toAccount(c)]);
  });

  it("keeps two accounts of the same platform side by side", () => {
    const a = makeConnection();
    const b = makeConnection({ id: "conn-2", external_account_id: "u-2", display_name: "Store two" });
    const state = reducer(reducer(undefined, upsertConnection(a)), upsertConnection(b));
    expect(state.connections.map((c) => c.id)).toEqual(["conn-1", "conn-2"]);
  });

  it("replaces by id and mirrors into accounts", () => {
    const a = makeConnection();
    let state = reducer(undefined, hydrateConnections([a]));
    state = reducer(state, hydrateAccounts([toAccount(a)]));
    state = reducer(state, upsertConnection({ ...a, display_name: "Renamed", is_active: false }));
    expect(state.connections[0].display_name).toBe("Renamed");
    expect(state.accounts[0]).toMatchObject({ display_name: "Renamed", is_active: false });
  });

  it("adds a new connection to accounts too", () => {
    const state = reducer(undefined, upsertConnection(makeConnection()));
    expect(state.accounts.map((a) => a.id)).toEqual(["conn-1"]);
  });

  it("sets status by id and leaves other accounts alone", () => {
    const a = makeConnection();
    const b = makeConnection({ id: "conn-2" });
    let state = reducer(undefined, hydrateConnections([a, b]));
    state = reducer(state, hydrateAccounts([toAccount(a), toAccount(b)]));
    state = reducer(state, setConnectionStatus({ id: "conn-2", status: "disconnected" }));
    expect(state.connections.map((c) => c.status)).toEqual(["connected", "disconnected"]);
    expect(state.accounts.map((c) => c.status)).toEqual(["connected", "disconnected"]);
  });

  it("ignores a status update for an unknown id", () => {
    const state = reducer(reducer(undefined, hydrateConnections([makeConnection()])), setConnectionStatus({ id: "nope", status: "error" }));
    expect(state.connections[0].status).toBe("connected");
  });
});
```

- [ ] **Step 2: Run — FAIL**: `npx jest dashboard/integrations`

- [ ] **Step 3: Implement the slice**

```ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlatformAccount, PlatformConnection } from "@/types";

interface IntegrationsState {
  /** Admin view (platform_connections, safe columns) — empty for non-admins (RLS). */
  connections: PlatformConnection[];
  /** Every tenant member (get_platform_accounts, 056) — for account filters/pickers. */
  accounts: PlatformAccount[];
}

const initialState: IntegrationsState = { connections: [], accounts: [] };

function toAccount(c: PlatformConnection): PlatformAccount {
  return { id: c.id, platform: c.platform, display_name: c.display_name, status: c.status, is_active: c.is_active, created_at: c.created_at };
}

export const integrationsSlice = createSlice({
  name: "integrations",
  initialState,
  reducers: {
    hydrateConnections(state, action: PayloadAction<PlatformConnection[]>) {
      state.connections = action.payload;
    },
    hydrateAccounts(state, action: PayloadAction<PlatformAccount[]>) {
      state.accounts = action.payload;
    },
    upsertConnection(state, action: PayloadAction<PlatformConnection>) {
      const c = action.payload;
      const i = state.connections.findIndex((x) => x.id === c.id);
      if (i >= 0) state.connections[i] = c;
      else state.connections.push(c);
      const j = state.accounts.findIndex((x) => x.id === c.id);
      if (j >= 0) state.accounts[j] = toAccount(c);
      else state.accounts.push(toAccount(c));
    },
    setConnectionStatus(state, action: PayloadAction<{ id: string; status: PlatformConnection["status"] }>) {
      const { id, status } = action.payload;
      const c = state.connections.find((x) => x.id === id);
      if (c) c.status = status;
      const a = state.accounts.find((x) => x.id === id);
      if (a) a.status = status;
    },
  },
});

export const { hydrateConnections, hydrateAccounts, upsertConnection, setConnectionStatus } = integrationsSlice.actions;
```

Run: `npx jest dashboard/integrations` → PASS.

- [ ] **Step 4: `layout.tsx`**

In the `platform_connections` select, set the column list to:
`"id, platform, status, external_account_id, external_username, display_name, is_active, marketplace_id, last_synced_at, last_sync_status, last_sync_error, created_at, updated_at"` and add `.order("created_at", { ascending: true })`.

After the `get_my_access` call, add:
```ts
  // Token-free account list for every member (056) — Orders' account filter
  // and the order modals' account picker. Empty (not an error) before 056.
  const { data: rawAccounts, error: accountsError } = await supabase.rpc("get_platform_accounts");
  if (accountsError) console.error("[dashboard/layout] get_platform_accounts failed", accountsError);
  const platformAccounts = (accountsError ? [] : (rawAccounts ?? [])) as PlatformAccount[];
```
Pass `platformAccounts={platformAccounts}` to `<StoreProvider>`; import `PlatformAccount`.

- [ ] **Step 5: `StoreProvider.tsx`**

Add prop `platformAccounts?: PlatformAccount[]`, destructure it, and next to the `hydrateConnections` dispatch:
```ts
    if (platformAccounts) store.dispatch(hydrateAccounts(platformAccounts));
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/integrations/_store src/app/dashboard/layout.tsx src/store/StoreProvider.tsx
git commit -m "feat(integrations): hydrate per-account connections and member-visible account list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Integrations page — multi-account UI

**Files:**
- Create: `src/app/dashboard/integrations/_components/PlatformAccountsSection.tsx`
- Modify: `src/app/dashboard/integrations/_components/ConnectionCard.tsx` (rewrite: one account)
- Modify: `src/app/dashboard/integrations/page.tsx`
- Create: `src/app/dashboard/integrations/_lib/accountSummary.ts`, `accountSummary.test.ts`

**Interfaces:**
- Consumes: `accountState`, `canResumeAccount`, `connectedCount` (Task 2); `getMaxAccountsPerPlatform`, `canAddAccount`; `integrationErrorMessage`; slice actions (Task 8); PATCH/disconnect routes (Task 5).
- Produces: `platformHeading(label: string, count: number, cap: number): string`; `needsReconnectBanner(connections: PlatformConnection[]): boolean` (an eBay row that is connected and has `external_account_id === null`).

- [ ] **Step 1: Failing test `_lib/accountSummary.test.ts`**

```ts
import { platformHeading, needsReconnectBanner } from "./accountSummary";
import type { PlatformConnection } from "@/types";

describe("platformHeading", () => {
  it("shows used/cap on capped plans", () => {
    expect(platformHeading("eBay", 1, 2)).toBe("eBay — 1 of 2 accounts");
  });
  it("shows a plain count when unlimited", () => {
    expect(platformHeading("Amazon", 3, Infinity)).toBe("Amazon — 3 accounts");
    expect(platformHeading("Amazon", 1, Infinity)).toBe("Amazon — 1 account");
  });
});

describe("needsReconnectBanner", () => {
  const base = { platform: "ebay", status: "connected", external_account_id: null } as PlatformConnection;
  it("is true for a connected legacy eBay row without an account id", () => {
    expect(needsReconnectBanner([base])).toBe(true);
  });
  it("is false once the id is known, for Amazon, or when disconnected", () => {
    expect(needsReconnectBanner([{ ...base, external_account_id: "u-1" }])).toBe(false);
    expect(needsReconnectBanner([{ ...base, platform: "amazon" }])).toBe(false);
    expect(needsReconnectBanner([{ ...base, status: "disconnected" }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL**, then implement `_lib/accountSummary.ts`:

```ts
import type { PlatformConnection } from "@/types";

export function platformHeading(label: string, count: number, cap: number): string {
  if (Number.isFinite(cap)) return `${label} — ${count} of ${cap} accounts`;
  return `${label} — ${count} account${count === 1 ? "" : "s"}`;
}

/** Pre-056 eBay connections have no account id until reconnected once. */
export function needsReconnectBanner(connections: PlatformConnection[]): boolean {
  return connections.some((c) => c.platform === "ebay" && c.status === "connected" && c.external_account_id === null);
}
```
Run: `npx jest dashboard/integrations` → PASS.

- [ ] **Step 3: Rewrite `ConnectionCard.tsx`** for ONE account

Props: `{ connection: PlatformConnection; state: AccountState; canResume: boolean; canManage: boolean }`.

Behaviour (follow the existing card's classes for the shell, icon chip, meta lines):
- Title row: `display_name ?? label`, muted subline `external_username ?? external_account_id` when it differs from the display name; `Badge` from `STATE_BADGES: Record<AccountState, { label: string; variant: "success" | "default" | "warning" | "danger" }>` = `active: { "Active", "success" }`, `paused: { "Paused", "default" }`, `plan_limit: { "Paused — plan limit", "warning" }`, `disconnected: { "Disconnected", "default" }`, `error: { "Error", "danger" }`.
- Last synced + `last_sync_error` lines unchanged.
- **Rename** (when `canManage`): a pencil `Button variant="ghost" size="sm" aria-label="Rename account"` (lucide `Pencil`) toggles an inline `<form id={`rename-${id}`} onSubmit=…>` with an `Input required maxLength={60}` and `Button type="submit" form=… size="sm" disabled={saving || !name.trim()}` → "Saving…"/"Save", plus a ghost "Cancel". Submit: `PATCH /api/integrations/connections/${id}` `{ display_name }`; on ok `dispatch(upsertConnection(json.connection))` + `success("Account renamed")`; else `toastError("Couldn't rename account", integrationErrorMessage(json.error, json.error ?? "Please try again."))`.
- Row actions when `canManage`:
  - `state === "active"` or `"plan_limit"`: `Button variant="secondary" size="sm"` **Pause** → PATCH `{ is_active: false }`, busy "Pausing…". Success toast "Account paused".
  - `state === "paused"`: **Resume** → PATCH `{ is_active: true }`, busy "Resuming…", `disabled={busy || !canResume}`; when `!canResume`, show a `text-xs` muted hint "Pause another account first, or upgrade your plan." 409 → toast with `integrationErrorMessage`.
  - `state === "plan_limit"`: also show the muted hint "Pause another account to use this one, or upgrade your plan."
  - connected states (not `disconnected`): "Review orders" link (unchanged) and **Disconnect** `Button variant="ghost"` that opens `DeleteConfirmModal` with `title="Disconnect account?"`, `description={`${name} will stop syncing. Its orders stay in your dashboard and reconnect automatically if you connect this account again.`}`, `confirmLabel="Disconnect"`, `confirmingLabel="Disconnecting…"`, `requireReason={false}`. `onConfirm`: `POST /api/integrations/${platform}/disconnect` body `{ connectionId: id }`; ok → `dispatch(setConnectionStatus({ id, status: "disconnected" }))` + `success(`${name} disconnected`)`; else `toastError("Failed to disconnect", "Please try again.")`.
  - `state === "disconnected"`: **Reconnect** `Button size="sm" variant="secondary"` → `window.location.assign(`/api/integrations/${platform}/connect?reconnect=1`)`.

- [ ] **Step 4: Create `PlatformAccountsSection.tsx`**

Props: `{ platform: IntegrationPlatform; connections: PlatformConnection[] (all platforms); plan: TenantPlan; canManage: boolean }`.

```tsx
"use client";

import { Button } from "@/components/ui/Button";
import { getMaxAccountsPerPlatform, canAddAccount } from "@/lib/utils/planGating";
import { accountState, canResumeAccount, connectedCount } from "@/lib/utils/activeAccounts";
import { ConnectionCard } from "./ConnectionCard";
import { platformHeading } from "../_lib/accountSummary";
import type { IntegrationPlatform, PlatformConnection, TenantPlan } from "@/types";

const LABELS: Record<IntegrationPlatform, string> = { ebay: "eBay", amazon: "Amazon" };

export function PlatformAccountsSection({ platform, connections, plan, canManage }: {
  platform: IntegrationPlatform;
  connections: PlatformConnection[];
  plan: TenantPlan;
  canManage: boolean;
}) {
  const label = LABELS[platform];
  const mine = connections.filter((c) => c.platform === platform);
  const cap = getMaxAccountsPerPlatform(plan);
  const used = connectedCount(connections, platform);
  const canAdd = canAddAccount(plan, used);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-strong)]">{platformHeading(label, used, cap)}</h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canAdd}
            onClick={() => window.location.assign(`/api/integrations/${platform}/connect`)}
          >
            Add {label} account
          </Button>
        )}
      </div>
      {canManage && !canAdd && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Your plan includes {cap} {label} account{cap === 1 ? "" : "s"}.{" "}
          <a href="/dashboard/settings" className="font-medium text-[var(--color-primary)] hover:underline">Upgrade for more →</a>
        </p>
      )}
      {mine.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text-muted)]">
          No {label} accounts connected yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {mine.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              state={accountState(connections, c.id, plan)}
              canResume={canResumeAccount(connections, c.id, plan)}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```
Use `next/link`'s `Link` instead of `<a>` for the upgrade link (match `page.tsx`'s existing upgrade link).

- [ ] **Step 5: `page.tsx`**

- Success toast in the `connected` effect: `"<Platform> account connected"`, and keep `router.refresh()`.
- Replace the card grid in the final branch with:

```tsx
      {pausedCount > 0 && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
          {pausedCount} account{pausedCount === 1 ? " is" : "s are"} paused by your plan&apos;s account limit. Pause the accounts you don&apos;t need to choose which stay active, or upgrade your plan.
        </div>
      )}
      {needsReconnectBanner(connections) && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-info-bg)] px-4 py-3 text-sm text-[var(--color-info-text)]">
          Reconnect your eBay account once to enable multiple eBay accounts.
        </div>
      )}
      <div className="space-y-8">
        {PLATFORMS.map((platform) => (
          <PlatformAccountsSection key={platform} platform={platform} connections={connections} plan={tenantPlan} canManage={canManage} />
        ))}
      </div>
```
with `const pausedCount = connections.filter((c) => accountState(connections, c.id, tenantPlan) === "plan_limit").length;` computed after the plan guard. Check `src/app/globals.css` (or wherever tokens live) for the exact warning/info token names (`grep -n "\-\-color-warning\|\-\-color-info" src/app/*.css`) and use the existing ones — do not invent tokens. Remove the now-unused `ConnectionCard` import from `page.tsx`.

- [ ] **Step 6: Run tests**: `npx jest dashboard/integrations` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/integrations
git commit -m "feat(integrations): multi-account Integrations page with pause, rename and plan limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Review Orders page — account column, filter, paused note

**Files:**
- Modify: `src/app/dashboard/integrations/review/page.tsx`
- Create: `src/app/dashboard/integrations/review/_lib/reviewAccounts.ts`, `reviewAccounts.test.ts`

**Interfaces:**
- Consumes: `ReviewOrder`, `ReviewResponse` (Task 6).
- Produces: `accountsInOrders(orders: ReviewOrder[]): { id: string; name: string }[]` (unique, first-seen order), `filterByAccount(orders: ReviewOrder[], accountId: string): ReviewOrder[]` (`"all"` = no filter).

- [ ] **Step 1: Failing test**

```ts
import { accountsInOrders, filterByAccount } from "./reviewAccounts";
import type { ReviewOrder } from "@/app/api/integrations/review/route";

const o = (id: string, connection_id: string, account_name: string) =>
  ({ external_order_id: id, connection_id, account_name, imported: false } as ReviewOrder);

describe("accountsInOrders", () => {
  it("lists each account once, in first-seen order", () => {
    expect(accountsInOrders([o("1", "c2", "Two"), o("2", "c1", "One"), o("3", "c2", "Two")])).toEqual([
      { id: "c2", name: "Two" },
      { id: "c1", name: "One" },
    ]);
  });
});

describe("filterByAccount", () => {
  const orders = [o("1", "c1", "One"), o("2", "c2", "Two")];
  it("returns everything for 'all'", () => {
    expect(filterByAccount(orders, "all")).toHaveLength(2);
  });
  it("narrows to one account", () => {
    expect(filterByAccount(orders, "c2").map((x) => x.external_order_id)).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Run — FAIL**, then implement:

```ts
import type { ReviewOrder } from "@/app/api/integrations/review/route";

export function accountsInOrders(orders: ReviewOrder[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const o of orders) if (!seen.has(o.connection_id)) seen.set(o.connection_id, o.account_name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export function filterByAccount(orders: ReviewOrder[], accountId: string): ReviewOrder[] {
  return accountId === "all" ? orders : orders.filter((o) => o.connection_id === accountId);
}
```
Run: `npx jest dashboard/integrations/review` → PASS.

- [ ] **Step 3: Wire into `review/page.tsx`**

- State: `const [accountFilter, setAccountFilter] = useState("all");` Reset it to `"all"` wherever `setActiveTab` is called.
- `const tabOrders = activeTab ? (data?.[activeTab]?.orders ?? []) : [];`, `const tabAccounts = accountsInOrders(tabOrders);`, `const showAccounts = tabAccounts.length > 1;`, and change `activeOrders` to `filterByAccount(tabOrders, accountFilter)`. (Selection keys stay `${platform}:${external_order_id}` — order ids are unique per platform.)
- Above the bulk-fee toolbar, when `showAccounts`:
```tsx
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-text-muted)]">Account</span>
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm"
              >
                <option value="all">All accounts</option>
                {tabAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
```
- Table: when `showAccounts`, insert an "Account" header after "Order ID" and a matching `<td className="p-3 text-xs text-[var(--color-text-muted)]">{order.account_name}</td>` in the row renderer (find the row `map` that renders the Order ID cell).
- Paused note, right after the errors banner:
```tsx
      {data?.pausedAccounts && data.pausedAccounts.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Not shown (paused): {data.pausedAccounts.join(", ")}. Manage accounts on the Integrations page.
        </p>
      )}
```
- The errors banner already prints `PLATFORM_LABELS[p] ?? p` — keys are now account names, so it prints them as-is. No change needed.
- In `handleImport` and the "Sync Statuses" collector, `order` already carries `connection_id` from the response; nothing else changes. Map a 409 from the import route: in both `!res.ok` branches use `integrationErrorMessage(result.error, result.detail ?? result.error ?? "Import failed")` (import from `@/lib/utils/integrationErrors`).
- "Sync Statuses" warning text: `failedPlatforms.map((p) => PLATFORM_LABELS[p as IntegrationPlatform] ?? p)` — add `?? p` since keys are account names now.

- [ ] **Step 4: Run tests**: `npx jest dashboard/integrations` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations/review
git commit -m "feat(integrations): account column and filter on Review Orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Orders — account filter, column, detail

**Files:**
- Create: `src/lib/utils/platformAccounts.ts`, `src/lib/utils/platformAccounts.test.ts`
- Modify: `src/lib/utils/filters.ts` (`SalesFilters`, `DEFAULT_SALES_FILTERS`, `isDefaultFilters`, `filterSales`)
- Modify: `src/app/dashboard/sales/_store/salesFilterParams.ts`, `salesFilterParams.test.ts`
- Modify: `src/app/dashboard/sales/_store/salesSlice.ts` (`fetchSalesPage`)
- Modify: `src/app/dashboard/sales/page.tsx` (filter bar, columns, `handleExport`)
- Modify: `src/app/dashboard/sales/[id]/page.tsx` (Details card)

**Interfaces:**
- Produces:
  - `UNASSIGNED_ACCOUNT = "__unassigned__"`
  - `hasMultipleAccounts(accounts: Pick<PlatformAccount,"platform">[]): boolean` — 2+ accounts on any one platform
  - `accountOptionsFor(accounts: PlatformAccount[], platform: string): PlatformAccount[]` — that platform's accounts, oldest first
  - `accountName(accounts: PlatformAccount[], id: string | null | undefined): string | null`
  - `accountLabel(a: PlatformAccount): string` — `display_name ?? "eBay account"/"Amazon account"`
  - `SalesFilters.account: string`; `SalesSummaryParams.p_connection_id: string | null`

- [ ] **Step 1: Failing test `platformAccounts.test.ts`**

```ts
import { hasMultipleAccounts, accountOptionsFor, accountName, accountLabel, UNASSIGNED_ACCOUNT } from "./platformAccounts";
import type { PlatformAccount } from "@/types";

const a = (id: string, platform: "ebay" | "amazon", created_at: string, display_name: string | null = id): PlatformAccount => ({
  id, platform, display_name, status: "connected", is_active: true, created_at,
});

describe("platformAccounts", () => {
  const accounts = [a("e2", "ebay", "2026-02-01"), a("e1", "ebay", "2026-01-01"), a("m1", "amazon", "2026-01-01", null)];

  it("UNASSIGNED_ACCOUNT matches the SQL sentinel in 056", () => {
    expect(UNASSIGNED_ACCOUNT).toBe("__unassigned__");
  });
  it("hasMultipleAccounts is true only with 2+ on one platform", () => {
    expect(hasMultipleAccounts(accounts)).toBe(true);
    expect(hasMultipleAccounts([accounts[0], accounts[2]])).toBe(false);
  });
  it("accountOptionsFor returns one platform's accounts, oldest first", () => {
    expect(accountOptionsFor(accounts, "ebay").map((x) => x.id)).toEqual(["e1", "e2"]);
    expect(accountOptionsFor(accounts, "etsy")).toEqual([]);
  });
  it("accountName resolves ids and falls back to a generic label", () => {
    expect(accountName(accounts, "e1")).toBe("e1");
    expect(accountName(accounts, "m1")).toBe("Amazon account");
    expect(accountName(accounts, null)).toBeNull();
    expect(accountName(accounts, "gone")).toBeNull();
  });
  it("accountLabel prefers the display name", () => {
    expect(accountLabel(accounts[0])).toBe("e2");
  });
});
```

- [ ] **Step 2: Run — FAIL**, then implement `src/lib/utils/platformAccounts.ts`:

```ts
import type { PlatformAccount } from "@/types";

/** "No account" filter value — keep in sync with '__unassigned__' in 056's get_sales_summary. */
export const UNASSIGNED_ACCOUNT = "__unassigned__";

export function accountLabel(a: Pick<PlatformAccount, "display_name" | "platform">): string {
  return a.display_name ?? (a.platform === "ebay" ? "eBay account" : "Amazon account");
}

/** Account UI (filters, columns, pickers) only appears once a platform has 2+ accounts. */
export function hasMultipleAccounts(accounts: Pick<PlatformAccount, "platform">[]): boolean {
  const counts = new Map<string, number>();
  for (const a of accounts) counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

export function accountOptionsFor(accounts: PlatformAccount[], platform: string): PlatformAccount[] {
  return accounts.filter((a) => a.platform === platform).sort((x, y) => x.created_at.localeCompare(y.created_at));
}

export function accountName(accounts: PlatformAccount[], id: string | null | undefined): string | null {
  if (!id) return null;
  const a = accounts.find((x) => x.id === id);
  return a ? accountLabel(a) : null;
}
```
Run: `npx jest src/lib/utils/platformAccounts.test.ts` → PASS.

- [ ] **Step 3: Failing `salesFilterParams` test** — add to `salesFilterParams.test.ts` (reuse its default-filters fixture; it spreads `DEFAULT_SALES_FILTERS`):

```ts
it("maps the account filter to p_connection_id", () => {
  expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "all" }).p_connection_id).toBeNull();
  expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "conn-1" }).p_connection_id).toBe("conn-1");
  expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, account: "__unassigned__" }).p_connection_id).toBe("__unassigned__");
});
```
Run: `npx jest dashboard/sales/_store/salesFilterParams` → FAIL.

- [ ] **Step 4: Implement filters + params**

`filters.ts`: add `account: string;` to `SalesFilters` (after `marketplace`), `account: "all",` to `DEFAULT_SALES_FILTERS`, `("account" in f ? f.account === "all" : true) &&` to `isDefaultFilters`, and in `filterSales` after the platform line:
```ts
  if (f.account && f.account !== "all")
    result = result.filter((s) => (f.account === UNASSIGNED_ACCOUNT ? !s.connection_id : s.connection_id === f.account));
```
(import `UNASSIGNED_ACCOUNT` from `./platformAccounts`).

`salesFilterParams.ts`: add to the interface
```ts
  /** Arg name matches get_sales_summary in 056; UNASSIGNED_ACCOUNT = connection_id IS NULL. */
  p_connection_id: string | null;
```
and to the return `p_connection_id: f.account === "all" ? null : f.account,`.

Run: `npx jest dashboard/sales src/lib/utils` → PASS (fix any fixtures that construct `SalesFilters` literals by adding `account: "all"`; `grep -rn "marketplace: \"all\"" src` finds them).

- [ ] **Step 5: Query pushdown** — in BOTH `fetchSalesPage` (`salesSlice.ts`) and `handleExport` (`sales/page.tsx`), after the marketplace lines:

```ts
    if (p.p_connection_id === UNASSIGNED_ACCOUNT) query = query.is("connection_id", null);
    else if (p.p_connection_id) query = query.eq("connection_id", p.p_connection_id);
```
`fetchSalesSummary` already passes `salesFilterParams(filters)` to the RPC, so it picks up `p_connection_id` with no change.

- [ ] **Step 6: Orders page UI** (`sales/page.tsx`)

- `const accounts = useAppSelector((s) => s.integrations.accounts);` and `const showAccounts = hasMultipleAccounts(accounts);`
- In `<FilterBar>`, after the Marketplace block, when `showAccounts`:
```tsx
        {showAccounts && (
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Account</span>
            <select value={filters.account} onChange={(e) => setFilter("account", e.target.value)} className={filterInputCls}>
              <option value="all">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{`${a.platform === "ebay" ? "eBay" : "Amazon"} · ${accountLabel(a)}`}</option>
              ))}
              <option value={UNASSIGNED_ACCOUNT}>Unassigned</option>
            </select>
          </div>
        )}
```
- Columns: the `columns` array is a plain `const`. Insert, right after the "Platform" column object, a spread:
```tsx
    ...(showAccounts
      ? [{
          header: "Account",
          sortValue: (s: Sale) => accountName(accounts, s.connection_id) ?? "",
          render: (s: Sale) => {
            const name = accountName(accounts, s.connection_id);
            return name ? <Badge label={name} variant="info" /> : <span className="text-xs text-[var(--color-text-muted)]">—</span>;
          },
        }]
      : []),
```
(import `Badge` from `@/components/ui/Badge` if not already).
- CSV export: append `"account"` to `headers` and `accountName(accounts, s.connection_id) ?? ""` to each row array, in the same position.

- [ ] **Step 7: Order detail** (`sales/[id]/page.tsx`) — read `accounts` from the store the same way; in the Details card, next to the existing marketplace/platform display, render a row "Account" with `accountName(accounts, sale.connection_id)` only when it is non-null. Copy the classes of the neighbouring Details rows.

- [ ] **Step 8: Run tests**: `npx jest dashboard/sales src/lib/utils` → PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/utils/platformAccounts.ts src/lib/utils/platformAccounts.test.ts src/lib/utils/filters.ts src/app/dashboard/sales
git commit -m "feat(sales): filter, show and export orders by marketplace account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Order modals + CSV import — optional account

**Files:**
- Modify: `src/lib/utils/platformAccounts.ts`, `platformAccounts.test.ts` (add `accountForImportRow`)
- Modify: `src/app/dashboard/sales/_components/AddSaleModal.tsx`
- Modify: `src/app/dashboard/sales/_components/EditSaleModal.tsx`
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Produces: `accountForImportRow(rowPlatform: string, account: PlatformAccount | null): string | null` — the account id when the row's platform matches, else null.

- [ ] **Step 1: Failing test** — append to `platformAccounts.test.ts`:

```ts
import { accountForImportRow } from "./platformAccounts";

describe("accountForImportRow", () => {
  const ebay = { id: "e1", platform: "ebay", display_name: "Main", status: "connected", is_active: true, created_at: "2026-01-01" } as const;
  it("assigns the account to rows of its platform", () => {
    expect(accountForImportRow("ebay", ebay)).toBe("e1");
  });
  it("leaves other platforms and no-selection unassigned", () => {
    expect(accountForImportRow("amazon", ebay)).toBeNull();
    expect(accountForImportRow("ebay", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**, implement in `platformAccounts.ts`:

```ts
/** CSV import "Assign all rows to account": applies only to rows on the account's own platform. */
export function accountForImportRow(rowPlatform: string, account: PlatformAccount | null): string | null {
  return account && account.platform === rowPlatform ? account.id : null;
}
```
Run: `npx jest src/lib/utils/platformAccounts.test.ts` → PASS.

- [ ] **Step 3: AddSaleModal**

- Form state: add `connection_id: string` (initial `""`).
- `const accounts = useAppSelector((s) => s.integrations.accounts);` `const accountOptions = accountOptionsFor(accounts, form.platform);`
- Wherever the Platform select's `onChange` sets the platform, also reset the account: `setForm((f) => ({ ...f, platform: value, connection_id: "" }))` (follow the existing setter shape — if it uses `set("platform", …)`, add a second `set("connection_id", "")`).
- After the Marketplace `Field`, when `accountOptions.length >= 2`:
```tsx
        {accountOptions.length >= 2 && (
          <Field label="Account">
            <Select value={form.connection_id} onChange={(e) => set("connection_id", e.target.value)}>
              <option value="">Unassigned</option>
              {accountOptions.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </Select>
          </Field>
        )}
```
- Insert payload: `connection_id: form.connection_id || null,` after `marketplace`.

- [ ] **Step 4: EditSaleModal** — same as Step 3, with `saleToForm` setting `connection_id: sale.connection_id ?? ""`, the update payload `connection_id: form.connection_id || null`, and `connection_id` added to both `before` (`sale.connection_id ?? null`) and `after` (`data.connection_id ?? null`) of the audit diff. If the sale's current account is not in `accountOptions` (e.g. a removed account), keep it selectable by showing the Select when `form.connection_id` is set even with < 2 options, labelled via `accountName(accounts, id) ?? "Removed account"`.

- [ ] **Step 5: ImportSalesModal**

- State: `const [assignAccountId, setAssignAccountId] = useState("");` cleared in `reset()`.
- `const accounts = useAppSelector((s) => s.integrations.accounts);` `const assignAccount = accounts.find((a) => a.id === assignAccountId) ?? null;`
- Under the "Import format" `Field`, when `hasMultipleAccounts(accounts)`:
```tsx
        {hasMultipleAccounts(accounts) && (
          <Field label="Assign rows to account (optional)">
            <Select value={assignAccountId} onChange={(e) => setAssignAccountId(e.target.value)}>
              <option value="">Leave unassigned</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{`${a.platform === "ebay" ? "eBay" : "Amazon"} · ${accountLabel(a)}`}</option>
              ))}
            </Select>
          </Field>
        )}
```
plus a muted `text-xs` hint below: "Only rows from the same platform are assigned."
- In `handleImport`'s `payload` map (~L596): `return { ...r.data!, created_by: user.id, product_id: productId, connection_id: accountForImportRow(r.data!.platform, assignAccount) };`
- Refund updates and duplicate pre-check are untouched.

- [ ] **Step 6: Run tests**: `npx jest dashboard/sales src/lib/utils` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/platformAccounts.ts src/lib/utils/platformAccounts.test.ts src/app/dashboard/sales/_components
git commit -m "feat(sales): optional account on manual and imported orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs + full verification

**Files:**
- Modify: `src/lib/integrations/SKILL.md`, `src/app/dashboard/integrations/CLAUDE.md`, `src/app/dashboard/integrations/SKILL.md`, `src/app/dashboard/sales/CLAUDE.md`, `src/app/dashboard/sales/SKILL.md`, `src/app/dashboard/CLAUDE.md` (layout hydration bullet), `AGENTS.md`

- [ ] **Step 1: `src/lib/integrations/SKILL.md`**
  - Multi-account model: one `platform_connections` row per account; `decideConnectionSave` (update / adopt legacy / insert / limit); `defaultDisplayName`.
  - tokenStore API: `listConnections`, `getConnectionById`, `insertConnection`, `updateConnection`, `requireActiveConnection`; `upsertConnection` removed.
  - **Gotcha — compatibility shim:** `getConnection(client, platform)` returns the oldest connected, non-paused account; listings/messages/dropshipping still call it; sub-projects 2/3 remove the callers; do not add new callers.
  - **Gotcha — legacy eBay rows:** `external_account_id` NULL until reconnected (needs `commerce.identity.readonly`); the Identity API is on `apiz.ebay.com`, not `api.ebay.com`.
  - **Gotcha — sync-status** pushes back for a sale's account even if that account is paused (it acts on an existing order).
  - Active-account rule lives in `src/lib/utils/activeAccounts.ts` (client-safe), not here.
- [ ] **Step 2: `dashboard/integrations/CLAUDE.md` + `SKILL.md`** — update the file map (`PlatformAccountsSection.tsx`, rewritten `ConnectionCard.tsx`, `_lib/accountSummary.ts`, `review/_lib/reviewAccounts.ts`), slice shape (`connections` + `accounts`, id-keyed actions), new routes (`connections/[id]` PATCH, disconnect body), review payload (`connection_id`, `account_name`, `pausedAccounts`, errors keyed by account name). SKILL gotchas: Pause always holds; plan-limit pause has no toggle; reconnect passes `?reconnect=1` to skip the connect-time cap check.
- [ ] **Step 3: `dashboard/sales/CLAUDE.md` + `SKILL.md`** — Account filter/column/export column (shown only with 2+ accounts on a platform, via `hasMultipleAccounts`), `UNASSIGNED_ACCOUNT` ↔ 056 sentinel, `p_connection_id` in `salesFilterParams`, modal Account select, import "Assign rows to account", `connection_id` in EditSaleModal's audit diff. Gotcha: accounts come from `state.integrations.accounts` (RPC, every member), NOT `connections` (admin-only RLS).
- [ ] **Step 4: `dashboard/CLAUDE.md`** — layout bullet: `platform_connections` select gained `external_username, display_name, is_active, created_at`; new `get_platform_accounts()` RPC hydrated as `platformAccounts`.
- [ ] **Step 5: `AGENTS.md`** — under the `src/lib/integrations/` bullet, add: "Multiple accounts per platform (2026-10-08, sub-project 1 of 4): see `docs/superpowers/specs/2026-10-08-multi-account-integrations-design.md`. Plan caps in `planGating.ts` (`maxAccountsPerPlatform`), active rule in `lib/utils/activeAccounts.ts`."
- [ ] **Step 6: Run the full touched test set**

Run: `npx jest src/lib/utils src/lib/integrations dashboard/integrations dashboard/sales`
Expected: all PASS. Paste the summary line into the PR description.

- [ ] **Step 7: Run the verifier on the diff**

Run: `uv run .claude/verifiers/verify_changes.py`
Expected: no new findings (or each one suppressed with a justified `verifier:allow`).

- [ ] **Step 8: Commit docs**

```bash
git add AGENTS.md src/lib/integrations/SKILL.md src/app/dashboard/CLAUDE.md src/app/dashboard/integrations/CLAUDE.md src/app/dashboard/integrations/SKILL.md src/app/dashboard/sales/CLAUDE.md src/app/dashboard/sales/SKILL.md
git commit -m "docs: multi-account integrations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Per the project rule, docs belong in the same commit as code. If a reviewer prefers, fold each doc change into the matching task's commit instead — the content above is split by feature so that's mechanical.)

- [ ] **Step 9: Hand-off checklist for the user (put in the PR description)**
  1. Add `commerce.identity.readonly` to the eBay app's OAuth scopes in the eBay developer portal **before** deploying.
  2. After merge, apply `056` live; then update `supabase/SKILL.md`'s row to "applied".
  3. Manual check in the browser: connect a second eBay account on a Pro tenant (Add button disables at 2), rename, pause/resume, Review Orders shows the Account column, Orders filter by account, and an accountant user sees the Orders account filter.
  4. Existing eBay tenants reconnect eBay once (banner prompts them).
