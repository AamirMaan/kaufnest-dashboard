# Overview Postgres RPC Aggregation — design

## Problem

The Overview page (`src/app/dashboard/page.tsx`) computes every stat card,
chart, and platform-balance figure by fetching up to 5000 rows per table
(`sales`/`expenses`/`purchases`/`platform_payouts`, via `fetchAllRows`,
`src/lib/utils/fetchAllRows.ts`) and reducing them in the browser. This was
the correct fix for the Max Rows truncation bug (PR #103,
`BACKEND_ARCHITECTURE_PRINCIPLES.md` section 1), but it does not fix the
underlying scale problem it flagged as future work (section 2): a tenant
still downloads up to 20,000 rows (4 tables × 5000) to produce roughly a
dozen numbers and a handful of small chart series. `tenant_k2_textil` has
grown from 1510 to 3048 sales rows since 2026-09-15 — over 3× the Max Rows
default and past 60% of the bounded-fetch cap — confirming this is not a
theoretical concern.

This is sub-project 2 of the three-part plan started in
`docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`.
Sub-project 1 (the principles doc + verifier rules) is complete on
`docs/backend-architecture-principles` (not yet merged to `main`). This
branch (`feat/overview-rpc-aggregation`) stacks on top of it because this
design cites specific sections of `BACKEND_ARCHITECTURE_PRINCIPLES.md` that
don't exist on `main` yet.

## Goals

- Move Overview's aggregation into Postgres: four new schema functions
  (`get_sales_overview`, `get_expenses_overview`, `get_purchases_overview`,
  `get_payouts_overview`), one per table, each returning a single small JSON
  result computed via `SUM`/`GROUP BY` — not the underlying rows.
- Preserve every existing number and chart exactly — this is a scale fix,
  not a behavior change. Where the current client-side logic has
  inconsistencies (see "Business logic inventory" below — there are
  genuinely two different "revenue" formulas in play depending on which
  card is showing it), the SQL must reproduce BOTH exactly as they are
  today, not unify them into one "more correct" definition. Fixing that
  inconsistency, if wanted, is separate work outside this spec's scope.
- Push the currency filter into SQL (`WHERE currency = p_currency`) — it is
  currently applied client-side, after already fetching the wrong-currency
  rows over the wire. This is a strict improvement with zero behavior
  change (same predicate, evaluated earlier).
- Verify correctness with a Jest integration test per function, seeding
  known rows into a real tenant schema and asserting the RPC's numbers
  match hand-computed expected values.

## Non-goals

- Not touching Sales/Expenses/Purchases pages' own server-side pagination
  (`fetchXPage` thunks) — those already work correctly and are out of
  scope.
- Not touching the Sales/Expenses/Purchases CSV exports (`fetchAllRows`-based,
  fixed in PR #103) — no growth pressure there today.
- Not "fixing" the two-different-revenue-formulas inconsistency documented
  below. That's a product/business decision, not an architecture one, and
  conflating it with this migration would make correctness verification
  much harder (the Jest tests could no longer just assert "matches current
  behavior").
- Not adding a 5th cross-table RPC for platform balance. Each of the four
  functions returns enough per-platform granularity that `page.tsx`
  combines them client-side — arithmetic on ~10 already-aggregated numbers,
  not a scale concern.
- Not changing `fetchAllRows` itself (already correct, still used by the
  three CSV exports).

## Business logic inventory (verified against current code, not assumed)

Two distinct "sales revenue" formulas exist today, and the SQL must keep
them distinct:

- **Formula A** (`_lib/aggregateSales.ts`'s `aggregateSaleRevenue`):
  `total_amount + coalesce(shipping_charged, 0)`, summed over
  "effective" sales (`status NOT IN ('returned','cancelled')` —
  `isRevenueSale` in `lib/utils/filters.ts`). Used by: the main Revenue
  stat card, Net Profit, and `monthlyTrend`'s revenue series
  (`page.tsx:244-248`).
- **Formula B** (raw `total_amount`, no shipping): used by revenue-by-platform
  (`page.tsx:272`), top products (`page.tsx:289`), and platform-balance
  cards' `sales` figure (`page.tsx:312`) — all over the same effective-sales
  filter.

Other verified specifics, easy to get subtly wrong:
- **Orders count** (`page.tsx:216`, inferred from the StatCard bullet in
  `dashboard/CLAUDE.md`) is `count(*)` over ALL period sales (currency +
  date filtered), NOT the effective-sales subset — a returned order still
  counts as "an order placed."
- **Units sold** (`page.tsx:218`) IS over effective sales only
  (`sum(quantity)` where not returned/cancelled) — the opposite filter
  scope from Orders count, on the same stat card.
- **Top products**: top 5 by Formula-B revenue descending
  (`page.tsx:285-294`), grouped by `product_name`, each entry also carries
  summed `quantity`.
- **Expenses-to-platform matching** (`page.tsx:315-317`, `339-341`) is a
  **case-insensitive substring match**, not a column:
  `vendor ILIKE '%ebay%' OR title ILIKE '%ebay%'` (and the same for
  `'%amazon%'`) — summed as `sum(amount)` over ALL period expenses (no
  effective/status filter — expenses have no such concept). Only these two
  hardcoded platform names are computed today (the UI only ever renders an
  eBay and an Amazon balance card, never Etsy/Shopify/other) — the function
  reproduces exactly that, not a dynamic per-connected-platform loop.
- **Platform balance `adFees`/`shippingFees`** (`page.tsx:313-314`,
  `337-338`): `sum(advertising_fee)` / `sum(shipping_cost)` over that
  platform's effective sales — note this is `advertising_fee` only, NOT
  `advertising_fee + platform_fee` the way the main Revenue card's `fees`
  figure is (`aggregateSaleRevenue` sums all three: `shipping_cost`,
  `advertising_fee`, `platform_fee`). Do not "complete" this by adding
  `platform_fee` — that would change the balance-card number, not fix a bug.
- **Monthly trend** (`page.tsx:233-266`): three independently-grouped
  monthly series (sales revenue via Formula A over effective sales,
  `sum(amount)` over ALL period expenses, `sum(total_amount)` over ALL
  period purchases), keyed by `date.slice(0,7)` (`YYYY-MM`), merged into one
  array client-side. The month display label
  (`new Date(`${ym}-15`).toLocaleString(...)`) stays a client-side
  concern — SQL returns the raw `YYYY-MM` key only.
- **VAT**: `vatCollected` = `sum(vat_amount)` over effective sales.
  `vatPaid` = `sum(vat_amount)` over ALL period expenses AND ALL period
  purchases (VAT Position = collected − paid, computed client-side from the
  three already-aggregated numbers).

## Deliverable

### The four functions (one migration, via `run_on_all_tenant_schemas`)

All four share the same first three parameters: `p_from date, p_to date,
p_currency text` — `p_from`/`p_to` are nullable (NULL means unbounded,
matching `page.tsx`'s `range: {from,to} | null`, where `resolveDateRange`
can return `null` for the "all time" preset). Each returns `jsonb`.

**`get_sales_overview(p_from date, p_to date, p_currency text) returns jsonb`**
```json
{
  "orderCount": 42,
  "unitsSold": 87,
  "revenue": 1234.56,
  "fees": 45.00,
  "vatCollected": 197.53,
  "revenueByPlatform": [{"platform": "ebay", "value": 900.00}, ...],
  "topProducts": [{"name": "Widget", "revenue": 300.00, "units": 12}, ...],
  "monthlyRevenue": [{"month": "2026-08", "revenue": 400.00}, ...],
  "platformBalance": [
    {"platform": "ebay", "sales": 900.00, "adFees": 20.00, "shippingFees": 10.00, "count": 15},
    {"platform": "amazon", "sales": 334.56, "adFees": 8.00, "shippingFees": 5.00, "count": 27}
  ]
}
```
`revenue`/`fees`/`vatCollected`/`unitsSold` use Formula A's effective-sales
filter; `revenueByPlatform`/`topProducts`/`platformBalance.sales` use
Formula B over the same filter; `orderCount` is unfiltered by status.
`platformBalance` only computes `ebay`/`amazon` (matching current
hardcoding — see Business logic inventory).

**`get_expenses_overview(p_from date, p_to date, p_currency text) returns jsonb`**
```json
{
  "total": 340.00,
  "vatPaid": 54.30,
  "byCategory": [{"category": "shipping", "amount": 120.00}, ...],
  "monthlyExpenses": [{"month": "2026-08", "amount": 80.00}, ...],
  "platformSubtotal": [{"platform": "ebay", "amount": 30.00}, {"platform": "amazon", "amount": 12.00}]
}
```
`platformSubtotal` uses the `vendor ILIKE`/`title ILIKE` match documented
above, hardcoded to `ebay`/`amazon`.

**`get_purchases_overview(p_from date, p_to date, p_currency text) returns jsonb`**
```json
{ "total": 560.00, "vatPaid": 89.60, "monthlyPurchases": [{"month": "2026-08", "amount": 200.00}, ...] }
```

**`get_payouts_overview(p_from date, p_to date, p_currency text) returns jsonb`**
```json
{ "transferred": [{"platform": "ebay", "amount": 850.00}, {"platform": "amazon", "amount": 300.00}] }
```

### Client rewiring (`src/app/dashboard/page.tsx`)

Replace the `fetchAllRows`-based `Promise.all` in the `load()` effect with:
```ts
const supabase = await createTenantClient();
const [salesRes, expensesRes, purchasesRes, payoutsRes] = await Promise.all([
  supabase.rpc("get_sales_overview", { p_from: range?.from ?? null, p_to: range?.to ?? null, p_currency: profileCurrency }),
  supabase.rpc("get_expenses_overview", { p_from: range?.from ?? null, p_to: range?.to ?? null, p_currency: profileCurrency }),
  supabase.rpc("get_purchases_overview", { p_from: range?.from ?? null, p_to: range?.to ?? null, p_currency: profileCurrency }),
  supabase.rpc("get_payouts_overview", { p_from: range?.from ?? null, p_to: range?.to ?? null, p_currency: profileCurrency }),
]);
```
`createTenantClient()` is already schema-scoped (`.schema(tenantSchema)`),
and calling a schema-scoped RPC this way is an established pattern
(`src/lib/ai/quota.ts:74`: `control.schema("control").rpc("record_ai_usage", ...)`)
— no new plumbing.

All the `useMemo`s currently deriving `periodSales`/`effectiveSales`/
`monthlyTrend`/`platformData`/`topProducts`/`expensesByCategory`/
`ebayBalance`/`amazonBalance`/`unitsSold`/etc. from raw arrays are replaced
with plain reads off the four RPC results (no more filtering/reducing raw
rows client-side — the arithmetic that remains, like `revenue - fees` for
Net Profit or combining three RPCs' platform figures into one balance card,
operates on already-aggregated numbers). `sales`/`expenses`/`purchases`/
`payouts` local `useState` arrays are removed; state becomes the four
result objects directly.

### Migration mechanics

New migration file adding the four `CREATE OR REPLACE FUNCTION` statements,
each wrapped in `run_on_all_tenant_schemas($$ ... $$)` per AGENTS.md's DDL
rule (never a literal `CREATE FUNCTION tenant_kaufnest.get_sales_overview`).
Each function body references `{{schema}}`-relative table names the same
way existing `run_on_all_tenant_schemas` migrations do. `provision_tenant_schema()`
in `005_tenant_provisioning.sql` gets the same four `CREATE FUNCTION`
statements added, so a newly provisioned tenant has them from day one — the
"2-places" rule from `supabase/SKILL.md`.

### Testing

One Jest integration test file per function (or one file covering all
four, implementer's call in the plan), seeding known rows into
`tenant_boughtopia` (currently 3 sales rows — low risk of colliding with
real usage) via a real `createTenantClient()`/service client, calling the
RPC, and asserting the returned JSON matches hand-computed expected values
for each field — including the Formula-A-vs-Formula-B distinction (a test
row with non-null `shipping_charged` should produce different `revenue`
vs. `revenueByPlatform` values, proving the two formulas weren't
accidentally unified) and the effective-sales filter (a `returned` status
row should count in `orderCount` but not in `revenue`/`unitsSold`). Tests
clean up (delete) their seeded rows in an `afterEach`/`afterAll` so
`tenant_boughtopia`'s row count doesn't grow from repeated test runs.

**Aside, not part of this spec's scope:** `supabase/SKILL.md` documents a
`tenant_testing` schema that does not exist in the live database (verified:
only `kaufnest`/`waqasmumtaz`/`hochkauf`/`k2_textil`/`boughtopia` exist) —
stale documentation, unrelated to this work, worth a follow-up fix.

### Error handling

Match the existing graceful-degradation behavior: `fetchAllRows`'s current
callers never surface a fetch error to the user (a failed query silently
defaults to an empty array/zero). The four RPC calls follow the same
pattern — on `error`, log it (no raw error to the UI, consistent with the
`db-error-to-client` verifier rule's intent even though this isn't an API
route) and default that section's numbers to zero / empty arrays, same as
today's `?? []` fallbacks.

## Self-review notes

- Scope check: one migration (4 functions + provisioning update) + one
  page rewrite + N integration tests. Single implementation plan.
- No placeholders — every field in every JSON shape above is a real,
  traced-to-source-code definition, not a guess.
- Consistency check: the Formula-A/Formula-B distinction is stated once in
  "Business logic inventory" and referenced (not re-derived) in the four
  function definitions.
- The `platformBalance`/`platformSubtotal` hardcoded-to-ebay/amazon choice
  matches current behavior exactly (verified against `page.tsx`, which only
  ever renders two balance cards) — flagged explicitly as "don't generalize
  this" so a future implementer doesn't "improve" it into scope creep.
