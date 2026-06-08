<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working agreement — how we proceed

- **Don't run `npm test`, `npx tsc --noEmit`, or `npm run lint` yourself.** Ask the
  user to run them and paste the output back. Running these repeatedly burns tokens
  on output the user can capture in one shot locally.
- **Don't start the dev server or `curl` routes to verify functionality.** Instead,
  add/extend unit tests in the feature's `_store/` (or `_components/`/lib) folder
  alongside the code you changed, then ask the user to manually exercise the feature
  in the browser and report back what they see.

# Project structure: feature folders

KaufNest Dashboard is a Next.js App Router app (Supabase + Redux Toolkit). To
keep changes isolated and cheap to make, **each feature's page, components,
state, and tests are colocated in one folder** under `src/app/...`, using
Next.js private folders (`_components/`, `_store/` — the leading underscore
opts them out of routing per the App Router docs at
`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`).

**Before editing a feature, open its folder's `CLAUDE.md` and `SKILL.md` first.**
They name the exact files to touch for common changes — you should rarely need
to explore outside that folder plus the shared dependencies it lists.

**After editing a feature, if you learned something important** — a new
gotcha, a changed data-flow pattern, a moved/renamed file, a new shared
dependency — update that feature's `SKILL.md` (and `CLAUDE.md` if the file map
changed) before you finish. Treat these docs as the project's context cache:
keeping them current means the next agent (or your future self) picks up where
you left off instead of re-deriving everything from scratch.

## Feature folders

| Folder | Route | Owns |
| --- | --- | --- |
| `src/app/(auth)/` | `/login`, `/forgot-password`, `/set-password` | auth pages (+ related `app/auth/callback`, `app/api/users/invite` routes) |
| `src/app/dashboard/` | `/dashboard` (Overview) | shell-level layout/data-hydration + overview stats — see its `CLAUDE.md` for the full feature table |
| `src/app/dashboard/sales/` | `/dashboard/sales` | sales records + `salesSlice` |
| `src/app/dashboard/expenses/` | `/dashboard/expenses` | expense records + `expensesSlice` |
| `src/app/dashboard/purchases/` | `/dashboard/purchases` | inventory purchases + `purchasesSlice` |
| `src/app/dashboard/inventory/` | `/dashboard/inventory` | product catalog + stock levels + `inventorySlice` (linked from Purchases/Sales; stock synced via DB triggers) |
| `src/app/dashboard/users/` | `/dashboard/users` | user invites/roles + `usersSlice` |
| `src/app/dashboard/audit-logs/` | `/dashboard/audit-logs` | activity-trail viewer (slice is shared, see below) |
| `src/app/dashboard/settings/` | `/dashboard/settings` | invoice template settings (thin — no private state) |

Each feature folder follows the same shape (where it has private code):

```
<feature>/
  page.tsx
  _components/   # feature-only modals/UI
  _store/        # feature-only Redux slice + its colocated test
  CLAUDE.md      # file map, data-flow pattern, shared deps, test command
  SKILL.md       # agent playbook: minimal file set per change type, gotchas
```

## Shared vs. feature-private — how the split was decided

A piece of code stays in a top-level shared folder only if it's used by **3+
features or only in core wiring**; otherwise it moves into the one feature that
owns it. Current shared locations:

- `src/components/ui/*` — generic primitives (Button, Modal, DataTable,
  FilterBar, Badge, Toast, FormFields, StatCard, ThemeProvider)
- `src/components/layout/*` — app shell (DashboardShell, Sidebar, PageHeader)
- `src/components/modals/{DeleteConfirmModal,InvoiceModal}` — used by Sales,
  Expenses, and Purchases
- `src/store/{store.ts,hooks.ts,StoreProvider.tsx}` + `src/store/slices/{auditLogsSlice,currentUserSlice}`
  — `auditLogsSlice` is written to by every CRUD feature; `currentUserSlice` is
  read directly by Sales/Expenses/Purchases for role checks
- `src/lib/*` — Supabase clients, `utils/{audit,currency,date,filters,permissions,generateInvoice}`,
  `hooks/useInvoiceSettings` (the last two are also used by the shared `InvoiceModal`)
- `src/types/index.ts` — single source of truth for all domain types

Two routes are conceptually part of a feature but **cannot** be colocated
because Next.js pins them to fixed URL paths: `app/api/users/invite/route.ts`
(Users) and `app/auth/callback/route.ts` (Auth). Each is cross-referenced from
its feature's `CLAUDE.md`.

## Tests

Tests are colocated with the code they cover (`*.test.ts` next to the slice or
lib file it tests) — `jest.config.ts` discovers any `src/**/*.test.ts(x)`. Run
a single feature's tests with `npx jest dashboard/<feature>`.
