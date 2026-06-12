# Dashboard shell + Overview

This is the entry point for everything behind login. **Each subfolder is its own
feature with its own `CLAUDE.md`/`SKILL.md` — read those instead of exploring
broadly when working on a specific feature.**

## Files at this level

- `layout.tsx` — server component: auth-guards the route (`redirect("/login")`
  if no session/profile), fetches the first page of every collection
  (sales/expenses/purchases/products/audit_logs/profiles/**company_profile**)
  from Supabase **once**, and hydrates them into Redux via `<StoreProvider>` so
  individual pages never refetch on mount. Also reads the `kaufnest_impersonating`
  cookie and passes it to `<DashboardShell>` for the impersonation banner.
  Wraps everything in `<ToastProvider>` and `<DashboardShell>`.
  **If you add a new feature with its own collection, hydrate it here.**
- `page.tsx` — the Overview/home page (`/dashboard`). Pure aggregation: reads
  `sales`/`expenses`/`purchases` from Redux, applies a user-controlled date-range
  filter (`resolveDateRange` from `lib/utils/filters`, preset + custom from/to),
  derives `effectiveSales = periodSales.filter(s => s.status !== "returned")`
  and renders:
  - 5 `StatCard`s: Revenue, Expenses, Purchases, Net Profit, Orders (sale count +
    units sold) — grid expands to `lg:grid-cols-5`. Revenue, Net Profit, VAT
    Collected, monthly trend revenue, Revenue by Platform, and Top Products all
    use `effectiveSales` (excludes `status === "returned"` orders) — only the
    "Orders" StatCard's count uses the unfiltered `periodSales.length` (total
    orders placed, including returns).
  - **VAT Position** section (hidden when no VAT data in period): VAT Collected
    (output, from sales), VAT Paid (input, purchases + expenses), net Due to
    Government / Government Refund
  - **Expenses by Category** section (hidden when no expenses): per-category totals
    sorted by spend, rendered with `CategoryBadge`
  - **Charts** section (hidden when no data in period): 2-column row with a
    `recharts` `AreaChart` (Revenue/Expenses/Purchases by month, 2/3 width) and a
    `PieChart` donut (Revenue by Platform, 1/3 width + custom legend)
  - **Top Products** and **Expenses by Category** side-by-side in a 2-col grid
    (each hidden when empty)
  Chart colours adapt to dark/light theme via `useTheme()` — hardcoded hex values
  are passed to recharts props (CSS variables don't render reliably inside SVG).
  No feature-private code — has no `_components`/`_store` of its own.
  Shared deps:
  `StatCard`, `CategoryBadge`, `formatCurrency`/`calculateNetProfit`,
  `resolveDateRange`, `ExpenseCategory` type, `useTheme`, `recharts`.

## Feature folders (each documents itself — start there)

| Folder | Route | What it owns |
| --- | --- | --- |
| `sales/` | `/dashboard/sales` | sales records ("Orders" in UI), `salesSlice` |
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
