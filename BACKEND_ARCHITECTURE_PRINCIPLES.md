# Backend & Data-Fetching Architecture Principles

This is the repo's decision framework for how data gets fetched, aggregated,
and served as tenant data grows — written after PR #103, where the Overview
page and three CSV exports silently computed their numbers from only the
first 1000 rows of a 1510-row table, with no error. See
`docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`
for the full design rationale and the audit that produced this doc.

This doc complements, not duplicates, two things that already exist:
- `.claude/verifiers/README.md` — the enforced invariants (`unbounded-limit`
  and `unpaginated-collection-read` are the two this doc is about; the rest
  cover tenant isolation, secrets, and code standards).
- `AGENTS.md`'s "Key rules" and `supabase/SKILL.md`'s
  `run_on_all_tenant_schemas` rule — the multi-tenant DDL rules this doc's
  aggregation guidance (section 2) must never contradict.

For the 30-second version, see AGENTS.md's "New Supabase query checklist" —
it's the actionable summary of sections 1–4 below, kept in every agent's
context by default. Come here for the reasoning behind it.

## 1. Data-fetching decision tree

Every new Supabase query is one of these four shapes. Pick based on what the
caller actually needs, not habit.

**Server-side paginated thunk** — the default for any list a user pages
through (a table with Prev/Next, a searchable list). Shape:
`.select(..., { count: "exact" }).range(from, to)`, wired through a
`fetchXPage` Redux thunk that dispatches a `hydratePage` reducer. Seven
existing implementations to copy from: `fetchSalesPage`, `fetchExpensesPage`,
`fetchPurchasesPage`, `fetchInventoryPage`, `fetchAuditLogsPage`,
`fetchListingsPage`, `fetchMessagesPage`. Shared helpers:
`src/lib/utils/pagedQuery.ts` (`rangeFor`, `PageRequest`,
`DEFAULT_PAGE_SIZE = 50`) and `src/components/ui/Pagination.tsx`. Filters
(date range, status, currency, keyword search) are pushed into the query via
`.gte`/`.lte`/`.eq`/`.ilike` — never applied client-side after an unfiltered
fetch, which would silently miss anything not yet loaded into the current
page.

Page 1 is not fetched by the thunk. `src/app/dashboard/layout.tsx` hydrates it
server-side alongside a row count — `.select("*", { count: "exact" }).range(0,
DEFAULT_PAGE_SIZE - 1)` — and passes each table's `{ data, count }` through
`StoreProvider` into that slice's `hydratePage` reducer; the `fetchXPage`
thunks handle only page 2 onward and filter changes. Two features opt out of
this shape deliberately: **Users and dropshipping listings paginate
client-side**, because both are structurally small sets (a tenant's seats, a
hand-curated supplier list) where a single fetch is honest under the bounded
test below — not a shortcut to copy for a growth table.

**`fetchAllRows`** (`src/lib/utils/fetchAllRows.ts`) — "I need every row
matching a filter, up to a bounded safety cap," not a page at a time. Used
today by the Overview page's four aggregation queries and the
Sales/Expenses/Purchases CSV exports, all capped at 5000 rows. This exists
because of the rule below — it pages through `.range()` calls internally,
advancing by each response's *actual* returned row count rather than the
requested width, so it self-adapts to whatever the server's real per-request
cap is.

**Plain unbounded fetch** — acceptable ONLY for a result set that is
structurally bounded, not just small today. The test: *can you name the
constant that bounds this set?* A tenant's own `platform_connections` is
bounded by the number of platforms this app integrates with (a handful,
fixed by this codebase's feature set). A `.eq("id", x).single()` lookup is
bounded by definition (one row). If the honest answer is a business-growth
quantity — customers, orders, products, users, notifications — it is NOT
bounded, even if today's tenants are all small. Use one of the other three
patterns instead.

**Postgres RPC aggregation** — for a read that needs a computed summary
(sums, group-bys, top-N) rather than the underlying rows. Full criteria in
section 2 below; no tenant-facing feature uses this today (Overview still
uses `fetchAllRows` + client-side reduce), but it's the documented next step
once a table outgrows the bounded-fetch cap.

**The rule underneath all four:** a client must never assume a requested
`.limit()`/`.range()` width was honored. Supabase's PostgREST "Max Rows" API
setting (Project Settings → API, default 1000) silently truncates ANY single
request to its own cap, regardless of what was asked for, with no error.
Confirmed live on `tenant_k2_textil`: a `.limit(5000)` request against 1510
`sales` rows returned `Content-Range: 0-999/1510`. This is why "fetch
everything" must always be a loop (`fetchAllRows`) that trusts the response's
actual size, never a single call with a big number.

**Known gap as of this writing:** `dashboard/layout.tsx`'s product-selector
dropdown query (`id, name, current_stock, sku`, all rows, no `.range()`) and
its `inventorySlice.ts` refetch twin are both plain unbounded fetches on a
table (`products`) that is NOT structurally bounded — a real violation of
this section's own rule, tracked for a future fix (see the verifiers'
"Known baseline" for the current count of open findings like this one; the
`unpaginated-collection-read` rule (below) flags it automatically).

## 2. Aggregation strategy — client-side vs. Postgres RPC

Client-side aggregation (fetch rows via `fetchAllRows`, reduce in memory —
the Overview page's current approach for revenue/VAT/net-profit/top-products)
stays acceptable WHILE the bounded fetch cap (5000 rows per table) reliably
covers a tenant's real data. The signal that it's stopped being acceptable is
observable, not a guess: `fetchAllRows` logs
`console.warn("[fetchAllRows] cap reached", { cap, total })` whenever a
table's real row count exceeds the cap it was given. `tenant_k2_textil` is
already at 1510 sales rows (30% of the 5000 cap) and growing from a two-month
import — this is the kind of number to watch.

When that signal fires (or a full-table download is clearly wasteful just to
produce a handful of summary numbers), the correct move is a Postgres RPC
function that computes the aggregate server-side and returns only the
numbers — not the rows. This is NOT free: it means porting business logic
(the revenue/VAT/exclusion rules currently in `_lib/aggregateSales.ts` and
`lib/utils/filters.ts`'s `isRevenueSale`) into SQL, creating two places
(TypeScript and SQL) that must agree on what counts as revenue. Any RPC
introduced this way is DDL and must go through `run_on_all_tenant_schemas` /
`provision_tenant_schema()` like any other tenant-schema change (section 5) —
it is not exempt from the "2-places" rule just because it's a function
instead of a table column.

## 3. N+1 avoidance

Batch via `.in()`/`.upsert()` rather than one query per row. Two existing
examples to copy: `integrations/review/import/route.ts`'s order upsert and
`listings/ebay/sync/route.ts`'s batched sync. When the `.in()` list itself
can be large, chunk it — `ImportSalesModal.tsx`'s `IN_CHUNK = 200` constant
and its `for (let i = 0; i < ids.length; i += IN_CHUNK)` loop is the
reference pattern.

**A batched `.in()` read is still subject to the Max Rows cap — batching
fixes the round-trip count, not the row cap.** `.in("external_order_id",
extIds)` over 1500 ids can still return only 1000 rows if nothing chunks the
IDS list itself; the 500 missing rows then look like "not found" to the
caller, which is a correctness bug, not just a display truncation one (see
`integrations/review/route.ts` and `integrations/review/import/route.ts` in
the verifiers' current findings — both pass the eslint/type-check gate but
still need the actual chunking fix, tracked for sub-project 3).

One structural exception, not a violation: the account-deletion webhook
(`api/notifications/ebay-account-deletion/route.ts`) loops once per active
tenant issuing several Supabase calls each. Schema-per-tenant multi-tenancy
makes this unavoidable without a cross-schema batching mechanism this app
doesn't have — PostgREST can't join across `tenant_kaufnest.sales` and
`tenant_k2_textil.sales` in one request. The point isn't "never loop," it's
"loop deliberately, with the constraint named," which is why that loop has a
`// verifier:allow unpaginated-collection-read` comment explaining exactly
that, not a silent pass.

## 4. API route conventions

Every subsystem with mutating routes has its own guard function —
`requireBillingAdmin()`, `requireIntegrationAdmin()`,
`requireShippingLabelAccess()`, `requireAiAccess()`
(`src/lib/{billing,integrations,shipping,ai}/authGuard.ts`). They are not
uniformly named `requireXAdmin()` — check the actual export before assuming
the name.

The return shape matters and must be copied exactly, not approximated:

```ts
export type BillingAuthResult =
  | { context: BillingAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };
```

The `?: undefined` on each branch is load-bearing. It's what lets
`if (auth.error) return auth.error;` narrow the union so `auth.context` is
non-optional on the next line. The more "obvious" shape,
`{ error: NextResponse } | { context: T }` without the `?: undefined`
branches, type-checks at the declaration and then fails at every call site
that tries to narrow it — TypeScript can't discriminate a union whose
members don't share an optional-vs-present marker on the same keys.

Every new mutating route needs a guard, first line of the handler:
`const auth = await requireXGuard(); if (auth.error) return auth.error;`.
A new read-only route should still authenticate via the tenant-scoped
Supabase client's RLS rather than skip the question — RLS is not a
substitute for "does this route even check who's asking," it's the
second layer.

Never return a raw Postgres/Supabase error message to the client
(`return NextResponse.json({ error: error.message })` leaks schema
internals — see the `db-error-to-client` verifier rule). Log the real error
server-side, return a generic message to the client.

## 5. Multi-tenant DDL recap

Any new database function, including a Postgres RPC introduced per section
2, is DDL and follows the same rule as every other tenant-schema change: it
goes through `public.run_on_all_tenant_schemas($$ ... $$)`, never a literal
`ALTER TABLE tenant_kaufnest....` or `CREATE FUNCTION tenant_kaufnest....`
targeting one schema. It also needs the matching update to
`provision_tenant_schema()` in `005_tenant_provisioning.sql` so new tenants
get it too. See AGENTS.md's "Key rules" #5 and `supabase/SKILL.md`'s
"2-places" rule for the full detail — this section is a pointer, not a
restatement.

## 6. New Supabase query checklist

The actionable summary of sections 1–4 — a checklist with the same substance
is also inlined into `AGENTS.md` so it's in every agent's context by default
(the wording there is condensed; this version is the fuller one):

1. Is this a list a user pages through? Use a `fetchXPage` thunk:
   `.select(..., { count: "exact" }).range(from, to)`.
2. Do you need every row matching a filter, not just one page? Use
   `fetchAllRows` — never a single `.limit(N)` call, however big N is.
3. Is the result set structurally bounded (not just small today)? Name the
   constant that bounds it. A business-growth quantity (orders, users,
   products, notifications) is never bounded.
4. Do you need a computed summary rather than the rows themselves, and has
   `fetchAllRows` logged a cap-reached warning for this table? Consider a
   Postgres RPC (section 2) instead of fetching rows to reduce client-side.
5. Reading more than one id? Batch via `.in()`/`.upsert()`, chunked if the
   id list can be large (`IN_CHUNK` in `ImportSalesModal.tsx`). Remember: a
   batched `.in()` read is still subject to the Max Rows cap.
6. Writing a new mutating API route? Gate it with a `requireXGuard()`-style
   function (section 4) and never return a raw Postgres error to the client.

## Appendix A — recorded audit findings (2026-09-15)

Predicate: a `.select()` whose result set grows with tenant or platform data,
with no `.range()`, `fetchAllRows`, chunked `.in()`, `.single()`,
`.maybeSingle()`, `.limit()`, or id-equality filter in the same statement.
Verified by reading each site. The `unpaginated-collection-read` verifier
rule (`.claude/verifiers/rules.py`) now catches this class automatically —
run `uv run .claude/verifiers/verify_changes.py --all` for the current live
count, which may include sites beyond this list (the rule's table allowlist
is broader than what was manually reviewed here). **This list is a fixture
recording what prompted the rule; it is not fixed by this doc** — that's
sub-project 3 of `docs/superpowers/specs/2026-09-15-backend-architecture-principles-design.md`.

**Correctness bugs** (wrong results, not just truncated display):

| # | Site | Failure past 1000 rows |
| --- | --- | --- |
| 1 | `src/app/api/integrations/review/import/route.ts` | Dedup `.in()` on `sales` returns a partial `existingByExtId`; `mergeImportedSale` then treats existing orders as new and silently wipes user-owned fields on re-import. |
| 2 | `src/app/api/integrations/review/route.ts` | Dedup set for the review list is partial, so already-imported orders re-appear as new and can be imported twice. |
| 3 | `src/app/api/dropshipping/listings/check-prices/route.ts` | Bulk price check silently examines only the first 1000 listings and reports success for the whole set. |
| 4 | `src/store/slices/notificationsSlice.ts` (`notification_reads`) | Unbounded and unlimited; past 1000 reads, already-read notifications resurface as unread. |
| 5 | `src/store/slices/notificationsSlice.ts` (low-stock `products` query) | Truncated source set → missed low-stock alerts for products past the cap. |

**Display / completeness truncation:**

| # | Site | Effect |
| --- | --- | --- |
| 6 | `src/app/dashboard/layout.tsx` (product selector) | Incomplete product dropdowns in Add/Edit Sale, Purchase. |
| 7 | `src/app/dashboard/inventory/_store/inventorySlice.ts` (selector refetch) | Same bug, second location — fix both together. |
| 8 | `src/app/dashboard/layout.tsx` (`dropship_listings`) | Hydration truncated. |
| 9 | `src/app/dashboard/layout.tsx` (`platform_payouts`) | Hydration truncated (Overview itself re-fetches via `fetchAllRows`, so this affects store consumers, not the Overview cards). |
| 10 | `src/app/dashboard/layout.tsx` (`profiles`) | Structurally unbounded, small in practice (tens per tenant) — lowest severity, listed for completeness. |
| 11 | `src/app/api/dropshipping/listings/route.ts` | Listing list truncated. |
| 12 | `src/app/api/admin/tenants/route.ts` | Platform-wide tenant list truncated in `/admin`. |
| 13 | `src/app/api/admin/ai-usage/route.ts` | `tenant_ai_usage` grows per tenant × user × kind × period — the fastest-growing table here; admin AI usage figures under-report. |

Deliberate and correct, suppressed rather than fixed:
`ImportSalesModal.tsx` (chunks via `IN_CHUNK`, one call per chunk — see
section 3), `messagesSlice.ts` (explicit `SEARCH_RESULT_LIMIT`, truncation
is the intended search-results UX), `ebay-account-deletion/route.ts`
(tenant list bounded by active tenant count — see section 3's N+1
exception).
