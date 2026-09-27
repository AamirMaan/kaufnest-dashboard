# Summary Tiles Implementation Plan (Part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "(this page)" text totals above the Orders, Purchases and Expenses tables with display-only tiles whose values cover every record matching the active filters.

**Architecture:** One `LANGUAGE sql` Postgres function per table (`get_{sales,purchases,expenses}_summary`) aggregates filtered rows server-side and returns one row per currency. A pure per-feature `xFilterParams()` maps the page's filter state to those RPC args and is ALSO used by the existing `fetchXPage` thunk, so table and tiles can never filter differently. Each slice gets a `fetchXSummary` thunk plus a `summaryVersion` counter bumped by add/update/remove reducers; the page refetches on filter or version change. A shared `SummaryTiles` atom renders tiles built by pure per-feature builders.

**Tech Stack:** Next.js App Router (this repo's version — see `node_modules/next/dist/docs/`), Redux Toolkit, Supabase (PostgREST RPC), Postgres, Jest (`testEnvironment: node`), Tailwind with `var(--color-*)` tokens.

> **Renumbered 2026-09-27:** this plan's migration shipped as `050_table_summary_functions.sql`, not `049` — advanced inventory's `049_advanced_inventory_phase3.sql` merged to `main` first. References below to `049` mean `050`. The tile-helper module is `summaryTileHelpers.ts` (renamed from `summaryTiles.ts`, a case collision with `SummaryTiles.tsx` on macOS).

**Spec:** `docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md` → "Part 1".

## Global Constraints

- Work only in worktree `.worktrees/feat-ui-summary-receipts-overview`, branch `feat/ui-summary-receipts-overview`. Run every command from that directory.
- Migration number is **`049`** (`047`/`048` are taken by the unmerged `feat/advanced-inventory` branch).
- Tenant DDL goes through `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)` **and** is mirrored into `provision_tenant_schema()` in `supabase/migrations/005_tenant_provisioning.sql` using `EXECUTE format($sql$ … %1$I … $sql$, schema_name)`. Inside `format()` any literal `%` must be written `%%` — this plan's SQL deliberately contains no literal `%`.
- Functions are **not** `SECURITY DEFINER`; they are `LANGUAGE sql STABLE`, `SET search_path = <schema>`, `GRANT EXECUTE … TO authenticated` — same as `045_overview_aggregation_functions.sql`.
- Never query `public.*`, never hardcode a tenant schema in app code; use `createTenantClient()`.
- Never surface a raw Postgres error to the user.
- Money is never converted between currencies: one line per currency.
- A money tile whose values are all exactly `0` is hidden. Count tiles always render (including `0`).
- Orders money tiles exclude `returned`/`cancelled` orders **unless** the status filter is set (then the filtered rows ARE the result set). "Excluded" counts returned/cancelled rows only when no status filter is set.
- Tiles are display-only — no `onClick`, no `button` element, no hover affordance.
- Colours/radii/shadows come from `var(--color-*)`/`--radius-*`/`--shadow-*` tokens only.
- Do not run `npx tsc --noEmit` or `npm run lint` manually — the pre-commit hook runs them; fix what it reports and re-run the same `git commit`.
- Run focused tests only: `npx jest <path>`.
- Every commit that changes a feature also updates that feature's `CLAUDE.md`/`SKILL.md` in the same commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Applying migration `049` to a live database is an outward-facing action: **ask the user first**, never apply it unprompted.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lib/utils/filters.ts` | modify | + `resolveDateBounds()`, `ilikePattern()` shared helpers |
| `src/lib/utils/filters.test.ts` | modify | tests for the two helpers |
| `src/app/dashboard/sales/_store/salesFilterParams.ts` (+ `.test.ts`) | create | `SalesFilters` → RPC args |
| `src/app/dashboard/purchases/_store/purchasesFilterParams.ts` (+ `.test.ts`) | create | `PurchaseFilters` → RPC args |
| `src/app/dashboard/expenses/_store/expensesFilterParams.ts` (+ `.test.ts`) | create | `ExpenseFilters` → RPC args |
| `src/app/dashboard/{sales,purchases,expenses}/_store/*Slice.ts` | modify | page thunk uses params; + summary thunk/state/version |
| `src/app/dashboard/{sales,purchases,expenses}/_store/*Slice.test.ts` | modify | summary reducer tests |
| `src/types/index.ts` | modify | + `SalesSummaryRow`, `PurchasesSummaryRow`, `ExpensesSummaryRow` |
| `supabase/migrations/049_table_summary_functions.sql` | create | three summary functions on all tenants |
| `supabase/migrations/005_tenant_provisioning.sql` | modify | same three functions for new tenants |
| `src/app/dashboard/_lib/summaryRpc.integration.test.ts` | create | real-DB check (integration suite only) |
| `src/components/ui/summaryTileHelpers.ts` (+ `.test.ts`) | create | pure `moneyTile`/`countTile`/`compactTiles` |
| `src/components/ui/SummaryTiles.tsx` | create | the tiles row atom |
| `src/components/ui/Badge.tsx` | modify | export `CATEGORY_LABELS` |
| `src/app/dashboard/sales/_lib/salesSummaryTiles.ts` (+ `.test.ts`) | create | Orders tile set |
| `src/app/dashboard/purchases/_lib/purchasesSummaryTiles.ts` (+ `.test.ts`) | create | Purchases tile set |
| `src/app/dashboard/expenses/_lib/expensesSummaryTiles.ts` (+ `.test.ts`) | create | Expenses tile set |
| `src/app/dashboard/{sales,purchases,expenses}/page.tsx` | modify | render tiles, delete page-scoped summary |
| docs: `supabase/SKILL.md`, `src/components/ui/SKILL.md`, each feature's `CLAUDE.md` + `SKILL.md` | modify | file maps + gotchas |

---

### Task 1: Shared filter → RPC-args mapping, used by the existing page thunks

**Files:**
- Modify: `src/lib/utils/filters.ts` (add after `sanitizeIlikeSearchTerm`, ~line 230)
- Modify: `src/lib/utils/filters.test.ts`
- Create: `src/app/dashboard/sales/_store/salesFilterParams.ts`, `salesFilterParams.test.ts`
- Create: `src/app/dashboard/purchases/_store/purchasesFilterParams.ts`, `purchasesFilterParams.test.ts`
- Create: `src/app/dashboard/expenses/_store/expensesFilterParams.ts`, `expensesFilterParams.test.ts`
- Modify: `fetchSalesPage` in `sales/_store/salesSlice.ts`, `fetchPurchasesPage` in `purchases/_store/purchasesSlice.ts`, `fetchExpensesPage` in `expenses/_store/expensesSlice.ts`

**Interfaces:**
- Produces:
  - `resolveDateBounds(f: { preset: DatePreset; dateFrom: string; dateTo: string }): { from: string | null; to: string | null }`
  - `ilikePattern(search: string): string | null` — `%<escaped>%` or `null`
  - `salesFilterParams(f: SalesFilters): SalesSummaryParams` where `SalesSummaryParams = { p_from: string | null; p_to: string | null; p_platform: string | null; p_currency: string | null; p_status: string | null; p_pattern: string | null }`
  - `purchasesFilterParams(f: PurchaseFilters): PurchasesSummaryParams` = `{ p_from; p_to; p_currency; p_pattern }` (all `string | null`)
  - `expensesFilterParams(f: ExpenseFilters): ExpensesSummaryParams` = `{ p_from; p_to; p_category; p_currency; p_pattern }` (all `string | null`)
  - Object keys are exactly the SQL parameter names used in Task 2.

- [ ] **Step 1: Write failing tests for the shared helpers** — append to `src/lib/utils/filters.test.ts` (add `resolveDateBounds, ilikePattern` to its existing import from `./filters`):

```ts
describe("resolveDateBounds", () => {
  afterEach(() => jest.useRealTimers());

  it("returns unbounded for the 'all' preset", () => {
    expect(resolveDateBounds({ preset: "all", dateFrom: "2026-01-01", dateTo: "2026-01-31" }))
      .toEqual({ from: null, to: null });
  });

  it("uses custom dates, treating blanks as unbounded", () => {
    expect(resolveDateBounds({ preset: "custom", dateFrom: "2026-02-01", dateTo: "" }))
      .toEqual({ from: "2026-02-01", to: null });
    expect(resolveDateBounds({ preset: "custom", dateFrom: "", dateTo: "" }))
      .toEqual({ from: null, to: null });
  });

  it("resolves a preset through getPresetRange", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 26, 12));
    expect(resolveDateBounds({ preset: "this_month", dateFrom: "", dateTo: "" }))
      .toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("ilikePattern", () => {
  it("returns null for blank input", () => {
    expect(ilikePattern("   ")).toBeNull();
  });
  it("wraps a trimmed term in wildcards", () => {
    expect(ilikePattern("  lamp ")).toBe("%lamp%");
  });
  it("escapes LIKE wildcards in the term", () => {
    expect(ilikePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/utils/filters.test.ts`
Expected: FAIL — `resolveDateBounds is not a function` / not exported.

- [ ] **Step 3: Implement** — in `src/lib/utils/filters.ts`, directly after `sanitizeIlikeSearchTerm`:

```ts
/**
 * Inclusive ISO date bounds for a filter set's date preset. `null` = that side
 * is unbounded. Shared by every `fetchXPage` thunk and its `get_x_summary`
 * RPC so the table and its summary tiles can never filter different dates.
 */
export function resolveDateBounds(f: {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
}): { from: string | null; to: string | null } {
  if (f.preset === "all") return { from: null, to: null };
  if (f.preset === "custom") return { from: f.dateFrom || null, to: f.dateTo || null };
  const range = getPresetRange(f.preset);
  return { from: range?.from ?? null, to: range?.to ?? null };
}

/**
 * `%term%` ILIKE pattern with LIKE wildcards escaped, or `null` for a blank
 * search. Backslash-escaping makes any character literal in LIKE, so the
 * same string is safe both inside a PostgREST `.or()` quoted value and as a
 * plain SQL `ILIKE` argument to the summary RPCs.
 */
export function ilikePattern(search: string): string | null {
  const term = search.trim();
  if (term === "") return null;
  return `%${sanitizeIlikeSearchTerm(term)}%`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/lib/utils/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for the three param mappers**

`src/app/dashboard/sales/_store/salesFilterParams.test.ts`:

```ts
import { salesFilterParams } from "./salesFilterParams";
import { DEFAULT_SALES_FILTERS } from "@/lib/utils/filters";

describe("salesFilterParams", () => {
  it("maps default filters to all-null params", () => {
    expect(salesFilterParams(DEFAULT_SALES_FILTERS)).toEqual({
      p_from: null, p_to: null, p_platform: null, p_currency: null, p_status: null, p_pattern: null,
    });
  });

  it("passes through concrete filter values", () => {
    expect(
      salesFilterParams({
        preset: "custom", dateFrom: "2026-01-01", dateTo: "2026-03-31",
        platform: "ebay", currency: "EUR", status: "shipped", search: " mug ",
      })
    ).toEqual({
      p_from: "2026-01-01", p_to: "2026-03-31", p_platform: "ebay",
      p_currency: "EUR", p_status: "shipped", p_pattern: "%mug%",
    });
  });
});
```

`src/app/dashboard/purchases/_store/purchasesFilterParams.test.ts`:

```ts
import { purchasesFilterParams } from "./purchasesFilterParams";

describe("purchasesFilterParams", () => {
  it("maps 'all' selections and blank search to null", () => {
    expect(
      purchasesFilterParams({ preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" })
    ).toEqual({ p_from: null, p_to: null, p_currency: null, p_pattern: null });
  });

  it("passes through concrete filter values", () => {
    expect(
      purchasesFilterParams({ preset: "custom", dateFrom: "2026-05-01", dateTo: "2026-05-31", currency: "GBP", search: "tape" })
    ).toEqual({ p_from: "2026-05-01", p_to: "2026-05-31", p_currency: "GBP", p_pattern: "%tape%" });
  });
});
```

`src/app/dashboard/expenses/_store/expensesFilterParams.test.ts`:

```ts
import { expensesFilterParams } from "./expensesFilterParams";

describe("expensesFilterParams", () => {
  it("maps 'all' selections and blank search to null", () => {
    expect(
      expensesFilterParams({ preset: "all", dateFrom: "", dateTo: "", category: "all", currency: "all", search: "" })
    ).toEqual({ p_from: null, p_to: null, p_category: null, p_currency: null, p_pattern: null });
  });

  it("passes through concrete filter values", () => {
    expect(
      expensesFilterParams({ preset: "custom", dateFrom: "2026-04-01", dateTo: "", category: "shipping", currency: "EUR", search: "DHL" })
    ).toEqual({ p_from: "2026-04-01", p_to: null, p_category: "shipping", p_currency: "EUR", p_pattern: "%DHL%" });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx jest dashboard/sales/_store/salesFilterParams dashboard/purchases/_store/purchasesFilterParams dashboard/expenses/_store/expensesFilterParams`
Expected: FAIL — cannot find module.

- [ ] **Step 7: Implement the three mappers**

`src/app/dashboard/sales/_store/salesFilterParams.ts`:

```ts
import { ilikePattern, resolveDateBounds, type SalesFilters } from "@/lib/utils/filters";

/** Arg names match `get_sales_summary` in 049_table_summary_functions.sql exactly. */
export interface SalesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_platform: string | null;
  p_currency: string | null;
  p_status: string | null;
  p_pattern: string | null;
}

/**
 * Single source of truth for how the Orders filter bar narrows rows — used by
 * both `fetchSalesPage` (PostgREST filters) and `fetchSalesSummary` (RPC args).
 * `"all"` / blank → `null` = filter not applied.
 */
export function salesFilterParams(f: SalesFilters): SalesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_platform: f.platform === "all" ? null : f.platform,
    p_currency: f.currency === "all" ? null : f.currency,
    p_status: f.status === "all" ? null : f.status,
    p_pattern: ilikePattern(f.search),
  };
}
```

`src/app/dashboard/purchases/_store/purchasesFilterParams.ts`:

```ts
import { ilikePattern, resolveDateBounds, type PurchaseFilters } from "@/lib/utils/filters";

/** Arg names match `get_purchases_summary` in 049_table_summary_functions.sql exactly. */
export interface PurchasesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_currency: string | null;
  p_pattern: string | null;
}

/** Shared by `fetchPurchasesPage` and `fetchPurchasesSummary`; `"all"`/blank → `null`. */
export function purchasesFilterParams(f: PurchaseFilters): PurchasesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_currency: f.currency === "all" ? null : f.currency,
    p_pattern: ilikePattern(f.search),
  };
}
```

`src/app/dashboard/expenses/_store/expensesFilterParams.ts`:

```ts
import { ilikePattern, resolveDateBounds, type ExpenseFilters } from "@/lib/utils/filters";

/** Arg names match `get_expenses_summary` in 049_table_summary_functions.sql exactly. */
export interface ExpensesSummaryParams {
  p_from: string | null;
  p_to: string | null;
  p_category: string | null;
  p_currency: string | null;
  p_pattern: string | null;
}

/** Shared by `fetchExpensesPage` and `fetchExpensesSummary`; `"all"`/blank → `null`. */
export function expensesFilterParams(f: ExpenseFilters): ExpensesSummaryParams {
  const { from, to } = resolveDateBounds(f);
  return {
    p_from: from,
    p_to: to,
    p_category: f.category === "all" ? null : f.category,
    p_currency: f.currency === "all" ? null : f.currency,
    p_pattern: ilikePattern(f.search),
  };
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx jest dashboard/sales/_store/salesFilterParams dashboard/purchases/_store/purchasesFilterParams dashboard/expenses/_store/expensesFilterParams`
Expected: PASS.

- [ ] **Step 9: Refactor the page thunks to use the mappers.** Behaviour is unchanged: the old custom-range fallbacks `"0000-00-00"`/`"9999-99-99"` become "no bound", which selects the same rows.

In `sales/_store/salesSlice.ts`, replace everything in `fetchSalesPage` from the `// Date filters` comment through the closing `}` of the `if (filters.search.trim() !== "")` block with:

```ts
    const p = salesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_platform) query = query.eq("platform", p.p_platform);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_status) query = query.eq("status", p.p_status);
    if (p.p_pattern) {
      query = query.or(
        `product_name.ilike."${p.p_pattern}",external_order_id.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}"`
      );
    }
```

Add `import { salesFilterParams } from "./salesFilterParams";`, and drop `getPresetRange, sanitizeIlikeSearchTerm` from the `@/lib/utils/filters` import if nothing else in the file uses them (keep `type SalesFilters`).

In `purchases/_store/purchasesSlice.ts`, the same span in `fetchPurchasesPage` becomes:

```ts
    const p = purchasesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_pattern) {
      query = query.or(
        `product_name.ilike."${p.p_pattern}",vendor.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}"`
      );
    }
```

(+ `import { purchasesFilterParams } from "./purchasesFilterParams";`, same import cleanup.)

In `expenses/_store/expensesSlice.ts`, the same span in `fetchExpensesPage` becomes:

```ts
    const p = expensesFilterParams(filters);
    if (p.p_from) query = query.gte("date", p.p_from);
    if (p.p_to) query = query.lte("date", p.p_to);
    if (p.p_category) query = query.eq("category", p.p_category);
    if (p.p_currency) query = query.eq("currency", p.p_currency);
    if (p.p_pattern) {
      query = query.or(
        `title.ilike."${p.p_pattern}",vendor.ilike."${p.p_pattern}",description.ilike."${p.p_pattern}",invoice_number.ilike."${p.p_pattern}"`
      );
    }
```

(+ `import { expensesFilterParams } from "./expensesFilterParams";`, same import cleanup.)

- [ ] **Step 10: Run the three features' existing tests**

Run: `npx jest dashboard/sales/_store dashboard/purchases/_store dashboard/expenses/_store src/lib/utils/filters.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/utils/filters.ts src/lib/utils/filters.test.ts \
  src/app/dashboard/{sales,purchases,expenses}/_store/
git commit -m "refactor(tables): share filter→query mapping between page fetch and summaries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 049 — summary functions on every tenant

**Files:**
- Create: `supabase/migrations/049_table_summary_functions.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (insert just before the final `END;` / `$$;` of `provision_tenant_schema`, ~line 1043)
- Create: `src/app/dashboard/_lib/summaryRpc.integration.test.ts`
- Modify: `supabase/SKILL.md` (file-map table: add a `049` row, status "not applied")

**Interfaces:**
- Consumes: param names from Task 1 (`p_from, p_to, p_platform, p_currency, p_status, p_pattern`; `p_category`).
- Produces (PostgREST RPC, called via `supabase.rpc(name, params)`, each returns an array of rows, one per currency, ordered by currency):
  - `get_sales_summary` → `{ currency, order_count, gross, vat, fees, shipping_charged, excluded_count }`
  - `get_purchases_summary` → `{ currency, purchase_count, units, gross, vat }`
  - `get_expenses_summary` → `{ currency, expense_count, gross, vat, top_category, top_category_amount }`

- [ ] **Step 1: Write the migration** `supabase/migrations/049_table_summary_functions.sql`:

```sql
-- ============================================================
-- Table summary functions — every tenant schema (run_on_all_tenant_schemas)
--
-- Back the summary tiles above the Orders / Purchases / Expenses tables.
-- Each aggregates EVERY row matching the table's active filters (not just
-- the visible page) and returns one row per currency — structurally
-- bounded by the number of currencies in use, so no pagination.
--
-- Parameters mirror the client's `xFilterParams()` mappers
-- (src/app/dashboard/*/_store/*FilterParams.ts) exactly; NULL = filter not
-- applied. `p_pattern` arrives already wrapped in wildcards with LIKE
-- metacharacters escaped (`ilikePattern()` in src/lib/utils/filters.ts) —
-- that keeps any literal percent sign out of this SQL, which matters for the
-- format()-based copy in 005_tenant_provisioning.sql.
--
-- Orders: money columns exclude returned/cancelled rows unless a status
-- filter is set (then the filtered rows ARE the result). excluded_count is
-- only non-zero when no status filter is set.
--
-- Not SECURITY DEFINER: runs as the caller, so the existing *_select RLS
-- policies gate visibility — same as 045_overview_aggregation_functions.sql.
-- Also baked into provision_tenant_schema() (005, same commit).
-- See docs/superpowers/specs/2026-09-26-summary-tiles-receipt-autofill-overview-charts-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text
  )
  RETURNS TABLE (
    currency text, order_count int, gross numeric, vat numeric,
    fees numeric, shipping_charged numeric, excluded_count int
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
      (count(*) FILTER (WHERE NOT f.counts))::int
    FROM filtered f
    GROUP BY f.currency
    ORDER BY f.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_purchases_summary(
    p_from date, p_to date, p_currency text, p_pattern text
  )
  RETURNS TABLE (currency text, purchase_count int, units numeric, gross numeric, vat numeric)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT
      p.currency,
      count(*)::int,
      coalesce(sum(p.quantity), 0),
      coalesce(sum(p.total_amount), 0),
      coalesce(sum(coalesce(p.vat_amount, 0)), 0)
    FROM purchases p
    WHERE (p_from IS NULL OR p.date >= p_from)
      AND (p_to IS NULL OR p.date <= p_to)
      AND (p_currency IS NULL OR p.currency = p_currency)
      AND (p_pattern IS NULL
           OR p.product_name ILIKE p_pattern
           OR p.vendor ILIKE p_pattern
           OR p.description ILIKE p_pattern)
    GROUP BY p.currency
    ORDER BY p.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_purchases_summary(date, date, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_expenses_summary(
    p_from date, p_to date, p_category text, p_currency text, p_pattern text
  )
  RETURNS TABLE (
    currency text, expense_count int, gross numeric, vat numeric,
    top_category text, top_category_amount numeric
  )
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT e.*
      FROM expenses e
      WHERE (p_from IS NULL OR e.date >= p_from)
        AND (p_to IS NULL OR e.date <= p_to)
        AND (p_category IS NULL OR e.category = p_category)
        AND (p_currency IS NULL OR e.currency = p_currency)
        AND (p_pattern IS NULL
             OR e.title ILIKE p_pattern
             OR e.vendor ILIKE p_pattern
             OR e.description ILIKE p_pattern
             OR e.invoice_number ILIKE p_pattern)
    ),
    totals AS (
      SELECT currency, count(*)::int AS cnt, sum(amount) AS gross,
             sum(coalesce(vat_amount, 0)) AS vat
      FROM filtered
      GROUP BY currency
    ),
    by_category AS (
      SELECT currency, category, sum(amount) AS amt,
             row_number() OVER (PARTITION BY currency ORDER BY sum(amount) DESC, category) AS rn
      FROM filtered
      GROUP BY currency, category
    )
    SELECT t.currency, t.cnt, coalesce(t.gross, 0), coalesce(t.vat, 0), c.category, c.amt
    FROM totals t
    LEFT JOIN by_category c ON c.currency = t.currency AND c.rn = 1
    ORDER BY t.currency;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_expenses_summary(date, date, text, text, text) TO authenticated;
$$);
```

Before moving on, check the column names against the real schema in `005_tenant_provisioning.sql` (`sales.total_amount/vat_amount/platform_fee/advertising_fee/shipping_cost/shipping_charged/external_order_id/status/platform`, `purchases.quantity/total_amount/vat_amount/vendor`, `expenses.amount/vat_amount/category/title/vendor/invoice_number`). If `currency` is not `text` in any table, change the `RETURNS TABLE` column type to match.

- [ ] **Step 2: Mirror into `provision_tenant_schema()`.** In `005_tenant_provisioning.sql`, directly before the function's final `END;`, add a comment block plus three `EXECUTE format($sql$ … $sql$, schema_name);` statements. Each has the same body as Step 1 with `{{schema}}` replaced by `%1$I`, and each is followed by its GRANT, in the style the existing overview functions use (~lines 493-570):

```sql
  -- Table summary functions — see 049_table_summary_functions.sql for the
  -- full header comment. Not SECURITY DEFINER. No literal percent signs in
  -- these bodies on purpose: format() would treat them as placeholders.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.get_sales_summary(
      p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text
    )
    -- … identical body to 049's get_sales_summary, with SET search_path = %1$I …
  $sql$, schema_name);

  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_sales_summary(date, date, text, text, text, text) TO authenticated', schema_name);
```

Write all three out in full (sales, purchases, expenses) with their grants. Do not abbreviate: the `-- …` line above is only there to keep this plan short, and the real file must contain the complete body copied from Step 1.

Then check that no `%` is left outside the `%1$I` placeholders:

Run: `awk '/Table summary functions/,/get_expenses_summary\(date/' supabase/migrations/005_tenant_provisioning.sql | grep -n '%' | grep -v '%1\$I'`
Expected: no output.

- [ ] **Step 3: Write the integration test** `src/app/dashboard/_lib/summaryRpc.integration.test.ts`. It runs only under `npm run test:integration` (see `jest.integration.config.ts`) and only passes once 049 is applied:

```ts
/**
 * Integration tests for get_sales_summary / get_purchases_summary /
 * get_expenses_summary (049_table_summary_functions.sql). Hits the REAL
 * tenant_boughtopia schema — only runs via `npm run test:integration`, and
 * only after 049 has been applied. Same env-loading approach as
 * overviewRpc.integration.test.ts (see the long comment there).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseEnv } from "util";
import { createServiceClientForTenant } from "@/lib/supabase/server";

const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const SCHEMA = "tenant_boughtopia";
const MARKER = "summary-rpc-integration-test";

describe("table summary RPCs (tenant_boughtopia)", () => {
  const saleIds: string[] = [];
  let createdBy: string;

  beforeAll(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client.from("profiles").select("id").limit(1).single();
    if (error) throw error;
    createdBy = data.id;
  });

  afterAll(async () => {
    if (saleIds.length > 0) {
      await createServiceClientForTenant(SCHEMA).from("sales").delete().in("id", saleIds);
    }
  });

  it("totals only matching rows and separates excluded orders", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const base = {
      platform: "other", product_name: MARKER, quantity: 1, unit_price: 10,
      currency: "EUR", date: "2001-01-15", created_by: createdBy, description: MARKER,
    };
    const { data, error } = await client.from("sales").insert([
      { ...base, total_amount: 100, vat_amount: 19, platform_fee: 5, status: "shipped" },
      { ...base, total_amount: 50, vat_amount: 0, status: "returned" },
    ]).select("id");
    if (error) throw error;
    saleIds.push(...data.map((r: { id: string }) => r.id));

    const { data: rows, error: rpcError } = await client.rpc("get_sales_summary", {
      p_from: "2001-01-01", p_to: "2001-01-31", p_platform: null,
      p_currency: "EUR", p_status: null, p_pattern: `%${MARKER}%`,
    });
    if (rpcError) throw rpcError;
    expect(rows).toEqual([
      expect.objectContaining({ currency: "EUR", order_count: 2, gross: 100, vat: 19, fees: 5, excluded_count: 1 }),
    ]);

    const { data: returnedOnly } = await client.rpc("get_sales_summary", {
      p_from: "2001-01-01", p_to: "2001-01-31", p_platform: null,
      p_currency: "EUR", p_status: "returned", p_pattern: `%${MARKER}%`,
    });
    expect(returnedOnly).toEqual([
      expect.objectContaining({ order_count: 1, gross: 50, excluded_count: 0 }),
    ]);
  });
});
```

- [ ] **Step 4: Update `supabase/SKILL.md`.** Add a `049_table_summary_functions.sql` row to the file-map table, in the same column format as the `045`/`046` rows, with status **not applied**. Add a gotcha: "Summary RPC `p_pattern` arrives pre-wrapped in wildcards from `ilikePattern()`. Never put a literal `%` in a function body that is mirrored into `005` via `format()`."

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/049_table_summary_functions.sql supabase/migrations/005_tenant_provisioning.sql \
  src/app/dashboard/_lib/summaryRpc.integration.test.ts supabase/SKILL.md
git commit -m "feat(db): per-table summary functions for filtered totals (049)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Stop and ask the user** whether to apply `049` to the tenant database now: "Migration 049 is ready. Should I apply it to Project B, or will you?". Only after the user confirms and it is applied: run `npm run test:integration -- summaryRpc` (expected PASS) and update the `supabase/SKILL.md` row to "applied" in a follow-up commit. The UI tasks below can continue before this; until 049 is applied, the tiles show "Totals unavailable".

---

### Task 3: Summary state + thunks in the three slices

**Files:**
- Modify: `src/types/index.ts` (after the `Expense` interface)
- Modify: `src/app/dashboard/sales/_store/salesSlice.ts`, `salesSlice.test.ts`
- Modify: `src/app/dashboard/purchases/_store/purchasesSlice.ts`, `purchasesSlice.test.ts`
- Modify: `src/app/dashboard/expenses/_store/expensesSlice.ts`, `expensesSlice.test.ts`

**Interfaces:**
- Consumes: `salesFilterParams`/`purchasesFilterParams`/`expensesFilterParams` (Task 1), RPC names/row shapes (Task 2).
- Produces:
  - Types: `SalesSummaryRow { currency: Currency; order_count: number; gross: number; vat: number; fees: number; shipping_charged: number; excluded_count: number }`, `PurchasesSummaryRow { currency: Currency; purchase_count: number; units: number; gross: number; vat: number }`, `ExpensesSummaryRow { currency: Currency; expense_count: number; gross: number; vat: number; top_category: ExpenseCategory | null; top_category_amount: number | null }`
  - Thunks: `fetchSalesSummary(filters: SalesFilters)`, `fetchPurchasesSummary(filters: PurchaseFilters)`, `fetchExpensesSummary(filters: ExpenseFilters)`
  - New state on each slice: `summary: XSummaryRow[]`, `summaryLoading: boolean`, `summaryError: boolean`, `summaryVersion: number`, `summaryRequestId: string | null`
  - `addX`/`updateX`/`removeX` reducers now also do `state.summaryVersion += 1`.

- [ ] **Step 1: Add the row types** to `src/types/index.ts`, after `interface Expense`:

```ts
/** One row per currency from get_sales_summary (049). Money excludes returned/cancelled unless a status filter is set. */
export interface SalesSummaryRow {
  currency: Currency;
  order_count: number;
  gross: number;
  vat: number;
  fees: number;
  shipping_charged: number;
  excluded_count: number;
}

/** One row per currency from get_purchases_summary (049). */
export interface PurchasesSummaryRow {
  currency: Currency;
  purchase_count: number;
  units: number;
  gross: number;
  vat: number;
}

/** One row per currency from get_expenses_summary (049). */
export interface ExpensesSummaryRow {
  currency: Currency;
  expense_count: number;
  gross: number;
  vat: number;
  top_category: ExpenseCategory | null;
  top_category_amount: number | null;
}
```

- [ ] **Step 2: Write failing reducer tests.** Append to `sales/_store/salesSlice.test.ts` (extend its import from `./salesSlice` with `fetchSalesSummary`, and import `DEFAULT_SALES_FILTERS` from `@/lib/utils/filters`):

```ts
describe("summary state", () => {
  const reducer = salesSlice.reducer;
  const init = () => reducer(undefined, { type: "@@init" });
  const row = { currency: "EUR" as const, order_count: 2, gross: 100, vat: 19, fees: 5, shipping_charged: 0, excluded_count: 1 };

  it("stores rows from the latest request only", () => {
    let s = reducer(init(), fetchSalesSummary.pending("req-1", DEFAULT_SALES_FILTERS));
    s = reducer(s, fetchSalesSummary.pending("req-2", DEFAULT_SALES_FILTERS));
    expect(s.summaryLoading).toBe(true);
    s = reducer(s, fetchSalesSummary.fulfilled([{ ...row, gross: 1 }], "req-1", DEFAULT_SALES_FILTERS));
    expect(s.summary).toEqual([]); // stale response ignored
    s = reducer(s, fetchSalesSummary.fulfilled([row], "req-2", DEFAULT_SALES_FILTERS));
    expect(s.summary).toEqual([row]);
    expect(s.summaryLoading).toBe(false);
    expect(s.summaryError).toBe(false);
  });

  it("flags an error for the latest request", () => {
    let s = reducer(init(), fetchSalesSummary.pending("req-1", DEFAULT_SALES_FILTERS));
    s = reducer(s, fetchSalesSummary.rejected(new Error("x"), "req-1", DEFAULT_SALES_FILTERS));
    expect(s.summaryError).toBe(true);
    expect(s.summaryLoading).toBe(false);
  });

  it("bumps summaryVersion on add, update and remove", () => {
    let s = init();
    const sale = makeSale();
    s = reducer(s, addSale(sale));
    s = reducer(s, updateSale(sale));
    s = reducer(s, removeSale(sale.id));
    expect(s.summaryVersion).toBe(3);
  });
});
```

Add the equivalent block to `purchases/_store/purchasesSlice.test.ts`, using `purchasesSlice`, `fetchPurchasesSummary`, `addPurchase`/`updatePurchase`/`removePurchase`, the file's existing purchase factory, and filters `{ preset: "all", dateFrom: "", dateTo: "", currency: "all", search: "" }`, with row `{ currency: "EUR", purchase_count: 1, units: 3, gross: 30, vat: 0 }`. Add it to `expenses/_store/expensesSlice.test.ts` too, using `expensesSlice`, `fetchExpensesSummary`, `addExpense`/`updateExpense`/`removeExpense`, that file's existing factory, filters `{ preset: "all", dateFrom: "", dateTo: "", category: "all", currency: "all", search: "" }` and row `{ currency: "EUR", expense_count: 1, gross: 10, vat: 1.6, top_category: "shipping", top_category_amount: 10 }`. The three test bodies are otherwise identical to the sales block. If a test file's factory or reducer names differ, use that file's actual names; check with `grep -n "export const\|^const make" <file>`.

- [ ] **Step 3: Run to verify failure**

Run: `npx jest dashboard/sales/_store/salesSlice dashboard/purchases/_store/purchasesSlice dashboard/expenses/_store/expensesSlice`
Expected: FAIL — `fetchSalesSummary` is undefined / `summaryVersion` undefined.

- [ ] **Step 4: Implement in `salesSlice.ts`**

State and initial state additions:

```ts
interface SalesState {
  // …existing fields…
  summary: SalesSummaryRow[];
  summaryLoading: boolean;
  summaryError: boolean;
  /** Bumped by add/update/remove so the page refetches filtered totals after any mutation. */
  summaryVersion: number;
  /** requestId of the latest summary fetch — older responses are dropped (fast filter typing). */
  summaryRequestId: string | null;
}

// initialState additions:
  summary: [],
  summaryLoading: false,
  summaryError: false,
  summaryVersion: 0,
  summaryRequestId: null,
```

Thunk (below `fetchSalesPage`):

```ts
/**
 * Filtered totals across ALL matching sales (not just the loaded page) —
 * one row per currency from get_sales_summary (049). Uses the same
 * `salesFilterParams` as `fetchSalesPage`, so tiles and table can't disagree.
 */
export const fetchSalesSummary = createAsyncThunk(
  "sales/fetchSummary",
  async (filters: SalesFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_sales_summary", salesFilterParams(filters));
    // Never forward the raw Postgres error — the page shows a generic message.
    if (error) throw new Error("sales_summary_failed");
    return (data ?? []) as SalesSummaryRow[];
  }
);
```

In `addSale`, `updateSale`, `removeSale`, add `state.summaryVersion += 1;` as the last line of each (in `updateSale` and `removeSale`, outside the `if`).

In `extraReducers`, after the existing cases:

```ts
    builder
      .addCase(fetchSalesSummary.pending, (state, action) => {
        state.summaryRequestId = action.meta.requestId;
        state.summaryLoading = true;
      })
      .addCase(fetchSalesSummary.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summary = action.payload;
        state.summaryLoading = false;
        state.summaryError = false;
      })
      .addCase(fetchSalesSummary.rejected, (state, action) => {
        if (action.meta.requestId !== state.summaryRequestId) return;
        state.summaryLoading = false;
        state.summaryError = true;
      });
```

(If `extraReducers` already chains off `builder`, continue that chain rather than starting a second `builder.` statement. Both work, so match the file's existing style.) Add `SalesSummaryRow` to the `@/types` import.

- [ ] **Step 5: Implement the same in `purchasesSlice.ts` and `expensesSlice.ts`** with these substitutions: thunk type prefixes `"purchases/fetchSummary"`/`"expenses/fetchSummary"`; RPC names `get_purchases_summary`/`get_expenses_summary`; mappers `purchasesFilterParams`/`expensesFilterParams`; filter types `PurchaseFilters`/`ExpenseFilters`; row types `PurchasesSummaryRow`/`ExpensesSummaryRow`; thrown messages `"purchases_summary_failed"`/`"expenses_summary_failed"`; version bump in `addPurchase`/`updatePurchase`/`removePurchase` and `addExpense`/`updateExpense`/`removeExpense`. Full code for purchases:

```ts
export const fetchPurchasesSummary = createAsyncThunk(
  "purchases/fetchSummary",
  async (filters: PurchaseFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_purchases_summary", purchasesFilterParams(filters));
    if (error) throw new Error("purchases_summary_failed");
    return (data ?? []) as PurchasesSummaryRow[];
  }
);
```

and for expenses:

```ts
export const fetchExpensesSummary = createAsyncThunk(
  "expenses/fetchSummary",
  async (filters: ExpenseFilters) => {
    const supabase = await createTenantClient();
    const { data, error } = await supabase.rpc("get_expenses_summary", expensesFilterParams(filters));
    if (error) throw new Error("expenses_summary_failed");
    return (data ?? []) as ExpensesSummaryRow[];
  }
);
```

The state fields, initial values and the three `extraReducers` cases are the same as in Step 4, with the thunk name swapped.

- [ ] **Step 6: Run to verify pass**

Run: `npx jest dashboard/sales/_store dashboard/purchases/_store dashboard/expenses/_store`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/app/dashboard/{sales,purchases,expenses}/_store/
git commit -m "feat(tables): filtered-summary thunks and state in sales/purchases/expenses slices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `SummaryTiles` atom + pure tile helpers

**Files:**
- Create: `src/components/ui/summaryTileHelpers.ts`, `src/components/ui/summaryTileHelpers.test.ts`
- Create: `src/components/ui/SummaryTiles.tsx`
- Modify: `src/components/ui/SKILL.md`

**Interfaces:**
- Produces:
  - `interface SummaryTile { label: string; lines: string[] }`
  - `moneyTile<T extends { currency: Currency }>(label: string, rows: T[], value: (r: T) => number): SummaryTile | null` — `null` when `rows` is empty or every value is `0`
  - `countTile(label: string, count: number): SummaryTile` — always returns a tile
  - `compactTiles(tiles: (SummaryTile | null)[]): SummaryTile[]` — drops nulls
  - `<SummaryTiles tiles={SummaryTile[]} loading={boolean} error={boolean} />`

- [ ] **Step 1: Write the failing test** `src/components/ui/summaryTileHelpers.test.ts`:

```ts
import { compactTiles, countTile, moneyTile } from "./summaryTileHelpers";
import { formatCurrency } from "@/lib/utils/currency";

const rows = [
  { currency: "EUR" as const, gross: 1234.5, vat: 0 },
  { currency: "GBP" as const, gross: 10, vat: 0 },
];

describe("moneyTile", () => {
  it("renders one formatted line per currency", () => {
    expect(moneyTile("Gross", rows, (r) => r.gross)).toEqual({
      label: "Gross",
      lines: [formatCurrency(1234.5, "EUR"), formatCurrency(10, "GBP")],
    });
  });

  it("returns null when every value is zero", () => {
    expect(moneyTile("VAT", rows, (r) => r.vat)).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(moneyTile("Gross", [], () => 1)).toBeNull();
  });

  it("keeps a tile whose only non-zero value is negative (credit notes)", () => {
    const tile = moneyTile("VAT", [{ currency: "EUR" as const, v: -3.2 }], (r) => r.v);
    expect(tile?.lines).toEqual([formatCurrency(-3.2, "EUR")]);
  });
});

describe("countTile", () => {
  it("always renders, including zero", () => {
    expect(countTile("Orders", 0)).toEqual({ label: "Orders", lines: ["0"] });
  });
  it("groups thousands", () => {
    expect(countTile("Orders", 12345).lines[0]).toBe(new Intl.NumberFormat("de-DE").format(12345));
  });
});

describe("compactTiles", () => {
  it("drops null tiles and keeps order", () => {
    const a = countTile("A", 1);
    const b = countTile("B", 2);
    expect(compactTiles([a, null, b])).toEqual([a, b]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/components/ui/summaryTileHelpers.test.ts`
Expected: FAIL — cannot find module `./summaryTileHelpers`.

- [ ] **Step 3: Implement** `src/components/ui/summaryTileHelpers.ts`:

```ts
import { formatCurrency } from "@/lib/utils/currency";
import type { Currency } from "@/types";

/** One display-only summary tile: a label and one value line per currency. */
export interface SummaryTile {
  label: string;
  lines: string[];
}

const countFormat = new Intl.NumberFormat("de-DE");

/**
 * Money tile with one line per currency (never converted). `null` — i.e.
 * hidden — when there are no rows or every value is exactly 0. A negative
 * total (credit notes) is real and still shows.
 */
export function moneyTile<T extends { currency: Currency }>(
  label: string,
  rows: T[],
  value: (r: T) => number
): SummaryTile | null {
  if (rows.length === 0 || rows.every((r) => value(r) === 0)) return null;
  return { label, lines: rows.map((r) => formatCurrency(value(r), r.currency)) };
}

/** Count tile — always shown, including 0. */
export function countTile(label: string, count: number): SummaryTile {
  return { label, lines: [countFormat.format(count)] };
}

/** Drops hidden (null) tiles, preserving order. */
export function compactTiles(tiles: (SummaryTile | null)[]): SummaryTile[] {
  return tiles.filter((t): t is SummaryTile => t !== null);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/components/ui/summaryTileHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the atom** `src/components/ui/SummaryTiles.tsx`:

```tsx
import type { SummaryTile } from "./summaryTileHelpers";

interface SummaryTilesProps {
  tiles: SummaryTile[];
  loading: boolean;
  error: boolean;
  className?: string;
}

const SKELETON_COUNT = 4;

/**
 * Display-only row of compact summary tiles above a data table. Values are
 * built by pure helpers in `./summaryTileHelpers` — this component only lays
 * them out. Deliberately not interactive (no button semantics, no hover).
 */
export function SummaryTiles({ tiles, loading, error, className = "" }: SummaryTilesProps) {
  if (error) {
    return <p className={`text-xs text-(--color-text-muted) ${className}`}>Totals unavailable</p>;
  }

  if (loading && tiles.length === 0) {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`} aria-busy="true" aria-label="Loading totals">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div
            key={i}
            className="h-[52px] w-28 animate-pulse rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface)"
          />
        ))}
      </div>
    );
  }

  return (
    <dl
      className={`flex flex-wrap gap-2 transition-opacity ${loading ? "opacity-60" : ""} ${className}`}
      aria-busy={loading}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="min-w-24 rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-3 py-2"
        >
          <dt className="text-[11px] font-medium text-(--color-text-muted)">{tile.label}</dt>
          {tile.lines.map((line, i) => (
            <dd key={i} className="text-sm font-semibold text-(--color-text-strong) tabular-nums">
              {line}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
```

(The `rounded-(--radius-btn)` / `text-(--color-…)` shorthand is what `StatCard.tsx` and the pages already use in this Tailwind version.)

- [ ] **Step 6: Document it.** Add a `SummaryTiles` entry to `src/components/ui/SKILL.md`, next to the StatCard entry. Cover: its purpose (compact, display-only filtered totals above a table, used by Orders/Purchases/Expenses); building tiles with `moneyTile`/`countTile`/`compactTiles`; hide-zero and count-always rules; no currency conversion. Gotcha: "`summaryTileHelpers.ts` is pure and has a test. Keep formatting/visibility logic there, not in the `.tsx`."

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/summaryTileHelpers.ts src/components/ui/summaryTileHelpers.test.ts \
  src/components/ui/SummaryTiles.tsx src/components/ui/SKILL.md
git commit -m "feat(ui): SummaryTiles atom with pure tile helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orders page tiles

**Files:**
- Create: `src/app/dashboard/sales/_lib/salesSummaryTiles.ts`, `salesSummaryTiles.test.ts`
- Modify: `src/app/dashboard/sales/page.tsx` (summary useMemos ~lines 92-111; summary JSX ~lines 415-445)
- Modify: `src/app/dashboard/sales/CLAUDE.md`, `src/app/dashboard/sales/SKILL.md`

**Interfaces:**
- Consumes: `SalesSummaryRow` (Task 3), `fetchSalesSummary` + `summary*` state (Task 3), `SummaryTiles`/`moneyTile`/`countTile`/`compactTiles` (Task 4).
- Produces: `buildSalesTiles(rows: SalesSummaryRow[]): SummaryTile[]`.

- [ ] **Step 1: Write the failing test** `src/app/dashboard/sales/_lib/salesSummaryTiles.test.ts`:

```ts
import { buildSalesTiles } from "./salesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { SalesSummaryRow } from "@/types";

const row = (o: Partial<SalesSummaryRow> = {}): SalesSummaryRow => ({
  currency: "EUR", order_count: 3, gross: 119, vat: 19, fees: 12, shipping_charged: 4.99, excluded_count: 1, ...o,
});

const labels = (rows: SalesSummaryRow[]) => buildSalesTiles(rows).map((t) => t.label);

describe("buildSalesTiles", () => {
  it("shows every tile when all values are present", () => {
    expect(labels([row()])).toEqual(["Orders", "Gross", "VAT", "Net", "Fees", "Shipping charged", "Excluded"]);
  });

  it("computes Net as gross minus VAT per currency", () => {
    const net = buildSalesTiles([row()]).find((t) => t.label === "Net");
    expect(net?.lines).toEqual([formatCurrency(100, "EUR")]);
  });

  it("hides VAT and Net when there is no VAT, and zero fees/shipping", () => {
    expect(labels([row({ vat: 0, fees: 0, shipping_charged: 0 })])).toEqual(["Orders", "Gross", "Excluded"]);
  });

  it("sums counts across currencies", () => {
    const tiles = buildSalesTiles([row(), row({ currency: "GBP", order_count: 2, excluded_count: 0 })]);
    expect(tiles.find((t) => t.label === "Orders")?.lines).toEqual(["5"]);
    expect(tiles.find((t) => t.label === "Excluded")?.lines).toEqual(["1"]);
    expect(tiles.find((t) => t.label === "Gross")?.lines).toHaveLength(2);
  });

  it("shows zero counts and no money tiles for an empty result", () => {
    expect(buildSalesTiles([])).toEqual([
      { label: "Orders", lines: ["0"] },
      { label: "Excluded", lines: ["0"] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest dashboard/sales/_lib/salesSummaryTiles`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** `src/app/dashboard/sales/_lib/salesSummaryTiles.ts`:

```ts
import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import type { SalesSummaryRow } from "@/types";

const sum = (rows: SalesSummaryRow[], pick: (r: SalesSummaryRow) => number) =>
  rows.reduce((acc, r) => acc + pick(r), 0);

/** Orders tiles, in spec order. VAT and Net only appear when VAT is non-zero (otherwise Net = Gross). */
export function buildSalesTiles(rows: SalesSummaryRow[]): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  return compactTiles([
    countTile("Orders", sum(rows, (r) => r.order_count)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
    moneyTile("Fees", rows, (r) => r.fees),
    moneyTile("Shipping charged", rows, (r) => r.shipping_charged),
    countTile("Excluded", sum(rows, (r) => r.excluded_count)),
  ]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/sales/_lib/salesSummaryTiles`
Expected: PASS.

- [ ] **Step 5: Wire into `sales/page.tsx`**

1. Imports: add `fetchSalesSummary` to the `./_store/salesSlice` import. Add `import { SummaryTiles } from "@/components/ui/SummaryTiles";` and `import { buildSalesTiles } from "./_lib/salesSummaryTiles";`.
2. Selectors, next to the existing `s.sales.*` selectors:

```tsx
  const summaryRows = useAppSelector((s) => s.sales.summary);
  const summaryLoading = useAppSelector((s) => s.sales.summaryLoading);
  const summaryError = useAppSelector((s) => s.sales.summaryError);
  const summaryVersion = useAppSelector((s) => s.sales.summaryVersion);
```

3. Delete the `excludedCount` useMemo, the `// Summary computed from current page items only…` comment, the `summary` useMemo and the `hasVat` line (~lines 92-111).
4. Directly after the `filters` state declaration, add:

```tsx
  // Filtered totals for the tiles — refetch when filters change or after any
  // add/edit/delete (summaryVersion), but NOT on page/sort change.
  useEffect(() => {
    dispatch(fetchSalesSummary(filters));
  }, [dispatch, filters, summaryVersion]);

  const summaryTiles = useMemo(() => buildSalesTiles(summaryRows), [summaryRows]);

  useEffect(() => {
    if (summaryError) toastError("Couldn't load order totals");
  }, [summaryError, toastError]);
```

5. Replace the whole `<div className="flex items-start justify-between mb-3 text-sm"> … </div>` block (the one holding `{total} order… total` and the "(this page)" lines) with:

```tsx
        <SummaryTiles tiles={summaryTiles} loading={summaryLoading} error={summaryError} className="mb-3" />
```

6. Remove imports that are now unused: likely `sumAmounts`, and `isRevenueSale`/`Currency` if nothing else in the file uses them. Check with `grep -n "sumAmounts\|isRevenueSale\|Currency\b" src/app/dashboard/sales/page.tsx`.

- [ ] **Step 6: Update docs.** In `sales/CLAUDE.md`'s file map, add `_store/salesFilterParams.ts` (+test) and `_lib/salesSummaryTiles.ts` (+test). In the data-flow section, note that tiles come from `fetchSalesSummary` → `get_sales_summary` (049) and refetch on filters/`summaryVersion`. In `sales/SKILL.md`, add a minimal-file-set entry "Add/change an Orders summary tile → `_lib/salesSummaryTiles.ts` (+ SQL in 049 **and** 005 if it needs a new aggregate)". Add a gotcha: "Tiles cover all filtered rows, not the page. New filters must be added to `salesFilterParams` AND the 049/005 SQL, or the tiles and table will disagree."

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/
git commit -m "feat(sales): filtered summary tiles above the Orders table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Purchases page tiles

**Files:**
- Create: `src/app/dashboard/purchases/_lib/purchasesSummaryTiles.ts`, `purchasesSummaryTiles.test.ts`
- Modify: `src/app/dashboard/purchases/page.tsx` (summary useMemo ~lines 84-100 and its JSX block)
- Modify: `src/app/dashboard/purchases/CLAUDE.md`, `src/app/dashboard/purchases/SKILL.md`

**Interfaces:**
- Consumes: `PurchasesSummaryRow`, `fetchPurchasesSummary` + state (Task 3); Task 4 helpers.
- Produces: `buildPurchasesTiles(rows: PurchasesSummaryRow[]): SummaryTile[]`.

- [ ] **Step 1: Write the failing test** `src/app/dashboard/purchases/_lib/purchasesSummaryTiles.test.ts`:

```ts
import { buildPurchasesTiles } from "./purchasesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { PurchasesSummaryRow } from "@/types";

const row = (o: Partial<PurchasesSummaryRow> = {}): PurchasesSummaryRow => ({
  currency: "EUR", purchase_count: 4, units: 40, gross: 238, vat: 38, ...o,
});

describe("buildPurchasesTiles", () => {
  it("shows all tiles in order", () => {
    expect(buildPurchasesTiles([row()]).map((t) => t.label)).toEqual(["Purchases", "Units bought", "Gross", "VAT", "Net"]);
  });

  it("computes Net as gross minus VAT", () => {
    expect(buildPurchasesTiles([row()]).find((t) => t.label === "Net")?.lines).toEqual([formatCurrency(200, "EUR")]);
  });

  it("hides VAT and Net without VAT", () => {
    expect(buildPurchasesTiles([row({ vat: 0 })]).map((t) => t.label)).toEqual(["Purchases", "Units bought", "Gross"]);
  });

  it("sums counts and units across currencies", () => {
    const tiles = buildPurchasesTiles([row(), row({ currency: "GBP", purchase_count: 1, units: 5 })]);
    expect(tiles.find((t) => t.label === "Purchases")?.lines).toEqual(["5"]);
    expect(tiles.find((t) => t.label === "Units bought")?.lines).toEqual(["45"]);
  });

  it("shows zero counts for an empty result", () => {
    expect(buildPurchasesTiles([])).toEqual([
      { label: "Purchases", lines: ["0"] },
      { label: "Units bought", lines: ["0"] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest dashboard/purchases/_lib/purchasesSummaryTiles`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** `src/app/dashboard/purchases/_lib/purchasesSummaryTiles.ts`:

```ts
import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import type { PurchasesSummaryRow } from "@/types";

const sum = (rows: PurchasesSummaryRow[], pick: (r: PurchasesSummaryRow) => number) =>
  rows.reduce((acc, r) => acc + pick(r), 0);

/** Purchases tiles, in spec order. VAT and Net only appear when VAT is non-zero. */
export function buildPurchasesTiles(rows: PurchasesSummaryRow[]): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  return compactTiles([
    countTile("Purchases", sum(rows, (r) => r.purchase_count)),
    countTile("Units bought", sum(rows, (r) => r.units)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
  ]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/purchases/_lib/purchasesSummaryTiles`
Expected: PASS.

- [ ] **Step 5: Wire into `purchases/page.tsx`.** Same edits as Task 5 Step 5, with these names:
  - import `fetchPurchasesSummary` from `./_store/purchasesSlice`, `SummaryTiles` from `@/components/ui/SummaryTiles`, and `buildPurchasesTiles` from `./_lib/purchasesSummaryTiles`
  - selectors `s.purchases.summary`/`summaryLoading`/`summaryError`/`summaryVersion`
  - delete the page-scoped `summary` useMemo, its comment and `hasVat`
  - add, after the `filters` state:

```tsx
  useEffect(() => {
    dispatch(fetchPurchasesSummary(filters));
  }, [dispatch, filters, summaryVersion]);

  const summaryTiles = useMemo(() => buildPurchasesTiles(summaryRows), [summaryRows]);

  useEffect(() => {
    if (summaryError) toastError("Couldn't load purchase totals");
  }, [summaryError, toastError]);
```

  - replace the summary-lines block above the table (the one containing `(this page)`, plus any `{total} … total` count span in the same wrapper) with `<SummaryTiles tiles={summaryTiles} loading={summaryLoading} error={summaryError} className="mb-3" />`
  - if the page doesn't already destructure `error: toastError` from `useToast()`, add it
  - remove imports that are now unused (`sumAmounts`, `Currency`)

- [ ] **Step 6: Update docs.** Same as Task 5 Step 6, for `purchases/CLAUDE.md` + `purchases/SKILL.md`, naming `purchasesFilterParams.ts`, `_lib/purchasesSummaryTiles.ts`, `fetchPurchasesSummary` and `get_purchases_summary`.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/purchases/
git commit -m "feat(purchases): filtered summary tiles above the Purchases table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Expenses page tiles

**Files:**
- Create: `src/app/dashboard/expenses/_lib/expensesSummaryTiles.ts`, `expensesSummaryTiles.test.ts`
- Modify: `src/components/ui/Badge.tsx` (line 53: export `CATEGORY_LABELS`)
- Modify: `src/app/dashboard/expenses/page.tsx` (summary useMemo ~lines 91-111 and its JSX ~lines 368-390)
- Modify: `src/app/dashboard/expenses/CLAUDE.md`, `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Consumes: `ExpensesSummaryRow`, `fetchExpensesSummary` + state (Task 3); Task 4 helpers.
- Produces: `buildExpensesTiles(rows: ExpensesSummaryRow[], categoryLabel: (c: ExpenseCategory) => string): SummaryTile[]`; `export const CATEGORY_LABELS` from `Badge.tsx`.

- [ ] **Step 1: Write the failing test** `src/app/dashboard/expenses/_lib/expensesSummaryTiles.test.ts`:

```ts
import { buildExpensesTiles } from "./expensesSummaryTiles";
import { formatCurrency } from "@/lib/utils/currency";
import type { ExpenseCategory, ExpensesSummaryRow } from "@/types";

const label = (c: ExpenseCategory) => c.toUpperCase();
const row = (o: Partial<ExpensesSummaryRow> = {}): ExpensesSummaryRow => ({
  currency: "EUR", expense_count: 6, gross: 119, vat: 19, top_category: "shipping", top_category_amount: 80, ...o,
});

describe("buildExpensesTiles", () => {
  it("shows all tiles in order", () => {
    expect(buildExpensesTiles([row()], label).map((t) => t.label))
      .toEqual(["Expenses", "Gross", "VAT", "Net", "Top category"]);
  });

  it("formats top category per currency", () => {
    const tile = buildExpensesTiles([row()], label).find((t) => t.label === "Top category");
    expect(tile?.lines).toEqual([`SHIPPING · ${formatCurrency(80, "EUR")}`]);
  });

  it("keeps a negative VAT total (credit notes)", () => {
    const tiles = buildExpensesTiles([row({ gross: -50, vat: -8 })], label);
    expect(tiles.find((t) => t.label === "VAT")?.lines).toEqual([formatCurrency(-8, "EUR")]);
  });

  it("hides VAT/Net without VAT and Top category without data", () => {
    expect(buildExpensesTiles([row({ vat: 0, top_category: null, top_category_amount: null })], label).map((t) => t.label))
      .toEqual(["Expenses", "Gross"]);
  });

  it("shows only the zero count for an empty result", () => {
    expect(buildExpensesTiles([], label)).toEqual([{ label: "Expenses", lines: ["0"] }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest dashboard/expenses/_lib/expensesSummaryTiles`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** `src/app/dashboard/expenses/_lib/expensesSummaryTiles.ts`:

```ts
import { compactTiles, countTile, moneyTile, type SummaryTile } from "@/components/ui/summaryTileHelpers";
import { formatCurrency } from "@/lib/utils/currency";
import type { ExpenseCategory, ExpensesSummaryRow } from "@/types";

/**
 * Expenses tiles, in spec order. `categoryLabel` is injected (the page passes
 * Badge's CATEGORY_LABELS) so this module stays React-free and testable.
 */
export function buildExpensesTiles(
  rows: ExpensesSummaryRow[],
  categoryLabel: (c: ExpenseCategory) => string
): SummaryTile[] {
  const vat = moneyTile("VAT", rows, (r) => r.vat);
  const topRows = rows.filter((r) => r.top_category !== null && r.top_category_amount !== null);
  const top: SummaryTile | null =
    topRows.length === 0
      ? null
      : {
          label: "Top category",
          lines: topRows.map(
            (r) => `${categoryLabel(r.top_category as ExpenseCategory)} · ${formatCurrency(r.top_category_amount as number, r.currency)}`
          ),
        };

  return compactTiles([
    countTile("Expenses", rows.reduce((acc, r) => acc + r.expense_count, 0)),
    moneyTile("Gross", rows, (r) => r.gross),
    vat,
    vat ? moneyTile("Net", rows, (r) => r.gross - r.vat) : null,
    top,
  ]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest dashboard/expenses/_lib/expensesSummaryTiles`
Expected: PASS.

- [ ] **Step 5: Export category labels.** In `src/components/ui/Badge.tsx` line 53, change `const CATEGORY_LABELS` to `export const CATEGORY_LABELS`.

- [ ] **Step 6: Wire into `expenses/page.tsx`.** Same edits as Task 5 Step 5, with these names:
  - import `fetchExpensesSummary` from `./_store/expensesSlice`, `SummaryTiles` from `@/components/ui/SummaryTiles`, `buildExpensesTiles` from `./_lib/expensesSummaryTiles`, and `CATEGORY_LABELS` from `@/components/ui/Badge`
  - selectors `s.expenses.summary`/`summaryLoading`/`summaryError`/`summaryVersion`
  - delete the page-scoped `summary` useMemo, its comment, and the `hasVat` line with its `!== 0` comment (that rule now lives in `moneyTile`)
  - add, after the `filters` state:

```tsx
  useEffect(() => {
    dispatch(fetchExpensesSummary(filters));
  }, [dispatch, filters, summaryVersion]);

  const summaryTiles = useMemo(
    () => buildExpensesTiles(summaryRows, (c) => CATEGORY_LABELS[c]),
    [summaryRows]
  );

  useEffect(() => {
    if (summaryError) toastError("Couldn't load expense totals");
  }, [summaryError, toastError]);
```

  - replace the summary-lines JSX block (the one containing `(this page)`, and any `{total} … total` count span in the same wrapper) with `<SummaryTiles tiles={summaryTiles} loading={summaryLoading} error={summaryError} className="mb-3" />`
  - add `error: toastError` to the `useToast()` destructure if missing
  - remove imports that are now unused

- [ ] **Step 7: Update docs.** Same as Task 5 Step 6, for `expenses/CLAUDE.md` + `expenses/SKILL.md`, naming `expensesFilterParams.ts`, `_lib/expensesSummaryTiles.ts`, `fetchExpensesSummary`, `get_expenses_summary`, and the new shared dependency on `CATEGORY_LABELS` from `Badge.tsx`. Add the gotcha "negative VAT (credit notes) must still show. `moneyTile` hides only when every value is exactly 0."

- [ ] **Step 8: Run all touched tests**

Run: `npx jest dashboard/sales dashboard/purchases dashboard/expenses src/components/ui src/lib/utils/filters.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/Badge.tsx src/app/dashboard/expenses/
git commit -m "feat(expenses): filtered summary tiles above the Expenses table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Hand off for manual check.** Tell the user what to verify in the browser once 049 is applied:
  - tiles appear above all three tables
  - values stay the same when paging
  - values change when filters or search change
  - adding or deleting a record updates them
  - the Orders "Excluded" tile follows the status filter
  - a multi-currency filter shows one line per currency

  If the Playwright MCP server is connected and `npm run dev` is already running, drive it yourself instead.
