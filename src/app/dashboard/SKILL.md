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

Full explanation, the decision framework for which fetch pattern to use, and
the current audit of other places this bites: `BACKEND_ARCHITECTURE_PRINCIPLES.md`
(sections 1 and Appendix A). Short version: a Supabase project's "Max Rows"
API setting (default 1000) caps every REST request's response at that many
rows regardless of the `.limit()`/`.range()` width requested, no error — use
`@/lib/utils/fetchAllRows`, not a bare `.limit(N)`, for "fetch everything
matching a filter." The 4 Overview queries in `page.tsx` and the
Sales/Expenses/Purchases CSV export queries all go through it already.

## Test command

`npx jest dashboard/_lib` (`aggregateSales.test.ts`, `platformBalance.test.ts`)
+ `npx jest lib/utils/fetchAllRows` for the shared helper itself.
