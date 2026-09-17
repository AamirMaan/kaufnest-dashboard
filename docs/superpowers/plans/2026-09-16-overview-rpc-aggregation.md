# Overview Postgres RPC Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks 2 and 6 are CONTROLLER-EXECUTED, not implementer-dispatched** — see their notes. Do not delegate them to a subagent, and do not run their SQL against the live database without the human partner's explicit go-ahead in that moment, even though this plan specifies the exact commands.

**Goal:** Replace the Overview page's `fetchAllRows`-based client-side aggregation (up to 20,000 rows downloaded per load) with four Postgres functions that compute the same numbers server-side, returning only the aggregated JSON — preserving every existing figure and chart exactly.

**Architecture:** Four `LANGUAGE sql STABLE` functions (`get_sales_overview`, `get_expenses_overview`, `get_purchases_overview`, `get_payouts_overview`), one per table, added to every tenant schema via `run_on_all_tenant_schemas` and to `provision_tenant_schema()` for future tenants. `page.tsx` calls all four via `Promise.all(supabase.rpc(...))` and derives its stat cards/charts from the four small JSON results instead of raw rows.

**Tech Stack:** PostgreSQL (`jsonb_build_object`/`jsonb_agg`), Supabase JS `.rpc()`, TypeScript/React, Jest.

## Global Constraints

- Branch: create `feat/overview-rpc-aggregation` — wait, it already exists (stacked on `docs/backend-architecture-principles`, currently 3 commits: the design spec + its two corrections). Continue on that branch.
- Every commit must pass `.husky/pre-commit` (`tsc --noEmit`, `eslint`, project verifier) automatically.
- Per this session's rule: every commit trailer is exactly `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Per AGENTS.md rule 5: tenant-schema DDL goes through `run_on_all_tenant_schemas`, never a literal `CREATE FUNCTION tenant_kaufnest....`. Every new function also goes into `provision_tenant_schema()` in the same commit (the "2-places" rule, `supabase/SKILL.md`).
- Per AGENTS.md's Mandatory docs update rule: `supabase/CLAUDE.md`'s migration file-map gains an entry for the new migration, in the same commit as the migration itself.
- Do not "complete" or "fix" any of the business-logic quirks documented in the design spec's "Business logic inventory" section (two distinct revenue formulas, `advertising_fee`-only balance-card fees, hardcoded ebay/amazon-only platform breakdowns) — reproduce them exactly.
- The two live-database steps (Tasks 2 and 6) require the human partner's explicit confirmation in the moment before running, regardless of what this plan says — DDL against a live production system is a hard-to-reverse, shared-state action per this session's standing operating rules.

---

### Task 1: Migration file + `provision_tenant_schema()` + docs

**Files:**
- Create: `supabase/migrations/045_overview_aggregation_functions.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `supabase/CLAUDE.md`

**Interfaces:**
- Consumes: nothing — pure SQL, no TS.
- Produces: four Postgres functions per tenant schema, callable as
  `supabase.rpc("get_sales_overview", { p_from, p_to, p_currency })` (and
  the same for `get_expenses_overview`/`get_purchases_overview`/
  `get_payouts_overview`) via a schema-scoped client. Task 3's integration
  tests and Task 5's client rewiring both depend on these exact function
  names, parameter names (`p_from date`, `p_to date`, `p_currency text`),
  and JSON return shapes below.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/045_overview_aggregation_functions.sql`:

```sql
-- ============================================================
-- Overview aggregation functions — every tenant schema (run_on_all_tenant_schemas)
--
-- Replaces the Overview page's client-side fetchAllRows aggregation (up to
-- 5000 rows per table downloaded to compute a dozen numbers) with four
-- server-side functions, one per table, each returning a small jsonb
-- result. See docs/superpowers/specs/2026-09-16-overview-rpc-aggregation-design.md
-- for the full design and the "Business logic inventory" section this SQL
-- reproduces exactly (including two genuinely distinct revenue formulas —
-- do not unify them if you touch this file later).
--
-- Not SECURITY DEFINER: these run as the calling user, so the existing
-- sales_select/expenses_select/purchases_select/platform_payouts_select RLS
-- policies still gate what a tenant member can see, same as the client-side
-- .select() queries they replace.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets these from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM sales
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    effective AS (
      SELECT *
      FROM filtered
      WHERE status NOT IN ('returned', 'cancelled')
    ),
    by_platform AS (
      SELECT
        platform,
        sum(total_amount) AS sales,
        sum(coalesce(advertising_fee, 0)) AS ad_fees,
        sum(coalesce(shipping_cost, 0)) AS shipping_fees,
        count(*) AS cnt
      FROM effective
      GROUP BY platform
    ),
    top_products AS (
      SELECT product_name AS name, sum(total_amount) AS revenue, sum(quantity) AS units
      FROM effective
      GROUP BY product_name
      ORDER BY sum(total_amount) DESC
      LIMIT 5
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month,
             sum(total_amount + coalesce(shipping_charged, 0)) AS revenue
      FROM effective
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'orderCount', (SELECT count(*) FROM filtered),
      'effectiveOrderCount', (SELECT count(*) FROM effective),
      'unitsSold', (SELECT coalesce(sum(quantity), 0) FROM effective),
      'revenue', (SELECT coalesce(sum(total_amount + coalesce(shipping_charged, 0)), 0) FROM effective),
      'fees', (SELECT coalesce(sum(coalesce(shipping_cost, 0) + coalesce(advertising_fee, 0) + coalesce(platform_fee, 0)), 0) FROM effective),
      'vatCollected', (SELECT coalesce(sum(vat_amount), 0) FROM effective),
      'revenueByPlatform', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'value', sales) ORDER BY sales DESC), '[]'::jsonb)
        FROM by_platform
      ),
      'topProducts', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue, 'units', units)), '[]'::jsonb)
        FROM top_products
      ),
      'monthlyRevenue', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'revenue', revenue) ORDER BY month), '[]'::jsonb)
        FROM monthly
      ),
      'platformBalance', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'platform', platform, 'sales', sales, 'adFees', ad_fees, 'shippingFees', shipping_fees, 'count', cnt
        )), '[]'::jsonb)
        FROM by_platform
        WHERE platform IN ('ebay', 'amazon')
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_expenses_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM expenses
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    by_category AS (
      SELECT category, sum(amount) AS amount
      FROM filtered
      GROUP BY category
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(amount) AS amount
      FROM filtered
      GROUP BY 1
    ),
    platform_sub AS (
      SELECT 'ebay' AS platform, coalesce(sum(amount), 0) AS amount
      FROM filtered
      WHERE vendor ILIKE '%ebay%' OR title ILIKE '%ebay%'
      UNION ALL
      SELECT 'amazon' AS platform, coalesce(sum(amount), 0) AS amount
      FROM filtered
      WHERE vendor ILIKE '%amazon%' OR title ILIKE '%amazon%'
    )
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(amount), 0) FROM filtered),
      'vatPaid', (SELECT coalesce(sum(vat_amount), 0) FROM filtered),
      'byCategory', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) ORDER BY amount DESC), '[]'::jsonb)
        FROM by_category
      ),
      'monthlyExpenses', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount) ORDER BY month), '[]'::jsonb)
        FROM monthly
      ),
      'platformSubtotal', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'amount', amount)), '[]'::jsonb)
        FROM platform_sub
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_expenses_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_purchases_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM purchases
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    monthly AS (
      SELECT to_char(date, 'YYYY-MM') AS month, sum(total_amount) AS amount
      FROM filtered
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(total_amount), 0) FROM filtered),
      'vatPaid', (SELECT coalesce(sum(vat_amount), 0) FROM filtered),
      'monthlyPurchases', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount) ORDER BY month), '[]'::jsonb)
        FROM monthly
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_purchases_overview(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_payouts_overview(p_from date, p_to date, p_currency text)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    WITH filtered AS (
      SELECT *
      FROM platform_payouts
      WHERE currency = p_currency
        AND (p_from IS NULL OR date >= p_from)
        AND (p_to IS NULL OR date <= p_to)
    ),
    by_platform AS (
      SELECT platform, sum(amount) AS amount
      FROM filtered
      GROUP BY platform
    )
    SELECT jsonb_build_object(
      'transferred', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'amount', amount)), '[]'::jsonb)
        FROM by_platform
      )
    );
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_payouts_overview(date, date, text) TO authenticated;
$$);
```

- [ ] **Step 2: Add the same four functions to `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, find the block of
`EXECUTE format($sql$ CREATE OR REPLACE FUNCTION %1$I.current_user_has_override(...) ... $sql$, schema_name);`
statements (around line 463 as of this writing — search for
`current_user_has_override` to locate it precisely, since line numbers
shift as the file grows). Immediately after that block, insert four more
`EXECUTE format(...)` calls — same four function bodies as Step 1, with
two mechanical substitutions: `{{schema}}` → `%1$I` everywhere it prefixes
a function name, and add `SET search_path = %1$I` exactly as the existing
`current_user_role()`/`current_user_has_override()` functions already do
two lines above (see the file's existing pattern at that location — do not
invent new syntax). The function BODY between `$func$` markers is
byte-identical to Step 1's — only the two functions' outer wrapper differs
(`run_on_all_tenant_schemas`'s `{{schema}}` templating vs.
`provision_tenant_schema`'s `%1$I` + `EXECUTE format`). The `GRANT EXECUTE`
statements also move inside their own `EXECUTE format('GRANT EXECUTE ON
FUNCTION %1$I.get_sales_overview(date, date, text) TO authenticated',
schema_name);` calls (a plain string, no `$sql$` needed since it has no
nested dollar-quoting) — one per function, right after each function's
`EXECUTE format(...)` block.

- [ ] **Step 3: Update `supabase/CLAUDE.md`'s migration file map**

Add a new bullet after the `044_ebay_listing_drafts_pricing_marketing.sql`
entry:

```markdown
- `migrations/045_overview_aggregation_functions.sql` — adds four
  `LANGUAGE sql STABLE` functions (`get_sales_overview`,
  `get_expenses_overview`, `get_purchases_overview`, `get_payouts_overview`)
  to every tenant schema via `run_on_all_tenant_schemas`; also mirrored
  into `provision_tenant_schema()` in the same commit. Each takes
  `(p_from date, p_to date, p_currency text)` and returns a small `jsonb`
  aggregate instead of rows — replaces the Overview page's
  `fetchAllRows`-based client-side aggregation. Not `SECURITY DEFINER`, so
  existing RLS `_select` policies still gate visibility. See
  `docs/superpowers/specs/2026-09-16-overview-rpc-aggregation-design.md`
  for the full design, including the "Business logic inventory" of
  intentional quirks this SQL reproduces exactly (two distinct revenue
  formulas, `advertising_fee`-only balance-card fees, hardcoded
  ebay/amazon-only platform breakdowns). Backs the Overview page
  (`src/app/dashboard/page.tsx`).
```

- [ ] **Step 4: Verify SQL syntax without touching the live database**

Run: `cat supabase/migrations/045_overview_aggregation_functions.sql | grep -c '\$func\$'`
Expected: `8` (each of the 4 functions opens and closes one `$func$` pair).
This is a cheap sanity check that every function body is properly
terminated — full syntax validation happens in Task 2 against a real
database, since there is no local Postgres instance in this repo to run
migrations against offline.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_overview_aggregation_functions.sql supabase/migrations/005_tenant_provisioning.sql supabase/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(db): add Overview aggregation functions (get_sales/expenses/purchases/payouts_overview)

Four LANGUAGE sql STABLE functions, one per table, each returning a small
jsonb aggregate instead of rows. Replaces the Overview page's
fetchAllRows-based client-side aggregation (up to 5000 rows per table
downloaded to compute a dozen numbers). Not yet applied to any live
tenant schema — that's a separate, explicitly-confirmed step.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 [CONTROLLER-EXECUTED — requires explicit human confirmation]: Apply the functions to `tenant_boughtopia` only

**Do not dispatch this task to a subagent implementer.** This is DDL
against a live production database. The controller (you, running this
plan) executes this task directly, and only after the human partner has
explicitly confirmed in that moment — not because this plan says to, but
because they said so when asked.

**Files:** none — this runs SQL directly against the live database via
whatever tool the controller has for that (e.g. `mcp__supabase-data__execute_sql`).

- [ ] **Step 1: Ask for confirmation**

Show the human partner the exact SQL from Task 1's migration file, scoped
to just `tenant_boughtopia` (substitute `{{schema}}` → `tenant_boughtopia`
literally, since this is a one-off manual application, not a
`run_on_all_tenant_schemas` fan-out — applying the real migration to all 5
tenants is Task 6, later, after the client code is verified working).
Explain: this creates 4 new read-only aggregate functions in one schema,
touches no existing table or row, and is reversible (`DROP FUNCTION`) if
anything is wrong. Wait for explicit go-ahead.

- [ ] **Step 2: Apply**

Execute the 4 `CREATE OR REPLACE FUNCTION ... GRANT EXECUTE ...` statements
from Task 1's migration, with every `{{schema}}` replaced by the literal
`tenant_boughtopia`, against the live database.

- [ ] **Step 3: Verify**

Run a smoke-test query directly:
```sql
SELECT tenant_boughtopia.get_sales_overview(NULL, NULL, 'EUR');
```
Expected: a `jsonb` object with the 9 keys from Task 1's `get_sales_overview`
shape (`orderCount`, `effectiveOrderCount`, `unitsSold`, `revenue`, `fees`,
`vatCollected`, `revenueByPlatform`, `topProducts`, `monthlyRevenue`,
`platformBalance`) — 10 keys, not 9; recount when you actually run this.
Repeat for the other three functions with their respective table/currency.
If any query errors, fix the SQL in the migration file (Task 1) and
re-apply — do not leave a working copy in the database that diverges from
the checked-in migration file.

- [ ] **Step 4: Record what happened**

No commit needed (no files changed) — just confirm to the human partner
that the 4 functions exist and smoke-test cleanly in `tenant_boughtopia`,
so Task 3's integration tests have something real to run against.

---

### Task 3: Integration test infrastructure + tests for the four functions

**Files:**
- Create: `jest.integration.config.ts`
- Modify: `package.json` (add a `test:integration` script)
- Create: `src/app/dashboard/_lib/overviewRpc.integration.test.ts`

**Interfaces:**
- Consumes: the 4 live functions from Task 2, `createServiceClientForTenant`
  or an equivalent service-role client construction from
  `src/lib/supabase/server.ts` (read that file first to find the exact
  exported helper — do not guess its name or signature).
- Produces: nothing consumed by later tasks — this is a verification
  artifact, run manually via `npm run test:integration`, never part of
  `npx jest`'s default run or `.husky/pre-push`.

- [ ] **Step 1: Create the separate Jest config**

`jest.integration.config.ts`:
```ts
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/*.integration.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
};

export default config;
```
This mirrors `jest.config.ts` exactly except `testMatch` targets
`*.integration.test.ts` instead of `*.test.ts` — the two configs' patterns
are mutually exclusive (a file can't match both), so `npx jest` (using the
default config) will never pick up integration tests, and
`test:integration` will never pick up the regular suite.

- [ ] **Step 2: Add the npm script**

In `package.json`'s `"scripts"` block, add (alongside the existing `"test"`
script — read the file first to match its exact formatting/quoting style):
```json
"test:integration": "jest --config jest.integration.config.ts"
```

- [ ] **Step 3: Write the integration test**

First, read `src/lib/supabase/server.ts` in full to find the real exported
function for a service-role, schema-scoped client (used by the
provisioning routes to bypass RLS for setup/teardown) — do not invent a
name. Use it (not `createTenantClient()`, which is user-session-scoped and
subject to RLS/auth) to seed and clean up rows directly.

Create `src/app/dashboard/_lib/overviewRpc.integration.test.ts`:

```ts
/**
 * Integration tests for the Overview RPC functions (get_sales_overview,
 * get_expenses_overview, get_purchases_overview, get_payouts_overview).
 * These hit the REAL tenant_boughtopia schema over the network — not part
 * of the default `npx jest` run (see jest.integration.config.ts). Run with
 * `npm run test:integration`. Requires SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_URL in the environment (already present in
 * .env.local for local runs).
 */
import { /* the real exported helper found in Step 3's first sub-step */ } from "@/lib/supabase/server";

const SCHEMA = "tenant_boughtopia";
const TEST_MARKER = "overview-rpc-integration-test";

describe("Overview RPC functions (tenant_boughtopia)", () => {
  const insertedSaleIds: string[] = [];
  const insertedExpenseIds: string[] = [];

  afterEach(async () => {
    const client = /* construct the service client for SCHEMA */;
    if (insertedSaleIds.length > 0) {
      await client.from("sales").delete().in("id", insertedSaleIds);
      insertedSaleIds.length = 0;
    }
    if (insertedExpenseIds.length > 0) {
      await client.from("expenses").delete().in("id", insertedExpenseIds);
      insertedExpenseIds.length = 0;
    }
  });

  it("distinguishes Formula A (revenue) from Formula B (revenueByPlatform/topProducts) when shipping_charged is set", async () => {
    const client = /* construct the service client for SCHEMA */;
    // Need a real created_by (profiles.id) and product_name — insert with
    // a distinctive product_name/date so this test's rows are unambiguous
    // even if run concurrently with other activity in the schema.
    const { data, error } = await client
      .from("sales")
      .insert({
        platform: "ebay",
        product_name: `${TEST_MARKER}-widget`,
        quantity: 1,
        unit_price: 100,
        total_amount: 100,
        shipping_charged: 10,
        currency: "EUR",
        date: "2020-01-15", // fixed past date, outside any real data's range
        status: "delivered",
        created_by: /* a real profiles.id in tenant_boughtopia — query one via `SELECT id FROM profiles LIMIT 1` in a beforeAll and reuse it */,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedSaleIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview", {
      p_from: "2020-01-01",
      p_to: "2020-01-31",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    // Formula A: total_amount + shipping_charged = 110
    expect(result.revenue).toBe(110);
    // Formula B: total_amount alone = 100 — proves the two formulas were
    // NOT accidentally unified.
    expect(result.revenueByPlatform.find((p: { platform: string }) => p.platform === "ebay").value).toBe(100);
    expect(result.topProducts.find((p: { name: string }) => p.name === `${TEST_MARKER}-widget`).revenue).toBe(100);
  });

  it("excludes a returned sale from revenue/unitsSold/effectiveOrderCount but still counts it in orderCount", async () => {
    const client = /* construct the service client for SCHEMA */;
    const { data, error } = await client
      .from("sales")
      .insert({
        platform: "amazon",
        product_name: `${TEST_MARKER}-returned-widget`,
        quantity: 2,
        unit_price: 50,
        total_amount: 100,
        currency: "EUR",
        date: "2020-02-15",
        status: "returned",
        created_by: /* same real profiles.id as above */,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedSaleIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview", {
      p_from: "2020-02-01",
      p_to: "2020-02-28",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    expect(result.orderCount).toBeGreaterThanOrEqual(1);
    // A returned-only period contributes 0 to every effective-sales figure.
    expect(result.revenue).toBe(0);
    expect(result.unitsSold).toBe(0);
    expect(result.effectiveOrderCount).toBe(0);
  });

  it("matches an expense to a platform via case-insensitive vendor/title substring, not a column", async () => {
    const client = /* construct the service client for SCHEMA */;
    const { data, error } = await client
      .from("expenses")
      .insert({
        title: `${TEST_MARKER} EBAY selling fees`, // mixed case on purpose
        amount: 25,
        currency: "EUR",
        category: "advertising",
        date: "2020-03-15",
        created_by: /* same real profiles.id */,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedExpenseIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_expenses_overview", {
      p_from: "2020-03-01",
      p_to: "2020-03-31",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    expect(result.platformSubtotal.find((p: { platform: string }) => p.platform === "ebay").amount).toBe(25);
    expect(result.platformSubtotal.find((p: { platform: string }) => p.platform === "amazon").amount).toBe(0);
  });

  it("get_purchases_overview and get_payouts_overview return the documented shape on an empty period", async () => {
    const client = /* construct the service client for SCHEMA */;
    const params = { p_from: "1999-01-01", p_to: "1999-01-02", p_currency: "EUR" };

    const { data: purchases, error: pErr } = await client.rpc("get_purchases_overview", params);
    if (pErr) throw pErr;
    expect(purchases).toEqual({ total: 0, vatPaid: 0, monthlyPurchases: [] });

    const { data: payouts, error: payErr } = await client.rpc("get_payouts_overview", params);
    if (payErr) throw payErr;
    expect(payouts).toEqual({ transferred: [] });
  });
});
```

Fill in the two bracketed constructs (`/* construct the service client for
SCHEMA */` and `/* a real profiles.id... */`) using whatever
`src/lib/supabase/server.ts` actually exports — read it first, this plan
deliberately doesn't guess its exact signature. Query one real
`profiles.id` from `tenant_boughtopia` in a `beforeAll` and store it in a
module-level variable, reused by every test (a foreign key requires a real
row).

- [ ] **Step 4: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS, all 4 tests. If Task 2 hasn't been completed yet (the
functions don't exist in `tenant_boughtopia`), this will fail with a
"function does not exist" Postgres error — that's expected until Task 2
lands; do not proceed past this step until it passes for real.

- [ ] **Step 5: Confirm cleanup**

Run the smoke-test query from Task 2 Step 3 again
(`SELECT tenant_boughtopia.get_sales_overview(NULL, NULL, 'EUR');`) and
confirm `orderCount` has NOT grown from this test run — proving the
`afterEach` cleanup actually deleted the seeded rows.

- [ ] **Step 6: Commit**

```bash
git add jest.integration.config.ts package.json src/app/dashboard/_lib/overviewRpc.integration.test.ts
git commit -m "$(cat <<'EOF'
test: add integration tests for the Overview RPC functions

Separate jest.integration.config.ts + npm run test:integration, excluded
from the default npx jest run and .husky/pre-push — these hit the real
tenant_boughtopia schema over the network, unlike everything else in this
suite (AGENTS.md's testing convention: keep tests pure, no Supabase
deps). Verifies the Formula-A/B revenue distinction, the effective-sales
exclusion, and the vendor/title substring platform match against real
Postgres execution, not just inspection.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `computePending` signature change

**Files:**
- Modify: `src/app/dashboard/_lib/platformBalance.ts`
- Modify: `src/app/dashboard/_lib/platformBalance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computePending(balance: number, transferred: number): number`
  — Task 5 calls this with a plain number (from `payoutsOverview.transferred`,
  already summed per-platform by the RPC) instead of an array of
  `PlatformPayout` rows to reduce client-side.

- [ ] **Step 1: Read the current implementation**

Read `src/app/dashboard/_lib/platformBalance.ts` in full — confirm its
current signature and body before changing it (this plan describes the
change, not the exact current text, since it may have evolved).

- [ ] **Step 2: Write the failing test**

In `platformBalance.test.ts`, replace any existing test that passes an
array of payout objects with one that passes a plain number:
```ts
it("subtracts the pre-summed transferred amount from balance", () => {
  expect(computePending(500, 200)).toBe(300);
});

it("returns a negative pending when more was transferred than earned", () => {
  expect(computePending(100, 150)).toBe(-50);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest dashboard/_lib/platformBalance`
Expected: FAIL — type error or wrong result, since the current signature
expects an array.

- [ ] **Step 4: Update the implementation**

```ts
/**
 * Subtracts the amount already transferred to a platform from a
 * pre-computed balance. The caller is responsible for pre-summing
 * transferred amounts by date range and platform first (the
 * get_payouts_overview RPC does this server-side).
 *
 * @param balance - pre-computed balance for the platform
 * @param transferred - total amount already paid out for the platform in the period
 * @returns balance minus transferred
 */
export function computePending(balance: number, transferred: number): number {
  return balance - transferred;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest dashboard/_lib/platformBalance`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/_lib/platformBalance.ts src/app/dashboard/_lib/platformBalance.test.ts
git commit -m "$(cat <<'EOF'
refactor(dashboard): computePending takes a pre-summed number, not an array

Overview's payout data now comes from get_payouts_overview, which
returns transferred amounts already grouped by platform — the caller no
longer has a raw PlatformPayout[] to reduce.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rewire `src/app/dashboard/page.tsx` to the four RPCs

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/CLAUDE.md`
- Modify: `src/app/dashboard/SKILL.md`

**Interfaces:**
- Consumes: `get_sales_overview`/`get_expenses_overview`/
  `get_purchases_overview`/`get_payouts_overview` (Task 1's shapes),
  `computePending(balance: number, transferred: number): number` (Task 4).
- Produces: nothing consumed elsewhere — this is the leaf of the chain.

- [ ] **Step 1: Replace the fetch effect**

Read `src/app/dashboard/page.tsx` in full first (827 lines as of this
writing) — this task references specific line ranges from that read,
which WILL have shifted slightly from the numbers below once earlier tasks
in this plan (none of which touch this file) and any intervening edits are
accounted for; re-locate each piece by the code shown, not by trusting the
line numbers literally.

Replace the `useState` declarations for `sales`/`expenses`/`purchases`/
`payouts` (around line 108-111) with four new-shape state variables:

```ts
const [salesOverview, setSalesOverview] = useState<SalesOverview | null>(null);
const [expensesOverview, setExpensesOverview] = useState<ExpensesOverview | null>(null);
const [purchasesOverview, setPurchasesOverview] = useState<PurchasesOverview | null>(null);
const [payoutsOverview, setPayoutsOverview] = useState<PayoutsOverview | null>(null);
```

Add these four types near the top of the file (after the existing imports,
before `RANGE_PRESETS`):

```ts
interface PlatformBucket {
  platform: string;
  value: number;
}

interface TopProductBucket {
  name: string;
  revenue: number;
  units: number;
}

interface MonthlyBucket {
  month: string;
  revenue?: number;
  amount?: number;
}

interface PlatformBalanceBucket {
  platform: string;
  sales: number;
  adFees: number;
  shippingFees: number;
  count: number;
}

interface SalesOverview {
  orderCount: number;
  effectiveOrderCount: number;
  unitsSold: number;
  revenue: number;
  fees: number;
  vatCollected: number;
  revenueByPlatform: PlatformBucket[];
  topProducts: TopProductBucket[];
  monthlyRevenue: MonthlyBucket[];
  platformBalance: PlatformBalanceBucket[];
}

interface ExpensesOverview {
  total: number;
  vatPaid: number;
  byCategory: { category: ExpenseCategory; amount: number }[];
  monthlyExpenses: MonthlyBucket[];
  platformSubtotal: PlatformBucket[]; // .value is unused here; amount is on the raw RPC row — see Step 2's mapping
}

interface PurchasesOverview {
  total: number;
  vatPaid: number;
  monthlyPurchases: MonthlyBucket[];
}

interface PayoutsOverview {
  transferred: PlatformBucket[]; // .value is unused here; amount is on the raw RPC row — see Step 2's mapping
}
```

(Note: `platformSubtotal` and `transferred` rows actually come back from
Postgres as `{platform, amount}`, not `{platform, value}` — the interfaces
above use a generic `PlatformBucket` for `revenueByPlatform` only, which
DOES use `value`. Define `expensesOverview.platformSubtotal` and
`payoutsOverview.transferred` as `{ platform: string; amount: number }[]`
directly instead of reusing `PlatformBucket` — fix the two interface
fields above to that shape before using them, so the field name matches
what Postgres actually returns.)

Replace the `load()` function body (the `Promise.all` of four
`fetchAllRows(...)` calls) with:

```ts
async function load() {
  setIsLoading(true);
  const supabase = await createTenantClient();
  const rpcParams = {
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_currency: profileCurrency,
  };

  const [salesRes, expensesRes, purchasesRes, payoutsRes] = await Promise.all([
    supabase.rpc("get_sales_overview", rpcParams),
    supabase.rpc("get_expenses_overview", rpcParams),
    supabase.rpc("get_purchases_overview", rpcParams),
    supabase.rpc("get_payouts_overview", rpcParams),
  ]);

  if (cancelled) return;
  if (salesRes.error) console.error("get_sales_overview failed", salesRes.error);
  if (expensesRes.error) console.error("get_expenses_overview failed", expensesRes.error);
  if (purchasesRes.error) console.error("get_purchases_overview failed", purchasesRes.error);
  if (payoutsRes.error) console.error("get_payouts_overview failed", payoutsRes.error);

  setSalesOverview(salesRes.error ? null : (salesRes.data as SalesOverview));
  setExpensesOverview(expensesRes.error ? null : (expensesRes.data as ExpensesOverview));
  setPurchasesOverview(purchasesRes.error ? null : (purchasesRes.data as PurchasesOverview));
  setPayoutsOverview(payoutsRes.error ? null : (payoutsRes.data as PayoutsOverview));
  setIsLoading(false);
}
```

Remove the `fetchAllRows` import (no longer used in this file) and the
`OVERVIEW_ROW_CAP` constant.

- [ ] **Step 2: Replace every derived-value `useMemo`/computation**

Remove entirely: `periodSales`, `periodExpenses`, `periodPurchases`,
`periodPayouts`, `effectiveSales` (all the currency/date/status-filtering
`useMemo`s — the RPCs already filtered by currency and date, and
"effective" filtering happens in SQL now).

Replace the plain-`const` block (`totalRevenue`/`totalSaleFees`/
`totalExpenses`/`totalPurchases`/`netProfit`/`profitMargin`/
`avgOrderValue`/`unitsSold`/`vatCollected`/`vatPaid`/`vatPosition`/
`hasVatData`) with:

```ts
const totalRevenue = salesOverview?.revenue ?? 0;
const totalSaleFees = salesOverview?.fees ?? 0;
const totalExpenses = expensesOverview?.total ?? 0;
const totalPurchases = purchasesOverview?.total ?? 0;
const netProfit = calculateNetProfit(totalRevenue, totalExpenses + totalSaleFees, totalPurchases);
const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : null;
const avgOrderValue =
  salesOverview && salesOverview.effectiveOrderCount > 0
    ? totalRevenue / salesOverview.effectiveOrderCount
    : null;
const unitsSold = salesOverview?.unitsSold ?? 0;

const vatCollected = salesOverview?.vatCollected ?? 0;
const vatPaid = (purchasesOverview?.vatPaid ?? 0) + (expensesOverview?.vatPaid ?? 0);
const vatPosition = vatCollected - vatPaid;
const hasVatData = vatCollected !== 0 || vatPaid !== 0;
```

Replace the `monthlyTrend` `useMemo` (merges three monthly series by
`YYYY-MM` key) with:

```ts
const monthlyTrend = useMemo(() => {
  const map = new Map<string, { revenue: number; expenses: number; purchases: number }>();
  const get = (k: string) => map.get(k) ?? { revenue: 0, expenses: 0, purchases: 0 };

  for (const { month, revenue } of salesOverview?.monthlyRevenue ?? []) {
    map.set(month, { ...get(month), revenue: revenue ?? 0 });
  }
  for (const { month, amount } of expensesOverview?.monthlyExpenses ?? []) {
    const entry = get(month);
    map.set(month, { ...entry, expenses: entry.expenses + (amount ?? 0) });
  }
  for (const { month, amount } of purchasesOverview?.monthlyPurchases ?? []) {
    const entry = get(month);
    map.set(month, { ...entry, purchases: entry.purchases + (amount ?? 0) });
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, data]) => ({
      month: new Date(`${ym}-15`).toLocaleString("default", { month: "short", year: "2-digit" }),
      ...data,
    }));
}, [salesOverview, expensesOverview, purchasesOverview]);
```

Replace the `platformData` `useMemo` (revenue-by-platform pie chart) with:

```ts
const platformData = useMemo(() => {
  return (salesOverview?.revenueByPlatform ?? [])
    .map(({ platform, value }, index) => ({
      key: platform,
      name: platform.charAt(0).toUpperCase() + platform.slice(1),
      value,
      fill: platformColor(platform, index),
    }))
    .sort((a, b) => b.value - a.value);
}, [salesOverview]);
```

Replace `topProducts` with a direct read (no more client-side grouping —
the RPC already grouped and sliced to top 5):

```ts
const topProducts = salesOverview?.topProducts ?? [];
```

Replace `expensesByCategory` (previously a `[category, amount][]` tuple
array, consumed by the JSX as `expensesByCategory.map(([category, amount]) => ...)`)
with a mapping that preserves that exact tuple shape so the JSX below
doesn't need to change:

```ts
const expensesByCategory: [ExpenseCategory, number][] =
  (expensesOverview?.byCategory ?? []).map((c) => [c.category, c.amount]);
```

Replace `showCharts`:

```ts
const showCharts =
  (salesOverview?.orderCount ?? 0) > 0 ||
  (expensesOverview?.monthlyExpenses.length ?? 0) > 0 ||
  (purchasesOverview?.monthlyPurchases.length ?? 0) > 0;
```

Replace `ebayBalance`/`amazonBalance` — these now combine three RPCs'
per-platform figures instead of filtering raw rows. Write one helper and
call it twice (do NOT duplicate the body like the original two `useMemo`s
did — that duplication was tolerable when it was inline row-filtering, but
would be worse now that it also has to reach into three different RPC
result objects):

```ts
function computePlatformBalance(
  platform: "ebay" | "amazon"
): {
  balance: number;
  sales: number;
  adFees: number;
  shippingFees: number;
  expenses: number;
  transferred: number;
  pending: number;
  count: number;
} | null {
  const bucket = salesOverview?.platformBalance.find((p) => p.platform === platform);
  if (!bucket) return null;
  const expenses = expensesOverview?.platformSubtotal.find((p) => p.platform === platform)?.amount ?? 0;
  const balance = bucket.sales - bucket.adFees - bucket.shippingFees - expenses;
  const transferred = payoutsOverview?.transferred.find((p) => p.platform === platform)?.amount ?? 0;
  return {
    balance,
    sales: bucket.sales,
    adFees: bucket.adFees,
    shippingFees: bucket.shippingFees,
    expenses,
    transferred,
    pending: computePending(balance, transferred),
    count: bucket.count,
  };
}

const ebayBalance = useMemo(
  () => computePlatformBalance("ebay"),
  [salesOverview, expensesOverview, payoutsOverview]
);
const amazonBalance = useMemo(
  () => computePlatformBalance("amazon"),
  [salesOverview, expensesOverview, payoutsOverview]
);
```

Import `computePending` from `./_lib/platformBalance` if not already
imported (check the existing import line — it should already be there
from before this change, just confirm its usage still type-checks against
Task 4's new signature).

Remove the `expensesByCategory`'s own `useMemo` wrapper entirely if the
replacement above is a plain computation, not memoized — matching the
`topProducts`/`platformData` treatment above (memoize only where a
non-trivial array transform runs on every render; a `.map()` over an
already-small RPC-returned array doesn't need `useMemo` any more than
reading `salesOverview?.revenue` does, but keep whichever the surrounding
code's existing style leans toward — check how `topProducts`/`platformData`
end up styled once you've made this edit, and match it for
`expensesByCategory` too, for consistency within the file).

- [ ] **Step 3: Update the two feature docs**

`src/app/dashboard/CLAUDE.md`'s `page.tsx` bullet (the one this session's
earlier work already updated to describe `fetchAllRows`/`OVERVIEW_ROW_CAP`)
needs rewriting to describe the RPC-based approach instead — read the
current bullet, then replace its data-fetching description with: "fetches
all four tables' aggregates via `supabase.rpc(...)` calls to
`get_sales_overview`/`get_expenses_overview`/`get_purchases_overview`/
`get_payouts_overview` (see `supabase/CLAUDE.md`'s migration 045 entry and
`docs/superpowers/specs/2026-09-16-overview-rpc-aggregation-design.md`),
each taking the date-range filter and `profileCurrency` as SQL parameters
— no more client-side currency filtering or row-level aggregation." Keep
the rest of the bullet (StatCard list, chart descriptions) as-is where
still accurate; update anywhere it still describes `fetchAllRows`/
`OVERVIEW_ROW_CAP`/row-level `useMemo` filtering.

`src/app/dashboard/SKILL.md`'s Max Rows gotcha section (already pointing
at `BACKEND_ARCHITECTURE_PRINCIPLES.md` from this session's earlier work)
needs one added sentence noting the Overview page itself no longer
exercises this gotcha at all — it moved to server-side aggregation — so a
future reader isn't confused about why `page.tsx` no longer shows a
`fetchAllRows` call.

- [ ] **Step 4: Manual verification**

Per this repo's working agreement: do not start the dev server yourself.
Ask the human partner to run `npm run dev`, open `/dashboard`, and confirm:
the 5 stat cards show numbers, the eBay/Amazon balance cards render (if
that tenant has eBay/Amazon sales), the Monthly Trend chart and Revenue by
Platform donut render, Top Products and Expenses by Category render, and
switching the date-range preset re-fetches and updates all of the above.
If the Playwright MCP server is connected and `npm run dev` is already
running, using it to drive this check yourself is fine.

- [ ] **Step 5: Run the full non-integration suite**

Run: `npx jest && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/CLAUDE.md src/app/dashboard/SKILL.md
git commit -m "$(cat <<'EOF'
refactor(dashboard): rewire Overview to the four aggregation RPCs

Replaces fetchAllRows-based client-side aggregation (up to 20,000 rows
downloaded per load across 4 tables) with 4 supabase.rpc() calls
returning pre-aggregated JSON. Every stat card, chart, and platform
balance figure preserves its exact prior value and formula — including
the two distinct revenue formulas and the ebay/amazon-only balance-card
hardcoding documented in the design spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 [CONTROLLER-EXECUTED — requires explicit human confirmation]: Roll out to all 5 live tenant schemas

**Do not dispatch this task to a subagent.** Same rule as Task 2 — DDL
against production, only after the human partner explicitly confirms in
that moment, done after Task 5 is verified working (manual check passed).

**Files:** none — runs the already-committed migration file's SQL live.

- [ ] **Step 1: Ask for confirmation**

Confirm with the human partner that Task 5's manual verification passed,
then ask to proceed with applying `045_overview_aggregation_functions.sql`
to all 5 live tenant schemas (`tenant_kaufnest`, `tenant_hochkauf`,
`tenant_k2_textil`, `tenant_waqasmumtaz`, `tenant_boughtopia` — the last
one already has these functions from Task 2, and `CREATE OR REPLACE
FUNCTION` re-applying there is a harmless no-op).

- [ ] **Step 2: Apply**

Execute `SELECT public.run_on_all_tenant_schemas($$ ... $$);` — the exact,
full contents of Task 1's migration file (not the tenant_boughtopia-only
manual version from Task 2), against the live database.

- [ ] **Step 3: Verify**

Run the same smoke-test query from Task 2 Step 3, once per tenant schema
(`tenant_kaufnest.get_sales_overview(NULL, NULL, 'EUR')`, etc.) — confirm
all 5 return a valid `jsonb` object with no error.

- [ ] **Step 4: Record what happened**

No commit needed. Confirm to the human partner that the migration is now
live on all 5 tenants and the Overview page is running on the new RPC
path everywhere, not just `tenant_boughtopia`.

---

### Task 7: Final verification and PR

**Files:** none — verification and git operations only.

- [ ] **Step 1: Run everything**

```bash
npx jest
npx tsc --noEmit
uv run .claude/verifiers/test_rules.py
uv run .claude/verifiers/verify_changes.py --all
npm run test:integration
```
Expected: all clean/passing. The verifier's warning count should be
unchanged from whatever Tasks 1-8 of the previous plan (backend
architecture principles) left it at, since this branch's own new SQL/TS
files shouldn't introduce new `unbounded-limit`/`unpaginated-collection-read`
findings (the new page.tsx code calls `.rpc(...)`, not `.select(...)` on a
growth table without bounds) — if `verify_changes.py --all` DOES report a
new finding in `page.tsx`, investigate before proceeding; don't assume
it's noise.

- [ ] **Step 2: Confirm git state**

```bash
git log --oneline docs/backend-architecture-principles..HEAD
git status --short
```
Expected: working tree clean, commits from Tasks 1, 3, 4, 5 present (Tasks
2 and 6 make no commits — they're live-database operations only).

- [ ] **Step 3: Push and open the PR**

Ask the human partner whether to push/open a PR now, matching how the
previous plan's finish step worked (they may want to keep this branch
local too, or merge it together with `docs/backend-architecture-principles`
in one PR since this branch stacks on top of it — that's their call, not
this plan's).

## Self-review notes

- **Spec coverage:** the design spec's four function shapes → Task 1. The
  "don't touch fetchAllRows/pagination/CSV exports" non-goals → nothing in
  this plan touches those files. The Formula-A/B distinction, the
  effective-sales filter, the vendor/title substring match, and the
  hardcoded ebay/amazon scope → all reproduced in Task 1's SQL and tested
  in Task 3. The `effectiveOrderCount` correction (added to the spec
  during this plan's writing) → present in Task 1's SQL and Task 5's
  `avgOrderValue` computation.
- **Placeholder scan:** Task 5's Step 1 line-number caveat ("WILL have
  shifted slightly") is a note about re-locating code by content, not a
  placeholder for missing content — every code block in every task is the
  actual code to write. Task 3's two bracketed constructs
  (`/* construct the service client for SCHEMA */`) are real gaps, called
  out explicitly as things Step 3 resolves by reading a specific file
  first — not silently glossed over as "the appropriate client."
- **Type consistency:** `SalesOverview`/`ExpensesOverview`/
  `PurchasesOverview`/`PayoutsOverview` field names are used identically in
  Task 5's `load()` function and its derived-value computations. Flagged
  and corrected one inconsistency while writing this plan: `platformSubtotal`/
  `transferred` come back from Postgres as `{platform, amount}`, not
  `{platform, value}` like `revenueByPlatform` — Task 5's Step 1 explicitly
  calls this out rather than leaving a `PlatformBucket` reused across
  three shapes that don't actually agree.
- **Controller-executed tasks:** Tasks 2 and 6 are marked, in their
  headers and in Global Constraints, as not-for-subagent-dispatch. If
  running this plan under subagent-driven-development, do not generate a
  task brief for them the way Tasks 1/3/4/5/7 get one — handle them
  directly, with confirmation, in the controller session.
