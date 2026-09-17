---
name: dashboard-shell
description: Work on the dashboard shell, layout-level data hydration, or the Overview/home page at src/app/dashboard — use when the task spans multiple dashboard features, touches the auth guard/data-fetch in layout.tsx, or is about the Overview stats page (not a single feature like sales/expenses/etc).
---

# Working on the Dashboard shell / Overview

If your task is about ONE feature (sales, expenses, purchases, users,
audit-logs, settings), go straight to that feature's folder and its own
`SKILL.md` — don't start here.

Use this folder when the task is about:
- The auth guard or initial data fetch/hydration (`layout.tsx`)
- The Overview/home page stats (`page.tsx`, route `/dashboard`)
- Something that spans multiple features (e.g. "add a new collection that
  every page needs hydrated")

## Adding a new feature with its own Supabase collection

1. Fetch it in `layout.tsx`'s `Promise.all` and pass it to `<StoreProvider>`.
2. Add the hydrate action + slice registration in `src/store/StoreProvider.tsx`
   and `src/store/store.ts` (see how `sales`/`expenses` are wired for the pattern).
3. Build the feature's own `_components`/`_store` inside its route folder,
   following the structure of `sales/` (the most complete example).
4. Write that feature's `CLAUDE.md`/`SKILL.md` and add a row to the table in
   `dashboard/CLAUDE.md`.

## Overview page changes

`page.tsx` fetches sales/expenses/purchases/platform_payouts directly via
`createTenantClient()` into local `useState` (NOT Redux — see `dashboard/CLAUDE.md`
for why) and does its aggregation in `_lib/`. Stat cards come from
`components/ui/StatCard`.

### Gotcha: Supabase's PostgREST "Max Rows" setting silently truncates below your `.limit()`

A Supabase project's "Max Rows" API setting (Project Settings → API, default
1000) caps **every** REST request's response at that many rows regardless of
the `.limit()`/`.range()` width the client actually requested — no error, no
warning, just fewer rows than asked for. Confirmed live: `tenant_k2_textil`
has 1510 `sales` rows; a `.limit(5000)` query returned `Content-Range:
0-999/1510` (curl against `/rest/v1/sales` with `Accept-Profile:
tenant_k2_textil`, see git history for the fix commit). Any tenant whose row
count crosses whatever that project's Max Rows setting is will silently get
wrong Overview aggregates (revenue, VAT, net profit, order count) computed
from only the most recent N rows — no loading error, so it looks like correct
but small numbers, not a failure.

**Fix**: use `@/lib/utils/fetchAllRows`, not a bare `.limit(N)` single
request. It pages through `.range()` calls, using each response's *actual*
returned row count (not the requested width) to advance the offset — so it
self-adapts to whatever the server's real per-request cap is instead of
assuming the requested width was honored. The 4 Overview queries in
`page.tsx` and the Sales/Expenses/Purchases CSV export queries
(`handleExport` in each feature's `page.tsx`) all go through it. It lives in
`src/lib/utils/` (not this folder's `_lib/`) since it now services 4
features — see AGENTS.md's shared-vs-feature-private rule. If you add a new
"fetch everything matching a filter" query anywhere, use the same helper
rather than a single `.limit()`.

### Gotcha: "Specific period" filter — Overview does NOT use `FilterBar`

Overview's date filter supports "Specific period" (any month/quarter/full
year) same as Sales/Expenses/Purchases/Audit Logs, but `page.tsx` has its own
bespoke inline date-range UI rather than importing the shared `FilterBar`
component — see `components/ui/SKILL.md`'s FilterBar entry for the shared
version other features use. If you change the period-picking logic, check
both places.

## Test command

`npx jest dashboard/_lib` (`aggregateSales.test.ts`, `platformBalance.test.ts`)
+ `npx jest lib/utils/fetchAllRows` for the shared helper itself.
