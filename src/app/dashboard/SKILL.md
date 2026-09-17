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
