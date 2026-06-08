---
name: lib-utils
description: Reference for the shared utility modules in src/lib/utils (audit, currency, date, filters, generateInvoice, permissions) — use this instead of opening the source files when you need to know what a helper does, its signature, or where it's used.
---

# Shared utilities (`src/lib/utils/`)

Pure-function helpers used across Sales/Expenses/Purchases/Users/Audit Logs.
They're shared because 3+ features depend on them — see the root `AGENTS.md`
"shared vs. feature-private" rule before moving anything into or out of here.
Each module (except `generateInvoice.ts`) has a colocated `*.test.ts` — run
them with `npx jest lib/utils`.

## audit.ts

`export async function writeAuditLog(supabase, params: WriteAuditLogParams)`
→ `Promise<AuditLog | null>`.

- `params`: `{ userId, userEmail, action: AuditAction, entityType: AuditEntity, entityId?, metadata? }`.
- Inserts into the `audit_logs` table and returns the inserted row via
  `.select().single()`.
- **Does not throw** — errors are swallowed (destructures only `data`, not
  `error`) so a logging failure never blocks the primary CRUD action. Don't
  wrap calls in `try/catch` expecting to handle audit failures; there's
  nothing to catch.
- Every create/update/delete across Sales/Expenses/Purchases/Users calls this
  *and* dispatches `addAuditLog(...)` to the shared `auditLogsSlice` — both
  halves are required (DB row for persistence, Redux dispatch for the
  same-session UI to show it immediately).

## currency.ts

- `formatCurrency(amount, currency: Currency = "EUR")` — `Intl.NumberFormat`
  `de-DE` locale, e.g. `1234.5` → `"1.234,50 €"`. Use for all money display;
  don't hand-roll formatting.
- `calculateNetProfit(revenue, expenses, purchases)` — `revenue - expenses - purchases`.
- `sumAmounts(amounts: number[])` — sums and rounds to 2 decimals (avoids FP
  drift from naive `reduce`).
- `calculateMargin(revenue, cost)` → `number | null` — percentage rounded to
  2 decimals; **returns `null` when `revenue === 0`** to avoid `Infinity`/`NaN`
  — callers must handle the null case (e.g. render "—").

## date.ts

- `formatDate(isoDate)` — `"2024-06-01"` → `"01.06.2024"` (`de-DE` short date).
- `formatDateTime(isoDate)` — `de-DE` date + time, e.g. `"01.06.2024, 16:30 Uhr"`.
- `getMonthRange(year, month)` → `{ from, to }` ISO strings for the first/last
  day of the month. Builds dates from local-date components (`new Date(year, month, day)`)
  rather than parsing ISO strings, specifically to dodge UTC offset shifts —
  keep that pattern if you extend it.

## filters.ts

The date-preset + entity-filter logic backing `FilterBar` (see
`components/ui/SKILL.md`) on the Sales/Expenses/Purchases list pages.

- `DatePreset = "all" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom"`
- `getPresetRange(preset)` → `{ from, to } | null` — concrete ISO range for a
  preset; `null` for `"all"`/`"custom"` (custom is resolved by the caller).
- `resolveDateRange(preset, dateFrom, dateTo)` — the one to call generally;
  handles `"custom"` by falling back to sentinel bounds (`"0000-00-00"` /
  `"9999-99-99"`) when only one side is provided, and to `null` (no filter)
  when both are empty.
- Per-entity filter shapes + defaults: `SalesFilters`/`DEFAULT_SALES_FILTERS`,
  `ExpenseFilters`/`DEFAULT_EXPENSE_FILTERS`, `PurchaseFilters`/`DEFAULT_PURCHASE_FILTERS`.
  Note `PurchaseFilters.vendor` defaults to `""` (free-text search) while
  Sales/Expenses use a `"all"`-sentinel dropdown (`platform`/`category`) —
  don't conflate the two when adding a new entity filter.
- `filterSales`/`filterExpenses`/`filterPurchases` — apply a filter object to
  an array; each composes `resolveDateRange` + the entity-specific field
  checks. Add new filterable fields here, mirroring the existing per-field
  `if` blocks.
- `isDefaultFilters(f)` — drives the `FilterBar`'s "Clear" button visibility
  (`hasActive = !isDefaultFilters(filters)`); uses `"x" in f` narrowing so one
  function works across all three filter shapes.

## permissions.ts

Static role-based permission matrix — no Supabase calls, pure lookups against
`UserRole` from `src/types`.

- `PERMISSIONS` — `Record<Permission, readonly UserRole[]>`. `Permission` is
  derived as `keyof typeof PERMISSIONS`, so adding a key automatically extends
  the type. Naming convention: `<verb>_<entity>` (`create_expense`,
  `manage_users`, `view_audit_logs`, ...).
- `hasPermission(role, permission)` — the primitive check; most call sites
  should use this directly (e.g. to show/hide an Edit/Delete button).
- `canAccessRoute(role, pathname)` — route-level gate used by `src/proxy.ts`
  (this app's middleware-equivalent) to block `/dashboard/users` and
  `/dashboard/audit-logs` for roles without `manage_users`/`view_audit_logs`.
  Everything else returns `true` (any authenticated role).
- `ROLE_HIERARCHY = ["accountant", "admin", "super_admin"]` (ascending) backs
  `hasMinimumRole(role, minimum)` — an index comparison, for "at least as
  privileged as X" checks rather than an exact-permission lookup.
- Adding a new role to `UserRole` means updating `ROLE_HIERARCHY` *and* every
  relevant `PERMISSIONS` array — neither is enforced by the type system.

## generateInvoice.ts

Client-side PDF generation via `jspdf`/`jspdf-autotable`, **dynamically
imported** (`getJsPDF`/`getAutoTable`) to avoid pulling them into the SSR
bundle — keep that pattern if you touch the imports.

- `generateSalesInvoice(sales, settings)`, `generateExpensesInvoice(expenses, settings)`,
  `generatePurchasesInvoice(purchases, settings)` — each builds a `jsPDF` doc,
  renders a header (company info from `InvoiceSettings`, see `lib/hooks/SKILL.md`),
  an `autoTable` of rows, a per-currency totals block, a footer, then
  `doc.save(...)`. All `async`, all trigger a browser download directly —
  there's no return value to await for.
- The three functions are near-identical (different columns, header color,
  filename suffix) — when changing shared layout/header/footer behavior, edit
  `addHeader`/`addFooter`/`formatDate`/`formatMoney`/`generateInvoiceNumber`
  once rather than each function; when changing one entity's columns, only
  touch that function's `rows`/`autoTable` config.
- `generateInvoiceNumber(prefix)` — `${prefix}${YYYYMM}-${4-digit random}`.
  Not guaranteed unique; this is a display/filing convenience, not a DB key.
- `doc`/`autoTable` callback params are typed `any` (with eslint-disable
  comments) — `jsPDF`'s plugin types don't expose `lastAutoTable`; keep the
  disables if you add similar `(doc as any)` accesses.

## Where these are used

`audit.ts`/`currency.ts`/`date.ts`/`permissions.ts` are imported directly by
feature `page.tsx`/`_components/*` files and `_store/*Slice.ts` reducers.
`filters.ts` pairs specifically with `components/ui/FilterBar.tsx`.
`generateInvoice.ts` is invoked from `components/modals/InvoiceModal.tsx` and
`app/dashboard/settings/page.tsx` (preview/test-generate button).
