# Advanced Inventory — Phase 1 (Ledger, Triggers, Enable Route) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the database side of Business-plan batches/locations/fulfillment — tables, FIFO triggers, RPCs, SQL tests, the enable route and the pure TS helpers later phases build on — with no user-visible UI.

**Architecture:** One idempotent installer, `public.install_advanced_inventory(schema_name)`, defined in `047_advanced_inventory.sql`, creates every table/policy/function/trigger in a tenant schema. `048_advanced_inventory_apply.sql` runs it on every existing tenant via `run_on_all_tenant_schemas`, and `provision_tenant_schema()` calls it for new tenants (the 2-places rule, satisfied by calling one shared installer instead of duplicating ~600 lines of SQL). All ledger triggers are no-ops until `inventory_settings.advanced_enabled` is flipped by `POST /api/inventory/enable-advanced`.

**Tech Stack:** Postgres (Supabase Project B, plpgsql), Next.js route handler, TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md`

**Scope:** This is Phase 1 of 4 (spec → "Phasing"). Phases 2–4 (Locations UI + enable flow, Purchases/Sales UI, Transfers UI) get their own plans after this merges, because they consume the exact names this plan settles.

## Global Constraints

- Branch: `feat/advanced-inventory` (already created, spec committed there). Never commit to `main`.
- Tenant DDL only via `run_on_all_tenant_schemas` + `provision_tenant_schema()`; never hardcode `tenant_kaufnest`.
- Never query `public.*` tables from app code; control-plane client is server-only.
- Plans: `advancedInventory` is `true` for `business` and `trial`, `false` for `starter` and `pro`.
- Landed unit cost = `((total_amount − coalesce(vat_amount,0)) + freight + customs + other) / quantity`, rounded to 4 dp — identical in SQL (`inv_landed_unit_cost`) and TS (`landedUnitCost`).
- FIFO key: `received_at`, then `created_at`, then `id`. Opening lots use `received_at = 1970-01-01T00:00:00Z`.
- Sale consumes stock iff `product_id` set AND location set AND location `type <> 'dropship'` AND `quantity > 0` AND NOT (`status = 'returned'` AND `restock`) — same rule as the legacy `apply_sale_stock_change`.
- `sales.cogs_amount` is written only by triggers (guarded by the transaction-local GUC `inv.writing_cogs`).
- Rows created before `enabled_at` are ignored by the ledger on UPDATE/DELETE.
- Trigger error messages: `'<CODE>: <user-safe detail>'`, `ERRCODE = 'P0001'`. Codes: `INV_CONSUMED`, `INV_INSUFFICIENT`, `INV_DROPSHIP_LOCATION`, `INV_TRANSFER_IMMUTABLE`, `INV_LOCATION_IN_USE`, `INV_DEFAULT_LOCATION`, `INV_NOT_ENABLED`, `INV_FORBIDDEN`, `INV_NOT_OPENING`, `INV_INVALID_COST`.
- **Inside any `format($sql$ … $sql$, schema_name)` string, never write a literal `%`** (format() would consume it). Build messages with `||`; no `LIKE '…%'` inside those strings.
- Live DB (Project B, via `mcp__supabase-data__execute_sql`): **ask the user before the first call in each task that touches it.** Defining `public.install_advanced_inventory` is harmless (touches no tenant); running `048` touches every tenant and needs explicit approval.
- Working agreement: don't start the dev server or curl routes; run focused `npx jest <path>`; don't run `tsc`/`lint` by hand (pre-commit does). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing the route handler, read `node_modules/next/dist/docs/` route-handler guide (this Next.js version has breaking changes).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types/index.ts` (modify) | `StockLocation`, `StockLot`, `StockTransfer`, `InventorySettings` types; optional new `Purchase`/`Sale` fields; 2 new `AuditEntity` values |
| `src/lib/utils/planGating.ts` (+ test) | `advancedInventory` flag + `hasAdvancedInventory()` |
| `src/lib/inventory/inventoryErrors.ts` (+ test) | Parse `INV_*` trigger errors → user-safe copy (pure; client- and server-safe) |
| `src/lib/inventory/access.ts` (+ test) | `canEnableAdvancedInventory(plan, role)` (pure) |
| `src/lib/inventory/authGuard.ts` | `requireAdvancedInventoryAdmin()` — server-only route guard |
| `src/app/api/inventory/enable-advanced/route.ts` | `POST` → guard → service-role RPC `enable_advanced_inventory` |
| `src/app/dashboard/inventory/_lib/landedCost.ts` (+ test) | TS mirror of the landed-cost formula for later UI |
| `supabase/migrations/047_advanced_inventory.sql` | Defines `public.install_advanced_inventory(text)` — the whole tenant-side feature |
| `supabase/migrations/048_advanced_inventory_apply.sql` | Runs the installer on every existing tenant |
| `supabase/migrations/005_tenant_provisioning.sql` (modify) | `PERFORM public.install_advanced_inventory(schema_name);` at the end |
| `supabase/tests/advanced_inventory.test.sql` | One `DO` block: throwaway schema, assertions, ends with `RAISE EXCEPTION 'INV_TESTS_PASSED'` (rolls everything back) |
| `.claude/verifiers/rules.py` (modify) | Add `requireAdvancedInventoryAdmin` to the route-auth markers |
| Docs (modify) | `supabase/SKILL.md`, `src/app/dashboard/inventory/{CLAUDE,SKILL}.md`, `AGENTS.md`, `.claude/verifiers/README.md`, spec file-name fix |

### How to run the SQL tests (used by Tasks 4–7)

1. `mcp__supabase-data__execute_sql` with the **entire** contents of `supabase/migrations/047_advanced_inventory.sql` (only (re)defines `public.install_advanced_inventory`; touches no tenant). Expected: success, no rows.
2. `mcp__supabase-data__execute_sql` with the **entire** contents of `supabase/tests/advanced_inventory.test.sql`. Expected: **an error whose message is exactly `INV_TESTS_PASSED`**. That error is the pass signal — it rolls back the throwaway schema. Any `FAIL …` message is a failing assertion; any other error is a bug.

First call in Task 4: confirm the MCP server is Project B by running `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY 1;` — it must list tenant schemas (e.g. `tenant_kaufnest`). If it doesn't, stop and ask the user.

---

### Task 1: Types and plan flag

**Files:**
- Modify: `src/types/index.ts` (Purchase ~L94-117, Sale ~L119+, after `Product` ~L196, `AuditEntity` ~L210)
- Modify: `src/lib/utils/planGating.ts`
- Test: `src/lib/utils/planGating.test.ts`

**Interfaces:**
- Produces: `hasAdvancedInventory(plan: TenantPlan): boolean`; types `StockLocationType`, `StockLocation`, `InventorySettings`, `StockLotKind`, `StockLot`, `StockTransfer`; optional `Purchase.location_id/freight_cost/customs_cost/other_cost`, `Sale.fulfillment_location_id/cogs_amount`; `AuditEntity` gains `"stock_location" | "stock_transfer"`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/utils/planGating.test.ts` and add `hasAdvancedInventory` to its import list:

```ts
describe("hasAdvancedInventory", () => {
  it("is true for business and for trial (trial mirrors business)", () => {
    expect(hasAdvancedInventory("business")).toBe(true);
    expect(hasAdvancedInventory("trial")).toBe(true);
  });

  it("is false for pro and starter", () => {
    expect(hasAdvancedInventory("pro")).toBe(false);
    expect(hasAdvancedInventory("starter")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`hasAdvancedInventory` is not exported)

Run: `npx jest src/lib/utils/planGating.test.ts`

- [ ] **Step 3: Implement** — in `planGating.ts` add to `PlanLimits`:

```ts
  // Batches, locations and FIFO cost of goods (advanced inventory) —
  // Business only. The ledger itself is switched on per tenant by
  // /api/inventory/enable-advanced; this gate decides who may switch it on
  // and who sees the UI.
  advancedInventory: boolean;
```

set it in each `PLAN_LIMITS` row (`trial: true`, `starter: false`, `pro: false`, `business: true` — append `advancedInventory: <value>` after `messagingAndListings` in each row), and export:

```ts
export function hasAdvancedInventory(plan: TenantPlan): boolean {
  return PLAN_LIMITS[plan].advancedInventory;
}
```

- [ ] **Step 4: Add the types** — in `src/types/index.ts`:

Append to `interface Purchase` (after `fx_rate_date`):

```ts
  // Advanced inventory (migration 047). Optional: Starter/Pro tenants never
  // send them, and the DB fills location_id from inventory_settings when
  // advanced inventory is on. Landed unit cost =
  // (total_amount − vat_amount + freight + customs + other) / quantity.
  location_id?: string | null;
  freight_cost?: number | null;
  customs_cost?: number | null;
  other_cost?: number | null;
```

Append to `interface Sale` (last fields):

```ts
  // Advanced inventory (migration 047). fulfillment_location_id is filled
  // from the platform default by a DB trigger when omitted. cogs_amount is
  // written ONLY by the FIFO trigger — never send it (the trigger discards
  // client-supplied values).
  fulfillment_location_id?: string | null;
  cogs_amount?: number | null;
```

After `interface Product`:

```ts
// ─── Advanced inventory (Business plan) ───────────────────────────────────────
// Batches (lots), locations and transfers — see
// docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md.
// stock_lots / stock_movements / inventory_settings are written only by
// Postgres triggers and RPCs; the client writes stock_locations,
// platform_location_defaults and stock_transfers.

export type StockLocationType = "own" | "fba" | "3pl" | "dropship";

export interface StockLocation {
  id: string;
  name: string;
  type: StockLocationType;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InventorySettings {
  advanced_enabled: boolean;
  enabled_at: string | null;
  default_location_id: string | null;
}

export type StockLotKind = "purchase" | "opening" | "transfer" | "shortfall";

export interface StockLot {
  id: string;
  product_id: string;
  location_id: string;
  purchase_id: string | null;
  source_lot_id: string | null;
  kind: StockLotKind;
  received_at: string;
  cost_addon: number;
  unit_cost: number;
  qty_received: number;
  qty_remaining: number; // negative only when kind === "shortfall"
  created_at: string;
}

export interface StockTransfer {
  id: string;
  product_id: string;
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  transfer_cost: number | null;
  date: string;
  note: string | null;
  created_by: string;
  created_at: string;
}
```

Change `AuditEntity` to:

```ts
export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product" | "message" | "shipment" | "stock_location" | "stock_transfer";
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx jest src/lib/utils/planGating.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/utils/planGating.ts src/lib/utils/planGating.test.ts
git commit -m "feat(inventory): advanced-inventory types and Business plan flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the pre-commit `tsc` reports an exhaustive `switch`/`Record` over `AuditEntity` (none found at plan time), add a label for the two new values there and re-run the same commit.

---

### Task 2: Inventory error parser

**Files:**
- Create: `src/lib/inventory/inventoryErrors.ts`
- Test: `src/lib/inventory/inventoryErrors.test.ts`

**Interfaces:**
- Produces: `INVENTORY_ERROR_CODES` (readonly tuple), `type InventoryErrorCode`, `parseInventoryError(message: unknown): { code: InventoryErrorCode; detail: string } | null`, `inventoryErrorMessage(err: unknown, fallback?: string): string`, `INVENTORY_ERROR_FALLBACK: string`.

- [ ] **Step 1: Write the failing test** — `src/lib/inventory/inventoryErrors.test.ts`:

```ts
import {
  INVENTORY_ERROR_FALLBACK,
  inventoryErrorMessage,
  parseInventoryError,
} from "./inventoryErrors";

describe("parseInventoryError", () => {
  it("parses a trigger-raised message into code and detail", () => {
    expect(parseInventoryError("INV_CONSUMED: 11 of 12 units from this batch are already sold")).toEqual({
      code: "INV_CONSUMED",
      detail: "11 of 12 units from this batch are already sold",
    });
  });

  it("returns null for an unknown INV_ code", () => {
    expect(parseInventoryError("INV_MADE_UP: nope")).toBeNull();
  });

  it("returns null for raw Postgres errors and non-strings", () => {
    expect(parseInventoryError('duplicate key value violates unique constraint "x"')).toBeNull();
    expect(parseInventoryError(undefined)).toBeNull();
    expect(parseInventoryError(42)).toBeNull();
  });
});

describe("inventoryErrorMessage", () => {
  it("returns the trigger detail for a Supabase error object", () => {
    const err = { message: "INV_INSUFFICIENT: Only 3 units are available at the source location", code: "P0001" };
    expect(inventoryErrorMessage(err)).toBe("Only 3 units are available at the source location");
  });

  it("accepts an Error instance and a bare string", () => {
    expect(inventoryErrorMessage(new Error("INV_FORBIDDEN: Only admins can change inventory settings"))).toBe(
      "Only admins can change inventory settings",
    );
    expect(inventoryErrorMessage("INV_NOT_ENABLED: Batches and locations are not enabled for this account")).toBe(
      "Batches and locations are not enabled for this account",
    );
  });

  it("never leaks a raw database message", () => {
    expect(inventoryErrorMessage({ message: 'relation "stock_lots" does not exist' })).toBe(INVENTORY_ERROR_FALLBACK);
    expect(inventoryErrorMessage(null)).toBe(INVENTORY_ERROR_FALLBACK);
  });

  it("uses a caller-supplied fallback", () => {
    expect(inventoryErrorMessage({ message: "boom" }, "Could not save the transfer.")).toBe("Could not save the transfer.");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx jest src/lib/inventory/inventoryErrors.test.ts`

- [ ] **Step 3: Implement** — `src/lib/inventory/inventoryErrors.ts`:

```ts
/**
 * Advanced-inventory triggers and RPCs (supabase/migrations/047) raise
 * `'<INV_CODE>: <detail>'`. The detail text is authored in that migration
 * and is user-safe by contract, so it is shown as-is; anything that does
 * not parse as a known code is a raw database error and is replaced by a
 * generic message — raw Postgres errors never reach the UI.
 *
 * Pure: safe to import from Client Components and route handlers alike.
 */
export const INVENTORY_ERROR_CODES = [
  "INV_CONSUMED",
  "INV_INSUFFICIENT",
  "INV_DROPSHIP_LOCATION",
  "INV_TRANSFER_IMMUTABLE",
  "INV_LOCATION_IN_USE",
  "INV_DEFAULT_LOCATION",
  "INV_NOT_ENABLED",
  "INV_FORBIDDEN",
  "INV_NOT_OPENING",
  "INV_INVALID_COST",
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

export const INVENTORY_ERROR_FALLBACK = "Something went wrong while updating inventory. Please try again.";

const PATTERN = /^(INV_[A-Z_]+):\s*([\s\S]+)$/;

export function parseInventoryError(message: unknown): { code: InventoryErrorCode; detail: string } | null {
  if (typeof message !== "string") return null;
  const match = PATTERN.exec(message.trim());
  if (!match) return null;
  const code = match[1];
  if (!(INVENTORY_ERROR_CODES as readonly string[]).includes(code)) return null;
  return { code: code as InventoryErrorCode, detail: match[2].trim() };
}

export function inventoryErrorMessage(err: unknown, fallback: string = INVENTORY_ERROR_FALLBACK): string {
  const message =
    typeof err === "string"
      ? err
      : err !== null && typeof err === "object" && "message" in err
        ? (err as { message: unknown }).message
        : null;
  return parseInventoryError(message)?.detail ?? fallback;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest src/lib/inventory/inventoryErrors.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/inventoryErrors.ts src/lib/inventory/inventoryErrors.test.ts
git commit -m "feat(inventory): parse INV_* trigger errors into user-safe copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Landed-cost helper (TS mirror of the SQL formula)

**Files:**
- Create: `src/app/dashboard/inventory/_lib/landedCost.ts`
- Test: `src/app/dashboard/inventory/_lib/landedCost.test.ts`

**Interfaces:**
- Produces: `interface LandedCostInput { totalAmount: number; vatAmount?: number | null; quantity: number; freightCost?: number | null; customsCost?: number | null; otherCost?: number | null }`, `landedUnitCost(input: LandedCostInput): number | null`.

- [ ] **Step 1: Write the failing test** — `landedCost.test.ts`:

```ts
import { landedUnitCost } from "./landedCost";

describe("landedUnitCost", () => {
  it("excludes VAT and adds freight, customs and other costs", () => {
    // (121 − 21 + 10 + 5 + 5) / 10 — same case as the SQL test
    expect(
      landedUnitCost({ totalAmount: 121, vatAmount: 21, quantity: 10, freightCost: 10, customsCost: 5, otherCost: 5 }),
    ).toBe(12);
  });

  it("treats missing VAT and extras as zero", () => {
    expect(landedUnitCost({ totalAmount: 100, quantity: 10 })).toBe(10);
    expect(landedUnitCost({ totalAmount: 100, vatAmount: null, quantity: 10, freightCost: null })).toBe(10);
  });

  it("rounds to 4 decimals like numeric(14,4)", () => {
    expect(landedUnitCost({ totalAmount: 10, quantity: 3 })).toBe(3.3333);
  });

  it("returns null when quantity is not positive", () => {
    expect(landedUnitCost({ totalAmount: 10, quantity: 0 })).toBeNull();
    expect(landedUnitCost({ totalAmount: 10, quantity: -2 })).toBeNull();
    expect(landedUnitCost({ totalAmount: 10, quantity: Number.NaN })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx jest src/app/dashboard/inventory/_lib/landedCost.test.ts`

- [ ] **Step 3: Implement** — `landedCost.ts`:

```ts
export interface LandedCostInput {
  totalAmount: number; // gross purchase total, VAT included
  vatAmount?: number | null;
  quantity: number;
  freightCost?: number | null;
  customsCost?: number | null;
  otherCost?: number | null;
}

/**
 * Landed unit cost of a purchase batch. MUST stay identical to
 * `inv_landed_unit_cost()` in supabase/migrations/047_advanced_inventory.sql —
 * the database is the source of truth for stored costs; this mirror only
 * powers the live read-out in the purchase form. VAT is excluded because it
 * is normally reclaimable, so it is not part of the cost of goods.
 */
export function landedUnitCost(input: LandedCostInput): number | null {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const net = input.totalAmount - (input.vatAmount ?? 0);
  const extras = (input.freightCost ?? 0) + (input.customsCost ?? 0) + (input.otherCost ?? 0);
  return Math.round(((net + extras) / input.quantity) * 10000) / 10000;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest src/app/dashboard/inventory/_lib/landedCost.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/inventory/_lib/landedCost.ts src/app/dashboard/inventory/_lib/landedCost.test.ts
git commit -m "feat(inventory): landed unit cost helper mirroring the SQL formula

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Installer skeleton — tables, RLS, grants

**Files:**
- Create: `supabase/migrations/047_advanced_inventory.sql`
- Create: `supabase/tests/advanced_inventory.test.sql`

**Interfaces:**
- Produces: `public.install_advanced_inventory(schema_name text) RETURNS void`; tenant tables `stock_locations`, `inventory_settings` (singleton row, `id = true`), `platform_location_defaults`, `stock_lots`, `stock_transfers`, `stock_movements`; columns `purchases.location_id/freight_cost/customs_cost/other_cost`, `sales.fulfillment_location_id/cogs_amount`. Marker comments `-- @@ SECTION 3 @@`, `-- @@ SECTION 4 @@`, `-- @@ SECTION 5 @@`, `-- @@ RPC GRANTS @@` in the installer and `-- @@ NEXT SECTION @@` in the test file, which later tasks replace.

- [ ] **Step 1: Write the failing test** — `supabase/tests/advanced_inventory.test.sql`:

```sql
-- supabase/tests/advanced_inventory.test.sql
-- ============================================================
-- Advanced inventory trigger tests. ONE DO block against a throwaway
-- schema (tenant_zz_invtest). It ends by raising INV_TESTS_PASSED, which
-- rolls EVERYTHING back — schema included — so it is safe to run against
-- the live Project B database.
--
-- Expected result: an error whose message is exactly 'INV_TESTS_PASSED'.
-- 'FAIL …' = a failing assertion. Anything else = a bug.
--
-- Prerequisite: supabase/migrations/047_advanced_inventory.sql executed
-- (it only defines public.install_advanced_inventory; no tenant touched).
-- Sections are cumulative — later sections rely on state from earlier ones.
-- ============================================================
DO $test$
DECLARE
  v_uid   uuid := gen_random_uuid();
  v_prod  uuid;  -- "Widget"
  v_prod2 uuid;  -- "Gadget" (pre-enable history)
  v_main  uuid;
  v_fba   uuid;
  v_drop  uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_ptmp uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_sd uuid; v_sa uuid; v_sg uuid;
  v_t1 uuid;
  v_lot uuid;
  v_num numeric;
  v_int integer;
  v_txt text;
BEGIN
  PERFORM public.provision_tenant_schema('tenant_zz_invtest');
  PERFORM public.install_advanced_inventory('tenant_zz_invtest');
  PERFORM set_config('search_path', 'tenant_zz_invtest, public', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_schema', 'tenant_zz_invtest'))::text, true);
  INSERT INTO profiles (id, email, role) VALUES (v_uid, 'inv-test@example.invalid', 'admin');

  -- ── Section: schema (Task 4) ──────────────────────────────
  SELECT count(*) INTO v_int FROM inventory_settings;
  IF v_int <> 1 THEN RAISE EXCEPTION 'FAIL schema: expected 1 settings row, got %', v_int; END IF;
  IF (SELECT advanced_enabled FROM inventory_settings) THEN
    RAISE EXCEPTION 'FAIL schema: advanced_enabled should default to false';
  END IF;
  PERFORM location_id, freight_cost, customs_cost, other_cost FROM purchases LIMIT 0;
  PERFORM fulfillment_location_id, cogs_amount FROM sales LIMIT 0;
  BEGIN
    INSERT INTO stock_locations (name, type) VALUES ('Bogus', 'moon');
    RAISE EXCEPTION 'FAIL schema: bogus location type accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'tenant_zz_invtest.stock_lots'::regclass) THEN
    RAISE EXCEPTION 'FAIL schema: RLS not enabled on stock_lots';
  END IF;
  IF has_table_privilege('authenticated', 'tenant_zz_invtest.stock_lots', 'INSERT')
     OR has_table_privilege('authenticated', 'tenant_zz_invtest.stock_movements', 'UPDATE')
     OR has_table_privilege('authenticated', 'tenant_zz_invtest.inventory_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL schema: clients can write ledger tables';
  END IF;
  IF NOT has_table_privilege('authenticated', 'tenant_zz_invtest.stock_transfers', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL schema: clients cannot insert transfers';
  END IF;
  PERFORM public.install_advanced_inventory('tenant_zz_invtest'); -- idempotent re-run

  -- @@ NEXT SECTION @@

  RAISE EXCEPTION 'INV_TESTS_PASSED';
END
$test$;
```

- [ ] **Step 2: Ask the user** for approval to run SQL against Project B (defining a `public` function + a rolled-back test). On approval, confirm it's Project B (see "How to run the SQL tests"), then run the test file alone. Expected: FAIL with `function public.install_advanced_inventory(unknown) does not exist`.

- [ ] **Step 3: Implement** — `supabase/migrations/047_advanced_inventory.sql`:

```sql
-- supabase/migrations/047_advanced_inventory.sql
-- ============================================================
-- Advanced inventory (Business plan): batches, locations, FIFO cost of
-- goods and stock transfers. Design:
-- docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
--
-- This file ONLY defines public.install_advanced_inventory(schema_name),
-- an idempotent installer that creates every table, policy, function and
-- trigger of the feature inside ONE tenant schema. It touches no tenant by
-- itself. Two callers (the "2 places" rule, via one shared installer
-- instead of duplicating this SQL into 005):
--   * 048_advanced_inventory_apply.sql — every existing tenant_% schema
--   * provision_tenant_schema() (005)  — every new tenant
--
-- Everything is inert until inventory_settings.advanced_enabled = true
-- (flipped by enable_advanced_inventory(), called from
-- POST /api/inventory/enable-advanced). The legacy current_stock triggers
-- (apply_purchase_stock_change / apply_sale_stock_change) are untouched and
-- keep running for every plan.
--
-- RULE for editing: inside format($sql$ … $sql$, schema_name) strings never
-- write a literal percent sign — format() consumes it. Build messages with ||.
-- ============================================================

CREATE OR REPLACE FUNCTION public.install_advanced_inventory(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $inst$
DECLARE
  fn record;
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  -- ── 1. Tables and columns ─────────────────────────────────
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.stock_locations (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL CHECK (length(btrim(name)) > 0),
      type       text NOT NULL CHECK (type IN ('own', 'fba', '3pl', 'dropship')),
      is_active  boolean NOT NULL DEFAULT true,
      created_by uuid REFERENCES %1$I.profiles(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_name_key
      ON %1$I.stock_locations (lower(name));

    CREATE TABLE IF NOT EXISTS %1$I.inventory_settings (
      id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
      advanced_enabled    boolean NOT NULL DEFAULT false,
      enabled_at          timestamptz,
      default_location_id uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT
    );
    INSERT INTO %1$I.inventory_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS %1$I.platform_location_defaults (
      platform    text PRIMARY KEY
                    CHECK (platform IN ('amazon', 'ebay', 'etsy', 'shopify', 'other')),
      location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT
    );

    ALTER TABLE %1$I.purchases
      ADD COLUMN IF NOT EXISTS location_id  uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS freight_cost numeric(12,2) CHECK (freight_cost >= 0),
      ADD COLUMN IF NOT EXISTS customs_cost numeric(12,2) CHECK (customs_cost >= 0),
      ADD COLUMN IF NOT EXISTS other_cost   numeric(12,2) CHECK (other_cost >= 0);

    ALTER TABLE %1$I.sales
      ADD COLUMN IF NOT EXISTS fulfillment_location_id uuid REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS cogs_amount numeric(12,2);

    CREATE TABLE IF NOT EXISTS %1$I.stock_lots (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id    uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      location_id   uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      purchase_id   uuid REFERENCES %1$I.purchases(id),
      source_lot_id uuid REFERENCES %1$I.stock_lots(id) ON DELETE CASCADE,
      kind          text NOT NULL CHECK (kind IN ('purchase', 'opening', 'transfer', 'shortfall')),
      received_at   timestamptz NOT NULL,
      cost_addon    numeric(14,4) NOT NULL DEFAULT 0,
      unit_cost     numeric(14,4) NOT NULL,
      qty_received  integer NOT NULL,
      qty_remaining integer NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (kind = 'shortfall' OR qty_remaining >= 0),
      CHECK (kind <> 'shortfall' OR qty_remaining <= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_lots_fifo
      ON %1$I.stock_lots (product_id, location_id, received_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS stock_lots_one_shortfall
      ON %1$I.stock_lots (product_id, location_id) WHERE kind = 'shortfall';
    CREATE INDEX IF NOT EXISTS idx_stock_lots_purchase ON %1$I.stock_lots (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_stock_lots_source ON %1$I.stock_lots (source_lot_id);

    CREATE TABLE IF NOT EXISTS %1$I.stock_transfers (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id       uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      from_location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      to_location_id   uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      quantity         integer NOT NULL CHECK (quantity > 0),
      transfer_cost    numeric(12,2) CHECK (transfer_cost >= 0),
      date             date NOT NULL,
      note             text,
      created_by       uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at       timestamptz NOT NULL DEFAULT now(),
      CHECK (from_location_id <> to_location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_date ON %1$I.stock_transfers (date DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS %1$I.stock_movements (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id  uuid NOT NULL REFERENCES %1$I.products(id) ON DELETE CASCADE,
      location_id uuid NOT NULL REFERENCES %1$I.stock_locations(id) ON DELETE RESTRICT,
      lot_id      uuid NOT NULL REFERENCES %1$I.stock_lots(id) ON DELETE CASCADE,
      kind        text NOT NULL
                    CHECK (kind IN ('receipt', 'opening', 'sale', 'transfer_out', 'transfer_in')),
      qty         integer NOT NULL,
      unit_cost   numeric(14,4) NOT NULL,
      sale_id     uuid REFERENCES %1$I.sales(id) ON DELETE CASCADE,
      purchase_id uuid REFERENCES %1$I.purchases(id) ON DELETE CASCADE,
      transfer_id uuid REFERENCES %1$I.stock_transfers(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((kind = 'sale') = (sale_id IS NOT NULL)),
      CHECK ((kind = 'receipt') = (purchase_id IS NOT NULL)),
      CHECK ((kind IN ('transfer_out', 'transfer_in')) = (transfer_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_lot ON %1$I.stock_movements (lot_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_sale ON %1$I.stock_movements (sale_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_transfer ON %1$I.stock_movements (transfer_id);
  $sql$, schema_name);

  -- ── 2. RLS and privileges ─────────────────────────────────
  -- Ledger tables (settings, lots, movements) are SELECT-only for clients:
  -- only SECURITY DEFINER triggers/RPCs write them. Locations and platform
  -- defaults are admin-only writes; transfers are any tenant member (same
  -- bar as purchases). The REVOKEs must run after table creation so they
  -- override the schema's ALTER DEFAULT PRIVILEGES blanket grant.
  EXECUTE format($sql$
    ALTER TABLE %1$I.stock_locations            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.inventory_settings         ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.platform_location_defaults ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_lots                 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_transfers            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE %1$I.stock_movements            ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "stock_locations_select" ON %1$I.stock_locations;
    CREATE POLICY "stock_locations_select" ON %1$I.stock_locations
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "stock_locations_write_admin" ON %1$I.stock_locations;
    CREATE POLICY "stock_locations_write_admin" ON %1$I.stock_locations
      FOR ALL
      USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'))
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'));

    DROP POLICY IF EXISTS "platform_location_defaults_select" ON %1$I.platform_location_defaults;
    CREATE POLICY "platform_location_defaults_select" ON %1$I.platform_location_defaults
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "platform_location_defaults_write_admin" ON %1$I.platform_location_defaults;
    CREATE POLICY "platform_location_defaults_write_admin" ON %1$I.platform_location_defaults
      FOR ALL
      USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'))
      WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN ('admin', 'super_admin'));

    DROP POLICY IF EXISTS "inventory_settings_select" ON %1$I.inventory_settings;
    CREATE POLICY "inventory_settings_select" ON %1$I.inventory_settings
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_lots_select" ON %1$I.stock_lots;
    CREATE POLICY "stock_lots_select" ON %1$I.stock_lots
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_movements_select" ON %1$I.stock_movements;
    CREATE POLICY "stock_movements_select" ON %1$I.stock_movements
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "stock_transfers_select" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_select" ON %1$I.stock_transfers
      FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = 'authenticated');
    DROP POLICY IF EXISTS "stock_transfers_insert" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_insert" ON %1$I.stock_transfers
      FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND created_by = auth.uid());
    DROP POLICY IF EXISTS "stock_transfers_delete" ON %1$I.stock_transfers;
    CREATE POLICY "stock_transfers_delete" ON %1$I.stock_transfers
      FOR DELETE USING (%1$I.is_tenant_member());

    GRANT SELECT ON %1$I.inventory_settings, %1$I.stock_lots, %1$I.stock_movements TO authenticated;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON %1$I.inventory_settings, %1$I.stock_lots, %1$I.stock_movements FROM anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON %1$I.stock_locations, %1$I.platform_location_defaults TO authenticated;
    GRANT SELECT, INSERT, DELETE ON %1$I.stock_transfers TO authenticated;
    REVOKE UPDATE, TRUNCATE ON %1$I.stock_transfers FROM anon, authenticated;
  $sql$, schema_name);

  -- @@ SECTION 3 @@

  -- @@ SECTION 4 @@

  -- @@ SECTION 5 @@

  -- ── Lock down EXECUTE on every function this installer owns ──
  -- Tenant schemas are exposed through PostgREST, so any function in them
  -- is callable as an RPC unless EXECUTE is revoked. Trigger functions do
  -- not need EXECUTE to fire; helpers are only called from SECURITY DEFINER
  -- code. The three public RPCs are re-granted below.
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = schema_name
      AND (p.proname LIKE 'inv\_%'
           OR p.proname IN ('enable_advanced_inventory', 'set_default_location', 'set_opening_lot_cost'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;

  -- @@ RPC GRANTS @@
END;
$inst$;

COMMENT ON FUNCTION public.install_advanced_inventory(text) IS
  'Idempotently installs advanced inventory (batches/locations/FIFO) into one tenant schema. See 047_advanced_inventory.sql.';
```

- [ ] **Step 4: Run the SQL tests — expect PASS** (both calls from "How to run the SQL tests"; second call errors with exactly `INV_TESTS_PASSED`). If `provision_tenant_schema` itself errors, stop and report to the user (the live function may be stale — `supabase/SKILL.md` tracks 005 re-apply status).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_advanced_inventory.sql supabase/tests/advanced_inventory.test.sql
git commit -m "feat(inventory): advanced inventory installer — tables, RLS, grants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ledger helpers, purchase triggers, enable RPC

**Files:**
- Modify: `supabase/migrations/047_advanced_inventory.sql` (replace `-- @@ SECTION 3 @@`; add a line under `-- @@ RPC GRANTS @@`)
- Modify: `supabase/tests/advanced_inventory.test.sql` (insert before `-- @@ NEXT SECTION @@`)

**Interfaces:**
- Consumes: Task 4 tables.
- Produces (tenant schema, all `SET search_path = <schema>`):
  - `inv_raise(p_code text, p_detail text)` — raises `'<code>: <detail>'`
  - `inv_lock(p_product uuid, p_location uuid)` — xact advisory lock
  - `inv_location_holds_stock(p_location uuid) → boolean`
  - `inv_last_unit_cost(p_product uuid) → numeric`
  - `inv_set_cogs(p_sale uuid, p_value numeric)`, `inv_recompute_cogs(p_sale_ids uuid[])` — only writers of `sales.cogs_amount` (set GUC `inv.writing_cogs`)
  - `inv_settle_shortfall(p_lot uuid)` — fill the location's shortfall from a new positive lot, re-point sale movements, recompute COGS
  - `inv_recost_lot(p_lot uuid, p_cost numeric)` — set lot cost, cascade to transfer-derived lots, movements, COGS
  - `inv_landed_unit_cost(p purchases) → numeric`, `inv_purchase_should_have_lot(p purchases) → boolean`, `inv_create_purchase_lot(p purchases)`, `inv_drop_purchase_lot(p_purchase uuid)`
  - triggers `inv_purchase_before_write` (BEFORE INSERT/UPDATE), `inv_purchase_after_write` (AFTER INSERT/UPDATE), `inv_purchase_before_delete` (BEFORE DELETE)
  - RPC `enable_advanced_inventory() → void` (EXECUTE granted to `service_role` only)

- [ ] **Step 1: Write the failing test** — insert above `-- @@ NEXT SECTION @@`:

```sql
  -- ── Section: purchases + enable (Task 5) ──────────────────
  -- Pre-enable history, backdated so it counts as "before enabled_at".
  INSERT INTO products (name, created_by) VALUES ('Widget', v_uid) RETURNING id INTO v_prod;
  INSERT INTO products (name, created_by) VALUES ('Gadget', v_uid) RETURNING id INTO v_prod2;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('Widget', v_prod, 5, 2, 10, current_date - 10, v_uid, now() - interval '1 day') RETURNING id INTO v_p1;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('Gadget', v_prod2, 4, 5, 20, current_date - 10, v_uid, now() - interval '1 day');
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by, created_at)
    VALUES ('ebay', 'Gadget', v_prod2, 1, 9, 9, current_date - 9, v_uid, now() - interval '1 day') RETURNING id INTO v_sg;

  IF EXISTS (SELECT 1 FROM stock_lots) OR EXISTS (SELECT 1 FROM stock_movements) THEN
    RAISE EXCEPTION 'FAIL purchases: ledger written while flag off';
  END IF;

  PERFORM enable_advanced_inventory();
  SELECT default_location_id INTO v_main FROM inventory_settings;
  IF v_main IS NULL OR NOT (SELECT advanced_enabled FROM inventory_settings) THEN
    RAISE EXCEPTION 'FAIL enable: flag or default location not set';
  END IF;
  SELECT count(*) INTO v_int FROM platform_location_defaults WHERE location_id = v_main;
  IF v_int <> 5 THEN RAISE EXCEPTION 'FAIL enable: expected 5 platform defaults, got %', v_int; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod AND kind = 'opening';
  IF v_int IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL enable: Widget opening lot should be 5, got %', v_int; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod2 AND kind = 'opening';
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL enable: Gadget opening lot should be 3, got %', v_int; END IF;
  PERFORM enable_advanced_inventory(); -- idempotent
  SELECT count(*) INTO v_int FROM stock_lots WHERE kind = 'opening';
  IF v_int <> 2 THEN RAISE EXCEPTION 'FAIL enable: re-enable duplicated opening lots (% lots)', v_int; END IF;

  -- New purchase: location defaults to Main; landed = (121 − 21 + 10 + 5 + 5) / 10 = 12
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, vat_amount,
                         freight_cost, customs_cost, other_cost, date, created_by)
    VALUES ('Widget', v_prod, 10, 12.10, 121, 21, 10, 5, 5, current_date - 5, v_uid) RETURNING id INTO v_p2;
  IF (SELECT location_id FROM purchases WHERE id = v_p2) IS DISTINCT FROM v_main THEN
    RAISE EXCEPTION 'FAIL purchases: location not defaulted to Main';
  END IF;
  SELECT unit_cost INTO v_num FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase';
  IF v_num IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'FAIL purchases: landed cost expected 12, got %', v_num; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE purchase_id = v_p2 AND kind = 'receipt' AND qty = 10) THEN
    RAISE EXCEPTION 'FAIL purchases: receipt movement missing';
  END IF;

  -- Cost-only edit re-costs: (100 + 20 + 5 + 5) / 10 = 13
  UPDATE purchases SET freight_cost = 20 WHERE id = v_p2;
  SELECT unit_cost INTO v_num FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase';
  IF v_num IS DISTINCT FROM 13 THEN RAISE EXCEPTION 'FAIL purchases: re-cost expected 13, got %', v_num; END IF;

  -- Quantity edit: 12 units, net 120 + 30 extras = 150 / 12 = 12.5
  UPDATE purchases SET quantity = 12, total_amount = 145.20, vat_amount = 25.20 WHERE id = v_p2;
  IF (SELECT qty_received FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12
     OR (SELECT unit_cost FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12.5 THEN
    RAISE EXCEPTION 'FAIL purchases: quantity edit not applied to lot';
  END IF;

  -- Dropship purchase: no lot (and it stays — the Task 7 totals rely on it)
  INSERT INTO stock_locations (name, type) VALUES ('Supplier DS', 'dropship') RETURNING id INTO v_drop;
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by, location_id)
    VALUES ('Widget', v_prod, 2, 7, 14, current_date - 3, v_uid, v_drop) RETURNING id INTO v_p3;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE purchase_id = v_p3) THEN
    RAISE EXCEPTION 'FAIL purchases: dropship purchase created a lot';
  END IF;

  -- Unconsumed purchase can be deleted; its lot goes with it
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('Widget', v_prod, 3, 1, 3, current_date - 2, v_uid) RETURNING id INTO v_ptmp;
  DELETE FROM purchases WHERE id = v_ptmp;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE purchase_id = v_ptmp) THEN
    RAISE EXCEPTION 'FAIL purchases: deleted purchase left a lot behind';
  END IF;

  -- Pre-enable purchase edit is ignored by the ledger
  UPDATE purchases SET quantity = 6, total_amount = 30 WHERE product_id = v_prod2 AND created_at < now();
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_prod2 AND kind = 'purchase') THEN
    RAISE EXCEPTION 'FAIL purchases: pre-enable purchase edit created a lot';
  END IF;

  -- Internal functions are not callable by clients; enable is service_role only
  IF has_function_privilege('authenticated', 'tenant_zz_invtest.inv_raise(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'tenant_zz_invtest.enable_advanced_inventory()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: clients can execute internal functions';
  END IF;
  IF NOT has_function_privilege('service_role', 'tenant_zz_invtest.enable_advanced_inventory()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: service_role cannot enable';
  END IF;

```

- [ ] **Step 2: Run the SQL tests — expect FAIL** with `function enable_advanced_inventory() does not exist`.

- [ ] **Step 3: Implement** — replace `-- @@ SECTION 3 @@` in `047_advanced_inventory.sql` with:

```sql
  -- ── 3a. Ledger helpers ────────────────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inv_raise(p_code text, p_detail text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_code || ': ' || p_detail;
    END;
    $func$;

    -- Serialises every ledger write for one (product, location): two synced
    -- orders for the same SKU cannot consume the same units.
    CREATE OR REPLACE FUNCTION %1$I.inv_lock(p_product uuid, p_location uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(p_product::text || ':' || p_location::text, 0));
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_location_holds_stock(p_location uuid)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN coalesce((SELECT type <> 'dropship' FROM stock_locations WHERE id = p_location), false);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_last_unit_cost(p_product uuid)
    RETURNS numeric
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN coalesce((
        SELECT unit_cost FROM stock_lots
        WHERE product_id = p_product AND kind <> 'shortfall'
        ORDER BY received_at DESC, created_at DESC
        LIMIT 1), 0);
    END;
    $func$;

    -- The only two writers of sales.cogs_amount. inv_sale_before_write
    -- discards any cogs_amount change made while inv.writing_cogs is off.
    CREATE OR REPLACE FUNCTION %1$I.inv_set_cogs(p_sale uuid, p_value numeric)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      PERFORM set_config('inv.writing_cogs', 'on', true);
      UPDATE sales SET cogs_amount = p_value
        WHERE id = p_sale AND cogs_amount IS DISTINCT FROM p_value;
      PERFORM set_config('inv.writing_cogs', 'off', true);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_recompute_cogs(p_sale_ids uuid[])
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF p_sale_ids IS NULL OR cardinality(p_sale_ids) = 0 THEN
        RETURN;
      END IF;
      PERFORM set_config('inv.writing_cogs', 'on', true);
      UPDATE sales s
        SET cogs_amount = (
          SELECT round(coalesce(sum(-m.qty * m.unit_cost), 0), 2)
          FROM stock_movements m
          WHERE m.sale_id = s.id)
        WHERE s.id = ANY (p_sale_ids);
      PERFORM set_config('inv.writing_cogs', 'off', true);
    END;
    $func$;

    -- A new positive lot at a location first fills that location's
    -- shortfall: the oldest short sale movements are re-pointed to the new
    -- lot at its real cost and their orders' COGS recomputed. Invariant:
    -- a (product, location) never has both a shortfall and positive stock.
    CREATE OR REPLACE FUNCTION %1$I.inv_settle_shortfall(p_lot uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot  stock_lots;
      v_sf   stock_lots;
      m      record;
      v_take integer;
      v_q    integer;
      v_sale_ids uuid[] := '{}';
    BEGIN
      SELECT * INTO v_lot FROM stock_lots WHERE id = p_lot;
      IF NOT FOUND OR v_lot.kind = 'shortfall' OR v_lot.qty_remaining <= 0 THEN
        RETURN;
      END IF;
      PERFORM inv_lock(v_lot.product_id, v_lot.location_id);
      SELECT * INTO v_sf FROM stock_lots
        WHERE product_id = v_lot.product_id AND location_id = v_lot.location_id AND kind = 'shortfall'
        FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      v_take := least(-v_sf.qty_remaining, v_lot.qty_remaining);
      IF v_take <= 0 THEN
        RETURN;
      END IF;
      UPDATE stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = v_lot.id;
      UPDATE stock_lots SET qty_remaining = qty_remaining + v_take WHERE id = v_sf.id;
      FOR m IN SELECT * FROM stock_movements WHERE lot_id = v_sf.id ORDER BY created_at, id LOOP
        EXIT WHEN v_take = 0;
        v_q := least(-m.qty, v_take);
        IF v_q = -m.qty THEN
          UPDATE stock_movements SET lot_id = v_lot.id, unit_cost = v_lot.unit_cost WHERE id = m.id;
        ELSE
          UPDATE stock_movements SET qty = qty + v_q WHERE id = m.id;
          INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
            VALUES (m.product_id, m.location_id, v_lot.id, 'sale', -v_q, v_lot.unit_cost, m.sale_id);
        END IF;
        v_take := v_take - v_q;
        v_sale_ids := array_append(v_sale_ids, m.sale_id);
      END LOOP;
      DELETE FROM stock_lots WHERE id = v_sf.id AND qty_remaining = 0;
      PERFORM inv_recompute_cogs(v_sale_ids);
    END;
    $func$;

    -- Set a lot's unit cost and cascade it: its movements, every lot
    -- transferred out of it (keeping each one's transfer-cost share in
    -- cost_addon), and the COGS of every sale that drew from any of them.
    CREATE OR REPLACE FUNCTION %1$I.inv_recost_lot(p_lot uuid, p_cost numeric)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_cost numeric := round(p_cost, 4);
      v_sale_ids uuid[];
      c record;
    BEGIN
      UPDATE stock_lots SET unit_cost = v_cost WHERE id = p_lot;
      UPDATE stock_movements SET unit_cost = v_cost WHERE lot_id = p_lot;
      SELECT array_agg(DISTINCT sale_id) INTO v_sale_ids
        FROM stock_movements WHERE lot_id = p_lot AND sale_id IS NOT NULL;
      PERFORM inv_recompute_cogs(v_sale_ids);
      FOR c IN SELECT id, cost_addon FROM stock_lots WHERE source_lot_id = p_lot LOOP
        PERFORM inv_recost_lot(c.id, v_cost + c.cost_addon);
      END LOOP;
    END;
    $func$;
  $sql$, schema_name);

  -- ── 3b. Purchases → lots ──────────────────────────────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inv_landed_unit_cost(p %1$I.purchases)
    RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      -- Mirrored by src/app/dashboard/inventory/_lib/landedCost.ts.
      RETURN round(
        ((p.total_amount - coalesce(p.vat_amount, 0))
          + coalesce(p.freight_cost, 0) + coalesce(p.customs_cost, 0) + coalesce(p.other_cost, 0))
        / p.quantity, 4);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_should_have_lot(p %1$I.purchases)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN p.product_id IS NOT NULL
        AND p.quantity > 0
        AND p.location_id IS NOT NULL
        AND inv_location_holds_stock(p.location_id);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_create_purchase_lot(p %1$I.purchases)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot  uuid;
      v_cost numeric := inv_landed_unit_cost(p);
    BEGIN
      PERFORM inv_lock(p.product_id, p.location_id);
      INSERT INTO stock_lots (product_id, location_id, purchase_id, kind, received_at, unit_cost, qty_received, qty_remaining)
        VALUES (p.product_id, p.location_id, p.id, 'purchase', p.date::timestamptz, v_cost, p.quantity, p.quantity)
        RETURNING id INTO v_lot;
      INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, purchase_id)
        VALUES (p.product_id, p.location_id, v_lot, 'receipt', p.quantity, v_cost, p.id);
      PERFORM inv_settle_shortfall(v_lot);
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_drop_purchase_lot(p_purchase uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_lot stock_lots;
    BEGIN
      SELECT * INTO v_lot FROM stock_lots WHERE purchase_id = p_purchase AND kind = 'purchase' FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      IF v_lot.qty_remaining <> v_lot.qty_received THEN
        PERFORM inv_raise('INV_CONSUMED',
          (v_lot.qty_received - v_lot.qty_remaining) || ' of ' || v_lot.qty_received
          || ' units from this batch are already sold or transferred, so it cannot be removed or moved');
      END IF;
      DELETE FROM stock_lots WHERE id = v_lot.id; -- its receipt movement cascades
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.created_at < v_s.enabled_at THEN
        RETURN NEW;
      END IF;
      IF NEW.product_id IS NOT NULL AND NEW.location_id IS NULL THEN
        NEW.location_id := v_s.default_location_id;
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_after_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s        inventory_settings;
      v_lot      stock_lots;
      v_want     boolean;
      v_consumed integer;
      v_cost     numeric;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NULL;
      END IF;
      v_want := inv_purchase_should_have_lot(NEW);

      IF TG_OP = 'INSERT' THEN
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF OLD.created_at < v_s.enabled_at THEN
        RETURN NULL; -- pre-enable rows are not part of the ledger
      END IF;

      SELECT * INTO v_lot FROM stock_lots WHERE purchase_id = NEW.id AND kind = 'purchase' FOR UPDATE;
      IF NOT FOUND THEN
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF NOT v_want
         OR NEW.product_id IS DISTINCT FROM OLD.product_id
         OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
        PERFORM inv_drop_purchase_lot(NEW.id); -- raises INV_CONSUMED if any unit is gone
        IF v_want THEN
          PERFORM inv_create_purchase_lot(NEW);
        END IF;
        RETURN NULL;
      END IF;

      IF NEW.quantity <> v_lot.qty_received THEN
        v_consumed := v_lot.qty_received - v_lot.qty_remaining;
        IF NEW.quantity < v_consumed THEN
          PERFORM inv_raise('INV_CONSUMED',
            v_consumed || ' units from this batch are already sold or transferred, so its quantity cannot go below '
            || v_consumed);
        END IF;
        UPDATE stock_lots SET qty_received = NEW.quantity, qty_remaining = NEW.quantity - v_consumed
          WHERE id = v_lot.id;
        UPDATE stock_movements SET qty = NEW.quantity WHERE lot_id = v_lot.id AND kind = 'receipt';
        IF NEW.quantity > v_lot.qty_received THEN
          PERFORM inv_settle_shortfall(v_lot.id);
        END IF;
      END IF;

      IF NEW.date IS DISTINCT FROM OLD.date THEN
        UPDATE stock_lots SET received_at = NEW.date::timestamptz WHERE purchase_id = NEW.id;
      END IF;

      v_cost := inv_landed_unit_cost(NEW);
      IF v_cost <> v_lot.unit_cost THEN
        PERFORM inv_recost_lot(v_lot.id, v_cost);
      END IF;
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_purchase_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF coalesce(v_s.advanced_enabled, false) AND OLD.created_at >= v_s.enabled_at THEN
        PERFORM inv_drop_purchase_lot(OLD.id);
      END IF;
      RETURN OLD;
    END;
    $func$;

    -- One-way switch. Called only by POST /api/inventory/enable-advanced
    -- (service_role), which checks plan + admin role first.
    CREATE OR REPLACE FUNCTION %1$I.enable_advanced_inventory()
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s    inventory_settings;
      v_main uuid;
      v_lot  uuid;
      r      record;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id FOR UPDATE;
      IF v_s.advanced_enabled THEN
        RETURN;
      END IF;
      SELECT id INTO v_main FROM stock_locations WHERE lower(name) = 'main';
      IF v_main IS NULL THEN
        INSERT INTO stock_locations (name, type) VALUES ('Main', 'own') RETURNING id INTO v_main;
      END IF;
      INSERT INTO platform_location_defaults (platform, location_id)
        SELECT unnest(ARRAY['amazon', 'ebay', 'etsy', 'shopify', 'other']), v_main
        ON CONFLICT (platform) DO NOTHING;
      -- "Start clean": today's stock becomes one opening lot per product at
      -- cost 0, oldest in FIFO order. Cost is editable later via
      -- set_opening_lot_cost().
      FOR r IN SELECT id, current_stock FROM products WHERE current_stock > 0 LOOP
        INSERT INTO stock_lots (product_id, location_id, kind, received_at, unit_cost, qty_received, qty_remaining)
          VALUES (r.id, v_main, 'opening', timestamptz '1970-01-01 00:00:00+00', 0, r.current_stock, r.current_stock)
          RETURNING id INTO v_lot;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost)
          VALUES (r.id, v_main, v_lot, 'opening', r.current_stock, 0);
      END LOOP;
      UPDATE inventory_settings
        SET advanced_enabled = true, enabled_at = now(), default_location_id = v_main
        WHERE id;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS inv_purchase_before_write ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_before_write BEFORE INSERT OR UPDATE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_before_write();
    DROP TRIGGER IF EXISTS inv_purchase_after_write ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_after_write AFTER INSERT OR UPDATE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_after_write();
    DROP TRIGGER IF EXISTS inv_purchase_before_delete ON %1$I.purchases;
    CREATE TRIGGER inv_purchase_before_delete BEFORE DELETE ON %1$I.purchases
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_purchase_before_delete();
  $sql$, schema_name);
```

Then, directly under the `-- @@ RPC GRANTS @@` line, add:

```sql
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.enable_advanced_inventory() TO service_role', schema_name);
```

- [ ] **Step 4: Run the SQL tests — expect PASS** (`INV_TESTS_PASSED`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_advanced_inventory.sql supabase/tests/advanced_inventory.test.sql
git commit -m "feat(inventory): purchase lots, landed cost, shortfall settlement, enable RPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sale triggers — FIFO consumption, shortfall, COGS

**Files:**
- Modify: `supabase/migrations/047_advanced_inventory.sql` (replace `-- @@ SECTION 4 @@`)
- Modify: `supabase/tests/advanced_inventory.test.sql` (insert before `-- @@ NEXT SECTION @@`)

**Interfaces:**
- Consumes: Task 5 helpers (`inv_lock`, `inv_last_unit_cost`, `inv_set_cogs`, `inv_recompute_cogs`, `inv_settle_shortfall`, `inv_location_holds_stock`, `inv_raise`).
- Produces: `inv_sale_consumes(p_product uuid, p_location uuid, p_qty integer, p_status text, p_restock boolean) → boolean`, `inv_consume(p_product uuid, p_location uuid, p_qty integer, p_sale uuid)`, `inv_revert_sale(p_sale uuid)`; triggers `inv_sale_before_write` (BEFORE INSERT/UPDATE), `inv_sale_after_write` (AFTER INSERT/UPDATE), `inv_sale_before_delete` (BEFORE DELETE).

State entering this section (Widget @ Main): opening lot 5 @0 (received 1970), P2 lot 12 @12.5.

- [ ] **Step 1: Write the failing test** — insert above `-- @@ NEXT SECTION @@`:

```sql
  -- ── Section: sales (Task 6) ───────────────────────────────
  -- FIFO split: 7 = 5 opening @0 + 2 from P2 @12.5 → COGS 25.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 7, 30, 210, current_date, v_uid) RETURNING id INTO v_s1;
  IF (SELECT fulfillment_location_id FROM sales WHERE id = v_s1) IS DISTINCT FROM v_main THEN
    RAISE EXCEPTION 'FAIL sales: fulfillment location not defaulted';
  END IF;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s1;
  IF v_num IS DISTINCT FROM 25.00 THEN RAISE EXCEPTION 'FAIL sales: FIFO COGS expected 25.00, got %', v_num; END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') <> 0
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 10 THEN
    RAISE EXCEPTION 'FAIL sales: FIFO did not drain the oldest lot first';
  END IF;

  -- Clients cannot write cogs_amount
  UPDATE sales SET cogs_amount = 999 WHERE id = v_s1;
  IF (SELECT cogs_amount FROM sales WHERE id = v_s1) <> 25.00 THEN
    RAISE EXCEPTION 'FAIL sales: client write to cogs_amount stuck';
  END IF;

  -- Unrelated edit leaves the ledger untouched
  SELECT string_agg(id::text, ',' ORDER BY id) INTO v_txt FROM stock_movements WHERE sale_id = v_s1;
  UPDATE sales SET description = 'gift wrap' WHERE id = v_s1;
  IF (SELECT string_agg(id::text, ',' ORDER BY id) FROM stock_movements WHERE sale_id = v_s1) IS DISTINCT FROM v_txt THEN
    RAISE EXCEPTION 'FAIL sales: unrelated edit re-ran FIFO';
  END IF;

  -- Quantity edit re-runs FIFO: 3 units, all from opening @0
  UPDATE sales SET quantity = 3, total_amount = 90 WHERE id = v_s1;
  IF (SELECT cogs_amount FROM sales WHERE id = v_s1) <> 0
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') <> 2
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 12 THEN
    RAISE EXCEPTION 'FAIL sales: quantity edit did not revert and re-apply';
  END IF;

  -- 13 more: 2 opening + 11 from P2 @12.5 → 137.50; P2 left with 1
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 13, 30, 390, current_date, v_uid) RETURNING id INTO v_s2;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s2;
  IF v_num IS DISTINCT FROM 137.50 THEN RAISE EXCEPTION 'FAIL sales: s2 COGS expected 137.50, got %', v_num; END IF;

  -- Consumed batch: cannot shrink below consumed, cannot delete
  BEGIN
    UPDATE purchases SET quantity = 5, total_amount = 60.50, vat_amount = 10.50 WHERE id = v_p2;
    RAISE EXCEPTION 'FAIL sales: shrinking a consumed batch was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM purchases WHERE id = v_p2;
    RAISE EXCEPTION 'FAIL sales: deleting a consumed batch was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;

  -- Batch cost edit flows into COGS already booked: (120 + 20 + 5 + 17) / 12 = 13.5 → s2 = 11 × 13.5
  UPDATE purchases SET other_cost = 17 WHERE id = v_p2;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s2;
  IF v_num IS DISTINCT FROM 148.50 THEN RAISE EXCEPTION 'FAIL sales: re-cost expected 148.50, got %', v_num; END IF;

  -- Shortfall: 4 wanted, 1 left → 1 @13.5 + 3 short @ last cost 13.5 = 54.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 4, 30, 120, current_date, v_uid) RETURNING id INTO v_s3;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s3;
  IF v_num IS DISTINCT FROM 54.00 THEN RAISE EXCEPTION 'FAIL sales: shortfall COGS expected 54.00, got %', v_num; END IF;
  SELECT qty_remaining INTO v_int FROM stock_lots WHERE product_id = v_prod AND location_id = v_main AND kind = 'shortfall';
  IF v_int IS DISTINCT FROM -3 THEN RAISE EXCEPTION 'FAIL sales: shortfall lot expected -3, got %', v_int; END IF;

  -- A receipt settles the shortfall and re-costs the order at the real price: 13.5 + 3 × 10 = 43.50
  INSERT INTO purchases (product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('Widget', v_prod, 10, 10, 100, current_date, v_uid) RETURNING id INTO v_p4;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE product_id = v_prod AND kind = 'shortfall') THEN
    RAISE EXCEPTION 'FAIL sales: shortfall not settled by receipt';
  END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') <> 7 THEN
    RAISE EXCEPTION 'FAIL sales: settlement did not draw 3 from the new lot';
  END IF;
  SELECT cogs_amount INTO v_num FROM sales WHERE id = v_s3;
  IF v_num IS DISTINCT FROM 43.50 THEN RAISE EXCEPTION 'FAIL sales: settled COGS expected 43.50, got %', v_num; END IF;

  -- Deleting a sale puts its units back where they came from
  DELETE FROM sales WHERE id = v_s3;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 1
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') <> 10 THEN
    RAISE EXCEPTION 'FAIL sales: delete did not restore lots';
  END IF;

  -- Returned + restock consumes nothing; COGS 0; its 3 opening units come back
  UPDATE sales SET status = 'returned', restock = true WHERE id = v_s1;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_s1)
     OR (SELECT cogs_amount FROM sales WHERE id = v_s1) <> 0
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') <> 3 THEN
    RAISE EXCEPTION 'FAIL sales: returned+restock not handled';
  END IF;

  -- Dropship fulfilment: no movements, COGS stays NULL (linked purchase applies)
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by, fulfillment_location_id)
    VALUES ('ebay', 'Widget', v_prod, 2, 30, 60, current_date, v_uid, v_drop) RETURNING id INTO v_sd;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_sd) OR (SELECT cogs_amount FROM sales WHERE id = v_sd) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sales: dropship sale touched the ledger';
  END IF;

  -- Platform default: Amazon → FBA (empty) → shortfall at FBA @ last cost 10
  INSERT INTO stock_locations (name, type) VALUES ('Amazon FBA', 'fba') RETURNING id INTO v_fba;
  UPDATE platform_location_defaults SET location_id = v_fba WHERE platform = 'amazon';
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('amazon', 'Widget', v_prod, 1, 30, 30, current_date, v_uid) RETURNING id INTO v_sa;
  IF (SELECT fulfillment_location_id FROM sales WHERE id = v_sa) IS DISTINCT FROM v_fba
     OR (SELECT cogs_amount FROM sales WHERE id = v_sa) <> 10 THEN
    RAISE EXCEPTION 'FAIL sales: platform default / FBA shortfall wrong';
  END IF;
  DELETE FROM sales WHERE id = v_sa;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE location_id = v_fba) THEN
    RAISE EXCEPTION 'FAIL sales: empty shortfall lot left behind at FBA';
  END IF;

  -- Pre-enable sale edits are ignored by the ledger
  UPDATE sales SET quantity = 2, total_amount = 18 WHERE id = v_sg;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE sale_id = v_sg) THEN
    RAISE EXCEPTION 'FAIL sales: pre-enable sale edit touched the ledger';
  END IF;

  -- Triggers still fire for a real client role (EXECUTE was revoked on them)
  SET LOCAL ROLE authenticated;
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('ebay', 'Widget', v_prod, 1, 30, 30, current_date, v_uid) RETURNING id INTO v_sa;
  RESET ROLE;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) IS NULL THEN
    RAISE EXCEPTION 'FAIL sales: trigger did not run for the authenticated role';
  END IF;
  DELETE FROM sales WHERE id = v_sa;

```

- [ ] **Step 2: Run the SQL tests — expect FAIL** with `FAIL sales: fulfillment location not defaulted`.

- [ ] **Step 3: Implement** — replace `-- @@ SECTION 4 @@` with:

```sql
  -- ── 4. Sales → FIFO consumption ───────────────────────────
  EXECUTE format($sql$
    -- Same consumption rule as the legacy apply_sale_stock_change, plus:
    -- dropship locations never hold stock.
    CREATE OR REPLACE FUNCTION %1$I.inv_sale_consumes(
      p_product uuid, p_location uuid, p_qty integer, p_status text, p_restock boolean)
    RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path = %1$I
    AS $func$
    BEGIN
      RETURN p_product IS NOT NULL
        AND p_location IS NOT NULL
        AND p_qty > 0
        AND inv_location_holds_stock(p_location)
        AND NOT (p_status = 'returned' AND coalesce(p_restock, false));
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_consume(p_product uuid, p_location uuid, p_qty integer, p_sale uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      l           record;
      v_remaining integer := p_qty;
      v_take      integer;
      v_sf        stock_lots;
    BEGIN
      IF p_qty <= 0 THEN
        RETURN;
      END IF;
      PERFORM inv_lock(p_product, p_location);
      FOR l IN
        SELECT * FROM stock_lots
        WHERE product_id = p_product AND location_id = p_location
          AND kind <> 'shortfall' AND qty_remaining > 0
        ORDER BY received_at, created_at, id
        FOR UPDATE
      LOOP
        v_take := least(l.qty_remaining, v_remaining);
        UPDATE stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = l.id;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
          VALUES (p_product, p_location, l.id, 'sale', -v_take, l.unit_cost, p_sale);
        v_remaining := v_remaining - v_take;
        EXIT WHEN v_remaining = 0;
      END LOOP;

      IF v_remaining > 0 THEN
        -- Not enough stock: never block the order. The gap goes to this
        -- location's shortfall lot at the last known cost and is re-costed
        -- when stock next arrives (inv_settle_shortfall).
        INSERT INTO stock_lots (product_id, location_id, kind, received_at, unit_cost, qty_received, qty_remaining)
          VALUES (p_product, p_location, 'shortfall', now(), inv_last_unit_cost(p_product), 0, 0)
          ON CONFLICT (product_id, location_id) WHERE kind = 'shortfall' DO NOTHING;
        SELECT * INTO v_sf FROM stock_lots
          WHERE product_id = p_product AND location_id = p_location AND kind = 'shortfall'
          FOR UPDATE;
        UPDATE stock_lots SET qty_remaining = qty_remaining - v_remaining WHERE id = v_sf.id;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, sale_id)
          VALUES (p_product, p_location, v_sf.id, 'sale', -v_remaining, v_sf.unit_cost, p_sale);
      END IF;
    END;
    $func$;

    -- Undo every movement of one sale, returning units to the exact lots
    -- they came from. Restored units then settle any shortfall at the same
    -- location, so a location never shows positive and negative at once.
    CREATE OR REPLACE FUNCTION %1$I.inv_revert_sale(p_sale uuid)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    DECLARE
      m      record;
      v_lots uuid[] := '{}';
      v_lot  uuid;
    BEGIN
      FOR m IN SELECT * FROM stock_movements WHERE sale_id = p_sale ORDER BY created_at, id LOOP
        PERFORM inv_lock(m.product_id, m.location_id);
        UPDATE stock_lots SET qty_remaining = qty_remaining - m.qty WHERE id = m.lot_id;
        v_lots := array_append(v_lots, m.lot_id);
      END LOOP;
      DELETE FROM stock_movements WHERE sale_id = p_sale;
      DELETE FROM stock_lots WHERE id = ANY (v_lots) AND kind = 'shortfall' AND qty_remaining = 0;
      FOR v_lot IN
        SELECT id FROM stock_lots
        WHERE id = ANY (v_lots) AND kind <> 'shortfall' AND qty_remaining > 0
        ORDER BY received_at, created_at
      LOOP
        PERFORM inv_settle_shortfall(v_lot);
      END LOOP;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_before_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      -- cogs_amount is trigger-owned: discard any value not written by
      -- inv_set_cogs / inv_recompute_cogs.
      IF coalesce(current_setting('inv.writing_cogs', true), 'off') <> 'on' THEN
        IF TG_OP = 'INSERT' THEN
          NEW.cogs_amount := NULL;
        ELSE
          NEW.cogs_amount := OLD.cogs_amount;
        END IF;
      END IF;

      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.created_at < v_s.enabled_at THEN
        RETURN NEW;
      END IF;
      IF NEW.product_id IS NOT NULL AND NEW.fulfillment_location_id IS NULL THEN
        NEW.fulfillment_location_id := coalesce(
          (SELECT location_id FROM platform_location_defaults WHERE platform = NEW.platform),
          v_s.default_location_id);
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_after_write()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s            inventory_settings;
      v_new_consumes boolean;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        RETURN NULL;
      END IF;
      v_new_consumes := inv_sale_consumes(
        NEW.product_id, NEW.fulfillment_location_id, NEW.quantity, NEW.status, NEW.restock);

      IF TG_OP = 'UPDATE' THEN
        IF OLD.created_at < v_s.enabled_at THEN
          RETURN NULL; -- pre-enable rows are not part of the ledger
        END IF;
        -- Only stock-relevant edits re-run FIFO; a note/fee edit (or our own
        -- cogs_amount write) must never move an order onto different lots.
        IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id
           AND NEW.fulfillment_location_id IS NOT DISTINCT FROM OLD.fulfillment_location_id
           AND NEW.quantity = OLD.quantity
           AND v_new_consumes = inv_sale_consumes(
                 OLD.product_id, OLD.fulfillment_location_id, OLD.quantity, OLD.status, OLD.restock) THEN
          RETURN NULL;
        END IF;
        PERFORM inv_revert_sale(NEW.id);
      END IF;

      IF v_new_consumes THEN
        PERFORM inv_consume(NEW.product_id, NEW.fulfillment_location_id, NEW.quantity, NEW.id);
        PERFORM inv_recompute_cogs(ARRAY[NEW.id]);
      ELSIF NEW.product_id IS NOT NULL
            AND NEW.fulfillment_location_id IS NOT NULL
            AND inv_location_holds_stock(NEW.fulfillment_location_id) THEN
        PERFORM inv_set_cogs(NEW.id, 0);    -- e.g. returned + restocked
      ELSE
        PERFORM inv_set_cogs(NEW.id, NULL); -- dropship / no product: linked purchase applies
      END IF;
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_sale_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF coalesce(v_s.advanced_enabled, false) THEN
        PERFORM inv_revert_sale(OLD.id);
      END IF;
      RETURN OLD;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS inv_sale_before_write ON %1$I.sales;
    CREATE TRIGGER inv_sale_before_write BEFORE INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_before_write();
    DROP TRIGGER IF EXISTS inv_sale_after_write ON %1$I.sales;
    CREATE TRIGGER inv_sale_after_write AFTER INSERT OR UPDATE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_after_write();
    DROP TRIGGER IF EXISTS inv_sale_before_delete ON %1$I.sales;
    CREATE TRIGGER inv_sale_before_delete BEFORE DELETE ON %1$I.sales
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_sale_before_delete();
  $sql$, schema_name);
```

- [ ] **Step 4: Run the SQL tests — expect PASS** (`INV_TESTS_PASSED`). If the `SET LOCAL ROLE authenticated` insert fails on RLS, read the `sales` insert policy in `005_tenant_provisioning.sql` and fix the test's JWT claims to satisfy it — do not weaken the policy.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_advanced_inventory.sql supabase/tests/advanced_inventory.test.sql
git commit -m "feat(inventory): FIFO sale consumption, shortfall lots and trigger-owned COGS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Transfers, location guards, settings RPCs

**Files:**
- Modify: `supabase/migrations/047_advanced_inventory.sql` (replace `-- @@ SECTION 5 @@`; add two lines under `-- @@ RPC GRANTS @@`)
- Modify: `supabase/tests/advanced_inventory.test.sql` (insert before `-- @@ NEXT SECTION @@`)

**Interfaces:**
- Consumes: Task 5/6 helpers.
- Produces: triggers on `stock_transfers` (`inv_transfer_before_insert`, `inv_transfer_after_insert`, `inv_transfer_before_update`, `inv_transfer_before_delete`) and `stock_locations` (`inv_location_before_update`, `inv_location_before_delete`); RPCs `set_default_location(p_location_id uuid) → void` and `set_opening_lot_cost(p_lot_id uuid, p_unit_cost numeric) → void` (both admin-only, EXECUTE granted to `authenticated`).

State entering this section (Widget @ Main): opening 3 @0, P2 1 @13.5, P4 10 @10 — 14 units. FBA empty.

- [ ] **Step 1: Write the failing test** — insert above `-- @@ NEXT SECTION @@`:

```sql
  -- ── Section: transfers, locations, RPCs (Task 7) ──────────
  -- 5 Main → FBA with €10 transfer cost (+2/unit): FIFO takes opening 3 @0, P2 1 @13.5, P4 1 @10
  INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, transfer_cost, date, created_by)
    VALUES (v_prod, v_main, v_fba, 5, 10, current_date, v_uid) RETURNING id INTO v_t1;
  SELECT count(*), sum(qty_remaining) INTO v_int, v_num FROM stock_lots WHERE location_id = v_fba;
  IF v_int <> 3 OR v_num <> 5 THEN RAISE EXCEPTION 'FAIL transfers: expected 3 lots / 5 units at FBA, got % / %', v_int, v_num; END IF;
  SELECT string_agg(unit_cost::text, ',' ORDER BY received_at, created_at) INTO v_txt FROM stock_lots WHERE location_id = v_fba;
  IF v_txt <> '2.0000,15.5000,12.0000' THEN RAISE EXCEPTION 'FAIL transfers: destination costs wrong: %', v_txt; END IF;
  IF (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') <> 9 THEN
    RAISE EXCEPTION 'FAIL transfers: source not drained FIFO';
  END IF;

  -- A sale at FBA consumes the transferred opening units first: 2 × 2 = 4.00
  INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, date, created_by)
    VALUES ('amazon', 'Widget', v_prod, 2, 30, 60, current_date, v_uid) RETURNING id INTO v_sa;
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) <> 4 THEN
    RAISE EXCEPTION 'FAIL transfers: FBA sale COGS expected 4.00';
  END IF;

  -- Opening cost edit flows through the transfer lot: (1 + 2) × 2 = 6.00
  SELECT id INTO v_lot FROM stock_lots WHERE product_id = v_prod AND kind = 'opening';
  PERFORM set_opening_lot_cost(v_lot, 1);
  IF (SELECT cogs_amount FROM sales WHERE id = v_sa) <> 6 THEN
    RAISE EXCEPTION 'FAIL transfers: opening re-cost did not reach the FBA sale';
  END IF;
  BEGIN
    PERFORM set_opening_lot_cost((SELECT id FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase'), 1);
    RAISE EXCEPTION 'FAIL rpc: set_opening_lot_cost accepted a purchase lot';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_NOT_OPENING:%' THEN RAISE; END IF;
  END;

  -- Transfers are immutable, and cannot be deleted once their units are sold
  BEGIN
    UPDATE stock_transfers SET note = 'x' WHERE id = v_t1;
    RAISE EXCEPTION 'FAIL transfers: edit allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_TRANSFER_IMMUTABLE:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM stock_transfers WHERE id = v_t1;
    RAISE EXCEPTION 'FAIL transfers: delete of a consumed transfer allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_CONSUMED:%' THEN RAISE; END IF;
  END;

  -- Once the sale is gone the transfer can be deleted, restoring Main exactly
  DELETE FROM sales WHERE id = v_sa;
  DELETE FROM stock_transfers WHERE id = v_t1;
  IF EXISTS (SELECT 1 FROM stock_lots WHERE location_id = v_fba)
     OR (SELECT qty_remaining FROM stock_lots WHERE product_id = v_prod AND kind = 'opening') <> 3
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p2 AND kind = 'purchase') <> 1
     OR (SELECT qty_remaining FROM stock_lots WHERE purchase_id = v_p4 AND kind = 'purchase') <> 10 THEN
    RAISE EXCEPTION 'FAIL transfers: delete did not restore the source';
  END IF;

  -- Insufficient source stock and dropship endpoints are rejected
  BEGIN
    INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, date, created_by)
      VALUES (v_prod, v_main, v_fba, 100, current_date, v_uid);
    RAISE EXCEPTION 'FAIL transfers: oversized transfer allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_INSUFFICIENT:%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, date, created_by)
      VALUES (v_prod, v_main, v_drop, 1, current_date, v_uid);
    RAISE EXCEPTION 'FAIL transfers: transfer to dropship allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DROPSHIP_LOCATION:%' THEN RAISE; END IF;
  END;

  -- Location guards
  BEGIN
    DELETE FROM stock_locations WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: deleting an in-use location allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_LOCATION_IN_USE:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE stock_locations SET is_active = false WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: deactivating the default allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DEFAULT_LOCATION:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE stock_locations SET type = 'dropship' WHERE id = v_main;
    RAISE EXCEPTION 'FAIL locations: switching a stocked location to dropship allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_LOCATION_IN_USE:%' THEN RAISE; END IF;
  END;

  -- set_default_location: dropship rejected, FBA accepted, non-admin forbidden
  BEGIN
    PERFORM set_default_location(v_drop);
    RAISE EXCEPTION 'FAIL rpc: dropship accepted as default location';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_DEFAULT_LOCATION:%' THEN RAISE; END IF;
  END;
  PERFORM set_default_location(v_fba);
  IF (SELECT default_location_id FROM inventory_settings) IS DISTINCT FROM v_fba THEN
    RAISE EXCEPTION 'FAIL rpc: default location not updated';
  END IF;
  UPDATE profiles SET role = 'accountant' WHERE id = v_uid;
  BEGIN
    PERFORM set_default_location(v_main);
    RAISE EXCEPTION 'FAIL rpc: accountant changed the default location';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INV_FORBIDDEN:%' THEN RAISE; END IF;
  END;
  UPDATE profiles SET role = 'admin' WHERE id = v_uid;
  IF NOT has_function_privilege('authenticated', 'tenant_zz_invtest.set_default_location(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL privileges: authenticated cannot call set_default_location';
  END IF;

  -- Consistency with the legacy counter. Widget history: purchases 5 + 12 + 2 (dropship) + 10,
  -- sales 13 + 2 (dropship); s1 restocked. Legacy current_stock = 14 = lots at stock-holding
  -- locations (the dropship purchase and dropship sale cancel out in the legacy counter).
  SELECT coalesce(sum(qty_remaining), 0) INTO v_int FROM stock_lots WHERE product_id = v_prod;
  IF v_int <> 14 OR (SELECT current_stock FROM products WHERE id = v_prod) <> 14 THEN
    RAISE EXCEPTION 'FAIL consistency: lots % vs current_stock %', v_int, (SELECT current_stock FROM products WHERE id = v_prod);
  END IF;

```

- [ ] **Step 2: Run the SQL tests — expect FAIL** with `FAIL transfers: expected 3 lots / 5 units at FBA, got 0 / <NULL>` (no transfer triggers yet, so the insert moves nothing).

- [ ] **Step 3: Implement** — replace `-- @@ SECTION 5 @@` with:

```sql
  -- ── 5. Transfers, location guards, settings RPCs ──────────
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.inv_transfer_before_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      v_s inventory_settings;
    BEGIN
      SELECT * INTO v_s FROM inventory_settings WHERE id;
      IF NOT coalesce(v_s.advanced_enabled, false) THEN
        PERFORM inv_raise('INV_NOT_ENABLED', 'Batches and locations are not enabled for this account');
      END IF;
      IF NOT inv_location_holds_stock(NEW.from_location_id) OR NOT inv_location_holds_stock(NEW.to_location_id) THEN
        PERFORM inv_raise('INV_DROPSHIP_LOCATION',
          'Dropship locations do not hold stock, so stock cannot be transferred to or from them');
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_transfer_after_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      l           record;
      v_remaining integer := NEW.quantity;
      v_take      integer;
      v_avail     integer;
      v_addon     numeric := round(coalesce(NEW.transfer_cost, 0) / NEW.quantity, 4);
      v_new       uuid;
    BEGIN
      -- Lock both ends in a fixed order so opposite transfers cannot deadlock.
      IF NEW.from_location_id::text < NEW.to_location_id::text THEN
        PERFORM inv_lock(NEW.product_id, NEW.from_location_id);
        PERFORM inv_lock(NEW.product_id, NEW.to_location_id);
      ELSE
        PERFORM inv_lock(NEW.product_id, NEW.to_location_id);
        PERFORM inv_lock(NEW.product_id, NEW.from_location_id);
      END IF;

      SELECT coalesce(sum(qty_remaining), 0) INTO v_avail FROM stock_lots
        WHERE product_id = NEW.product_id AND location_id = NEW.from_location_id
          AND kind <> 'shortfall' AND qty_remaining > 0;
      IF v_avail < NEW.quantity THEN
        PERFORM inv_raise('INV_INSUFFICIENT',
          'Only ' || v_avail || ' units are available at the source location');
      END IF;

      FOR l IN
        SELECT * FROM stock_lots
        WHERE product_id = NEW.product_id AND location_id = NEW.from_location_id
          AND kind <> 'shortfall' AND qty_remaining > 0
        ORDER BY received_at, created_at, id
        FOR UPDATE
      LOOP
        v_take := least(l.qty_remaining, v_remaining);
        UPDATE stock_lots SET qty_remaining = qty_remaining - v_take WHERE id = l.id;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, transfer_id)
          VALUES (NEW.product_id, NEW.from_location_id, l.id, 'transfer_out', -v_take, l.unit_cost, NEW.id);
        -- The moved units keep their batch (purchase_id) and FIFO age
        -- (received_at); only the transfer cost share is added.
        INSERT INTO stock_lots (product_id, location_id, purchase_id, source_lot_id, kind, received_at,
                                cost_addon, unit_cost, qty_received, qty_remaining)
          VALUES (NEW.product_id, NEW.to_location_id, l.purchase_id, l.id, 'transfer', l.received_at,
                  v_addon, l.unit_cost + v_addon, v_take, v_take)
          RETURNING id INTO v_new;
        INSERT INTO stock_movements (product_id, location_id, lot_id, kind, qty, unit_cost, transfer_id)
          VALUES (NEW.product_id, NEW.to_location_id, v_new, 'transfer_in', v_take, l.unit_cost + v_addon, NEW.id);
        PERFORM inv_settle_shortfall(v_new);
        v_remaining := v_remaining - v_take;
        EXIT WHEN v_remaining = 0;
      END LOOP;
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_transfer_before_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = %1$I
    AS $func$
    BEGIN
      PERFORM inv_raise('INV_TRANSFER_IMMUTABLE',
        'Transfers cannot be edited. Delete it and record a new one instead');
      RETURN NULL;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_transfer_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      m         record;
      v_sources uuid[] := '{}';
      v_lot     uuid;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM stock_movements mv JOIN stock_lots l ON l.id = mv.lot_id
        WHERE mv.transfer_id = OLD.id AND mv.kind = 'transfer_in' AND l.qty_remaining <> l.qty_received
      ) THEN
        PERFORM inv_raise('INV_CONSUMED',
          'Some of the transferred units have already been sold or moved on, so this transfer cannot be deleted');
      END IF;
      IF OLD.from_location_id::text < OLD.to_location_id::text THEN
        PERFORM inv_lock(OLD.product_id, OLD.from_location_id);
        PERFORM inv_lock(OLD.product_id, OLD.to_location_id);
      ELSE
        PERFORM inv_lock(OLD.product_id, OLD.to_location_id);
        PERFORM inv_lock(OLD.product_id, OLD.from_location_id);
      END IF;
      FOR m IN SELECT * FROM stock_movements WHERE transfer_id = OLD.id AND kind = 'transfer_out' LOOP
        UPDATE stock_lots SET qty_remaining = qty_remaining - m.qty WHERE id = m.lot_id;
        v_sources := array_append(v_sources, m.lot_id);
      END LOOP;
      DELETE FROM stock_lots
        WHERE id IN (SELECT lot_id FROM stock_movements WHERE transfer_id = OLD.id AND kind = 'transfer_in');
      DELETE FROM stock_movements WHERE transfer_id = OLD.id;
      FOR v_lot IN SELECT id FROM stock_lots WHERE id = ANY (v_sources) ORDER BY received_at, created_at LOOP
        PERFORM inv_settle_shortfall(v_lot);
      END LOOP;
      RETURN OLD;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_location_before_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF NEW.type <> OLD.type AND (NEW.type = 'dropship' OR OLD.type = 'dropship')
         AND EXISTS (SELECT 1 FROM stock_lots WHERE location_id = OLD.id) THEN
        PERFORM inv_raise('INV_LOCATION_IN_USE',
          'This location has stock history, so it cannot be switched to or from dropship');
      END IF;
      IF (SELECT default_location_id FROM inventory_settings WHERE id) = OLD.id
         AND (NOT NEW.is_active OR NEW.type = 'dropship') THEN
        PERFORM inv_raise('INV_DEFAULT_LOCATION',
          'This is the default location. Choose another default location first');
      END IF;
      RETURN NEW;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.inv_location_before_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF EXISTS (SELECT 1 FROM stock_lots WHERE location_id = OLD.id)
         OR EXISTS (SELECT 1 FROM sales WHERE fulfillment_location_id = OLD.id)
         OR EXISTS (SELECT 1 FROM purchases WHERE location_id = OLD.id)
         OR EXISTS (SELECT 1 FROM stock_transfers WHERE from_location_id = OLD.id OR to_location_id = OLD.id)
         OR EXISTS (SELECT 1 FROM platform_location_defaults WHERE location_id = OLD.id)
         OR EXISTS (SELECT 1 FROM inventory_settings WHERE default_location_id = OLD.id) THEN
        PERFORM inv_raise('INV_LOCATION_IN_USE', 'This location is in use. Deactivate it instead of deleting it');
      END IF;
      RETURN OLD;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.set_default_location(p_location_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF coalesce(current_user_role(), '') NOT IN ('admin', 'super_admin') THEN
        PERFORM inv_raise('INV_FORBIDDEN', 'Only admins can change inventory settings');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE id = p_location_id AND is_active AND type <> 'dropship') THEN
        PERFORM inv_raise('INV_DEFAULT_LOCATION', 'The default location must be an active location that holds stock');
      END IF;
      UPDATE inventory_settings SET default_location_id = p_location_id WHERE id;
    END;
    $func$;

    CREATE OR REPLACE FUNCTION %1$I.set_opening_lot_cost(p_lot_id uuid, p_unit_cost numeric)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF coalesce(current_user_role(), '') NOT IN ('admin', 'super_admin') THEN
        PERFORM inv_raise('INV_FORBIDDEN', 'Only admins can change inventory settings');
      END IF;
      IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
        PERFORM inv_raise('INV_INVALID_COST', 'Unit cost must be zero or more');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stock_lots WHERE id = p_lot_id AND kind = 'opening') THEN
        PERFORM inv_raise('INV_NOT_OPENING', 'Only opening-balance batches can have their cost edited here');
      END IF;
      PERFORM inv_recost_lot(p_lot_id, p_unit_cost);
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS inv_transfer_before_insert ON %1$I.stock_transfers;
    CREATE TRIGGER inv_transfer_before_insert BEFORE INSERT ON %1$I.stock_transfers
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_transfer_before_insert();
    DROP TRIGGER IF EXISTS inv_transfer_after_insert ON %1$I.stock_transfers;
    CREATE TRIGGER inv_transfer_after_insert AFTER INSERT ON %1$I.stock_transfers
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_transfer_after_insert();
    DROP TRIGGER IF EXISTS inv_transfer_before_update ON %1$I.stock_transfers;
    CREATE TRIGGER inv_transfer_before_update BEFORE UPDATE ON %1$I.stock_transfers
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_transfer_before_update();
    DROP TRIGGER IF EXISTS inv_transfer_before_delete ON %1$I.stock_transfers;
    CREATE TRIGGER inv_transfer_before_delete BEFORE DELETE ON %1$I.stock_transfers
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_transfer_before_delete();
    DROP TRIGGER IF EXISTS inv_location_before_update ON %1$I.stock_locations;
    CREATE TRIGGER inv_location_before_update BEFORE UPDATE ON %1$I.stock_locations
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_location_before_update();
    DROP TRIGGER IF EXISTS inv_location_before_delete ON %1$I.stock_locations;
    CREATE TRIGGER inv_location_before_delete BEFORE DELETE ON %1$I.stock_locations
      FOR EACH ROW EXECUTE FUNCTION %1$I.inv_location_before_delete();
  $sql$, schema_name);
```

Under `-- @@ RPC GRANTS @@` (below the Task 5 line) add:

```sql
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.set_default_location(uuid) TO authenticated', schema_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.set_opening_lot_cost(uuid, numeric) TO authenticated', schema_name);
```

Finally delete the now-unused marker comment lines `-- @@ SECTION 3 @@`/`4`/`5` if any remain (keep `-- @@ RPC GRANTS @@` as a plain section comment: rename it to `-- ── RPC grants (after the revoke loop) ──`). In the test file, delete the `-- @@ NEXT SECTION @@` line.

- [ ] **Step 4: Run the SQL tests — expect PASS** (`INV_TESTS_PASSED`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_advanced_inventory.sql supabase/tests/advanced_inventory.test.sql
git commit -m "feat(inventory): stock transfers, location guards, settings RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Roll out to every tenant (2-places rule)

**Files:**
- Create: `supabase/migrations/048_advanced_inventory_apply.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (end of `provision_tenant_schema`, just before its final `END;`)

**Interfaces:**
- Consumes: `public.install_advanced_inventory(text)`.
- Produces: every `tenant_%` schema (existing and future) has the feature installed, flag off.

- [ ] **Step 1: Create `048_advanced_inventory_apply.sql`:**

```sql
-- supabase/migrations/048_advanced_inventory_apply.sql
-- ============================================================
-- Installs advanced inventory (047) into every existing tenant schema.
-- Safe on live data: adds nullable columns, empty tables and triggers that
-- are no-ops until a tenant runs enable_advanced_inventory(). New tenants
-- get the same via provision_tenant_schema() (005, same commit).
-- Requires 047 applied first.
-- ============================================================
SELECT public.run_on_all_tenant_schemas($$
  SELECT public.install_advanced_inventory('{{schema}}');
$$);
```

- [ ] **Step 2: Hook provisioning** — in `005_tenant_provisioning.sql`, immediately before the final `END;` of `provision_tenant_schema` (after the `notify_message_received` trigger lines, ~line 1043), add:

```sql

  -- ── 9. Advanced inventory (batches, locations, FIFO) ──────
  -- One shared installer instead of duplicating its SQL here — see
  -- 047_advanced_inventory.sql. Must stay last: it REVOKEs privileges that
  -- the blanket GRANT above would otherwise re-open.
  PERFORM public.install_advanced_inventory(schema_name);
```

- [ ] **Step 3: Re-run the SQL tests — expect PASS** (the test calls the installer explicitly, so this proves the installer is still green before rollout).

- [ ] **Step 4: Ask the user for explicit approval to roll out to live tenants**, stating: "This runs `048` on every `tenant_%` schema in Project B (adds nullable columns, empty tables and inert triggers) and re-applies `005_tenant_provisioning.sql` so new tenants get it." On approval:
  1. `execute_sql` with `047_advanced_inventory.sql` (latest version).
  2. `execute_sql` with `048_advanced_inventory_apply.sql`.
  3. `execute_sql` with the full `005_tenant_provisioning.sql`.
  4. Verify: 

```sql
SELECT n.nspname,
       to_regclass(n.nspname || '.stock_lots') IS NOT NULL AS has_lots,
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relnamespace = n.oid AND t.tgname LIKE 'inv\_%') AS inv_triggers
FROM pg_namespace n
WHERE n.nspname LIKE 'tenant\_%'
ORDER BY 1;
```

  Expected: every tenant row `has_lots = true`, `inv_triggers = 12`. Then run the SQL test file once more — expect `INV_TESTS_PASSED`.

  If the user declines, skip steps 1–4, and record 047/048/005 as ⏳ pending in Task 10's docs instead of ✅.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/048_advanced_inventory_apply.sql supabase/migrations/005_tenant_provisioning.sql
git commit -m "feat(inventory): install advanced inventory on all tenants and new provisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Enable route and guard

**Files:**
- Create: `src/lib/inventory/access.ts`, `src/lib/inventory/access.test.ts`
- Create: `src/lib/inventory/authGuard.ts`
- Create: `src/app/api/inventory/enable-advanced/route.ts`
- Modify: `.claude/verifiers/rules.py` (`_AUTH_MARKERS` regex + `route-without-auth` message)

**Interfaces:**
- Consumes: `hasAdvancedInventory` (Task 1), `inventoryErrorMessage` (Task 2), RPC `enable_advanced_inventory` (Task 5, service_role only), `createClient`/`createServiceClientForTenant` (`@/lib/supabase/server`), `createControlClient` (`@/lib/supabase/control`).
- Produces: `canEnableAdvancedInventory(plan: TenantPlan, role: UserRole | null | undefined): boolean`; `requireAdvancedInventoryAdmin(): Promise<AdvancedInventoryAuthResult>` where `AdvancedInventoryAuthResult = { context: { userId: string; tenantSchema: string }; error?: undefined } | { context?: undefined; error: NextResponse }`; `POST /api/inventory/enable-advanced` → `200 { ok: true }` | `401/400/403/404/500 { error: string }`.

- [ ] **Step 1: Write the failing test** — `src/lib/inventory/access.test.ts`:

```ts
import { canEnableAdvancedInventory } from "./access";

describe("canEnableAdvancedInventory", () => {
  it("allows admins and super admins on business and trial", () => {
    expect(canEnableAdvancedInventory("business", "admin")).toBe(true);
    expect(canEnableAdvancedInventory("business", "super_admin")).toBe(true);
    expect(canEnableAdvancedInventory("trial", "admin")).toBe(true);
  });

  it("refuses accountants and unknown roles", () => {
    expect(canEnableAdvancedInventory("business", "accountant")).toBe(false);
    expect(canEnableAdvancedInventory("business", null)).toBe(false);
    expect(canEnableAdvancedInventory("business", undefined)).toBe(false);
  });

  it("refuses starter and pro even for admins", () => {
    expect(canEnableAdvancedInventory("starter", "admin")).toBe(false);
    expect(canEnableAdvancedInventory("pro", "super_admin")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx jest src/lib/inventory/access.test.ts`

- [ ] **Step 3: Implement `access.ts`:**

```ts
import type { TenantPlan, UserRole } from "@/types";
import { hasAdvancedInventory } from "@/lib/utils/planGating";

/**
 * Who may switch on batches & locations: an admin/super_admin on a plan
 * that includes advanced inventory. Pure so the rule is unit-tested; the
 * route guard (authGuard.ts) is the enforcement point.
 */
export function canEnableAdvancedInventory(plan: TenantPlan, role: UserRole | null | undefined): boolean {
  return hasAdvancedInventory(plan) && (role === "admin" || role === "super_admin");
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest src/lib/inventory/access.test.ts`

- [ ] **Step 5: Read the route-handler guide** in `node_modules/next/dist/docs/` (find it with `ls node_modules/next/dist/docs/01-app/*` and open the route handlers file) and confirm an exported `async function POST()` returning `NextResponse.json(...)` is still the convention (it is what `src/app/api/billing/*` uses). Adjust the route below only if the guide says otherwise.

- [ ] **Step 6: Implement `authGuard.ts`:**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { canEnableAdvancedInventory } from "@/lib/inventory/access";
import type { Profile, TenantPlan } from "@/types";

export interface AdvancedInventoryAuthContext {
  userId: string;
  tenantSchema: string;
}

export type AdvancedInventoryAuthResult =
  | { context: AdvancedInventoryAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Guard for advanced-inventory admin routes. Checks, in order: signed in,
 * has a tenant, and canEnableAdvancedInventory(plan, role). The plan lives
 * in the control plane (Project A), which the tenant database cannot see —
 * that is why enable_advanced_inventory() is service_role-only and this
 * guard is the enforcement point. Server-only.
 */
export async function requireAdvancedInventoryAdmin(): Promise<AdvancedInventoryAuthResult> {
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
    .select("role")
    .eq("id", user.id)
    .single<Pick<Profile, "role">>();

  let plan: TenantPlan | null;
  try {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("plan")
      .eq("schema_name", tenantSchema)
      .single();
    plan = (tenant as { plan: TenantPlan } | null)?.plan ?? null;
  } catch (err) {
    console.error("requireAdvancedInventoryAdmin failed", err);
    return { error: NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 }) };
  }

  if (!plan) {
    return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }
  if (!canEnableAdvancedInventory(plan, profile?.role)) {
    return {
      error: NextResponse.json(
        { error: "Batches and locations are available to admins on the Business plan." },
        { status: 403 },
      ),
    };
  }

  return { context: { userId: user.id, tenantSchema } };
}
```

- [ ] **Step 7: Implement the route** — `src/app/api/inventory/enable-advanced/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdvancedInventoryAdmin } from "@/lib/inventory/authGuard";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";

/**
 * One-way switch for batches & locations. Idempotent — the RPC returns
 * early when already enabled. Audit logging happens client-side after a
 * 200 (Phase 2's enable card), the same way every other feature writes
 * writeAuditLog.
 */
export async function POST() {
  const auth = await requireAdvancedInventoryAdmin();
  if (auth.error) return auth.error;

  const service = createServiceClientForTenant(auth.context.tenantSchema);
  const { error } = await service.rpc("enable_advanced_inventory");
  if (error) {
    console.error("enable_advanced_inventory failed", error);
    return NextResponse.json({ error: inventoryErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Teach the verifier the new guard** — in `.claude/verifiers/rules.py`, change `_AUTH_MARKERS` to:

```python
_AUTH_MARKERS = re.compile(
    r"auth\.getUser\(\)|verifyPlatformAdmin|requireIntegrationAdmin|requireBillingAdmin"
    r"|requireAdvancedInventoryAdmin"
    r"|requirePermission|verifySignature|constructEvent|verifyNotificationSignature"
    r"|verifyWebhookSignature"
)
```

and in the `route-without-auth` rule's `message`, change `"requireIntegrationAdmin, requireBillingAdmin, or a webhook "` to `"requireIntegrationAdmin, requireBillingAdmin, requireAdvancedInventoryAdmin, or a webhook "`.

Run: `uv run .claude/verifiers/test_rules.py` — expect all pass. Then `uv run .claude/verifiers/verify_changes.py` — expect no `route-without-auth` finding for the new route.

- [ ] **Step 9: Commit**

```bash
git add src/lib/inventory/access.ts src/lib/inventory/access.test.ts src/lib/inventory/authGuard.ts src/app/api/inventory/enable-advanced/route.ts .claude/verifiers/rules.py
git commit -m "feat(inventory): enable-advanced route behind a Business-plan admin guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs (mandatory, same PR)

**Files:**
- Modify: `supabase/SKILL.md` (file-map table after the `046` row; Gotchas section)
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`
- Modify: `AGENTS.md` ("New shared code from the migration" list)
- Modify: `.claude/verifiers/README.md` (route-without-auth marker list, if it enumerates markers)
- Modify: `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md` (file names)

- [ ] **Step 1: `supabase/SKILL.md` file map** — add after the `046` row (use ✅ **applied** if Task 8 rolled out, else ⏳ **pending**):

```markdown
| `migrations/047_advanced_inventory.sql` | `public` function | <status> — defines `public.install_advanced_inventory(schema_name)`, the idempotent installer for Business-plan batches/locations/FIFO (tables `stock_locations`, `inventory_settings`, `platform_location_defaults`, `stock_lots`, `stock_transfers`, `stock_movements`; new `purchases`/`sales` columns; triggers; RPCs `enable_advanced_inventory` (service_role), `set_default_location`, `set_opening_lot_cost`). Touches no tenant by itself. Tests: `supabase/tests/advanced_inventory.test.sql`. See `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md`. |
| `migrations/048_advanced_inventory_apply.sql` | all `tenant_%` schemas | <status> — runs the 047 installer on every tenant via `run_on_all_tenant_schemas`. Inert until a tenant enables it. `005`'s `provision_tenant_schema()` calls the same installer for new tenants (re-apply `005`). |
```

- [ ] **Step 2: `supabase/SKILL.md` Gotchas** — append:

```markdown
- **Advanced inventory uses a shared installer, not duplicated DDL.** `047`
  defines `public.install_advanced_inventory(schema)`; `048` and
  `provision_tenant_schema()` both call it. To change the feature, edit the
  installer and re-run it on every tenant with
  `SELECT public.run_on_all_tenant_schemas($$ SELECT public.install_advanced_inventory('{{schema}}'); $$);`
  — never copy its SQL into 005. Inside its `format($sql$ … $sql$)` strings a
  literal `%` breaks `format()`; build messages with `||`.
- **Trigger/SQL tests run against live Project B safely**: execute 047 (only
  defines the installer), then `supabase/tests/advanced_inventory.test.sql`.
  It provisions `tenant_zz_invtest`, asserts, and raises `INV_TESTS_PASSED`
  to roll everything back — that error is the pass signal.
```

- [ ] **Step 3: `src/app/dashboard/inventory/CLAUDE.md`** — add a section after "How stock levels actually update":

```markdown
## Advanced inventory ledger (Business plan) — Phase 1 of 4

Batches, locations and FIFO cost of goods live entirely in Postgres
(`supabase/migrations/047_advanced_inventory.sql`, installer
`install_advanced_inventory`). Inert until a tenant admin calls
`POST /api/inventory/enable-advanced` (`src/lib/inventory/authGuard.ts`,
Business/trial + admin only), which creates "Main", maps every platform to
it, and turns today's `current_stock` into one opening lot per product at
cost 0. From then on:

- purchases create **lots** at landed cost (`_lib/landedCost.ts` mirrors the
  SQL formula); sales consume lots **FIFO** at their `fulfillment_location_id`
  (default per platform) and get `sales.cogs_amount`; missing stock goes to a
  **shortfall** lot that the next receipt settles and re-costs;
- `stock_transfers` move lots between locations (immutable; delete only while
  untouched); dropship-type locations never hold stock;
- the legacy `current_stock` triggers keep running unchanged for every plan.

Tables: `stock_locations`, `inventory_settings`, `platform_location_defaults`,
`stock_lots`, `stock_transfers`, `stock_movements`. Client-writable: locations,
platform defaults (admin), transfers. Everything else is trigger/RPC-owned.
Trigger errors are `INV_*: detail` — show them with
`inventoryErrorMessage()` (`src/lib/inventory/inventoryErrors.ts`).
UI arrives in Phases 2–4 (see the spec's "Phasing").
```

and add to its "Files in this folder" list: `` - `_lib/landedCost.ts` (+ test) — TS mirror of the SQL landed-unit-cost formula, for the purchase form read-out (Phase 3). ``; add to "Shared dependencies": `` - `lib/inventory/{inventoryErrors,access,authGuard}` — advanced-inventory error copy, enable rule, route guard ``; and change the Tests line to `` `npx jest dashboard/inventory` runs the slice and `_lib/landedCost` tests; SQL trigger tests: `supabase/tests/advanced_inventory.test.sql` (see `supabase/SKILL.md`). ``

- [ ] **Step 4: `src/app/dashboard/inventory/SKILL.md`** — add a minimal-file-set bullet and gotchas:

```markdown
- **Change advanced-inventory stock/cost behaviour** (FIFO, landed cost,
  shortfall, transfers): `supabase/migrations/047_advanced_inventory.sql`
  (installer) + `supabase/tests/advanced_inventory.test.sql`; if the landed-cost
  formula changes, also `_lib/landedCost.ts` + its test. Re-run the installer on
  all tenants (see `supabase/SKILL.md`).
```

```markdown
- **`sales.cogs_amount` is trigger-owned.** `inv_sale_before_write` discards
  any client-supplied value; only `inv_set_cogs`/`inv_recompute_cogs` (which set
  the transaction-local GUC `inv.writing_cogs`) can write it. Never send it.
- **Rows created before `enabled_at` are outside the ledger.** Editing or
  deleting a pre-enable purchase/sale adjusts legacy `current_stock` only, so
  lot totals can drift from `current_stock` by exactly those edits. By design
  ("start clean").
- **Only stock-relevant sale edits re-run FIFO** (product, location, quantity,
  or the consumes/doesn't-consume result). A stock-relevant edit may land on
  different lots than before if other sales consumed in between, changing that
  order's COGS.
- **Dropship purchases + dropship-fulfilled sales cancel out** in legacy
  `current_stock` and never touch lots, so `current_stock` equals the lot total
  for tenants that only ever used the ledger.
- **`enable_advanced_inventory()` is service_role-only** because the plan lives
  in the control plane; the route guard is the enforcement point.
```

- [ ] **Step 5: `AGENTS.md`** — in "New shared code from the migration", add after the `src/lib/support/` bullet:

```markdown
- `src/lib/inventory/` — advanced inventory (Business plan): `inventoryErrors.ts`
  (pure, client-safe `INV_*` error copy), `access.ts` (pure enable rule),
  `authGuard.ts` (server-only `requireAdvancedInventoryAdmin()`).
  `src/app/api/inventory/enable-advanced/` flips the per-tenant switch via the
  service-role RPC `enable_advanced_inventory`. The ledger itself is Postgres
  triggers — see `supabase/migrations/047_advanced_inventory.sql`.
```

- [ ] **Step 6: `.claude/verifiers/README.md`** — if it lists the `route-without-auth` markers, add `requireAdvancedInventoryAdmin` to that list.

- [ ] **Step 7: Spec file names** — in the spec, replace the `047_advanced_inventory.sql` sentence under "Architecture" with: "New migrations: `supabase/migrations/047_advanced_inventory.sql` (defines the shared installer `public.install_advanced_inventory`) and `048_advanced_inventory_apply.sql` (runs it on every tenant); `provision_tenant_schema()` calls the same installer." and under "Code layout" replace the migration bullet with `` - `supabase/migrations/047_advanced_inventory.sql` (installer), `048_advanced_inventory_apply.sql` (rollout), `005_tenant_provisioning.sql` (calls the installer) `` and `supabase/tests/advanced_inventory.sql` with `supabase/tests/advanced_inventory.test.sql`.

- [ ] **Step 8: Run all Phase 1 jest tests**

Run: `npx jest src/lib/utils/planGating.test.ts src/lib/inventory src/app/dashboard/inventory`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/SKILL.md src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md AGENTS.md .claude/verifiers/README.md docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
git commit -m "docs(inventory): advanced inventory ledger — SKILL/CLAUDE/AGENTS updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Phase 1)

| Spec requirement | Task |
| --- | --- |
| New tables + changed columns, RLS, select-only ledger | 4 |
| Landed cost (net of VAT + extras) | 3 (TS), 5 (SQL) |
| Purchase insert/update/delete rules, `INV_CONSUMED` | 5, 6 (consumed cases) |
| Shortfall lot + settlement re-costing | 5 (settle), 6 (tests) |
| Sale FIFO, platform default, revert/reapply, unrelated-edit skip, returned+restock, dropship | 6 |
| Trigger-owned `cogs_amount` | 5 (writers), 6 (guard) |
| Transfers FIFO + cost share, immutable, guarded delete, `INV_INSUFFICIENT`, `INV_DROPSHIP_LOCATION` | 7 |
| Location delete/type/default guards | 7 |
| Enable: Main, platform defaults, opening lots @0, one-way, idempotent | 5 |
| `set_opening_lot_cost`, `default_location_id` + `set_default_location` | 7 |
| Concurrency (advisory lock per product+location) | 5–7 |
| Error codes → user copy | 2 |
| Plan gating flag | 1 |
| Enable route + admin/plan guard | 9 |
| Existing + future tenants | 8 |
| Types, audit entities | 1 |
| Docs same PR | 10 |
| UI (tabs, modals, drawer, Purchases/Sales fields, audit writes) | **Phases 2–4 — separate plans** |
