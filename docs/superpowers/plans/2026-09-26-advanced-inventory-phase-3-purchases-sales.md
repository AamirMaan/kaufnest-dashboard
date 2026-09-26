# Advanced Inventory — Phase 3 (Purchases, Sales, Stock by Location) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put batches and locations to work in day-to-day entry: purchases record a location and landed costs, orders record where they ship from (with a shortage warning), the order page shows FIFO cost of goods, and Inventory shows stock per location, each product's open batches, and on-hand units per location.

**Architecture:** Two new read RPCs in the Phase 1 installer (`inventory_stock_by_location`, `inventory_stock_by_location_totals`, both SECURITY INVOKER so tenant RLS applies) plus a sale-trigger guard that skips inactive platform defaults; rolled out by re-running the installer (`049`). On the client, the Phase 2 `advancedInventory` slice gains error-reporting loads and a freshness policy, exposed to Purchases/Sales through one hook, `useAdvancedInventory()`. Every decision (landed-cost fields, suggested fulfillment location, shortage warning, COGS source, stock pivot, lot labels) is a pure function with colocated tests; components stay thin.

**Tech Stack:** Postgres (plpgsql, Supabase Project B), Next.js App Router client components, Redux Toolkit, Supabase JS, Jest.

**Spec:** `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md` ("UI → Inventory page", "Purchases (advanced mode)", "Sales (advanced mode)", "Phasing" item 3).
**Builds on:** Phase 1 (#109) and Phase 2 (#110), both merged. `048` is applied on all five live tenants (verified 2026-09-26).
**Also closes the Phase 2 final-review follow-ups:** `fetchAllRows` swallowing page errors, the slice's load-once policy, and inactive platform defaults in the sale trigger.

## Global Constraints

- Branch `feat/advanced-inventory-phase-3` (from `main`). Never commit to `main`.
- Advanced fields appear only when the advanced view is `"active"` (`hasAdvancedInventory(plan)` AND `advanced_enabled`); Starter/Pro and not-yet-enabled tenants see today's forms and payloads byte-for-byte (the new keys are not even sent).
- `sales.cogs_amount` is trigger-owned: never send it.
- Landed unit cost = `((total_amount − coalesce(vat_amount,0)) + freight + customs + other) / quantity` — display only, via `landedUnitCost()` (`inventory/_lib/landedCost.ts`); the DB computes the stored value.
- Location select on purchases: `""` means "default location" (the trigger fills `inventory_settings.default_location_id`); options are active locations incl. dropship, plus the current one if inactive (`platformLocationOptions`).
- Fulfillment location on sales: pre-filled from the platform default **if that location is active**, else the tenant default (mirrors the trigger after Task 1); a manual pick sticks. Shortage never blocks saving — it is a warning.
- COGS on the order page: `cogs_amount` (FIFO) first; if null, the linked purchase (same currency only); else hidden.
- Never show a raw Postgres error: `inventoryErrorMessage(err, fallback)`.
- Every mutation: try/catch/finally (never stuck busy); toast on success AND failure; post-success audit write in its own error-swallowing try/catch.
- Supabase checklist: per-page stock reads are bounded by page size (chunked at `STOCK_RPC_MAX_IDS = 200`, which the RPC enforces); per-product open lots are read with `fetchAllRowsOrThrow` (cap `PRODUCT_LOTS_CAP = 1000`); `stock_locations` with `fetchAllRowsOrThrow` (cap `STOCK_LOCATIONS_CAP = 1000`).
- SQL: inside `format($sql$ … $sql$, schema_name)` never write a bare `%` (comments included). Agents must NOT run SQL: the `supabase-data` MCP connection is read-only; the user runs SQL tests and migrations.
- Form conventions (AGENTS.md) and UI conventions (tokens only, one primary button per view, `emptyMessage` on every `DataTable`, accessible icon buttons).
- Tests: pure logic in `_lib/` (or a feature's pure `_components/*.ts`) with colocated tests; components are not unit-tested in this project. Run focused `npx jest <paths>`; don't run tsc/lint by hand. No dev server; browser checks only via a connected Playwright MCP against an already-running dev server, otherwise list manual checks in the report.
- Docs: update the touched feature's `CLAUDE.md`/`SKILL.md` in the same commit as the code (AGENTS.md); Task 10 reconciles.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/047_advanced_inventory.sql` (modify installer) | + `inventory_stock_by_location(uuid[])`, `inventory_stock_by_location_totals()`; sale trigger skips inactive platform defaults |
| `supabase/migrations/049_advanced_inventory_phase3.sql` | Re-runs the installer on every tenant |
| `supabase/tests/advanced_inventory.test.sql` (modify) | Phase 3 section |
| `src/lib/utils/fetchAllRows.ts` (+ test) | + `fetchAllRowsOrThrow` |
| `src/app/dashboard/inventory/_lib/advancedInventory.ts` (+ test) | error view only when nothing is loaded yet |
| `src/app/dashboard/inventory/_store/advancedInventorySlice.ts` (+ test) | `loadedAt`, freshness condition, `force` |
| `src/app/dashboard/inventory/_store/useAdvancedInventory.ts` | Hook used by Inventory, Purchases, Sales, order page |
| `src/app/dashboard/inventory/_lib/stockByLocation.ts` (+ test) | Pure: stock columns, per-product summaries, location totals |
| `src/app/dashboard/inventory/_store/stockByLocation.ts` | RPC fetchers |
| `src/app/dashboard/purchases/_lib/purchaseInventoryFields.ts` (+ test) | Pure: location + landed-cost field state, validation, payload |
| `src/app/dashboard/purchases/_components/PurchaseInventoryFields.tsx` | Location select + collapsible landed costs + live read-out |
| `src/app/dashboard/purchases/_components/{Add,Edit}PurchaseModal.tsx` (modify) | Wire the fields |
| `src/app/dashboard/sales/_components/fulfillmentLocation.ts` (+ test) | Pure: suggested location, shortage/dropship warning |
| `src/app/dashboard/sales/_components/FulfillmentLocationField.tsx` | "Fulfilled from" select + warning |
| `src/app/dashboard/sales/_components/{Add,Edit}SaleModal.tsx` (modify) | Wire the field |
| `src/app/dashboard/sales/_components/orderMath.ts` (+ test) | `resolveOrderCogs`, `grossProfitFromCogs` |
| `src/app/dashboard/sales/[id]/page.tsx` (modify) | FIFO COGS + "Fulfilled from" row |
| `src/app/dashboard/inventory/_components/ProductsTab.tsx` (modify) | Per-location columns, total, avg cost; opens lots modal |
| `src/app/dashboard/inventory/_lib/productLots.ts` (+ test) | Pure lot labels, FIFO sort, cost parsing |
| `src/app/dashboard/inventory/_store/productLots.ts` | `fetchOpenLots` |
| `src/app/dashboard/inventory/_components/ProductLotsModal.tsx` | Open batches + opening-cost edit |
| `src/app/dashboard/inventory/_components/LocationsTab.tsx` (modify) | "On hand" column |
| Docs | inventory/purchases/sales `CLAUDE.md`/`SKILL.md`, `supabase/SKILL.md`, spec phasing note |

---

### Task 1: SQL — stock-by-location RPCs + inactive platform-default guard

**Files:**
- Modify: `supabase/migrations/047_advanced_inventory.sql` (installer body)
- Create: `supabase/migrations/049_advanced_inventory_phase3.sql`
- Modify: `supabase/tests/advanced_inventory.test.sql`

**Interfaces:**
- Produces (per tenant schema): `inventory_stock_by_location(p_product_ids uuid[]) RETURNS TABLE (product_id uuid, location_id uuid, qty integer, positive_qty integer, stock_value numeric)` — SECURITY INVOKER, raises when more than 200 ids; `inventory_stock_by_location_totals() RETURNS TABLE (location_id uuid, qty integer)`; both EXECUTE-granted to `authenticated` only. Sale default-fill now ignores a platform default whose location is inactive (falls back to `default_location_id`).

- [ ] **Step 1: Write the failing SQL test** — in `supabase/tests/advanced_inventory.test.sql`, insert this block directly above the final `RAISE EXCEPTION 'INV_TESTS_PASSED';` (state at that point: Widget at Main = opening 3 @1, P2 1 @13.5, P4 10 @10; `default_location_id` = v_fba; ebay → Main, amazon → v_fba):

```sql
  -- ── Section: stock RPCs + inactive platform default (Phase 3) ──
  SELECT qty, positive_qty, stock_value INTO v_int, v_gq, v_num
    FROM inventory_stock_by_location(ARRAY[v_prod]) WHERE location_id = v_main;
  IF v_int IS DISTINCT FROM 14 OR v_gq IS DISTINCT FROM 14 OR v_num IS DISTINCT FROM 116.50 THEN
    RAISE EXCEPTION 'FAIL stock rpc: Widget at Main expected 14/14/116.50, got %/%/%', v_int, v_gq, v_num;
  END IF;
  IF (SELECT qty FROM inventory_stock_by_location_totals() WHERE location_id = v_main)
     IS DISTINCT FROM (SELECT sum(qty_remaining)::integer FROM stock_lots WHERE location_id = v_main) THEN
    RAISE EXCEPTION 'FAIL stock rpc: location totals disagree with stock_lots';
  END IF;
  BEGIN
    PERFORM * FROM inventory_stock_by_location(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)));
    RAISE EXCEPTION 'FAIL stock rpc: 201 product ids accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Too many products%' THEN RAISE; END IF;
  END;
  IF has_function_privilege('anon', 'tenant_zz_invtest.inventory_stock_by_location(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'tenant_zz_invtest.inventory_stock_by_location_totals()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL stock rpc: wrong EXECUTE grants';
  END IF;

  -- An inactive platform default is skipped: the order falls back to the tenant default (FBA)
  INSERT INTO stock_locations (name, type) VALUES ('Temp WH', 'own') RETURNING id INTO v_lot;
  UPDATE platform_location_defaults SET location_id = v_lot WHERE platform = 'etsy';
  UPDATE stock_locations SET is_active = false WHERE id = v_lot;
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('etsy', 'Widget', v_prod, 1, 30, 30, current_date, v_uid) RETURNING id INTO v_sd;
  IF (SELECT fulfillment_location_id FROM sales WHERE id = v_sd) IS DISTINCT FROM v_fba THEN
    RAISE EXCEPTION 'FAIL guard: inactive platform default was used';
  END IF;
  DELETE FROM sales WHERE id = v_sd;

```

- [ ] **Step 2: Implement — RPCs.** In the installer, directly above the line `-- ── Lock down EXECUTE on every function this installer owns ──`, add:

```sql
  -- ── 6. Read RPCs for the Inventory/Purchases/Sales UI (Phase 3) ──
  -- SECURITY INVOKER on purpose: they read stock_lots through the caller's
  -- RLS (stock_lots_select = tenant member), so they can never widen access.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inventory_stock_by_location(p_product_ids uuid[])
    RETURNS TABLE (product_id uuid, location_id uuid, qty integer, positive_qty integer, stock_value numeric)
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    #variable_conflict use_column
    BEGIN
      IF coalesce(cardinality(p_product_ids), 0) > 200 THEN
        RAISE EXCEPTION 'Too many products requested (max 200)';
      END IF;
      RETURN QUERY
        SELECT l.product_id,
               l.location_id,
               sum(l.qty_remaining)::integer,
               sum(greatest(l.qty_remaining, 0))::integer,
               round(sum(greatest(l.qty_remaining, 0) * l.unit_cost), 2)
        FROM stock_lots l
        WHERE l.product_id = ANY (p_product_ids)
        GROUP BY l.product_id, l.location_id;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inventory_stock_by_location_totals()
    RETURNS TABLE (location_id uuid, qty integer)
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    #variable_conflict use_column
    BEGIN
      RETURN QUERY
        SELECT l.location_id, sum(l.qty_remaining)::integer
        FROM stock_lots l
        GROUP BY l.location_id;
    END;
    $func$;
  $sql$, schema_name);
```

and in the RPC-grants section (below the revoke loop, after the existing three GRANT lines) add:

```sql
  EXECUTE format('REVOKE ALL ON FUNCTION %I.inventory_stock_by_location(uuid[]) FROM PUBLIC, anon', schema_name);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.inventory_stock_by_location_totals() FROM PUBLIC, anon', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.inventory_stock_by_location(uuid[]) TO authenticated', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.inventory_stock_by_location_totals() TO authenticated', schema_name);
```

(Those four lines are outside `format($sql$…$sql$)` strings — they use single-quoted `format()` with `%I`, like the existing grants.)

- [ ] **Step 3: Implement — inactive platform-default guard.** `grep -n "platform_location_defaults WHERE platform" supabase/migrations/047_advanced_inventory.sql` finds every place the trigger reads a platform default (the BEFORE sale trigger's fill, and the pre-enable restock branch's `v_loc`). Replace each `(SELECT location_id FROM platform_location_defaults WHERE platform = NEW.platform)` with:

```sql
(SELECT d.location_id
   FROM platform_location_defaults d
   JOIN stock_locations sl ON sl.id = d.location_id
  WHERE d.platform = NEW.platform AND sl.is_active)
```

keeping the surrounding `coalesce(…, v_s.default_location_id)`. Show each replaced line in your report.

- [ ] **Step 4: Create `049_advanced_inventory_phase3.sql`:**

```sql
-- supabase/migrations/049_advanced_inventory_phase3.sql
-- ============================================================
-- Advanced inventory Phase 3: re-runs the updated installer (047) on every
-- tenant, adding the read RPCs inventory_stock_by_location /
-- inventory_stock_by_location_totals and making the sale trigger skip an
-- inactive platform default. Idempotent; inert for tenants that haven't
-- enabled advanced inventory.
-- Apply order: re-run 047 (redefines public.install_advanced_inventory),
-- then this file. New tenants get the same via provision_tenant_schema().
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_advanced_inventory('{{schema}}');
$$);
```

- [ ] **Step 5: Static checks (agents do NOT run SQL):** dollar-quote balance (`$inst$` = 2, `$sql$` even, `$func$` even; test `$test$` = 2); a script listing any `%` inside `format($sql$ … $sql$)` bodies that isn't `%1$I` (must be none); record both in the report. Then add rows to `supabase/SKILL.md`'s file map for `049` (⏳ **pending** — needs 047 re-run then 049; SQL test not yet run) and flip the `048` row to ✅ **applied** (verified live on all 5 tenants 2026-09-26).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/047_advanced_inventory.sql supabase/migrations/049_advanced_inventory_phase3.sql supabase/tests/advanced_inventory.test.sql supabase/SKILL.md
git commit -m "feat(inventory): stock-by-location RPCs and skip inactive platform defaults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The controller asks the user to run 047 + the test file (expect `INV_TESTS_PASSED`) before Tasks 3+ are exercised manually.

---

### Task 2: Loading infrastructure — error-reporting fetch, freshness, `useAdvancedInventory`

**Files:**
- Modify: `src/lib/utils/fetchAllRows.ts` (+ its test, create `fetchAllRows.test.ts` if absent)
- Modify: `src/app/dashboard/inventory/_lib/advancedInventory.ts` (+ test)
- Modify: `src/app/dashboard/inventory/_store/advancedInventorySlice.ts` (+ test)
- Create: `src/app/dashboard/inventory/_store/useAdvancedInventory.ts`
- Modify: `src/app/dashboard/inventory/page.tsx`, `src/app/dashboard/inventory/_components/EnableAdvancedCard.tsx`

**Interfaces:**
- Produces: `fetchAllRowsOrThrow<T>(fetchPage, cap): Promise<T[]>` (throws the first page error); `ADVANCED_INVENTORY_STALE_MS = 60_000`; `isAdvancedInventoryFresh(loadedAt: number | null, now: number): boolean`; `fetchAdvancedInventory(arg?: { force?: boolean })` — skipped (RTK `condition`) while loading or while fresh unless `force`; state gains `loadedAt: number | null`; `useAdvancedInventory(): { entitled: boolean; active: boolean; view: AdvancedInventoryView; settings; locations; platformDefaults; loading: boolean; error: string | null; reload: () => void }`.

- [ ] **Step 1: Failing tests.**

In `src/lib/utils/fetchAllRows.test.ts` (create it if it doesn't exist; if it exists, append):

```ts
import { fetchAllRows, fetchAllRowsOrThrow } from "./fetchAllRows";

const pageOf = (from: number, to: number, total: number) =>
  Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ n: from + i }));

describe("fetchAllRowsOrThrow", () => {
  it("collects every page like fetchAllRows", async () => {
    const rows = await fetchAllRowsOrThrow(
      async (from, to) => ({ data: pageOf(from, to, 1500), error: null, count: 1500 }),
      5000,
    );
    expect(rows).toHaveLength(1500);
  });

  it("throws the page error instead of returning a partial list", async () => {
    const boom = { message: "permission denied" };
    await expect(
      fetchAllRowsOrThrow(async () => ({ data: null, error: boom, count: null }), 100),
    ).rejects.toBe(boom);
  });
});

describe("fetchAllRows (unchanged behaviour)", () => {
  it("still stops quietly on a page error", async () => {
    const rows = await fetchAllRows(async () => ({ data: null, error: { message: "x" }, count: null }), 100);
    expect(rows).toEqual([]);
  });
});
```

In `_lib/advancedInventory.test.ts`, inside `describe("advancedInventoryView")`, add:

```ts
  it("keeps showing loaded data when a background refresh fails", () => {
    expect(advancedInventoryView("business", { loaded: true, loading: false, error: "boom", settings: settings() })).toBe("active");
    expect(advancedInventoryView("business", { loaded: true, loading: false, error: "boom", settings: settings({ advanced_enabled: false }) })).toBe("enable");
  });
```

In `_store/advancedInventorySlice.test.ts`, update the initial-state expectation to include `loadedAt: null`, update the fulfilled payload/expectation to include `loadedAt: 1_700_000_000_000`, and add:

```ts
import { isAdvancedInventoryFresh, ADVANCED_INVENTORY_STALE_MS } from "./advancedInventorySlice";

describe("isAdvancedInventoryFresh", () => {
  it("is fresh only within the stale window after a load", () => {
    expect(isAdvancedInventoryFresh(null, 1_000)).toBe(false);
    expect(isAdvancedInventoryFresh(1_000, 1_000 + ADVANCED_INVENTORY_STALE_MS - 1)).toBe(true);
    expect(isAdvancedInventoryFresh(1_000, 1_000 + ADVANCED_INVENTORY_STALE_MS)).toBe(false);
  });
});

it("keeps loaded data when a refresh is rejected", () => {
  const loaded = reducer(undefined, {
    type: fetchAdvancedInventory.fulfilled.type,
    payload: { settings, locations: [loc("main")], platformDefaults: [], loadedAt: 1 },
  });
  const failed = reducer(loaded, { type: fetchAdvancedInventory.rejected.type, error: { message: "offline" } });
  expect(failed.loaded).toBe(true);
  expect(failed.locations).toHaveLength(1);
  expect(failed.error).toBe("offline");
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/lib/utils/fetchAllRows.test.ts src/app/dashboard/inventory`

- [ ] **Step 3: Implement.**

`fetchAllRows.ts` — keep the existing doc comment on `fetchAllRows`, move the loop into a shared helper:

```ts
async function collectRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown; count: number | null }>,
  cap: number,
  throwOnError: boolean,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  let total = cap;

  while (offset < Math.min(total, cap)) {
    const to = Math.min(offset + 999, cap - 1);
    const { data, error, count } = await fetchPage(offset, to);
    if (error) {
      if (throwOnError) throw error;
      break;
    }
    if (!data || data.length === 0) break;
    if (count != null) total = count;
    results.push(...data);
    offset += data.length;
  }

  if (total > cap) {
    console.warn("[fetchAllRows] cap reached", { cap, total });
  }
  return results;
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown; count: number | null }>,
  cap: number,
): Promise<T[]> {
  return collectRows(fetchPage, cap, false);
}

/**
 * Same paging as fetchAllRows, but a page error is thrown instead of
 * silently returning the rows collected so far — use it wherever an empty
 * or partial list would be mistaken for real data (e.g. a location picker).
 */
export async function fetchAllRowsOrThrow<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown; count: number | null }>,
  cap: number,
): Promise<T[]> {
  return collectRows(fetchPage, cap, true);
}
```

`_lib/advancedInventory.ts` — in `advancedInventoryView`, change `if (load.error) return "error";` to:

```ts
  if (load.error && !load.loaded) return "error";
```

and update its doc comment: a failed background refresh keeps the last loaded view.

`_store/advancedInventorySlice.ts`:
- add `loadedAt: number | null` to the state (initial `null`);
- add

```ts
/** A load younger than this is reused instead of refetched (e.g. opening a modal right after the page loaded). */
export const ADVANCED_INVENTORY_STALE_MS = 60_000;

export function isAdvancedInventoryFresh(loadedAt: number | null, now: number): boolean {
  return loadedAt !== null && now - loadedAt < ADVANCED_INVENTORY_STALE_MS;
}
```

- change the thunk to take an optional `{ force?: boolean }`, read locations with `fetchAllRowsOrThrow` (wrapping its throw: `.catch((e) => { throw new Error(inventoryErrorMessage(e, LOAD_ERROR)); })`), return `loadedAt: Date.now()` in the payload, and add the RTK `condition`:

```ts
export const fetchAdvancedInventory = createAsyncThunk(
  "advancedInventory/fetch",
  async (_arg: { force?: boolean } | undefined) => {
    // …existing Promise.all, with fetchAllRowsOrThrow for stock_locations…
    return { settings: …, locations, platformDefaults: …, loadedAt: Date.now() };
  },
  {
    condition: (arg, { getState }) => {
      const s = (getState() as { advancedInventory: AdvancedInventoryState }).advancedInventory;
      if (s.loading) return false;
      return !!arg?.force || !isAdvancedInventoryFresh(s.loadedAt, Date.now());
    },
  },
);
```

- `fulfilled` also sets `state.loadedAt = action.payload.loadedAt`; `rejected` keeps `loaded`/data untouched (it already only sets `loading`/`error`) — confirm with the new test.

`_store/useAdvancedInventory.ts`:

```ts
"use client";

import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hasAdvancedInventory } from "@/lib/utils/planGating";
import { advancedInventoryView } from "../_lib/advancedInventory";
import { fetchAdvancedInventory } from "./advancedInventorySlice";

/**
 * The one entry point for advanced-inventory state outside the slice:
 * Inventory page, Purchases/Sales modals and the order page. Loads (or
 * refreshes, if older than ADVANCED_INVENTORY_STALE_MS) on mount when the
 * plan allows it; never for Starter/Pro.
 */
export function useAdvancedInventory() {
  const dispatch = useAppDispatch();
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const state = useAppSelector((s) => s.advancedInventory);
  const entitled = !!plan && hasAdvancedInventory(plan);

  useEffect(() => {
    if (entitled) dispatch(fetchAdvancedInventory());
  }, [entitled, dispatch]);

  const reload = useCallback(() => {
    dispatch(fetchAdvancedInventory({ force: true }));
  }, [dispatch]);

  const view = advancedInventoryView(plan, state);
  return {
    entitled,
    active: view === "active",
    view,
    settings: state.settings,
    locations: state.locations,
    platformDefaults: state.platformDefaults,
    loading: state.loading,
    error: state.error,
    reload,
  };
}
```

`page.tsx` — replace its own `plan`/`advanced` selectors, `entitled`, `view` computation and fetch `useEffect` with `const advanced = useAdvancedInventory();` and use `advanced.view`, `advanced.error`, and `advanced.reload` for the Retry button (keep everything else). `EnableAdvancedCard.tsx` — change `dispatch(fetchAdvancedInventory())` to `dispatch(fetchAdvancedInventory({ force: true }))` (fresh data must load right after enabling).

- [ ] **Step 4: Run — expect PASS:** `npx jest src/lib/utils/fetchAllRows.test.ts src/app/dashboard/inventory`

- [ ] **Step 5: Docs + commit** — inventory `CLAUDE.md` (file map: `useAdvancedInventory.ts`; slice freshness) and `SKILL.md` gotcha ("load via `useAdvancedInventory()`; `fetchAdvancedInventory()` is a no-op while fresh — pass `{ force: true }` after a change that alters settings/locations outside the slice's own reducers"). Also update the Phase 2 `SKILL.md` gotcha that says the slice is page-loaded only.

```bash
git add src/lib/utils/fetchAllRows.ts src/lib/utils/fetchAllRows.test.ts src/app/dashboard/inventory
git commit -m "feat(inventory): error-reporting loads, freshness window and useAdvancedInventory hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stock-by-location client

**Files:**
- Create: `src/app/dashboard/inventory/_lib/stockByLocation.ts` (+ `stockByLocation.test.ts`)
- Create: `src/app/dashboard/inventory/_store/stockByLocation.ts`

**Interfaces:**
- Consumes: RPCs from Task 1; `inventoryErrorMessage`; `StockLocation`.
- Produces: `StockByLocationRow { product_id: string; location_id: string; qty: number; positive_qty: number; stock_value: number }`; `MAX_STOCK_COLUMNS = 4`; `OTHER_COLUMN_ID = "other"`; `StockColumn { id: string; label: string }`; `ProductStockSummary { cells: Record<string, number>; total: number; avgUnitCost: number | null }`; `stockColumns(locations): StockColumn[]`; `summarizeStock(rows, columns): Record<string, ProductStockSummary>`; `locationTotals(rows: { location_id: string; qty: number }[]): Record<string, number>`; `STOCK_RPC_MAX_IDS = 200`; `fetchStockByLocation(productIds: string[]): Promise<StockByLocationRow[]>`; `fetchLocationStockTotals(): Promise<Record<string, number>>`.

- [ ] **Step 1: Failing test** — `_lib/stockByLocation.test.ts`:

```ts
import { stockColumns, summarizeStock, locationTotals, OTHER_COLUMN_ID } from "./stockByLocation";
import type { StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id, name: id, type: "own", is_active: true, created_by: null, created_at: "2026-09-26T00:00:00.000Z", ...overrides,
});

describe("stockColumns", () => {
  it("shows up to four active stock-holding locations by name, then Other", () => {
    const cols = stockColumns([
      loc("e"), loc("d"), loc("c"), loc("b"), loc("a"),
      loc("ds", { type: "dropship" }),
    ]);
    expect(cols.map((c) => c.id)).toEqual(["a", "b", "c", "d", OTHER_COLUMN_ID]);
  });

  it("adds Other for inactive stock-holding locations, never for dropship-only extras", () => {
    expect(stockColumns([loc("a"), loc("old", { is_active: false })]).map((c) => c.id)).toEqual(["a", OTHER_COLUMN_ID]);
    expect(stockColumns([loc("a"), loc("ds", { type: "dropship" })]).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("summarizeStock", () => {
  const columns = [{ id: "main", label: "Main" }, { id: "fba", label: "FBA" }, { id: OTHER_COLUMN_ID, label: "Other" }];

  it("puts shown locations in their own cell and everything else in Other", () => {
    const s = summarizeStock([
      { product_id: "p", location_id: "main", qty: 10, positive_qty: 10, stock_value: 100 },
      { product_id: "p", location_id: "fba", qty: -2, positive_qty: 0, stock_value: 0 },
      { product_id: "p", location_id: "x", qty: 3, positive_qty: 3, stock_value: 45 },
    ], columns);
    expect(s.p.cells).toEqual({ main: 10, fba: -2, [OTHER_COLUMN_ID]: 3 });
    expect(s.p.total).toBe(11);
    expect(s.p.avgUnitCost).toBe(11.15); // (100 + 45) / 13
  });

  it("has no average cost when nothing is on hand", () => {
    const s = summarizeStock([{ product_id: "p", location_id: "main", qty: -1, positive_qty: 0, stock_value: 0 }], columns);
    expect(s.p.avgUnitCost).toBeNull();
  });

  it("accepts numeric strings from PostgREST", () => {
    const s = summarizeStock(
      [{ product_id: "p", location_id: "main", qty: 2, positive_qty: 2, stock_value: "3.50" as unknown as number }],
      columns,
    );
    expect(s.p.avgUnitCost).toBe(1.75);
  });
});

describe("locationTotals", () => {
  it("maps location id to quantity", () => {
    expect(locationTotals([{ location_id: "a", qty: 4 }, { location_id: "b", qty: -1 }])).toEqual({ a: 4, b: -1 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/app/dashboard/inventory/_lib/stockByLocation.test.ts`

- [ ] **Step 3: Implement** — `_lib/stockByLocation.ts`:

```ts
import type { StockLocation } from "@/types";

/** Row shape of the inventory_stock_by_location RPC (047 installer). */
export interface StockByLocationRow {
  product_id: string;
  location_id: string;
  qty: number;          // net units, negative for a shortfall
  positive_qty: number; // units actually on hand
  stock_value: number;  // value of the on-hand units at their lot cost
}

export const MAX_STOCK_COLUMNS = 4;
export const OTHER_COLUMN_ID = "other";

export interface StockColumn {
  id: string;
  label: string;
}

export interface ProductStockSummary {
  cells: Record<string, number>;
  total: number;
  avgUnitCost: number | null;
}

const byName = (a: StockLocation, b: StockLocation) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** First MAX_STOCK_COLUMNS active, stock-holding locations by name, plus "Other" when more exist. */
export function stockColumns(locations: StockLocation[]): StockColumn[] {
  const holding = locations.filter((l) => l.type !== "dropship");
  const shown = holding.filter((l) => l.is_active).sort(byName).slice(0, MAX_STOCK_COLUMNS);
  const columns = shown.map((l) => ({ id: l.id, label: l.name }));
  const hasMore = holding.some((l) => !shown.some((s) => s.id === l.id));
  return hasMore ? [...columns, { id: OTHER_COLUMN_ID, label: "Other" }] : columns;
}

export function summarizeStock(
  rows: StockByLocationRow[],
  columns: StockColumn[],
): Record<string, ProductStockSummary> {
  const shownIds = new Set(columns.filter((c) => c.id !== OTHER_COLUMN_ID).map((c) => c.id));
  const acc: Record<string, { cells: Record<string, number>; total: number; onHand: number; value: number }> = {};
  for (const r of rows) {
    const s = (acc[r.product_id] ??= { cells: {}, total: 0, onHand: 0, value: 0 });
    const col = shownIds.has(r.location_id) ? r.location_id : OTHER_COLUMN_ID;
    const qty = Number(r.qty);
    s.cells[col] = (s.cells[col] ?? 0) + qty;
    s.total += qty;
    s.onHand += Number(r.positive_qty);
    s.value += Number(r.stock_value);
  }
  const out: Record<string, ProductStockSummary> = {};
  for (const [productId, s] of Object.entries(acc)) {
    out[productId] = {
      cells: s.cells,
      total: s.total,
      avgUnitCost: s.onHand > 0 ? Math.round((s.value / s.onHand) * 100) / 100 : null,
    };
  }
  return out;
}

export function locationTotals(rows: { location_id: string; qty: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.location_id, Number(r.qty)]));
}
```

`_store/stockByLocation.ts`:

```ts
import { createTenantClient } from "@/lib/supabase/client";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationTotals, type StockByLocationRow } from "../_lib/stockByLocation";

/** The RPC refuses more ids than this (047 installer); callers pass one table page at a time. */
export const STOCK_RPC_MAX_IDS = 200;

export async function fetchStockByLocation(productIds: string[]): Promise<StockByLocationRow[]> {
  if (productIds.length === 0) return [];
  const supabase = await createTenantClient();
  const rows: StockByLocationRow[] = [];
  for (let i = 0; i < productIds.length; i += STOCK_RPC_MAX_IDS) {
    const { data, error } = await supabase.rpc("inventory_stock_by_location", {
      p_product_ids: productIds.slice(i, i + STOCK_RPC_MAX_IDS),
    });
    if (error) throw new Error(inventoryErrorMessage(error, "Could not load stock by location."));
    rows.push(...((data ?? []) as StockByLocationRow[]));
  }
  return rows;
}

/** One row per location (bounded by the tenant's location count). */
export async function fetchLocationStockTotals(): Promise<Record<string, number>> {
  const supabase = await createTenantClient();
  const { data, error } = await supabase.rpc("inventory_stock_by_location_totals");
  if (error) throw new Error(inventoryErrorMessage(error, "Could not load stock totals."));
  return locationTotals((data ?? []) as { location_id: string; qty: number }[]);
}
```

- [ ] **Step 4: Run — expect PASS:** `npx jest src/app/dashboard/inventory/_lib/stockByLocation.test.ts`

- [ ] **Step 5: Docs + commit** (inventory `CLAUDE.md` file map for both files)

```bash
git add src/app/dashboard/inventory
git commit -m "feat(inventory): stock-by-location pivot and RPC fetchers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Purchases — location and landed costs

**Files:**
- Create: `src/app/dashboard/purchases/_lib/purchaseInventoryFields.ts` (+ test)
- Create: `src/app/dashboard/purchases/_components/PurchaseInventoryFields.tsx`
- Modify: `src/app/dashboard/purchases/_components/AddPurchaseModal.tsx`, `EditPurchaseModal.tsx`

**Interfaces:**
- Consumes: `useAdvancedInventory` (Task 2); `platformLocationOptions`, `LOCATION_TYPE_LABELS` (`inventory/_lib/advancedInventory`); `landedUnitCost` (`inventory/_lib/landedCost`); `inventoryErrorMessage`.
- Produces: `PurchaseInventoryFieldsState { locationId: string; freight: string; customs: string; other: string }`; `emptyPurchaseInventoryFields()`; `purchaseInventoryFieldsFrom(p)`; `isPurchaseInventoryFieldsValid(s)`; `purchaseInventoryPayload(s): { location_id: string | null; freight_cost: number | null; customs_cost: number | null; other_cost: number | null }`; `hasLandedCosts(s)`; `parseLandedPreview(raw): number`; component `PurchaseInventoryFields({ value, onChange, locations, defaultLocationName, quantity, totalAmount, vatAmount, currency, disabled })`.

- [ ] **Step 1: Failing test** — `purchases/_lib/purchaseInventoryFields.test.ts`:

```ts
import {
  emptyPurchaseInventoryFields,
  purchaseInventoryFieldsFrom,
  isPurchaseInventoryFieldsValid,
  purchaseInventoryPayload,
  hasLandedCosts,
  parseLandedPreview,
} from "./purchaseInventoryFields";

describe("purchase inventory fields", () => {
  it("starts on the default location with no landed costs", () => {
    const s = emptyPurchaseInventoryFields();
    expect(s).toEqual({ locationId: "", freight: "", customs: "", other: "" });
    expect(hasLandedCosts(s)).toBe(false);
    expect(purchaseInventoryPayload(s)).toEqual({ location_id: null, freight_cost: null, customs_cost: null, other_cost: null });
  });

  it("round-trips an existing purchase", () => {
    const s = purchaseInventoryFieldsFrom({ location_id: "fba", freight_cost: 10, customs_cost: null, other_cost: 2.5 });
    expect(s).toEqual({ locationId: "fba", freight: "10", customs: "", other: "2.5" });
    expect(hasLandedCosts(s)).toBe(true);
  });

  it("treats missing fields on older purchases as empty", () => {
    expect(purchaseInventoryFieldsFrom({})).toEqual(emptyPurchaseInventoryFields());
  });

  it("parses costs to 2 decimals and rejects negatives or non-numbers", () => {
    const ok = { locationId: "main", freight: " 12.345 ", customs: "0", other: "" };
    expect(isPurchaseInventoryFieldsValid(ok)).toBe(true);
    expect(purchaseInventoryPayload(ok)).toEqual({ location_id: "main", freight_cost: 12.35, customs_cost: 0, other_cost: null });
    expect(isPurchaseInventoryFieldsValid({ ...ok, customs: "-1" })).toBe(false);
    expect(isPurchaseInventoryFieldsValid({ ...ok, other: "abc" })).toBe(false);
  });

  it("reads costs leniently for the live read-out", () => {
    expect(parseLandedPreview("2.5")).toBe(2.5);
    expect(parseLandedPreview("")).toBe(0);
    expect(parseLandedPreview("-1")).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/app/dashboard/purchases/_lib/purchaseInventoryFields.test.ts`

- [ ] **Step 3: Implement** — `purchases/_lib/purchaseInventoryFields.ts`:

```ts
import type { Purchase } from "@/types";

/** Advanced-inventory fields on a purchase form (Business plan, feature enabled). "" = default location. */
export interface PurchaseInventoryFieldsState {
  locationId: string;
  freight: string;
  customs: string;
  other: string;
}

export function emptyPurchaseInventoryFields(): PurchaseInventoryFieldsState {
  return { locationId: "", freight: "", customs: "", other: "" };
}

const toField = (n: number | null | undefined) => (n == null ? "" : String(n));

export function purchaseInventoryFieldsFrom(
  p: Partial<Pick<Purchase, "location_id" | "freight_cost" | "customs_cost" | "other_cost">>,
): PurchaseInventoryFieldsState {
  return {
    locationId: p.location_id ?? "",
    freight: toField(p.freight_cost),
    customs: toField(p.customs_cost),
    other: toField(p.other_cost),
  };
}

/** "" → null; a finite number ≥ 0 → rounded to 2 dp; anything else → undefined (invalid). */
function parseCost(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

export function isPurchaseInventoryFieldsValid(s: PurchaseInventoryFieldsState): boolean {
  return [s.freight, s.customs, s.other].every((v) => parseCost(v) !== undefined);
}

export function purchaseInventoryPayload(s: PurchaseInventoryFieldsState) {
  return {
    location_id: s.locationId || null,
    freight_cost: parseCost(s.freight) ?? null,
    customs_cost: parseCost(s.customs) ?? null,
    other_cost: parseCost(s.other) ?? null,
  };
}

export function hasLandedCosts(s: PurchaseInventoryFieldsState): boolean {
  return [s.freight, s.customs, s.other].some((v) => v.trim() !== "");
}

/** Lenient parse for the live read-out only: invalid or empty counts as 0. */
export function parseLandedPreview(raw: string): number {
  const n = parseCost(raw);
  return typeof n === "number" ? n : 0;
}
```

`purchases/_components/PurchaseInventoryFields.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field, Input, Row, Select } from "@/components/ui/FormFields";
import { LOCATION_TYPE_LABELS, platformLocationOptions } from "@/app/dashboard/inventory/_lib/advancedInventory";
import { landedUnitCost } from "@/app/dashboard/inventory/_lib/landedCost";
import { hasLandedCosts, parseLandedPreview, type PurchaseInventoryFieldsState } from "../_lib/purchaseInventoryFields";
import type { Currency, StockLocation } from "@/types";

interface Props {
  value: PurchaseInventoryFieldsState;
  onChange: (next: PurchaseInventoryFieldsState) => void;
  locations: StockLocation[];
  defaultLocationName: string | null;
  quantity: number;
  totalAmount: number;
  vatAmount: number;
  currency: Currency;
  disabled?: boolean;
}

export function PurchaseInventoryFields({
  value, onChange, locations, defaultLocationName, quantity, totalAmount, vatAmount, currency, disabled,
}: Props) {
  const [open, setOpen] = useState(() => hasLandedCosts(value));
  const set = (key: keyof PurchaseInventoryFieldsState, v: string) => onChange({ ...value, [key]: v });
  const preview = landedUnitCost({
    totalAmount,
    vatAmount,
    quantity,
    freightCost: parseLandedPreview(value.freight),
    customsCost: parseLandedPreview(value.customs),
    otherCost: parseLandedPreview(value.other),
  });

  return (
    <div className="space-y-3 rounded-(--radius-card) border border-(--color-border) p-4">
      <Field label="Location">
        <Select value={value.locationId} onChange={(e) => set("locationId", e.target.value)} disabled={disabled}>
          <option value="">Default location{defaultLocationName ? ` (${defaultLocationName})` : ""}</option>
          {platformLocationOptions(locations, value.locationId || null).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {LOCATION_TYPE_LABELS[l.type]}{l.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </Field>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-medium text-(--color-text-strong)"
      >
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} Landed costs
      </button>

      {open && (
        <>
          <Row>
            <Field label="Freight">
              <Input type="number" min="0" step="0.01" value={value.freight} onChange={(e) => set("freight", e.target.value)} placeholder="0.00" disabled={disabled} />
            </Field>
            <Field label="Customs / duty">
              <Input type="number" min="0" step="0.01" value={value.customs} onChange={(e) => set("customs", e.target.value)} placeholder="0.00" disabled={disabled} />
            </Field>
          </Row>
          <Field label="Other costs">
            <Input type="number" min="0" step="0.01" value={value.other} onChange={(e) => set("other", e.target.value)} placeholder="0.00" disabled={disabled} />
          </Field>
        </>
      )}

      {preview !== null && totalAmount > 0 && (
        <p className="text-xs text-(--color-text-muted)">
          Landed cost per unit (excl. VAT): <span className="font-semibold text-(--color-text-strong)">{currency} {preview.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire `AddPurchaseModal.tsx`:**
  - `const advanced = useAdvancedInventory();` (import from `@/app/dashboard/inventory/_store/useAdvancedInventory`), `const [inv, setInv] = useState(emptyPurchaseInventoryFields);`
  - `const tracksStock = advanced.active && (!!form.product_id || (form.add_to_inventory && isNewProductName));`
  - `const defaultLocationName = advanced.locations.find((l) => l.id === advanced.settings?.default_location_id)?.name ?? null;`
  - render `<PurchaseInventoryFields value={inv} onChange={setInv} locations={advanced.locations} defaultLocationName={defaultLocationName} quantity={qty} totalAmount={total} vatAmount={vatAmount} currency={form.currency} disabled={saving} />` right after the VAT block, only when `tracksStock`;
  - insert payload: spread `...(tracksStock ? purchaseInventoryPayload(inv) : {})`;
  - submit button: `disabled={saving || (tracksStock && !isPurchaseInventoryFieldsValid(inv))}`;
  - the purchase insert's error branch: `setError(inventoryErrorMessage(dbError, "Could not save the purchase."))`;
  - reset `inv` to `emptyPurchaseInventoryFields()` wherever the form resets (success and close).

- [ ] **Step 5: Wire `EditPurchaseModal.tsx`** — read it fully first. Same pattern with `useState(() => purchaseInventoryFieldsFrom(purchase))` (the modal is keyed per purchase — if it isn't, initialise when `purchase` changes the same way the modal initialises its other fields), `tracksStock = advanced.active && !!<the form's product id>`, spread the payload into the update, include the four new fields in the audit before/after diff the modal already builds, and map the update error with `inventoryErrorMessage(dbError, "Could not save the purchase.")` — this surfaces `INV_CONSUMED` ("…units from this batch are already sold…") when a consumed batch's quantity or location is changed.

- [ ] **Step 6: Run** `npx jest src/app/dashboard/purchases src/app/dashboard/inventory` — expect PASS. Manual-check list in the report (Business tenant, feature enabled): add a tracked purchase with freight → read-out shows landed cost; Starter tenant → no new fields and unchanged payload; edit a consumed batch's quantity below sold → readable INV_CONSUMED message.

- [ ] **Step 7: Docs + commit** — purchases `CLAUDE.md` (file map) and `SKILL.md` (gotcha: advanced fields only when `tracksStock`; `""` location = default; DB computes landed cost, the read-out is display-only).

```bash
git add src/app/dashboard/purchases
git commit -m "feat(purchases): location and landed costs on purchases (advanced inventory)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sales — "Fulfilled from" with shortage warning

**Files:**
- Create: `src/app/dashboard/sales/_components/fulfillmentLocation.ts` (+ test)
- Create: `src/app/dashboard/sales/_components/FulfillmentLocationField.tsx`
- Modify: `src/app/dashboard/sales/_components/AddSaleModal.tsx`, `EditSaleModal.tsx`

**Interfaces:**
- Consumes: `useAdvancedInventory`; `fetchStockByLocation` (Task 3); `platformLocationOptions`, `LOCATION_TYPE_LABELS`; `Badge`.
- Produces: `suggestedFulfillmentLocationId(platform, platformDefaults, locations, settings): string`; `type StockWarning = { kind: "short"; available: number } | { kind: "dropship" } | null`; `fulfillmentStockWarning(location, available, quantity): StockWarning`; `fulfillmentWarningText(warning, locationName): string`; component `FulfillmentLocationField({ productId, platform, quantity, value, touched, onChange, disabled })` with `onChange(locationId: string, touched: boolean)`.

- [ ] **Step 1: Failing test** — `sales/_components/fulfillmentLocation.test.ts`:

```ts
import { suggestedFulfillmentLocationId, fulfillmentStockWarning, fulfillmentWarningText } from "./fulfillmentLocation";
import type { InventorySettings, StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id, name: id.toUpperCase(), type: "own", is_active: true, created_by: null, created_at: "2026-09-26T00:00:00.000Z", ...overrides,
});
const settings: InventorySettings = { advanced_enabled: true, enabled_at: null, default_location_id: "main" };

describe("suggestedFulfillmentLocationId", () => {
  const locations = [loc("main"), loc("fba", { type: "fba" }), loc("old", { is_active: false })];

  it("uses the platform default when it is active", () => {
    expect(suggestedFulfillmentLocationId("amazon", [{ platform: "amazon", location_id: "fba" }], locations, settings)).toBe("fba");
  });

  it("falls back to the tenant default for an inactive or missing platform default", () => {
    expect(suggestedFulfillmentLocationId("ebay", [{ platform: "ebay", location_id: "old" }], locations, settings)).toBe("main");
    expect(suggestedFulfillmentLocationId("etsy", [], locations, settings)).toBe("main");
    expect(suggestedFulfillmentLocationId("etsy", [], locations, null)).toBe("");
  });
});

describe("fulfillmentStockWarning", () => {
  it("warns when the location has fewer units than ordered", () => {
    expect(fulfillmentStockWarning(loc("main"), 1, 3)).toEqual({ kind: "short", available: 1 });
    expect(fulfillmentStockWarning(loc("main"), -2, 1)).toEqual({ kind: "short", available: 0 });
  });

  it("is quiet when stock covers the order or stock is unknown", () => {
    expect(fulfillmentStockWarning(loc("main"), 5, 3)).toBeNull();
    expect(fulfillmentStockWarning(loc("main"), null, 3)).toBeNull();
    expect(fulfillmentStockWarning(undefined, 0, 3)).toBeNull();
  });

  it("explains dropship locations instead of counting stock", () => {
    expect(fulfillmentStockWarning(loc("ds", { type: "dropship" }), 0, 3)).toEqual({ kind: "dropship" });
  });
});

describe("fulfillmentWarningText", () => {
  it("words both warnings", () => {
    expect(fulfillmentWarningText({ kind: "short", available: 1 }, "Main")).toBe(
      "Only 1 in stock at Main. The order will still be saved; the missing units are costed at the last known price until stock arrives.",
    );
    expect(fulfillmentWarningText({ kind: "dropship" }, "Supplier")).toBe(
      "Supplier is a dropship supplier: no stock is taken, so link a purchase to record the cost of goods.",
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/app/dashboard/sales/_components/fulfillmentLocation.test.ts`

- [ ] **Step 3: Implement** — `sales/_components/fulfillmentLocation.ts`:

```ts
import type { InventorySettings, Platform, PlatformLocationDefault, StockLocation } from "@/types";

/**
 * The location a new order ships from unless the user picks another one.
 * Mirrors inv_sale_before_write (047): the platform default if that location
 * is active, else the tenant default.
 */
export function suggestedFulfillmentLocationId(
  platform: Platform,
  platformDefaults: PlatformLocationDefault[],
  locations: StockLocation[],
  settings: InventorySettings | null,
): string {
  const platformDefault = platformDefaults.find((d) => d.platform === platform)?.location_id;
  if (platformDefault && locations.some((l) => l.id === platformDefault && l.is_active)) return platformDefault;
  return settings?.default_location_id ?? "";
}

export type StockWarning = { kind: "short"; available: number } | { kind: "dropship" } | null;

export function fulfillmentStockWarning(
  location: StockLocation | undefined,
  available: number | null,
  quantity: number,
): StockWarning {
  if (!location) return null;
  if (location.type === "dropship") return { kind: "dropship" };
  if (available === null || available >= quantity) return null;
  return { kind: "short", available: Math.max(available, 0) };
}

export function fulfillmentWarningText(warning: Exclude<StockWarning, null>, locationName: string): string {
  if (warning.kind === "dropship") {
    return `${locationName} is a dropship supplier: no stock is taken, so link a purchase to record the cost of goods.`;
  }
  return `Only ${warning.available} in stock at ${locationName}. The order will still be saved; the missing units are costed at the last known price until stock arrives.`;
}
```

`sales/_components/FulfillmentLocationField.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Field, Select } from "@/components/ui/FormFields";
import { Badge } from "@/components/ui/Badge";
import { useAdvancedInventory } from "@/app/dashboard/inventory/_store/useAdvancedInventory";
import { fetchStockByLocation } from "@/app/dashboard/inventory/_store/stockByLocation";
import { LOCATION_TYPE_LABELS, platformLocationOptions } from "@/app/dashboard/inventory/_lib/advancedInventory";
import { fulfillmentStockWarning, fulfillmentWarningText, suggestedFulfillmentLocationId } from "./fulfillmentLocation";
import type { Platform } from "@/types";

interface Props {
  productId: string;
  platform: Platform;
  quantity: number;
  /** "" until a location is suggested or picked. */
  value: string;
  /** true once the user picked a location (or the order already had one) — suggestions stop overwriting it. */
  touched: boolean;
  onChange: (locationId: string, touched: boolean) => void;
  disabled?: boolean;
}

export function FulfillmentLocationField({ productId, platform, quantity, value, touched, onChange, disabled }: Props) {
  const { locations, platformDefaults, settings } = useAdvancedInventory();
  const [available, setAvailable] = useState<number | null>(null);

  // Follow the platform default until the user picks a location themselves.
  useEffect(() => {
    if (touched) return;
    const suggested = suggestedFulfillmentLocationId(platform, platformDefaults, locations, settings);
    if (suggested !== value) onChange(suggested, false);
  }, [platform, platformDefaults, locations, settings, touched, value, onChange]);

  // Units on hand at the chosen location, for the shortage warning.
  useEffect(() => {
    let cancelled = false;
    setAvailable(null);
    if (!productId || !value) return;
    fetchStockByLocation([productId])
      .then((rows) => {
        if (!cancelled) setAvailable(rows.find((r) => r.location_id === value)?.qty ?? 0);
      })
      .catch(() => {
        if (!cancelled) setAvailable(null); // warning is advisory; never block the form on it
      });
    return () => { cancelled = true; };
  }, [productId, value]);

  const location = locations.find((l) => l.id === value);
  const warning = fulfillmentStockWarning(location, available, quantity);

  return (
    <Field label="Fulfilled from">
      <Select value={value} onChange={(e) => onChange(e.target.value, true)} disabled={disabled}>
        <option value="">Default location</option>
        {platformLocationOptions(locations, value || null).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · {LOCATION_TYPE_LABELS[l.type]}{l.is_active ? "" : " (inactive)"}
          </option>
        ))}
      </Select>
      {warning && location && (
        <div className="mt-1 flex items-start gap-2" role="status">
          <Badge label={warning.kind === "dropship" ? "Dropship" : "Low stock"} variant="warning" />
          <p className="text-xs text-(--color-text-muted)">{fulfillmentWarningText(warning, location.name)}</p>
        </div>
      )}
    </Field>
  );
}
```

Callers must pass a stable `onChange` (`useCallback`), otherwise the suggestion effect re-runs every render.

- [ ] **Step 4: Wire `AddSaleModal.tsx`** — read it fully first.
  - `const advanced = useAdvancedInventory();` `const [fulfillment, setFulfillment] = useState({ id: "", touched: false });` `const onFulfillmentChange = useCallback((id: string, touched: boolean) => setFulfillment({ id, touched }), []);`
  - `const tracksStock = advanced.active && !!form.product_id;`
  - render `<FulfillmentLocationField productId={form.product_id} platform={form.platform} quantity={qty} value={fulfillment.id} touched={fulfillment.touched} onChange={onFulfillmentChange} disabled={saving} />` directly under the Platform/Date row, only when `tracksStock`;
  - insert payload: spread `...(tracksStock ? { fulfillment_location_id: fulfillment.id || null } : {})`;
  - the sale insert's error branch: `setError(inventoryErrorMessage(dbError, "Could not save the order."))`;
  - reset `fulfillment` to `{ id: "", touched: false }` wherever the form resets.

- [ ] **Step 5: Wire `EditSaleModal.tsx`** — read it fully first. Initial state `{ id: sale.fulfillment_location_id ?? "", touched: !!sale.fulfillment_location_id }`, same field and payload spread (`tracksStock = advanced.active && !!<form product id>`), include `fulfillment_location_id` in the audit before/after diff it builds, and map the update error with `inventoryErrorMessage(dbError, "Could not save the order.")`.

- [ ] **Step 6: Run** `npx jest src/app/dashboard/sales` — expect PASS. Manual-check list in the report: platform switch moves the suggestion until a manual pick; ordering more than on hand shows the Low stock warning but saves; a dropship location shows the dropship note; Starter tenant → unchanged form/payload.

- [ ] **Step 7: Docs + commit** — sales `CLAUDE.md` (file map) and `SKILL.md` (gotchas: suggestion mirrors the trigger incl. inactive defaults; pass a stable `onChange`; shortage is advisory; `cogs_amount` never sent).

```bash
git add src/app/dashboard/sales/_components
git commit -m "feat(sales): Fulfilled from location with shortage warning (advanced inventory)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Order page — FIFO cost of goods and "Fulfilled from"

**Files:**
- Modify: `src/app/dashboard/sales/_components/orderMath.ts` (+ `orderMath.test.ts`)
- Modify: `src/app/dashboard/sales/[id]/page.tsx`

**Interfaces:**
- Produces: `OrderCogs { amount: number; currency: Currency; source: "fifo" | "linked_purchase" }`; `resolveOrderCogs(sale: Pick<Sale, "cogs_amount" | "currency">, linkedPurchase: Pick<Purchase, "total_amount" | "currency"> | null): OrderCogs | null`; `grossProfitFromCogs(netProceeds: number, cogs: OrderCogs | null): number | null`.

- [ ] **Step 1: Failing test** — append to `orderMath.test.ts`:

```ts
import { resolveOrderCogs, grossProfitFromCogs } from "./orderMath";

describe("resolveOrderCogs", () => {
  const sale = { cogs_amount: null, currency: "EUR" as const };

  it("prefers FIFO cost of goods from the ledger", () => {
    expect(resolveOrderCogs({ ...sale, cogs_amount: 43.5 }, { total_amount: 99, currency: "EUR" })).toEqual({
      amount: 43.5, currency: "EUR", source: "fifo",
    });
  });

  it("treats a FIFO cost of 0 as real (e.g. restocked return)", () => {
    expect(resolveOrderCogs({ ...sale, cogs_amount: 0 }, null)?.amount).toBe(0);
  });

  it("falls back to a linked purchase in the same currency", () => {
    expect(resolveOrderCogs(sale, { total_amount: 12, currency: "EUR" })).toEqual({
      amount: 12, currency: "EUR", source: "linked_purchase",
    });
    expect(resolveOrderCogs(sale, { total_amount: 12, currency: "USD" })).toBeNull();
    expect(resolveOrderCogs(sale, null)).toBeNull();
  });
});

describe("grossProfitFromCogs", () => {
  it("subtracts the cost of goods, or is null without one", () => {
    expect(grossProfitFromCogs(100, { amount: 43.5, currency: "EUR", source: "fifo" })).toBe(56.5);
    expect(grossProfitFromCogs(100, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/app/dashboard/sales/_components/orderMath.test.ts`

- [ ] **Step 3: Implement** — append to `orderMath.ts` (keep `computeGrossProfit` for existing callers):

```ts
export interface OrderCogs {
  amount: number;
  currency: Currency;
  source: "fifo" | "linked_purchase";
}

/**
 * Cost of goods for the order page: the FIFO amount the ledger booked
 * (sales.cogs_amount, advanced inventory) wins; otherwise a linked purchase
 * in the order's currency (mixed currencies would be meaningless); else none.
 */
export function resolveOrderCogs(
  sale: Pick<Sale, "cogs_amount" | "currency">,
  linkedPurchase: Pick<Purchase, "total_amount" | "currency"> | null,
): OrderCogs | null {
  if (sale.cogs_amount != null) return { amount: sale.cogs_amount, currency: sale.currency, source: "fifo" };
  if (linkedPurchase && linkedPurchase.currency === sale.currency) {
    return { amount: linkedPurchase.total_amount, currency: sale.currency, source: "linked_purchase" };
  }
  return null;
}

export function grossProfitFromCogs(netProceeds: number, cogs: OrderCogs | null): number | null {
  return cogs ? netProceeds - cogs.amount : null;
}
```

(add `Currency` to the file's type import).

- [ ] **Step 4: Page** — in `sales/[id]/page.tsx`:
  - `const cogs = resolveOrderCogs(sale, linkedPurchase);` `const grossProfit = grossProfitFromCogs(netProceeds, cogs);` — replace the old `computeGrossProfit`/`hasCurrencyMatch` use for this card;
  - render the Cost of Goods / Gross Profit block when `cogs` is non-null; label `cogs.source === "fifo" ? "Cost of Goods (FIFO)" : "Cost of Goods"`, amount `−formatCurrency(cogs.amount, cogs.currency)`; keep the "View purchase record →" link only when `cogs.source === "linked_purchase"`;
  - `const advanced = useAdvancedInventory();` and, in the card that shows the order's details (next to Platform/Status — read the page to find it), when `advanced.active && sale.fulfillment_location_id`, add a row "Fulfilled from" with the location name (`advanced.locations.find(...)?.name ?? "Unknown location"`), using the same row classes as its neighbours.

- [ ] **Step 5: Run** `npx jest src/app/dashboard/sales` — expect PASS. Manual check in report: an order with FIFO COGS shows "Cost of Goods (FIFO)"; a dropship order with a linked purchase still shows the old row and link.

- [ ] **Step 6: Docs + commit** — sales `CLAUDE.md` (order page data flow) and `SKILL.md` (COGS precedence; known limit: FIFO COGS is in the purchases' currency — mixed-currency ledgers aren't converted).

```bash
git add src/app/dashboard/sales
git commit -m "feat(sales): FIFO cost of goods and fulfilled-from on the order page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Products tab — stock per location, total, average cost

**Files:**
- Modify: `src/app/dashboard/inventory/_components/ProductsTab.tsx`

**Interfaces:**
- Consumes: `useAdvancedInventory`; `stockColumns`, `summarizeStock`, `OTHER_COLUMN_ID`, `type ProductStockSummary` (Task 3); `fetchStockByLocation`.
- Produces: in the active view, the "Current Stock" column is replaced by one column per `stockColumns(locations)` entry, then "Total", then "Avg. cost"; other views unchanged.

- [ ] **Step 1: Implement** — in `ProductsTab.tsx`:

```tsx
  const advanced = useAdvancedInventory();
  const [stock, setStock] = useState<Record<string, ProductStockSummary>>({});
  const [stockError, setStockError] = useState<string | null>(null);
  const columnsForStock = useMemo(() => stockColumns(advanced.locations), [advanced.locations]);
  const pageIds = useMemo(() => products.map((p) => p.id).join(","), [products]);

  useEffect(() => {
    if (!advanced.active || pageIds === "") { setStock({}); return; }
    let cancelled = false;
    setStockError(null);
    fetchStockByLocation(pageIds.split(","))
      .then((rows) => { if (!cancelled) setStock(summarizeStock(rows, columnsForStock)); })
      .catch((e: Error) => { if (!cancelled) setStockError(e.message); });
    return () => { cancelled = true; };
  }, [advanced.active, pageIds, columnsForStock]);
```

Build the columns: when `advanced.active`, drop the "Current Stock" column object and insert, in its place,

```tsx
    ...columnsForStock.map((c) => ({
      header: c.label,
      sortValue: (p: Product) => stock[p.id]?.cells[c.id] ?? 0,
      render: (p: Product) => <StockCell qty={stock[p.id]?.cells[c.id] ?? 0} />,
    })),
    {
      header: "Total",
      sortValue: (p: Product) => stock[p.id]?.total ?? 0,
      render: (p: Product) => <StockCell qty={stock[p.id]?.total ?? 0} strong />,
    },
    {
      header: "Avg. cost",
      sortValue: (p: Product) => stock[p.id]?.avgUnitCost ?? -1,
      render: (p: Product) => (
        <span className="text-sm text-(--color-text-muted) tabular-nums">
          {stock[p.id]?.avgUnitCost != null ? stock[p.id]!.avgUnitCost!.toFixed(2) : "—"}
        </span>
      ),
    },
```

with a local component in the same file:

```tsx
function StockCell({ qty, strong }: { qty: number; strong?: boolean }) {
  const tone = qty < 0 ? "text-(--color-danger-text)" : "text-(--color-text-base)";
  return <span className={`text-sm tabular-nums ${strong ? "font-semibold" : ""} ${tone}`}>{qty}</span>;
}
```

and, under the table's count row, when `stockError`: `<p className="mb-2 text-xs text-(--color-danger-text)">{stockError}</p>`. Keep the low-stock Status badge as is (legacy `current_stock`); `DataTable` keeps its `emptyMessage`.

- [ ] **Step 2: Run** `npx jest src/app/dashboard/inventory` — expect PASS. Manual check in report: active tenant shows per-location columns + Other/Total/Avg. cost; a shortfall shows a red negative number; Starter tenant sees the old "Current Stock" column.

- [ ] **Step 3: Docs + commit** — inventory `CLAUDE.md` (ProductsTab data flow: per-page RPC call) and `SKILL.md` (Total = ledger lots, may differ from legacy `current_stock` by pre-enable edits; the Status badge still uses `current_stock`).

```bash
git add src/app/dashboard/inventory
git commit -m "feat(inventory): stock per location, total and average cost on the Products tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Product batches modal + opening-cost edit

**Files:**
- Create: `src/app/dashboard/inventory/_lib/productLots.ts` (+ test)
- Create: `src/app/dashboard/inventory/_store/productLots.ts`
- Create: `src/app/dashboard/inventory/_components/ProductLotsModal.tsx`
- Modify: `src/app/dashboard/inventory/_components/ProductsTab.tsx`

**Interfaces:**
- Consumes: `fetchAllRowsOrThrow` (Task 2); RPC `set_opening_lot_cost(p_lot_id uuid, p_unit_cost numeric)` (Phase 1, admin-only); `useAdvancedInventory`; `inventoryErrorMessage`.
- Produces: `lotSourceLabel(lot): string`; `lotReceivedLabel(lot): string`; `sortLotsFifo(lots): StockLot[]`; `canEditLotCost(lot, isAdmin): boolean`; `parseUnitCostInput(raw): number | null`; `PRODUCT_LOTS_CAP = 1000`; `fetchOpenLots(productId): Promise<StockLot[]>`; `ProductLotsModal({ product, isAdmin, onClose })`.

- [ ] **Step 1: Failing test** — `_lib/productLots.test.ts`:

```ts
import { lotSourceLabel, lotReceivedLabel, sortLotsFifo, canEditLotCost, parseUnitCostInput } from "./productLots";
import type { StockLot } from "@/types";

const lot = (id: string, overrides: Partial<StockLot> = {}): StockLot => ({
  id, product_id: "p", location_id: "main", purchase_id: null, source_lot_id: null, kind: "purchase",
  received_at: "2026-09-20T00:00:00.000Z", cost_addon: 0, unit_cost: 10, qty_received: 5, qty_remaining: 5,
  created_at: "2026-09-20T10:00:00.000Z", ...overrides,
});

describe("product lots", () => {
  it("labels each kind of batch", () => {
    expect(lotSourceLabel(lot("a"))).toBe("Purchase");
    expect(lotSourceLabel(lot("a", { kind: "opening" }))).toBe("Opening balance");
    expect(lotSourceLabel(lot("a", { kind: "transfer" }))).toBe("Transferred in");
    expect(lotSourceLabel(lot("a", { kind: "shortfall" }))).toBe("Shortfall (awaiting stock)");
  });

  it("shows the received date, but not the 1970 placeholder of opening batches", () => {
    expect(lotReceivedLabel(lot("a"))).toBe("2026-09-20");
    expect(lotReceivedLabel(lot("a", { kind: "opening", received_at: "1970-01-01T00:00:00.000Z" }))).toBe("Before tracking");
  });

  it("sorts oldest first like the ledger's FIFO", () => {
    const sorted = sortLotsFifo([
      lot("late", { received_at: "2026-09-21T00:00:00.000Z" }),
      lot("b", { created_at: "2026-09-20T11:00:00.000Z" }),
      lot("a"),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b", "late"]);
  });

  it("lets admins edit only opening-balance costs", () => {
    expect(canEditLotCost(lot("a", { kind: "opening" }), true)).toBe(true);
    expect(canEditLotCost(lot("a", { kind: "opening" }), false)).toBe(false);
    expect(canEditLotCost(lot("a"), true)).toBe(false);
  });

  it("parses a unit cost to 4 decimals", () => {
    expect(parseUnitCostInput(" 2.12345 ")).toBe(2.1235);
    expect(parseUnitCostInput("0")).toBe(0);
    expect(parseUnitCostInput("")).toBeNull();
    expect(parseUnitCostInput("-1")).toBeNull();
    expect(parseUnitCostInput("x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx jest src/app/dashboard/inventory/_lib/productLots.test.ts`

- [ ] **Step 3: Implement** — `_lib/productLots.ts`:

```ts
import type { StockLot } from "@/types";

const SOURCE_LABELS: Record<StockLot["kind"], string> = {
  purchase: "Purchase",
  opening: "Opening balance",
  transfer: "Transferred in",
  shortfall: "Shortfall (awaiting stock)",
};

export function lotSourceLabel(lot: StockLot): string {
  return SOURCE_LABELS[lot.kind];
}

/** Opening batches carry a 1970 FIFO placeholder date — don't show it as a real date. */
export function lotReceivedLabel(lot: StockLot): string {
  return lot.kind === "opening" ? "Before tracking" : lot.received_at.slice(0, 10);
}

/** Same order as the ledger's FIFO: received_at, then created_at, then id. */
export function sortLotsFifo(lots: StockLot[]): StockLot[] {
  return [...lots].sort(
    (a, b) =>
      a.received_at.localeCompare(b.received_at) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Mirrors set_opening_lot_cost (047): admins, opening batches only. */
export function canEditLotCost(lot: StockLot, isAdmin: boolean): boolean {
  return isAdmin && lot.kind === "opening";
}

export function parseUnitCostInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10000) / 10000;
}
```

`_store/productLots.ts`:

```ts
import { createTenantClient } from "@/lib/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/utils/fetchAllRows";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import type { StockLot } from "@/types";

/** One product's open batches grow with its purchase history, so read them with fetchAllRowsOrThrow. */
export const PRODUCT_LOTS_CAP = 1000;

/** Batches with units left (or a shortfall) for one product, oldest first. */
export async function fetchOpenLots(productId: string): Promise<StockLot[]> {
  const supabase = await createTenantClient();
  try {
    return await fetchAllRowsOrThrow<StockLot>(
      (from, to) =>
        supabase
          .from("stock_lots")
          .select("*", { count: "exact" })
          .eq("product_id", productId)
          .neq("qty_remaining", 0)
          .order("received_at", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, to),
      PRODUCT_LOTS_CAP,
    );
  } catch (e) {
    throw new Error(inventoryErrorMessage(e, "Could not load this product's batches."));
  }
}
```

`_components/ProductLotsModal.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { useAdvancedInventory } from "../_store/useAdvancedInventory";
import { fetchOpenLots } from "../_store/productLots";
import { canEditLotCost, lotReceivedLabel, lotSourceLabel, parseUnitCostInput, sortLotsFifo } from "../_lib/productLots";
import type { Product, StockLot } from "@/types";

const FORM_ID = "opening-cost-form";

interface Props {
  product: Product | null;
  isAdmin: boolean;
  onClose: () => void;
}

export function ProductLotsModal({ product, isAdmin, onClose }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { locations } = useAdvancedInventory();
  const [lots, setLots] = useState<StockLot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockLot | null>(null);
  const [costInput, setCostInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (productId: string) => {
    setLoadError(null);
    try {
      setLots(sortLotsFifo(await fetchOpenLots(productId)));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setLots(null);
    setEditing(null);
    if (product) load(product.id);
  }, [product, load]);

  const parsedCost = parseUnitCostInput(costInput);

  async function handleSaveCost(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !product || parsedCost === null) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { error } = await supabase.rpc("set_opening_lot_cost", { p_lot_id: editing.id, p_unit_cost: parsedCost });
      if (error) {
        toastError("Cost not saved", inventoryErrorMessage(error, "Could not change the opening cost."));
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "update",
            entityType: "product",
            entityId: product.id,
            metadata: { event: "opening_cost_changed", lot_id: editing.id, before: editing.unit_cost, after: parsedCost },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // audit is best-effort; the cost is already saved
      }
      success("Opening cost saved", "Orders that used these units were re-costed.");
      setEditing(null);
      await load(product.id);
    } catch {
      toastError("Cost not saved", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";

  const columns = [
    { header: "Batch", render: (l: StockLot) => <span className="text-sm text-(--color-text-base)">{lotSourceLabel(l)}</span> },
    { header: "Location", render: (l: StockLot) => <span className="text-sm text-(--color-text-base)">{locationName(l.location_id)}</span> },
    { header: "Received", render: (l: StockLot) => <span className="text-sm text-(--color-text-muted)">{lotReceivedLabel(l)}</span> },
    {
      header: "Remaining",
      render: (l: StockLot) =>
        l.kind === "shortfall" ? (
          <Badge label={`${l.qty_remaining}`} variant="danger" />
        ) : (
          <span className="text-sm tabular-nums text-(--color-text-base)">{l.qty_remaining}</span>
        ),
    },
    {
      header: "Unit cost",
      render: (l: StockLot) => (
        <span className="flex items-center gap-1">
          <span className="text-sm tabular-nums text-(--color-text-base)">{Number(l.unit_cost).toFixed(2)}</span>
          {canEditLotCost(l, isAdmin) && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => { setEditing(l); setCostInput(String(l.unit_cost)); }}
              title="Edit opening cost"
              aria-label="Edit opening cost"
            >
              <Pencil size={14} />
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Modal
      title={product ? `Batches · ${product.name}` : "Batches"}
      open={!!product}
      onClose={() => { if (!saving) onClose(); }}
      footer={
        editing ? (
          <>
            <Button variant="secondary" type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" form={FORM_ID} disabled={saving || parsedCost === null}>
              {saving ? "Saving…" : "Save cost"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
        )
      }
    >
      {loadError && <p className="mb-3 text-sm text-(--color-danger-text)">{loadError}</p>}
      {lots === null && !loadError ? (
        <p className="flex items-center gap-2 text-sm text-(--color-text-muted)">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading batches…
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={lots ?? []}
          keyField="id"
          emptyMessage="No batches with stock left — record a purchase to add one."
        />
      )}

      {editing && (
        <form id={FORM_ID} onSubmit={handleSaveCost} className="mt-4 space-y-2">
          <Field label="Opening unit cost" required>
            <Input type="number" min="0" step="0.0001" value={costInput} onChange={(e) => setCostInput(e.target.value)} required />
          </Field>
          <p className="text-xs text-(--color-text-muted)">
            Orders and transfers that used these units are re-costed automatically.
          </p>
        </form>
      )}
    </Modal>
  );
}
```

Before writing, confirm `DataTable`'s column contract (e.g. whether `sortValue` is required) and adapt.

- [ ] **Step 4: Open it from `ProductsTab.tsx`** — `const [lotsProduct, setLotsProduct] = useState<Product | null>(null);`; in the active view render the Product name cell as

```tsx
<button
  type="button"
  onClick={() => setLotsProduct(p)}
  className="text-left text-sm font-medium text-(--color-primary) hover:underline"
  aria-label={`Show batches for ${p.name}`}
>
  {p.name}
</button>
```

(non-active views keep today's plain span), and render `<ProductLotsModal product={lotsProduct} isAdmin={isAdmin} onClose={() => setLotsProduct(null)} />` where `isAdmin` is `role === "admin" || role === "super_admin"` from `state.currentUser.profile?.role`.

- [ ] **Step 5: Run** `npx jest src/app/dashboard/inventory` — expect PASS. Manual check in report: click a product → batches oldest first; shortfall shows a red badge; admin edits an opening cost → toast, list reloads with the new cost; non-admin sees no pencil.

- [ ] **Step 6: Docs + commit** — inventory `CLAUDE.md` (file map) + `SKILL.md` (gotchas: only open lots are listed; opening-cost edits re-cost dependent orders server-side).

```bash
git add src/app/dashboard/inventory
git commit -m "feat(inventory): product batches modal with opening-cost editing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Locations tab — on-hand units

**Files:**
- Modify: `src/app/dashboard/inventory/_components/LocationsTab.tsx`

**Interfaces:**
- Consumes: `fetchLocationStockTotals` (Task 3).

- [ ] **Step 1: Implement** — in `LocationsTab.tsx` add `const [onHand, setOnHand] = useState<Record<string, number> | null>(null);` and an effect that loads totals on mount and whenever the locations list changes (`locations.map((l) => l.id).join(",")` as the dependency), ignoring stale responses with a `cancelled` flag; on error keep `null` and render `—`. Add a column after "Type":

```tsx
    {
      header: "On hand",
      sortValue: (l: StockLocation) => onHand?.[l.id] ?? 0,
      render: (l: StockLocation) =>
        l.type === "dropship" ? (
          <span className="text-sm text-(--color-text-muted)">—</span>
        ) : (
          <span className={`text-sm tabular-nums ${(onHand?.[l.id] ?? 0) < 0 ? "text-(--color-danger-text)" : "text-(--color-text-base)"}`}>
            {onHand ? onHand[l.id] ?? 0 : "—"}
          </span>
        ),
    },
```

- [ ] **Step 2: Run** `npx jest src/app/dashboard/inventory` — expect PASS. Manual check in report: Main shows its units; a dropship location shows "—".

- [ ] **Step 3: Docs + commit** — inventory `CLAUDE.md` (LocationsTab entry).

```bash
git add src/app/dashboard/inventory
git commit -m "feat(inventory): on-hand units per location on the Locations tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs reconcile

**Files:** `src/app/dashboard/{inventory,purchases,sales}/{CLAUDE,SKILL}.md`, `supabase/SKILL.md`, the spec.

- [ ] **Step 1:** Read each file fully; merge rather than append; remove anything now wrong (e.g. "the slice is only loaded by the Inventory page", "on-hand units column moves to Phase 3", "Phase 3 follow-ups" lists that this phase closed). Every name mentioned must exist (grep).
- [ ] **Step 2:** Spec "Phasing": "Phase 3 status: implemented per `docs/superpowers/plans/2026-09-26-advanced-inventory-phase-3-purchases-sales.md`, including the per-location stock columns and on-hand units moved from Phase 2, error-reporting loads with a 60s freshness window, and a trigger guard that skips inactive platform defaults."
- [ ] **Step 3:** `supabase/SKILL.md` — the `049` row states apply order (re-run 047, then 049) and whether the SQL suite has passed (the controller fills this in after the user's run).
- [ ] **Step 4:** Run `npx jest src/app/dashboard/inventory src/app/dashboard/purchases src/app/dashboard/sales src/lib` — expect PASS.
- [ ] **Step 5:** Commit

```bash
git add src/app/dashboard supabase/SKILL.md docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
git commit -m "docs(inventory): phase 3 — purchases, sales and stock by location

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Phase 3)

| Spec requirement | Task |
| --- | --- |
| Purchases: location select (default, dropship allowed) + collapsible landed costs + live read-out | 4 |
| Sales: "Fulfilled from" pre-filled from platform default, non-blocking shortage warning | 5 |
| Order page: Cost of goods (FIFO) + gross profit, linked-purchase fallback | 6 |
| Products: per-location columns (first 4 active + Other), total, weighted average cost via `inventory_stock_by_location` | 1, 3, 7 |
| Product lots drawer (oldest first, source, location, received, remaining, cost, shortfall badge) + opening-cost edit | 8 |
| Locations: on-hand units | 1, 3, 9 |
| Phase 2 follow-ups: error-reporting loads, refresh policy, inactive platform-default guard | 1, 2 |
| Transfers tab + modal | **Phase 4** |
