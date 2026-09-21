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

`page.tsx` fetches its four aggregates via `createTenantClient()` calling
`supabase.rpc("get_sales_overview" | "get_expenses_overview" |
"get_purchases_overview" | "get_payouts_overview", { p_from, p_to,
p_currency })` (2026-09-17 rewire), storing each RPC's JSON result in local
`useState` (NOT Redux — see `dashboard/CLAUDE.md` for why). Date-range and
currency filtering happen in SQL now, not client-side. Derived values
(`totalRevenue`, `monthlyTrend`, `platformData`, `computePlatformBalance()`,
etc.) are plain reads/reshapes of those four objects — see `_lib/` in
`dashboard/CLAUDE.md` for the two pure helpers still involved
(`aggregateSaleRevenue`'s formula moved into the `get_sales_overview` SQL
function itself; `computePending` still runs client-side). Stat cards come
from `components/ui/StatCard`.

### Gotcha: Supabase's PostgREST "Max Rows" setting silently truncates below your `.limit()`

Full explanation, the decision framework for which fetch pattern to use, and
the current audit of other places this bites: `BACKEND_ARCHITECTURE_PRINCIPLES.md`
(sections 1 and Appendix A). Short version: a Supabase project's "Max Rows"
API setting (default 1000) caps every REST request's response at that many
rows regardless of the `.limit()`/`.range()` width requested, no error — use
`@/lib/utils/fetchAllRows`, not a bare `.limit(N)`, for "fetch everything
matching a filter." **The Overview page (`page.tsx`) no longer exercises this
gotcha at all** — as of the 2026-09-17 RPC rewire it fetches pre-aggregated
JSON via `supabase.rpc(...)` instead of paging through raw rows, so don't be
confused if you don't see a `fetchAllRows` call in `page.tsx` anymore. The
Sales/Expenses/Purchases CSV export queries still go through it.

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

`overviewRpc.integration.test.ts` in the same folder is NOT part of that
run — it's excluded from the default `jest.config.ts` `testMatch` and
picked up only by `jest.integration.config.ts`'s `*.integration.test.ts`
pattern. Run it with `npm run test:integration`. It makes real
insert/rpc/delete calls against `tenant_boughtopia` — see its file header
and `dashboard/CLAUDE.md`'s `_lib` entry for what it verifies and why.

### Gotcha: `.env.local` doesn't reach an integration test the way you'd expect

Jest sets `NODE_ENV=test`, and two of the obvious ways to load env vars for
a Jest test both silently no-op under that:
- `process.loadEnvFile(".env.local")` writes to Node's real environment
  store, but jest's `NodeEnvironment` has already replaced `process.env`
  with a static snapshot object *before* your test file's top-level code
  runs — so the write lands somewhere your test's `process.env` reads never
  see.
- `@next/env`'s `loadEnvConfig()` (the function Next's own docs point you
  to for exactly this — see
  `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`)
  deliberately skips `.env.local` whenever `NODE_ENV === "test"`, precisely
  so tests don't depend on a developer's local secrets. That's the right
  default for most tests, but this one specifically needs a live
  Supabase project's real credentials.

Fix: read the file yourself and parse it with Node's built-in
`util.parseEnv` (same parser `node --env-file` uses, no extra dependency),
then assign into `process.env` directly — a plain
`process.env[key] = value` assignment mutates jest's snapshot object fine,
unlike `loadEnvFile`. See the top of `overviewRpc.integration.test.ts` for
the exact pattern; reuse it verbatim in any future integration test file
rather than re-discovering this.
