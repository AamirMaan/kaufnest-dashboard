# Dashboard shell + Overview

This is the entry point for everything behind login. **Each subfolder is its own
feature with its own `CLAUDE.md`/`SKILL.md` — read those instead of exploring
broadly when working on a specific feature.**

## Files at this level

- `layout.tsx` — server component: auth-guards the route (`redirect("/login")`
  if no session/profile), fetches the first page of every collection
  (sales/expenses/purchases/products/audit_logs/profiles) from Supabase
  **once**, and hydrates them into Redux via `<StoreProvider>` so individual
  pages never refetch on mount. Wraps everything in `<ToastProvider>` and
  `<DashboardShell>`. **If you add a new feature with its own collection,
  hydrate it here.**
- `page.tsx` — the Overview/home page (`/dashboard`). Pure aggregation: reads
  `sales`/`expenses`/`purchases` from Redux, computes this-month totals via
  `getMonthRange` + `calculateNetProfit`, renders `StatCard`s. No
  feature-private code — has no `_components`/`_store` of its own.

## Feature folders (each documents itself — start there)

| Folder | Route | What it owns |
| --- | --- | --- |
| `sales/` | `/dashboard/sales` | sales records, `salesSlice` |
| `expenses/` | `/dashboard/expenses` | expense records, `expensesSlice` |
| `purchases/` | `/dashboard/purchases` | inventory purchases, `purchasesSlice` |
| `inventory/` | `/dashboard/inventory` | product catalog + stock levels, `inventorySlice` (stock kept in sync via DB triggers off linked purchases/sales — see its CLAUDE.md) |
| `users/` | `/dashboard/users` | user invites/roles, `usersSlice` (super_admin only) |
| `audit-logs/` | `/dashboard/audit-logs` | activity trail viewer (slice is shared, see its CLAUDE.md) |
| `settings/` | `/dashboard/settings` | invoice template settings |

## Shared shell components (live outside, in `src/components/layout/`)

`DashboardShell` (header, user menu, theme toggle), `Sidebar` (nav + role-based
links + collapse), `PageHeader` (page title/description/actions row used by
every feature page).

## Cross-cutting state & infra

`src/store/{store.ts,hooks.ts,StoreProvider.tsx}` + the two genuinely shared
slices `auditLogsSlice`/`currentUserSlice` in `src/store/slices/`. See
`src/AGENTS.md` → "Project structure" for the full shared-vs-feature-private map.
