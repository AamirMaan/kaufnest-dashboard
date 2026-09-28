# Sales Marketplace + VAT Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each order's marketplace (`amazon.de`, `ebay.co.uk`, …) from imports and platform sync, backfill it on re-import, and surface it (Orders column/filter, Analytics card) together with a net "VAT base" figure for tax declarations.

**Architecture:** One nullable `sales.marketplace` text column (migration 052) filled by a single pure normaliser (`src/lib/utils/marketplace.ts`) used by the CSV importer, the eBay/Amazon adapters and the Add/Edit modals. The VAT base is never stored — `get_sales_summary` and a new `get_sales_by_marketplace` RPC compute `total_amount + shipping_charged − vat_amount` over VAT-bearing orders. Re-import backfill rides on the importer's existing duplicate pre-check.

**Tech Stack:** Next.js App Router, TypeScript, Redux Toolkit, Supabase (PostgREST + Postgres SQL functions), Jest.

**Spec:** `docs/superpowers/specs/2026-09-28-sales-marketplace-vat-base-design.md`

## Global Constraints

- Branch: `feat/sales-marketplace-vat-base` (already created from `main`). Never commit to `main`.
- Tenant DDL only via `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)` **and** mirrored in `provision_tenant_schema()` in `supabase/migrations/005_tenant_provisioning.sql` (inside `format()` → use `%1$I`, and **no literal `%` characters**).
- Never query `public.*`; never hardcode a schema name.
- Stored marketplace form: lower-case domain (`amazon.de`, `amazon.co.uk`, `ebay.de`, `ebay.com`). `null` = unknown.
- Unknown-marketplace filter sentinel: the string `"__unknown__"` (client and SQL must match exactly).
- VAT base formula (everywhere): `sum(total_amount + coalesce(shipping_charged, 0) − vat_amount)` over rows with `coalesce(vat_amount, 0) > 0`, same status exclusion as the neighbouring gross/VAT sums. Reason: for Amazon, `total_amount` is the **item** total, shipping lives in `shipping_charged`, and `vat_amount` is the **combined** item + shipping VAT.
- `Sale.marketplace` is declared **optional** (`marketplace?: string | null`), matching the `fulfillment_location_id?` precedent, so the dozens of existing `Sale` literals in tests don't all need editing.
- Do NOT alias the Amazon `SALES_CHANNEL` header — in the VAT report it holds `AFN`/`MFN` (fulfilment channel), not a marketplace.
- Every mutation fires a `useToast()` on success and failure; never return a raw Postgres error to the client.
- Run only focused tests: `npx jest <path>`. Do not run `tsc`/`lint` by hand — `.husky/pre-commit` does, fix what it reports and re-run the same commit.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Each task updates the affected `CLAUDE.md`/`SKILL.md` in the **same commit** as its code.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lib/utils/marketplace.ts` (+ `.test.ts`) | create | `normalizeMarketplace`, `UNKNOWN_MARKETPLACE`, `marketplaceLabel` |
| `src/types/index.ts` | modify | `Sale.marketplace?`, `SalesSummaryRow.vat_base` |
| `supabase/migrations/052_sales_marketplace.sql` | create | column, index, 3 SQL functions |
| `supabase/migrations/005_tenant_provisioning.sql` | modify | same for new tenants |
| `src/lib/utils/importAliases.ts` | modify | `marketplace` aliases |
| `src/app/dashboard/sales/_components/importFormats.ts` (+ test) | modify | parse marketplace |
| `src/app/dashboard/sales/_components/marketplaceBackfill.ts` (+ test) | create | pure duplicate-marking + backfill grouping |
| `src/app/dashboard/sales/_components/ImportSalesModal.tsx` | modify | wire backfill |
| `src/app/dashboard/sales/page.tsx` | modify | toast, filter, cell, tile, export |
| `src/lib/integrations/{types,amazon,ebay,mapToSale,mergeImportedSale}.ts` (+ tests) | modify | sync capture, fill-only merge |
| `src/lib/utils/filters.ts` (+ test) | modify | `SalesFilters.marketplace` |
| `src/app/dashboard/sales/_store/{salesFilterParams,salesSlice}.ts` (+ tests) | modify | `p_marketplace` |
| `src/app/dashboard/sales/_lib/salesSummaryTiles.ts` (+ test) | modify | VAT base tile |
| `src/app/dashboard/sales/_components/{AddSaleModal,EditSaleModal}.tsx`, `sales/[id]/page.tsx` | modify | manual field + display |
| `src/app/dashboard/_lib/marketplaceRows.ts` (+ test) | create | Analytics row shaping |
| `src/app/dashboard/_lib/overviewTypes.ts` | modify | `MarketplaceRow` type |
| `src/app/dashboard/_components/{useOverviewData.ts,MarketplaceCard.tsx}` | modify/create | fetch + card |
| `src/app/dashboard/analytics/page.tsx` | modify | render card |

---

### Task 1: `normalizeMarketplace` helper + `Sale.marketplace` type

**Files:**
- Create: `src/lib/utils/marketplace.ts`
- Test: `src/lib/utils/marketplace.test.ts`
- Modify: `src/types/index.ts` (`Sale` interface, after `external_order_id`)
- Docs: root `AGENTS.md` shared `src/lib/*` list

**Interfaces:**
- Produces: `normalizeMarketplace(raw: string | null | undefined): string | null`, `UNKNOWN_MARKETPLACE = "__unknown__"`, `marketplaceLabel(m: string | null): string` (returns `"Unknown"` for null/empty, else the value), `Sale.marketplace?: string | null`.

- [ ] **Step 1: Write the failing test** — `src/lib/utils/marketplace.test.ts`

```ts
import { normalizeMarketplace, marketplaceLabel, UNKNOWN_MARKETPLACE } from "./marketplace";

describe("normalizeMarketplace", () => {
  it.each([
    ["Amazon.de", "amazon.de"],
    ["  amazon.DE ", "amazon.de"],
    ["amazon.co.uk", "amazon.co.uk"],
    ["www.amazon.fr", "amazon.fr"],
    ["EBAY_DE", "ebay.de"],
    ["ebay_fr", "ebay.fr"],
    ["EBAY_GB", "ebay.co.uk"],
    ["EBAY_US", "ebay.com"],
    ["EBAY_AU", "ebay.com.au"],
    ["EBAY_MOTORS_US", "ebay.com"],
    ["ebay.de", "ebay.de"],
    ["Etsy.com", "etsy.com"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMarketplace(raw)).toBe(expected);
  });

  it.each(["amazon", "Amazon", "ebay", "EBAY", "", "   "])("%p carries no market → null", (raw) => {
    expect(normalizeMarketplace(raw)).toBeNull();
  });

  it("null/undefined → null", () => {
    expect(normalizeMarketplace(null)).toBeNull();
    expect(normalizeMarketplace(undefined)).toBeNull();
  });
});

describe("marketplaceLabel", () => {
  it("labels null/empty as Unknown", () => {
    expect(marketplaceLabel(null)).toBe("Unknown");
    expect(marketplaceLabel("")).toBe("Unknown");
  });
  it("returns the stored value otherwise", () => {
    expect(marketplaceLabel("amazon.de")).toBe("amazon.de");
  });
  it("exports the filter sentinel", () => {
    expect(UNKNOWN_MARKETPLACE).toBe("__unknown__");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/utils/marketplace.test.ts`
Expected: FAIL — `Cannot find module './marketplace'`.

- [ ] **Step 3: Implement** — `src/lib/utils/marketplace.ts`

```ts
/**
 * Marketplace = the regional storefront an order was sold on (amazon.de,
 * ebay.co.uk, …) — finer than `Sale.platform` ("amazon"). Stored on
 * `sales.marketplace` (migration 052) as a lower-case domain; null means
 * unknown. Pure and dependency-free: used by the Sales CSV importer, the
 * server-side eBay/Amazon adapters, and the Add/Edit Sale modals.
 */

/** Filter-bar / RPC sentinel for "orders with no marketplace". Must match 052's SQL. */
export const UNKNOWN_MARKETPLACE = "__unknown__";

/** eBay API site ids whose domain suffix isn't simply the lower-cased country code. */
const EBAY_SITE_DOMAINS: Record<string, string> = {
  GB: "ebay.co.uk",
  UK: "ebay.co.uk",
  US: "ebay.com",
  MOTORS_US: "ebay.com",
  AU: "ebay.com.au",
};

/** Bare platform names say nothing about the market. */
const NO_MARKET = new Set(["amazon", "ebay", "etsy", "shopify", "other"]);

export function normalizeMarketplace(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;

  const ebayId = /^ebay_(.+)$/i.exec(s);
  if (ebayId) {
    const site = ebayId[1].toUpperCase();
    return EBAY_SITE_DOMAINS[site] ?? `ebay.${site.toLowerCase()}`;
  }

  const lower = s.toLowerCase().replace(/^www\./, "");
  return NO_MARKET.has(lower) ? null : lower;
}

export function marketplaceLabel(m: string | null | undefined): string {
  return m ? m : "Unknown";
}
```

- [ ] **Step 4: Add the type** — in `src/types/index.ts`, inside `interface Sale`, directly after the `external_order_id` line:

```ts
  /**
   * Regional storefront, e.g. "amazon.de", "ebay.co.uk" (migration 052).
   * Lower-case domain via `normalizeMarketplace` (lib/utils/marketplace.ts);
   * null/absent = unknown. Optional like `fulfillment_location_id` so
   * existing Sale literals stay valid.
   */
  marketplace?: string | null;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/lib/utils/marketplace.test.ts`
Expected: PASS.

- [ ] **Step 6: Docs** — in root `AGENTS.md`, in the "Shared vs. feature-private" `src/lib/*` bullet list, add after the `src/lib/fx/` bullet:

```md
- `src/lib/utils/marketplace.ts` (2026-09-28) — `normalizeMarketplace`
  (Amazon `Amazon.de`/eBay `EBAY_GB` → `amazon.de`/`ebay.co.uk`; bare
  platform names → null), `marketplaceLabel`, `UNKNOWN_MARKETPLACE`
  sentinel. Used by the Sales importer, the eBay/Amazon adapters and the
  Add/Edit Sale modals — see `sales/SKILL.md`.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/marketplace.ts src/lib/utils/marketplace.test.ts src/types/index.ts AGENTS.md
git commit -m "feat(sales): normalizeMarketplace helper + Sale.marketplace type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 052 — column, index, SQL functions

**Files:**
- Create: `supabase/migrations/052_sales_marketplace.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (sales `CREATE TABLE` ~line 138-185; index block ~line 887-898; `get_sales_summary` block ~line 1047-1089; append new functions right after the `get_sales_summary` GRANT)
- Modify: `src/types/index.ts` (`SalesSummaryRow`)
- Docs: `supabase/SKILL.md` (file-map row), `supabase/CLAUDE.md` if it lists migrations

**Interfaces:**
- Produces (SQL, per tenant schema):
  - `get_sales_summary(p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text, p_marketplace text DEFAULT NULL)` → adds column `vat_base numeric` (last).
  - `get_sales_by_marketplace(p_from date, p_to date, p_currency text)` → `TABLE (marketplace text, order_count int, revenue numeric, vat numeric, vat_base numeric)`, ordered by revenue desc.
  - `get_sales_marketplaces()` → `TABLE (marketplace text)`, distinct non-null, ordered.
- Produces (TS): `SalesSummaryRow.vat_base: number`.

- [ ] **Step 1: Write `supabase/migrations/052_sales_marketplace.sql`**

```sql
-- ============================================================
-- 052 — sales.marketplace + VAT base
--
-- `marketplace`: regional storefront (amazon.de, ebay.co.uk …), normalised
-- client-side by normalizeMarketplace (src/lib/utils/marketplace.ts). NULL =
-- unknown (manual entries, pre-052 imports not yet re-imported).
--
-- VAT base (net taxable amount declared to the tax office) is DERIVED, not
-- stored: total_amount + shipping_charged − vat_amount over rows with VAT.
-- For Amazon, total_amount is the ITEM total, shipping lives in
-- shipping_charged, and vat_amount is the COMBINED item + shipping VAT —
-- dropping shipping_charged would understate the base.
--
-- get_sales_summary gains p_marketplace (DEFAULT NULL, so a client still
-- sending the 6 old named args keeps working mid-deploy) and a trailing
-- vat_base column. Its parameter list changes, so the old signature is
-- DROPPED first — CREATE OR REPLACE cannot change it, and leaving it would
-- create an ambiguous overload.
--
-- '__unknown__' is the client's UNKNOWN_MARKETPLACE sentinel — keep in sync.
-- Not SECURITY DEFINER (RLS on sales applies). Also baked into
-- provision_tenant_schema() (005, same commit).
-- See docs/superpowers/specs/2026-09-28-sales-marketplace-vat-base-design.md
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales ADD COLUMN IF NOT EXISTS marketplace text;
  CREATE INDEX IF NOT EXISTS idx_sales_marketplace ON {{schema}}.sales (marketplace);

  DROP FUNCTION IF EXISTS {{schema}}.get_sales_summary(date, date, text, text, text, text);

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_summary(
    p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
    p_marketplace text DEFAULT NULL
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

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_summary(date, date, text, text, text, text, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_by_marketplace(p_from date, p_to date, p_currency text)
  RETURNS TABLE (marketplace text, order_count int, revenue numeric, vat numeric, vat_base numeric)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT
      s.marketplace,
      count(*)::int,
      coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0)), 0),
      coalesce(sum(coalesce(s.vat_amount, 0)), 0),
      coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0) - s.vat_amount)
               FILTER (WHERE coalesce(s.vat_amount, 0) > 0), 0)
    FROM sales s
    WHERE s.currency = p_currency
      AND s.status NOT IN ('returned', 'cancelled')
      AND (p_from IS NULL OR s.date >= p_from)
      AND (p_to IS NULL OR s.date <= p_to)
    GROUP BY s.marketplace
    ORDER BY 3 DESC, 1;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_by_marketplace(date, date, text) TO authenticated;

  CREATE OR REPLACE FUNCTION {{schema}}.get_sales_marketplaces()
  RETURNS TABLE (marketplace text)
  LANGUAGE sql STABLE
  SET search_path = {{schema}}
  AS $func$
    SELECT DISTINCT s.marketplace FROM sales s WHERE s.marketplace IS NOT NULL ORDER BY 1;
  $func$;

  GRANT EXECUTE ON FUNCTION {{schema}}.get_sales_marketplaces() TO authenticated;
$$);
```

- [ ] **Step 2: Mirror in `005_tenant_provisioning.sql`**

(a) In the `CREATE TABLE IF NOT EXISTS %1$I.sales` column list, directly after `external_order_id text,` add:

```sql
      -- Regional storefront (amazon.de …) — see 052_sales_marketplace.sql.
      marketplace text,
```

(b) After the line creating `idx_sales_platform_external_order_id` add:

```sql
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_marketplace ON %1$I.sales (marketplace)', schema_name);
```

(c) Replace the whole `get_sales_summary` `EXECUTE format($sql$ … $sql$, schema_name);` block **and** its `GRANT` line with the following (a fresh tenant has no old overload, but keep the DROP so re-applying 005 over an existing schema is safe):

```sql
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.get_sales_summary(date, date, text, text, text, text)', schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.get_sales_summary(
      p_from date, p_to date, p_platform text, p_currency text, p_status text, p_pattern text,
      p_marketplace text DEFAULT NULL
    )
    RETURNS TABLE (
      currency text, order_count int, gross numeric, vat numeric,
      fees numeric, shipping_charged numeric, excluded_count int, vat_base numeric
    )
    LANGUAGE sql STABLE
    SET search_path = %1$I
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
  $sql$, schema_name);

  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_sales_summary(date, date, text, text, text, text, text) TO authenticated', schema_name);

  -- Marketplace breakdown + filter options — see 052_sales_marketplace.sql.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.get_sales_by_marketplace(p_from date, p_to date, p_currency text)
    RETURNS TABLE (marketplace text, order_count int, revenue numeric, vat numeric, vat_base numeric)
    LANGUAGE sql STABLE
    SET search_path = %1$I
    AS $func$
      SELECT
        s.marketplace,
        count(*)::int,
        coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0)), 0),
        coalesce(sum(coalesce(s.vat_amount, 0)), 0),
        coalesce(sum(s.total_amount + coalesce(s.shipping_charged, 0) - s.vat_amount)
                 FILTER (WHERE coalesce(s.vat_amount, 0) > 0), 0)
      FROM sales s
      WHERE s.currency = p_currency
        AND s.status NOT IN ('returned', 'cancelled')
        AND (p_from IS NULL OR s.date >= p_from)
        AND (p_to IS NULL OR s.date <= p_to)
      GROUP BY s.marketplace
      ORDER BY 3 DESC, 1;
    $func$;
  $sql$, schema_name);

  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_sales_by_marketplace(date, date, text) TO authenticated', schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.get_sales_marketplaces()
    RETURNS TABLE (marketplace text)
    LANGUAGE sql STABLE
    SET search_path = %1$I
    AS $func$
      SELECT DISTINCT s.marketplace FROM sales s WHERE s.marketplace IS NOT NULL ORDER BY 1;
    $func$;
  $sql$, schema_name);

  EXECUTE format('GRANT EXECUTE ON FUNCTION %1$I.get_sales_marketplaces() TO authenticated', schema_name);
```

Verify no `%` other than `%1$I` was introduced: `grep -n "052\|marketplace" supabase/migrations/005_tenant_provisioning.sql` and eyeball the new lines.

- [ ] **Step 3: Type** — in `src/types/index.ts`, `interface SalesSummaryRow`, add after `excluded_count: number;`:

```ts
  /** Net taxable base: total + shipping_charged − VAT over VAT-bearing orders (052). */
  vat_base: number;
```

Update the fixture in `src/app/dashboard/sales/_lib/salesSummaryTiles.test.ts` `row()` default object to include `vat_base: 104.99` (119 + 4.99 − 19) and in `src/app/dashboard/sales/_store/salesSlice.test.ts` add `vat_base: 0` to its `row` fixture (find with `grep -n "excluded_count" src/app/dashboard/sales/_store/salesSlice.test.ts`).

Run: `npx jest dashboard/sales/_lib dashboard/sales/_store`
Expected: PASS (fixtures only changed).

- [ ] **Step 4: Apply to the live database — ASK THE USER FIRST.** This writes to Project B (all tenants). Ask: "Apply 052 and the updated 005 to Project B now via the supabase-data MCP?" Only on an explicit yes, run 052's contents, then 005's full `provision_tenant_schema()` definition, with `mcp__supabase-data__execute_sql`. Then verify:

```sql
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('get_sales_summary','get_sales_by_marketplace','get_sales_marketplaces')
ORDER BY 1, 2;
```

Expected: one `get_sales_summary` per tenant schema with 7 args, plus the two new functions per schema. If the user says no, record "⏳ pending" in the docs row (Step 5).

- [ ] **Step 5: Docs** — add a row to `supabase/SKILL.md`'s file-map table after the `051` row:

```md
| `migrations/052_sales_marketplace.sql` | all `tenant_%` schemas | ⏳ **pending** (or ✅ applied <date> if Step 4 ran) — adds nullable `sales.marketplace text` + `idx_sales_marketplace`; redefines `get_sales_summary` with `p_marketplace text DEFAULT NULL` (old 6-arg signature DROPPED first — CREATE OR REPLACE can't change a parameter list) and a trailing `vat_base` column (`total_amount + shipping_charged − vat_amount` over VAT-bearing rows); adds `get_sales_by_marketplace(p_from, p_to, p_currency)` and `get_sales_marketplaces()`. `'__unknown__'` = client `UNKNOWN_MARKETPLACE`. Also baked into `provision_tenant_schema()`. Backs Sales + Analytics. |
```

If `supabase/CLAUDE.md` has a per-migration list (`grep -n "051" supabase/CLAUDE.md`), add a matching 052 entry.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/052_sales_marketplace.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts src/app/dashboard/sales/_lib/salesSummaryTiles.test.ts src/app/dashboard/sales/_store/salesSlice.test.ts supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(db): 052 sales.marketplace, VAT base in get_sales_summary, marketplace RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Parse marketplace in the CSV import formats

**Files:**
- Modify: `src/lib/utils/importAliases.ts` (`ALIASES`, sales block)
- Modify: `src/app/dashboard/sales/_components/importFormats.ts` (`RICH_COLUMNS`, `RICH_HEADERS`, generic `columns`/`templateHeaders`/`templateExample`, amazon/ebay `templateExample`, `validateRowForFormat` return)
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`, `src/app/dashboard/sales/_components/dedupeImportRows.test.ts`
- Docs: `src/app/dashboard/sales/SKILL.md`, `src/app/dashboard/sales/CLAUDE.md`

**Interfaces:**
- Consumes: `normalizeMarketplace` from `@/lib/utils/marketplace` (Task 1).
- Produces: `ParsedRow.data.marketplace: string | null` on every successful SALE row (via `SaleImportData`, which inherits `marketplace?` from `Sale`).

- [ ] **Step 1: Write the failing tests** — append to `importFormats.test.ts`:

```ts
describe("marketplace", () => {
  it("amazon format reads the MARKETPLACE column", () => {
    const { mapping } = resolveHeaders(["ORDER_ID", "MARKETPLACE"].map((h) => h.toLowerCase()), AMAZON.columns);
    expect(mapping.get("marketplace")).toBe("marketplace");
    const r = validateRowForFormat(AMAZON, { ...AMAZON_BASE, marketplace: "amazon.fr" }, 2);
    expect(r.error).toBeNull();
    expect(r.data?.marketplace).toBe("amazon.fr");
    expect(r.data?.platform).toBe("amazon");
  });

  it("does not map SALES_CHANNEL (AFN/MFN fulfilment channel) to marketplace", () => {
    const { mapping } = resolveHeaders(["sales_channel"], AMAZON.columns);
    expect(mapping.get("sales_channel")).toBeUndefined();
  });

  it("ebay format reads a marketplace column", () => {
    const r = validateRowForFormat(EBAY, { ...AMAZON_BASE, order_id: "12-34567-89012", marketplace: "EBAY_GB" }, 2);
    expect(r.data?.marketplace).toBe("ebay.co.uk");
  });

  it("missing column → null", () => {
    const r = validateRowForFormat(AMAZON, AMAZON_BASE, 2);
    expect(r.data?.marketplace).toBeNull();
  });

  it("generic: platform 'amazon.de' keeps platform amazon AND marketplace amazon.de", () => {
    const r = validateRowForFormat(
      GENERIC,
      { date: "2024-01-15", product_name: "Mug", quantity: "1", unit_price: "10", platform: "amazon.de" },
      2,
    );
    expect(r.error).toBeNull();
    expect(r.data?.platform).toBe("amazon");
    expect(r.data?.marketplace).toBe("amazon.de");
  });

  it("generic: explicit marketplace column wins over platform", () => {
    const r = validateRowForFormat(
      GENERIC,
      { date: "2024-01-15", product_name: "Mug", quantity: "1", unit_price: "10", platform: "amazon.de", marketplace: "amazon.it" },
      2,
    );
    expect(r.data?.marketplace).toBe("amazon.it");
  });

  it("generic: bare platform 'amazon' → marketplace null", () => {
    const r = validateRowForFormat(
      GENERIC,
      { date: "2024-01-15", product_name: "Mug", quantity: "1", unit_price: "10", platform: "amazon" },
      2,
    );
    expect(r.data?.marketplace).toBeNull();
  });
});
```

Append to `dedupeImportRows.test.ts` inside `describe("dedupeImportRows", …)`:

```ts
  it("keeps the first line's marketplace when merging same order+sku lines", () => {
    const out = dedupeImportRows([
      row({ sku: "A", data: { marketplace: "amazon.de", quantity: 1, total_amount: 10 } }),
      row({ rowNum: 2, sku: "A", data: { marketplace: "amazon.de", quantity: 2, total_amount: 20 } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].data?.marketplace).toBe("amazon.de");
    expect(out[0].data?.quantity).toBe(3);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest dashboard/sales/_components/importFormats dashboard/sales/_components/dedupeImportRows`
Expected: the new `marketplace` tests FAIL (`mapping.get("marketplace")` undefined / `data.marketplace` undefined). The dedupe test may already pass (spread preserves fields) — that's fine, it pins the behaviour.

- [ ] **Step 3: Implement**

(a) `src/lib/utils/importAliases.ts` — in `ALIASES`, sales block, after `platform:`:

```ts
  // Regional storefront. NOT "sales_channel": in Amazon's VAT report that
  // column is AFN/MFN (fulfilment channel), not the marketplace.
  marketplace: ["marketplace", "marktplatz", "marketplace_name"],
```

(b) `importFormats.ts` — add import near the top imports:

```ts
import { normalizeMarketplace } from "@/lib/utils/marketplace";
```

Append `col("marketplace", false),` as the last entry of `RICH_COLUMNS`, and `"marketplace"` as the last entry of `RICH_HEADERS`. Append `"amazon.de"` to the end of `amazon.templateExample` and `"ebay.de"` to the end of `ebay.templateExample` (arrays must stay the same length as `RICH_HEADERS`).

In `generic.columns` add `col("marketplace", false),` after `col("platform", false),`; in `generic.templateHeaders` insert `"marketplace"` after `"platform"`; in `generic.templateExample` insert `"amazon.de"` after `"amazon"`.

(c) In `validateRowForFormat`, just before the final `return {` of the SALE path, add:

```ts
  // Explicit marketplace column wins; otherwise a generic-format platform
  // value like "amazon.de" (which normalizePlatform folds to "amazon")
  // still carries the market. Forced-platform formats have no platform column.
  const marketplace = normalizeMarketplace(
    raw.marketplace?.trim() || (format.forcedPlatform ? null : raw.platform),
  );
```

and add `marketplace,` to the returned `data` object directly after `external_order_id: externalOrderId,`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest dashboard/sales/_components/importFormats dashboard/sales/_components/dedupeImportRows src/lib/utils`
Expected: PASS (all existing tests too — `toEqual` on whole `data` objects, if any, needs `marketplace: null` added; fix those expectations if they fail).

- [ ] **Step 5: Docs** — `sales/SKILL.md`: add a gotcha:

```md
- **Marketplace (2026-09-28, migration 052).** `normalizeMarketplace`
  (`lib/utils/marketplace.ts`) is the only way a marketplace is written.
  Amazon's VAT report column is `MARKETPLACE`; do **not** alias
  `SALES_CHANNEL` — it holds `AFN`/`MFN`. The generic format keeps folding
  `platform: amazon.de` → `amazon` but now ALSO stores `amazon.de` as the
  marketplace; an explicit `marketplace` column wins.
```

`sales/CLAUDE.md`: in the `importFormats.ts` entry, mention the optional `marketplace` column on all three formats.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/importAliases.ts src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts src/app/dashboard/sales/_components/dedupeImportRows.test.ts src/app/dashboard/sales/SKILL.md src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): read marketplace on Amazon/eBay/generic imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Re-import backfills marketplace on existing orders

**Files:**
- Create: `src/app/dashboard/sales/_components/marketplaceBackfill.ts`
- Test: `src/app/dashboard/sales/_components/marketplaceBackfill.test.ts`
- Modify: `src/app/dashboard/sales/_components/importFormats.ts` (`ParsedRow.backfill`)
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx` (`markDuplicates` ~line 281-333, `canImport`/`actionableCount` ~line 191-197, `handleImport` after the insert audit block ~line 634, `ImportSummary` ~line 102, summary object ~line 844, ready-line ~line 1012)
- Modify: `src/app/dashboard/sales/page.tsx` (`ImportSalesModal onSuccess` ~line 451)
- Docs: `sales/SKILL.md`, `sales/CLAUDE.md`

**Interfaces:**
- Consumes: `ParsedRow.data.marketplace` (Task 3).
- Produces:
  - `ParsedRow.backfill?: { saleId: string; marketplace: string } | null`
  - `interface ExistingSaleRef { id: string; marketplace: string | null }`
  - `markExistingOrders(rows: ParsedRow[], existing: Map<string, ExistingSaleRef>): ParsedRow[]` — key is `` `${platform}:${external_order_id}` ``
  - `groupBackfills(rows: ParsedRow[]): Map<string, string[]>` — marketplace → sale ids
  - `ImportSummary.marketplacesAdded: number`, `ImportSummary.marketplaceBackfillFailed: boolean`

- [ ] **Step 1: Write the failing test** — `marketplaceBackfill.test.ts`

```ts
import { markExistingOrders, groupBackfills, type ExistingSaleRef } from "./marketplaceBackfill";
import type { ParsedRow } from "./importFormats";

const sale = (id: string, marketplace: string | null, extra: Partial<ParsedRow> = {}): ParsedRow => ({
  rowNum: 1,
  error: null,
  data: { platform: "amazon", external_order_id: id, marketplace } as ParsedRow["data"],
  ...extra,
});

const existing = (entries: [string, ExistingSaleRef][]) => new Map(entries);

describe("markExistingOrders", () => {
  it("marks a match as 'order already exists' and plans a backfill when the stored marketplace is null", () => {
    const [r] = markExistingOrders([sale("A", "amazon.de")], existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(r.skipped).toBe("order already exists");
    expect(r.backfill).toEqual({ saleId: "s1", marketplace: "amazon.de" });
  });

  it("never overwrites a stored marketplace", () => {
    const [r] = markExistingOrders([sale("A", "amazon.fr")], existing([["amazon:A", { id: "s1", marketplace: "amazon.de" }]]));
    expect(r.skipped).toBe("order already exists");
    expect(r.backfill).toBeUndefined();
  });

  it("no backfill when the file row has no marketplace", () => {
    const [r] = markExistingOrders([sale("A", null)], existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(r.backfill).toBeUndefined();
  });

  it("leaves new orders, refunds and already-skipped rows alone", () => {
    const rows = [
      sale("NEW", "amazon.de"),
      { ...sale("A", "amazon.de"), isRefund: true },
      sale("A", "amazon.de", { skipped: "duplicate in file" }),
    ];
    const out = markExistingOrders(rows, existing([["amazon:A", { id: "s1", marketplace: null }]]));
    expect(out[0].skipped).toBeUndefined();
    expect(out[1]).toBe(rows[1]);
    expect(out[2].skipped).toBe("duplicate in file");
    expect(out[2].backfill).toBeUndefined();
  });
});

describe("groupBackfills", () => {
  it("groups sale ids by marketplace", () => {
    const rows: ParsedRow[] = [
      { rowNum: 1, error: null, data: null, backfill: { saleId: "s1", marketplace: "amazon.de" } },
      { rowNum: 2, error: null, data: null, backfill: { saleId: "s2", marketplace: "amazon.fr" } },
      { rowNum: 3, error: null, data: null, backfill: { saleId: "s3", marketplace: "amazon.de" } },
      { rowNum: 4, error: null, data: null },
    ];
    expect(groupBackfills(rows)).toEqual(new Map([["amazon.de", ["s1", "s3"]], ["amazon.fr", ["s2"]]]));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest dashboard/sales/_components/marketplaceBackfill`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

(a) `importFormats.ts`, in `interface ParsedRow`, after `skipped?`:

```ts
  /**
   * Set on an "order already exists" row whose stored sale has no
   * marketplace but this file row does — the modal writes ONLY
   * `marketplace` onto that sale (marketplaceBackfill.ts).
   */
  backfill?: { saleId: string; marketplace: string } | null;
```

(b) `marketplaceBackfill.ts`:

```ts
import type { ParsedRow } from "./importFormats";

/** What the duplicate pre-check reads back for each matched existing sale. */
export interface ExistingSaleRef {
  id: string;
  marketplace: string | null;
}

/**
 * Pure half of ImportSalesModal's duplicate pre-check. Rows matching an
 * existing sale (key `${platform}:${external_order_id}`) are skipped as
 * "order already exists" — never overwritten — EXCEPT that when the stored
 * sale has no marketplace and this row does, a `backfill` is planned so a
 * re-import of an old report fills in the marketplace (migration 052).
 * A stored non-null marketplace is never changed.
 *
 * REFUND rows pass through untouched: they carry the id of an existing sale
 * by definition, and must reach the refund matcher.
 */
export function markExistingOrders(rows: ParsedRow[], existing: Map<string, ExistingSaleRef>): ParsedRow[] {
  return rows.map((r) => {
    if (r.isRefund || r.skipped || !r.data?.external_order_id) return r;
    const match = existing.get(`${r.data.platform}:${r.data.external_order_id}`);
    if (!match) return r;
    const incoming = r.data.marketplace ?? null;
    const backfill = match.marketplace === null && incoming ? { saleId: match.id, marketplace: incoming } : undefined;
    return backfill ? { ...r, skipped: "order already exists", backfill } : { ...r, skipped: "order already exists" };
  });
}

/** marketplace → sale ids, so the modal issues one UPDATE per distinct value. */
export function groupBackfills(rows: ParsedRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.backfill) continue;
    const ids = out.get(r.backfill.marketplace) ?? [];
    ids.push(r.backfill.saleId);
    out.set(r.backfill.marketplace, ids);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest dashboard/sales/_components/marketplaceBackfill`
Expected: PASS.

- [ ] **Step 5: Wire into `ImportSalesModal.tsx`**

(a) Import: `import { markExistingOrders, groupBackfills, type ExistingSaleRef } from "./marketplaceBackfill";`

(b) In `markDuplicates`, replace `const existing = new Set<string>();` with `const existing = new Map<string, ExistingSaleRef>();`, change `.select("external_order_id")` to `.select("id, external_order_id, marketplace")`, and the loop body to:

```ts
          for (const row of data ?? []) {
            if (row.external_order_id) {
              existing.set(`${platform}:${row.external_order_id}`, { id: row.id, marketplace: row.marketplace ?? null });
            }
          }
```

Replace the final `return withFileDupes.map((r) => { … });` with:

```ts
      return markExistingOrders(withFileDupes, existing);
```

(keep the REFUND comment above it — `markExistingOrders` preserves that behaviour).

(c) After `const refundCount = …` add, and change the two lines below:

```ts
  // A re-import of an old report can be ALL duplicates yet still have work:
  // filling in the marketplace on existing orders (marketplaceBackfill.ts).
  const backfillCount = parsed.filter((r) => r.backfill).length;
  const actionableCount = importable.length + refundCount + backfillCount;
  const canImport =
    parsed.length > 0 &&
    errors.length === 0 &&
    (importable.length > 0 || refundCount > 0 || backfillCount > 0) &&
    !checking;
```

(d) `ImportSummary` — add:

```ts
  /** Existing orders that got a marketplace from this re-import (052). */
  marketplacesAdded: number;
  /** The backfill UPDATE failed; the rest of the import is committed. */
  marketplaceBackfillFailed: boolean;
```

(e) In `handleImport`, directly after the `if (inserted.length > 0) { …writeAuditLog… }` block and before the refund matching, add:

```ts
    // Marketplace backfill — only fills sales whose marketplace is still
    // null (the `.is` guard makes a concurrent edit win). A failure here
    // leaves the insert committed and is reported in the summary toast.
    let marketplacesAdded = 0;
    let marketplaceBackfillFailed = false;
    for (const [marketplace, ids] of groupBackfills(parsed)) {
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data: updated, error: backfillError } = await supabase
          .from("sales")
          .update({ marketplace })
          .in("id", ids.slice(i, i + IN_CHUNK))
          .is("marketplace", null)
          .select("id");
        if (backfillError) {
          marketplaceBackfillFailed = true;
          continue;
        }
        marketplacesAdded += updated?.length ?? 0;
      }
    }
    if (marketplacesAdded > 0) {
      const log = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "update",
        entityType: "sale",
        metadata: { bulk_import: true, marketplace_backfill: marketplacesAdded, format: formatId },
      });
      if (log) dispatch(addAuditLog(log));
    }
```

(f) Add both fields to the `summary` object: `marketplacesAdded, marketplaceBackfillFailed,`.

(g) Ready line: inside the `✓ {actionableCount} row… ready to import` paragraph, after the SKU span, add:

```tsx
                {backfillCount > 0 && (
                  <span className="text-[var(--color-text-muted)]"> · {backfillCount} existing order{backfillCount !== 1 ? "s" : ""} will get a marketplace</span>
                )}
```

(h) `page.tsx` `onSuccess` — destructure `marketplacesAdded, marketplaceBackfillFailed`, add before the `skippedRows` line:

```ts
          if (marketplacesAdded > 0) parts.push(`Marketplace added to ${marketplacesAdded} existing order${marketplacesAdded !== 1 ? "s" : ""}.`);
```

change the warning condition to `if (inserted === 0 && refundsApplied === 0 && marketplacesAdded === 0)`, and after the success/warning call add:

```ts
          if (marketplaceBackfillFailed) toastError("Some marketplaces weren't saved", "Re-import the file to retry — nothing else was affected.");
```

The table only learns about imports through `addSale` (inserted rows), so backfilled rows would keep showing no marketplace. At the top of `onSuccess` add:

```ts
          if (marketplacesAdded > 0) {
            // Backfilled rows were UPDATEd server-side — refetch so the table and tiles show them.
            dispatch(fetchSalesPage({ page, pageSize, filters }));
            dispatch(fetchSalesSummary(filters));
          }
```

- [ ] **Step 6: Run focused tests**

Run: `npx jest dashboard/sales`
Expected: PASS (includes `ImportSalesModal.test.ts`; if it asserts on the `ImportSummary` shape, add the two new fields).

- [ ] **Step 7: Docs** — `sales/SKILL.md` gotcha:

```md
- **Re-import backfills marketplace (2026-09-28).** The duplicate
  pre-check now reads `id, marketplace` and `markExistingOrders`
  (`_components/marketplaceBackfill.ts`) plans a `backfill` for matched
  sales whose marketplace is null. Those rows stay "order already exists"
  but count toward `canImport`, so an all-duplicates re-import is still
  importable. The UPDATE carries `.is("marketplace", null)` — a stored
  value is never overwritten.
```

`sales/CLAUDE.md`: add `marketplaceBackfill.ts` to the file map.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/sales/_components/marketplaceBackfill.ts src/app/dashboard/sales/_components/marketplaceBackfill.test.ts src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/ImportSalesModal.tsx src/app/dashboard/sales/page.tsx src/app/dashboard/sales/SKILL.md src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): re-import fills marketplace on existing orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capture marketplace from eBay/Amazon API sync

**Files:**
- Modify: `src/lib/integrations/types.ts` (`NormalizedOrder`)
- Modify: `src/lib/integrations/amazon.ts` (`AmazonOrder`, `fetchOrders` push)
- Modify: `src/lib/integrations/ebay.ts` (`EbayLineItem`, `fetchOrders` push)
- Modify: `src/lib/integrations/mapToSale.ts`
- Modify: `src/lib/integrations/mergeImportedSale.ts`
- Test: `src/lib/integrations/{ebay,mapToSale,mergeImportedSale}.test.ts`
- Docs: `src/lib/integrations/SKILL.md`

**Interfaces:**
- Consumes: `normalizeMarketplace` (Task 1).
- Produces: `NormalizedOrder.marketplace?: string | null`; `normalizedOrderToSaleRow(...).marketplace`; `mergeImportedSale` fills `marketplace` only when `existing.marketplace` is null/undefined.

- [ ] **Step 1: Write the failing tests**

`ebay.test.ts`, inside the `fetchOrders` describe (reuse its `mockJsonResponse` helper):

```ts
  it("maps each line item's purchaseMarketplaceId to a normalised marketplace", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-1",
          creationDate: "2026-06-01T10:00:00.000Z",
          lineItems: [
            { lineItemId: "001", title: "A", quantity: "1", total: { value: "5", currency: "GBP" }, purchaseMarketplaceId: "EBAY_GB" },
            { lineItemId: "002", title: "B", quantity: "1", total: { value: "5", currency: "EUR" } },
          ],
        },
      ],
    });
    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);
    expect(orders[0].marketplace).toBe("ebay.co.uk");
    expect(orders[1].marketplace).toBeNull();
  });
```

`mapToSale.test.ts`:

```ts
  it("carries order.marketplace onto the sale row, null when absent", () => {
    expect(normalizedOrderToSaleRow({ ...ebayOrder, marketplace: "ebay.de" }, "ebay", "u").marketplace).toBe("ebay.de");
    expect(normalizedOrderToSaleRow(ebayOrder, "ebay", "u").marketplace).toBeNull();
  });
```

Also add `marketplace: null,` to the two full `toEqual({...})` expectations in "maps an eBay order…" and "maps an Amazon order…".

`mergeImportedSale.test.ts`:

```ts
  it("fills marketplace from incoming only when existing has none", () => {
    const incoming = { ...existingSale, marketplace: "ebay.de" };
    expect(mergeImportedSale({ ...existingSale, marketplace: null }, incoming).marketplace).toBe("ebay.de");
    expect(mergeImportedSale({ ...existingSale, marketplace: undefined }, incoming).marketplace).toBe("ebay.de");
    expect(mergeImportedSale({ ...existingSale, marketplace: "ebay.fr" }, incoming).marketplace).toBe("ebay.fr");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/lib/integrations`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`types.ts`, `NormalizedOrder`, after `description`:

```ts
  /** Regional storefront via normalizeMarketplace — "amazon.de", "ebay.co.uk"; null when the API didn't say. */
  marketplace?: string | null;
```

`amazon.ts`: add `import { normalizeMarketplace } from "@/lib/utils/marketplace";`; add `SalesChannel?: string;` to `AmazonOrder`; in the `orders.push({...})` add `marketplace: normalizeMarketplace(order.SalesChannel),`.

`ebay.ts`: same import; add `purchaseMarketplaceId?: string;` to `EbayLineItem`; in `orders.push({...})` add `marketplace: normalizeMarketplace(item.purchaseMarketplaceId),`.

`mapToSale.ts`: in the returned object after `external_order_id: order.external_order_id,` add `marketplace: order.marketplace ?? null,`.

`mergeImportedSale.ts`: replace the merge `return` with:

```ts
  return {
    ...existing,
    ...Object.fromEntries(
      PLATFORM_OWNED.map((k) => [k, incoming[k]])
    ),
    // Fill-only: a sync may supply a marketplace the row never had (pre-052
    // rows), but never overwrites one — a manual correction wins.
    marketplace: existing.marketplace ?? incoming.marketplace ?? null,
  } as Sale;
```

and add to the doc comment above `PLATFORM_OWNED`: "`marketplace` is neither: it is fill-only (see the merge below)."

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/lib/integrations`
Expected: PASS.

- [ ] **Step 5: Docs** — `src/lib/integrations/SKILL.md`, add a gotcha:

```md
- **Marketplace (2026-09-28, migration 052).** Amazon reads
  `order.SalesChannel` ("Amazon.de"), eBay reads each line item's
  `purchaseMarketplaceId` ("EBAY_DE"), both via `normalizeMarketplace`
  (`lib/utils/marketplace.ts`). In `mergeImportedSale` it is **fill-only**:
  written when the stored row has none, never overwritten.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations src/lib/integrations/SKILL.md
git commit -m "feat(integrations): capture marketplace on eBay/Amazon sync (fill-only merge)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orders page — marketplace filter, column, VAT base tile, export

**Files:**
- Modify: `src/lib/utils/filters.ts` (`SalesFilters`, `DEFAULT_SALES_FILTERS`, `isDefaultFilters`) + `src/lib/utils/filters.test.ts`
- Modify: `src/app/dashboard/sales/_store/salesFilterParams.ts` + test
- Modify: `src/app/dashboard/sales/_store/salesSlice.ts` (`fetchSalesPage`; new `fetchSalesMarketplaces`)
- Modify: `src/app/dashboard/sales/_lib/salesSummaryTiles.ts` + test
- Modify: `src/app/dashboard/sales/page.tsx` (filter select, Platform cell, export headers/rows + query)
- Docs: `sales/CLAUDE.md`, `sales/SKILL.md`

**Interfaces:**
- Consumes: `UNKNOWN_MARKETPLACE`, `marketplaceLabel` (Task 1); `get_sales_summary` `p_marketplace` + `vat_base`, `get_sales_marketplaces()` (Task 2).
- Produces: `SalesFilters.marketplace: string` (`"all"` | `"__unknown__"` | a domain); `SalesSummaryParams.p_marketplace: string | null`; `fetchSalesMarketplaces(): Promise<string[]>` (plain async function, not a thunk — the list is page-local UI state).

- [ ] **Step 1: Write the failing tests**

`salesFilterParams.test.ts` — update the default expectation to include `p_marketplace: null`, add `marketplace: "all"` to the concrete-filters input and `p_marketplace: null` to its expected output, then add:

```ts
  it("passes marketplace through, including the unknown sentinel", () => {
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, marketplace: "amazon.de" }).p_marketplace).toBe("amazon.de");
    expect(salesFilterParams({ ...DEFAULT_SALES_FILTERS, marketplace: "__unknown__" }).p_marketplace).toBe("__unknown__");
  });
```

`salesSummaryTiles.test.ts` — update the first test's expected labels to `["Orders", "Gross", "VAT", "Net", "VAT base (net)", "Fees", "Shipping charged", "Excluded"]` and add:

```ts
  it("shows VAT base from the RPC's vat_base (includes shipping, excludes zero-VAT orders)", () => {
    const tile = buildSalesTiles([row({ vat_base: 104.99 })]).find((t) => t.label === "VAT base (net)");
    expect(tile?.lines).toEqual([formatCurrency(104.99, "EUR")]);
  });

  it("hides VAT base when there is no VAT", () => {
    expect(labels([row({ vat: 0, vat_base: 0 })])).not.toContain("VAT base (net)");
  });
```

`filters.test.ts` — add (find the `isDefaultFilters` describe):

```ts
  it("a non-default sales marketplace is an active filter", () => {
    expect(isDefaultFilters({ ...DEFAULT_SALES_FILTERS, marketplace: "amazon.de" })).toBe(false);
    expect(isDefaultFilters(DEFAULT_SALES_FILTERS)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest dashboard/sales/_store dashboard/sales/_lib src/lib/utils/filters`
Expected: FAIL on the new expectations.

- [ ] **Step 3: Implement**

`filters.ts`: add `marketplace: string;` to `SalesFilters` (after `platform`), `marketplace: "all",` to `DEFAULT_SALES_FILTERS`, and to `isDefaultFilters` add `("marketplace" in f ? f.marketplace === "all" : true) &&` before the `category` line.

`salesFilterParams.ts`: add `p_marketplace: string | null;` to `SalesSummaryParams` (comment: "Arg names match get_sales_summary in 052"), and `p_marketplace: f.marketplace === "all" ? null : f.marketplace,` to the returned object.

`salesSummaryTiles.ts`: after the `vat ? moneyTile("Net", …) : null,` line add:

```ts
    // Net taxable base to declare: total + shipping − VAT over VAT-bearing orders (052's vat_base).
    vat ? moneyTile("VAT base (net)", rows, (r) => r.vat_base) : null,
```

`salesSlice.ts` — in `fetchSalesPage`, after the `p_platform` line:

```ts
    if (p.p_marketplace === UNKNOWN_MARKETPLACE) query = query.is("marketplace", null);
    else if (p.p_marketplace) query = query.eq("marketplace", p.p_marketplace);
```

(import `UNKNOWN_MARKETPLACE` from `@/lib/utils/marketplace`). Append:

```ts
/**
 * Distinct marketplaces for the Orders filter dropdown (get_sales_marketplaces,
 * 052). Structurally bounded by the storefronts a seller trades on. Returns []
 * on error — the filter then only offers "All" / "Unknown".
 */
export async function fetchSalesMarketplaces(): Promise<string[]> {
  const supabase = await createTenantClient();
  const { data, error } = await supabase.rpc("get_sales_marketplaces");
  if (error) return [];
  return ((data ?? []) as { marketplace: string }[]).map((r) => r.marketplace);
}
```

`page.tsx`:
- Import `fetchSalesMarketplaces` from the slice and `UNKNOWN_MARKETPLACE` from `@/lib/utils/marketplace`.
- State + load: `const [marketplaces, setMarketplaces] = useState<string[]>([]);` and `useEffect(() => { fetchSalesMarketplaces().then(setMarketplaces); }, [summaryVersion]);` (refreshes after add/edit/delete like the tiles). A backfill doesn't bump `summaryVersion`, so also add `fetchSalesMarketplaces().then(setMarketplaces);` inside the `if (marketplacesAdded > 0) { … }` block Task 4 added to the import `onSuccess`.
- Filter select, after the Platform `<div>`:

```tsx
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Marketplace</span>
          <select
            value={filters.marketplace}
            onChange={(e) => setFilter("marketplace", e.target.value)}
            className={filterInputCls}
          >
            <option value="all">All Marketplaces</option>
            {marketplaces.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value={UNKNOWN_MARKETPLACE}>Unknown</option>
          </select>
        </div>
```

- Platform column `render`:

```tsx
      render: (s: Sale) => (
        <div className="flex flex-col items-start gap-0.5">
          <PlatformBadge platform={s.platform} />
          {s.marketplace && <span className="text-xs text-[var(--color-text-muted)]">{s.marketplace}</span>}
        </div>
      ),
```

- Export: in `handleExport`'s query, after the `p_platform` line, add the same two marketplace lines as the slice. Insert `"marketplace"` after `"platform"` in `headers`, and `s.marketplace ?? ""` after `s.platform` in the row array.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest dashboard/sales src/lib/utils/filters`
Expected: PASS.

- [ ] **Step 5: Docs** — `sales/CLAUDE.md`: document the Marketplace filter (options from `get_sales_marketplaces`, `"__unknown__"` → `.is("marketplace", null)`), the Platform-cell marketplace line, the `VAT base (net)` tile (shown only when VAT ≠ 0), and the CSV `marketplace` column. `sales/SKILL.md` gotcha:

```md
- **VAT base includes shipping.** `get_sales_summary.vat_base` =
  `total_amount + shipping_charged − vat_amount` over VAT-bearing rows.
  Amazon's `total_amount` is items only and its `vat_amount` is item +
  shipping VAT — `total_amount − vat_amount` would understate the base.
  Marketplace filtering lives in two query builders (`fetchSalesPage` and
  `page.tsx`'s `handleExport`) plus the RPC — change all three together.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/filters.ts src/lib/utils/filters.test.ts src/app/dashboard/sales
git commit -m "feat(sales): marketplace filter/column/export + VAT base tile on Orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Marketplace on Add/Edit Sale and order detail

**Files:**
- Modify: `src/app/dashboard/sales/_components/AddSaleModal.tsx` (`FormState`, `makeDefaults`, payload ~line 174, Platform `<Row>` ~line 359)
- Modify: `src/app/dashboard/sales/_components/EditSaleModal.tsx` (`FormState`, init from `sale` ~line 75, blank defaults ~line 108, payload ~line 259, audit before/after ~line 317-318, Platform select ~line 468)
- Modify: `src/app/dashboard/sales/[id]/page.tsx` (~line 406)
- Docs: `sales/CLAUDE.md`

**Interfaces:**
- Consumes: `normalizeMarketplace` (Task 1).

No new pure logic (normalisation is Task 1's, already tested). Verified in the browser.

- [ ] **Step 1: AddSaleModal** — add `marketplace: string;` to `FormState`, `marketplace: "",` to `makeDefaults`, `marketplace: normalizeMarketplace(form.marketplace),` to the insert payload (next to `platform: form.platform,`), and immediately after the Platform/Date `</Row>`:

```tsx
        <Field label="Marketplace">
          <Input
            value={form.marketplace}
            onChange={(e) => set("marketplace", e.target.value)}
            placeholder="e.g. amazon.de, ebay.co.uk"
          />
        </Field>
```

Import `normalizeMarketplace` from `@/lib/utils/marketplace`. It is optional — do not add it to `isFormValid`.

- [ ] **Step 2: EditSaleModal** — same `FormState` field; init `marketplace: sale.marketplace ?? "",`; blank default `marketplace: "",`; payload `marketplace: normalizeMarketplace(form.marketplace),`; add `marketplace: sale.marketplace ?? null` to the audit `before` object and `marketplace: data.marketplace ?? null` to `after`; same `<Field label="Marketplace">` after the Platform select's row.

- [ ] **Step 3: Order detail** — in `sales/[id]/page.tsx`, after `{sale.platform && <PlatformBadge platform={sale.platform} />}`:

```tsx
        {sale.marketplace && <span className="text-sm text-(--color-text-muted)">{sale.marketplace}</span>}
```

- [ ] **Step 4: Run the Sales tests**

Run: `npx jest dashboard/sales`
Expected: PASS.

- [ ] **Step 5: Browser check** — if the Playwright MCP is connected and `npm run dev` is already running, open `/dashboard/sales`, add an order with marketplace `Amazon.FR`, confirm the row shows `amazon.fr` under the platform badge and on its detail page, edit it to blank, and confirm it disappears. Otherwise ask the user to do exactly that and report back.

- [ ] **Step 6: Docs** — `sales/CLAUDE.md`: note the optional Marketplace field in both modals (normalised on save, included in the edit audit diff) and on the detail page.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales
git commit -m "feat(sales): marketplace field on Add/Edit order + order detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Analytics — "Revenue by marketplace" card

**Files:**
- Modify: `src/app/dashboard/_lib/overviewTypes.ts`
- Create: `src/app/dashboard/_lib/marketplaceRows.ts` + `marketplaceRows.test.ts`
- Modify: `src/app/dashboard/_components/useOverviewData.ts`
- Create: `src/app/dashboard/_components/MarketplaceCard.tsx`
- Modify: `src/app/dashboard/analytics/page.tsx`
- Docs: `src/app/dashboard/CLAUDE.md`, `src/app/dashboard/analytics/CLAUDE.md`, `src/app/dashboard/analytics/SKILL.md`

**Interfaces:**
- Consumes: `get_sales_by_marketplace(p_from, p_to, p_currency)` (Task 2); `marketplaceLabel` (Task 1).
- Produces:
  - `interface MarketplaceRow { marketplace: string | null; order_count: number; revenue: number; vat: number; vat_base: number }` (overviewTypes)
  - `interface MarketplaceShare extends MarketplaceRow { label: string; sharePct: number }`
  - `marketplaceShares(rows: MarketplaceRow[]): { total: number; rows: MarketplaceShare[] }`
  - `OverviewData.marketplaces: MarketplaceRow[] | null`

- [ ] **Step 1: Types** — append to `overviewTypes.ts`:

```ts
/** One row per marketplace from get_sales_by_marketplace (052). marketplace null = unknown. */
export interface MarketplaceRow {
  marketplace: string | null;
  order_count: number;
  revenue: number;
  vat: number;
  vat_base: number;
}
```

- [ ] **Step 2: Write the failing test** — `marketplaceRows.test.ts`

```ts
import { marketplaceShares } from "./marketplaceRows";
import type { MarketplaceRow } from "./overviewTypes";

const r = (marketplace: string | null, revenue: number): MarketplaceRow => ({
  marketplace, order_count: 1, revenue, vat: 0, vat_base: 0,
});

describe("marketplaceShares", () => {
  it("sorts by revenue desc, labels null as Unknown, computes share of the positive total", () => {
    const { total, rows } = marketplaceShares([r("amazon.fr", 25), r(null, 25), r("amazon.de", 50)]);
    expect(total).toBe(100);
    expect(rows.map((x) => x.label)).toEqual(["amazon.de", "amazon.fr", "Unknown"]);
    expect(rows.map((x) => x.sharePct)).toEqual([50, 25, 25]);
  });

  it("puts Unknown last on a revenue tie", () => {
    expect(marketplaceShares([r(null, 10), r("ebay.de", 10)]).rows.map((x) => x.label)).toEqual(["ebay.de", "Unknown"]);
  });

  it("negative-revenue rows get 0% and don't inflate the total", () => {
    const { total, rows } = marketplaceShares([r("amazon.de", 100), r("amazon.it", -20)]);
    expect(total).toBe(100);
    expect(rows.find((x) => x.label === "amazon.it")?.sharePct).toBe(0);
  });

  it("empty input → zero total, no rows", () => {
    expect(marketplaceShares([])).toEqual({ total: 0, rows: [] });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest dashboard/_lib/marketplaceRows`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `marketplaceRows.ts`

```ts
import { marketplaceLabel } from "@/lib/utils/marketplace";
import type { MarketplaceRow } from "./overviewTypes";

export interface MarketplaceShare extends MarketplaceRow {
  label: string;
  /** Share of the positive revenue total, 0–100. */
  sharePct: number;
}

/**
 * Shapes get_sales_by_marketplace rows for MarketplaceCard: revenue desc,
 * Unknown (null) last on ties, share % of the POSITIVE total (a refund-heavy
 * market can net negative — same rule as platformShare.ts).
 */
export function marketplaceShares(rows: MarketplaceRow[]): { total: number; rows: MarketplaceShare[] } {
  const total = rows.reduce((acc, r) => acc + Math.max(0, r.revenue), 0);
  const sorted = [...rows].sort(
    (a, b) => b.revenue - a.revenue || Number(a.marketplace === null) - Number(b.marketplace === null),
  );
  return {
    total,
    rows: sorted.map((r) => ({
      ...r,
      label: marketplaceLabel(r.marketplace),
      sharePct: total > 0 ? Math.round((Math.max(0, r.revenue) / total) * 1000) / 10 : 0,
    })),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest dashboard/_lib/marketplaceRows`
Expected: PASS.

- [ ] **Step 6: Fetch** — `useOverviewData.ts`: import `MarketplaceRow`; add `marketplaces: MarketplaceRow[] | null;` to `OverviewData`; add `const [marketplaces, setMarketplaces] = useState<MarketplaceRow[] | null>(null);`; add `supabase.rpc("get_sales_by_marketplace", rpcParams),` as a 6th entry of the `Promise.all` (destructure as `marketplacesRes`); after the other error logs add `if (marketplacesRes.error) console.error("get_sales_by_marketplace failed", marketplacesRes.error);` and `setMarketplaces(marketplacesRes.error ? null : (marketplacesRes.data as MarketplaceRow[]));`; return `marketplaces`. Update the doc comment's "5 Postgres RPCs" to 6. (Home also calls this hook; the extra RPC is cheap and grouped server-side — acceptable.)

- [ ] **Step 7: Card** — `src/app/dashboard/_components/MarketplaceCard.tsx`

```tsx
"use client";

import type { Currency } from "@/types";
import type { MarketplaceRow } from "../_lib/overviewTypes";
import { marketplaceShares } from "../_lib/marketplaceRows";
import { ChartCard } from "./ChartCard";
import { useChartKit } from "./useChartKit";

/** Revenue, VAT and net VAT base per marketplace for the picked range (052). Ranked table, TopProductsCard style. */
export function MarketplaceCard({ rows, currency }: { rows: MarketplaceRow[] | null; currency: Currency }) {
  const kit = useChartKit(currency);
  const { rows: shares } = marketplaceShares(rows ?? []);
  const top = shares[0];

  return (
    <ChartCard
      title="Revenue by Marketplace"
      headline={top ? kit.money(top.revenue) : kit.money(0)}
      meta={top ? `Largest: ${top.label} · ${top.sharePct}%` : undefined}
      empty={shares.length === 0}
      bodyClassName="mt-4"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-(--color-text-muted) border-b border-(--color-border-subtle)">
            <th className="py-2 pr-2 font-medium">Marketplace</th>
            <th className="py-2 pr-2 font-medium text-right">Orders</th>
            <th className="py-2 pr-2 font-medium text-right">Revenue</th>
            <th className="py-2 pr-2 font-medium text-right">VAT</th>
            <th className="py-2 font-medium text-right">VAT base</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((m) => (
            <tr key={m.label} className="border-b border-(--color-border-subtle) last:border-0">
              <td className="py-2.5 pr-2 min-w-0">
                <p className="truncate max-w-[12rem] text-(--color-text-strong)" title={m.label}>{m.label}</p>
                <div className="mt-1 h-1 w-full max-w-[12rem] rounded-full bg-(--color-border-subtle)">
                  <div className="h-1 rounded-full bg-(--color-primary)" style={{ width: `${m.sharePct}%` }} />
                </div>
              </td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{m.order_count.toLocaleString()}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums font-medium text-(--color-text-strong)">{kit.money(m.revenue)}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-(--color-text-base)">{kit.money(m.vat)}</td>
              <td className="py-2.5 text-right tabular-nums text-(--color-text-base)">{kit.money(m.vat_base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}
```

- [ ] **Step 8: Render** — `analytics/page.tsx`: `import { MarketplaceCard } from "../_components/MarketplaceCard";` and after `<TopProductsCard … />` add `<MarketplaceCard rows={data.marketplaces} currency={currency} />`.

- [ ] **Step 9: Run tests + browser check**

Run: `npx jest dashboard/_lib dashboard/analytics`
Expected: PASS. Then (Playwright if connected + dev server running, else ask the user) open `/dashboard/analytics`, pick a range with imported Amazon orders, and confirm the card lists marketplaces with Revenue/VAT/VAT base and an "Unknown" row for orders without one.

- [ ] **Step 10: Docs** — `dashboard/CLAUDE.md`: add `MarketplaceCard.tsx` under "Analytics-only" and `marketplaceRows.ts` under `_lib/`; update `useOverviewData` to "6 range-scoped RPCs" incl. `get_sales_by_marketplace`. `analytics/CLAUDE.md`: list the card. `analytics/SKILL.md` gotcha: "MarketplaceCard is filtered to the profile currency like every other card (`p_currency`) — orders in other currencies aren't shown or converted."

- [ ] **Step 11: Commit**

```bash
git add src/app/dashboard/_lib src/app/dashboard/_components src/app/dashboard/analytics src/app/dashboard/CLAUDE.md
git commit -m "feat(analytics): Revenue by Marketplace card with VAT base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Integration test + final verification

**Files:**
- Modify: `src/app/dashboard/_lib/overviewRpc.integration.test.ts` (same setup/teardown pattern it already uses)

Only runnable once 052 is applied (Task 2 Step 4). If it wasn't, skip Steps 1–2, and say so in the PR description.

- [ ] **Step 1: Add the test** — following the file's existing insert/cleanup helpers (reuse its service client and its created-row cleanup), insert two `sales` rows dated inside a unique test range, same currency: A = `total_amount 100, shipping_charged 10, vat_amount 17.56, marketplace 'amazon.de', status 'delivered'`; B = `total_amount 50, vat_amount 0, marketplace null, status 'delivered'`. Then assert:

```ts
    const { data: summary } = await client.rpc("get_sales_summary", {
      p_from: FROM, p_to: TO, p_platform: null, p_currency: "EUR", p_status: null, p_pattern: null, p_marketplace: null,
    });
    expect(Number(summary[0].vat_base)).toBeCloseTo(92.44, 2); // 100 + 10 − 17.56; B excluded (no VAT)

    const { data: unknown } = await client.rpc("get_sales_summary", {
      p_from: FROM, p_to: TO, p_platform: null, p_currency: "EUR", p_status: null, p_pattern: null, p_marketplace: "__unknown__",
    });
    expect(unknown[0].order_count).toBe(1);

    const { data: byMarket } = await client.rpc("get_sales_by_marketplace", { p_from: FROM, p_to: TO, p_currency: "EUR" });
    expect(byMarket.find((r: { marketplace: string | null }) => r.marketplace === "amazon.de")?.revenue).toBeCloseTo(110, 2);
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- overviewRpc`
Expected: PASS.

- [ ] **Step 3: Full focused run**

Run: `npx jest dashboard/sales dashboard/_lib dashboard/analytics src/lib/integrations src/lib/utils`
Expected: PASS.

- [ ] **Step 4: Verifier**

Run: `uv run .claude/verifiers/verify_changes.py`
Expected: no new findings (the `fetchSalesMarketplaces` RPC read is bounded by marketplace count — if `unpaginated-collection-read` flags it, add `// verifier:allow unpaginated-collection-read — distinct marketplaces, bounded by storefronts traded on` on that line).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/_lib/overviewRpc.integration.test.ts
git commit -m "test(db): integration coverage for vat_base and marketplace RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off** — use superpowers:finishing-a-development-branch (push + PR; PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, and states 052's apply status).
