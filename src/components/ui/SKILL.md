---
name: ui-primitives
description: Reference for the shared UI primitives in src/components/ui (Button, Badge, DataTable, FilterBar, FormFields, Modal, StatCard, Toast, ThemeProvider, AiUsageNote) — use this instead of opening the component source files when you need to know props, exports, or usage patterns.
---

# UI primitives reference (`src/components/ui/`)

These are generic, design-token-driven primitives used across all dashboard
features (Sales, Expenses, Purchases, Users, Audit Logs). They're shared
because 3+ features depend on them — see the root `AGENTS.md` "shared vs.
feature-private" rule before moving anything into here or out of here.

This file documents every component's **exports, props, and gotchas** so you
can use them correctly without re-reading the source. Only open the actual
`.tsx` file if you need to change its behavior, not just consume it.

All of them style via CSS custom properties (`var(--color-*)`, `var(--radius-*)`,
`var(--shadow-*)`) defined by the theme system — never hardcode colors/radii,
reuse the existing token names you see in sibling usages.

## Button.tsx

`export const Button` — `forwardRef<HTMLButtonElement, ButtonProps>`, extends
all native `<button>` attributes.

- `variant?: "primary" | "secondary" | "danger" | "ghost"` (default `"primary"`)
- `size?: "sm" | "md" | "icon"` (default `"md"`)
- Also exports the `ButtonVariant` / `ButtonSize` types.
- Pass `className` to extend/override; it's appended after the variant/size classes.

## Badge.tsx

Base `export function Badge({ label, variant? })` —
`variant?: "default" | "success" | "warning" | "danger" | "info"` (default `"default"`).

Domain-specific wrappers (prefer these over the base `Badge` when the value maps
to a known domain enum — they own the label text + color mapping):

- `RoleBadge({ role: UserRole })` — `super_admin`→danger, `admin`→warning, `accountant`→info
- `ActionBadge({ action: AuditAction })` — create→success, update→info, delete→danger, login/logout→default, role_change→warning, permission_change→warning, status_change→warning
- `CategoryBadge({ category: ExpenseCategory })` — always `variant="default"`,
  maps the enum to a display label via `CATEGORY_LABELS[category] ?? category`
  (2026-09-27 final-review fix — `expenses.category` is unconstrained `text`
  in the DB, so a value outside the known 8-entry enum falls back to itself
  instead of rendering the literal word "undefined"; the Expenses feature's
  own summary-tile `categoryLabel` lambda in `page.tsx` needs the identical
  `?? c` fallback wherever it reads `CATEGORY_LABELS` directly)
- `PlatformBadge({ platform: Platform })` — amazon→warning, ebay→danger, etsy→success, shopify→info, other→default
- `StatusBadge({ status: string })` — generic (not typed to a specific enum,
  so adding a value needs no `Record<Enum,...>` TS enforcement — easy to
  forget). Order statuses (Sales feature): pending→default, processing/
  shipped→info, delivered→success, returned→danger, cancelled→warning; any
  unmapped string (custom order statuses) falls back to `variant="default"`.
  User statuses (Users feature, `Profile.status`): `active`→success,
  `deactivated`→danger — same `STATUS_VARIANTS` map, both domains share it
  since the string values don't collide.

If you add a new value to `UserRole`/`AuditAction`/`ExpenseCategory`/`Platform`
in `src/types/index.ts`, you must add it to the corresponding `*_LABELS`/`*_VARIANTS`
record here too (TS will error on the `Record<Enum, ...>` if you forget) — for
`StatusBadge`'s `STATUS_VARIANTS` specifically, TS won't catch a missing entry
(it's `Record<string, BadgeVariant>`), it'll just silently render `"default"`.

## DataTable.tsx

`export function DataTable<T>({ columns, rows, keyField, emptyMessage?, selectedIds?, onSelectionChange? })`

- `Column<T>`: `{ header, accessor?: keyof T, render?: (row: T) => ReactNode, className?, sortValue?: (row: T) => string | number }`
  - Provide `render` for custom cell content (badges, formatted currency, actions);
    falls back to `String(row[accessor])` or `"—"`.
  - Provide `sortValue` to make a column header clickable/sortable (cycles
    asc → desc → unsorted). Sorting is handled internally via `useState`/`useMemo` —
    callers don't manage sort state.
- Selection is opt-in: pass both `selectedIds: Set<string>` and `onSelectionChange`
  to get a checkbox column (select-all + per-row), keyed by `String(row[keyField])`.
  Omit both for a plain read-only table.
- `emptyMessage` defaults to `"No records found."`.

## FilterBar.tsx

`export function FilterBar(props: FilterBarProps)` — `"use client"`. The shared
date-range + currency filter shell used by Sales/Expenses/Purchases list pages.

Controlled component — caller owns all state:
`preset, onPresetChange, dateFrom, onDateFromChange, dateTo, onDateToChange,
currency, onCurrencyChange, searchValue, onSearchChange, searchPlaceholder,
hasActive, onClear`, plus `children` for entity-specific filter slots (e.g. a
platform/category dropdown) rendered inline before the search box — search is
the catch-all, so it renders last, to the right of the more specific dropdowns.

- `searchValue`/`onSearchChange` render a free-text search input (hidden when
  `onSearchChange` is undefined, same pattern as `currency`/`onCurrencyChange`).
  `FilterBar` owns a 400ms debounce internally via local state + a
  `setTimeout` effect — the caller's `onSearchChange` only fires 400ms after
  the user stops typing, so callers don't need their own debounce logic.
  Pair with `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`) on the page/thunk
  side before building a Supabase `.or()`/`.ilike()` query.

- `preset: DatePreset` (from `@/lib/utils/filters` — `"all" | "this_month" |
  "last_month" | "this_quarter" | "this_year" | "custom"`). Selecting `"custom"`
  reveals the From/To date inputs — **unless** the "Specific period" mode
  below is active, in which case it reveals Year/Period selects instead.
- **"Specific period" mode** (2026-09-17) — two new OPTIONAL props,
  `earliestYear?: number` and `onPeriodChange?: (preset, dateFrom, dateTo)
  => void`. A "Specific Period" dropdown option only appears when
  `onPeriodChange` is provided; picking it (or changing the resulting
  Year/Period selects) resolves a `{year, unit}` pick via
  `periodRange`/`describePeriod` (`@/lib/utils/filters`) into a plain
  `{from, to}` pair and calls `onPeriodChange("custom", from, to)` — **one
  call, all three values at once**. This is load-bearing, not a style
  choice: Sales/Expenses/Purchases/Audit Logs each hold `preset`/`dateFrom`/
  `dateTo` in ONE merged filter object updated via a `setFilter(key, value)`
  helper that reads the CURRENT `filters` from closure — calling
  `onPresetChange`/`onDateFromChange`/`onDateToChange` as three separate
  prop calls in the same handler would have each one compute its `next`
  object from the same pre-update closure, so only the LAST call's field
  would survive. Callers must add their own combined setter (see
  `sales/page.tsx`'s `setPeriod`) and pass it as `onPeriodChange`.
  `earliestYear` sets the Year select's lower bound (defaults to the
  current year, showing a single-year dropdown, if omitted) — see
  `lib/utils/fetchEarliestYear.ts`.
  Whether "custom" is showing the period selects or the raw date inputs is
  tracked as local component state (`customSubMode`), computed once at
  mount via `describePeriod(dateFrom, dateTo)` and changed afterward only by
  the user's own explicit dropdown pick — NOT re-derived on every prop
  change, which would otherwise flip the UI out from under someone mid-way
  through typing a manual custom range that happens to land on a period
  boundary.
- Currency options are hardcoded: `["all", "EUR", "USD", "GBP"]`.
- The Clear button only renders when `hasActive` is true.
- Pair with `lib/utils/filters.ts` helpers (e.g. `filterSales`/`filterExpenses`)
  on the page side — this component only renders the controls, it does no
  filtering itself.

## FormFields.tsx

Lightweight form primitives shared by all "Add"/"Edit" modals:

- `Field({ label, error?, required?, children })` — label + error wrapper around any input
- `Input(props: InputHTMLAttributes<HTMLInputElement>)`
- `Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>)`
- `Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>)` — fixed `rows={3}`
- `Checkbox({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">)`
  — labeled native `<input type="checkbox">`, token-styled. Used for the
  "Total/Amount includes VAT" toggle in the Sales/Purchases/Expenses Add/Edit
  modals (paired with a VAT-rate `Field`+`Input` and `vatAmountFromGross` —
  see those features' `CLAUDE.md` "VAT" sections).
- `Row({ children })` — 2-column grid on `sm:`+, single column on mobile; use to
  pair two `Field`s side by side

`Input`/`Select`/`Textarea` all share one `inputClass` constant (token-based
border/bg/focus-ring styling) — they're thin styled wrappers over native
elements and forward all native props directly. `className` on
`Input`/`Select`/`Textarea` is appended to the base input style (used for the
receipt-autofill highlight ring), not a replacement — no current caller
relies on the old replace behavior.

## Modal.tsx

`export function Modal({ title, open, onClose, children, footer? })` — `"use client"`.

- Renders via `createPortal` into `document.body`; returns `null` when `!open`.
- Closes on `Escape` and on backdrop click; locks `document.body` scroll while open.
- `footer` is optional — omit it for a modal with no action bar (footer row only
  renders when provided). Typically pass `<Button variant="secondary">Cancel</Button>
  <Button onClick={...}>Save</Button>`.
- Not a generic dialog — it's specifically the "Add/Edit X" / confirm shape used
  across the app. `DeleteConfirmModal` and `InvoiceModal` (in `src/components/modals/`)
  are built on top of it.

## Pagination.tsx

Shared table footer used by every server-paginated list (Sales, Expenses,
Purchases, Inventory products/transfers, Audit Logs, Listings, Dropshipping).
Redesigned 2026-09-28: "Showing X–Y of Z results" on the left; on the right a
"Rows" select (25/50/100, only when `onPageSizeChange` is passed) and
**Previous · numbered page buttons · Next** — active page is solid
`--color-primary` + white, disabled Previous/Next go muted.

- `pageNumbers(page, totalPages)` (pure, tested) — every page when ≤ 7,
  otherwise first/last/current±1 with `"…"` gaps, always 7 slots so the
  footer width doesn't jump while paging.
- `pageRangeLabel()` is unchanged (no " results" suffix) because
  `dashboard/users/_store/usersSlice.test.ts` asserts its exact output — the
  component appends " results" itself.
- Props are unchanged, so callers need no edits. Test:
  `npx jest src/components/ui/Pagination`.

## StatCard.tsx

`export function StatCard({ label, value, subtext?, trend? })` —
`trend?: "up" | "down" | "neutral"` only controls the `subtext` color
(success/danger/muted). Used on the dashboard overview for summary metrics.
Purely presentational, no state.

## SummaryTiles.tsx + summaryTileHelpers.ts

Compact display-only summary tiles shown above data tables (Orders/Purchases/
Expenses list pages) to show filtered-result totals. Always display-only —
no interactions, no hover affordance, no button semantics.

**Renamed from `summaryTiles.ts` during Task 5 (2026-09-26):** the original
name differed from the component's `SummaryTiles.tsx` only in casing, which
resolves fine on case-sensitive Linux CI but collides on a case-insensitive
filesystem (macOS/Windows) — `import ... from "@/components/ui/SummaryTiles"`
resolved to this file instead of the component, since TS tries `.ts` before
`.tsx` and the OS treats the two filenames as the same path. The collision
went undetected in Task 4 because nothing imported the component yet; Task 5
was the first real consumer and hit a `tsc` error. Fixed by renaming the pure
module to `summaryTileHelpers.ts` — keep the two names visibly distinct if
you ever touch either file. (`SummaryTiles.tsx`'s own top-of-file doc comment
still said `./summaryTiles` after the rename until a 2026-09-27 final-review
fix — a reminder that a rename needs a repo-wide grep for the old name in
comments too, not just import statements, which `tsc` doesn't catch.)

`summaryTileHelpers.ts` exports pure, tested helpers:
- `moneyTile<T extends { currency }>(label, rows, value: (r) => number): SummaryTile | null`
  — renders one line per row by calling `formatCurrency(value(r), r.currency)` for each row.
  **Callers must pass rows that are already grouped by currency** (e.g., the result of
  a `get_*_summary` RPC). This function does not group or sum. Returns `null` (hidden)
  when there are no rows or all values are exactly 0. Negative values (e.g., credit notes)
  are real and still render.
- `countTile(label, count): SummaryTile` — always renders, even for 0.
  Formats count via `Intl.NumberFormat("de-DE").format(count)` (German thousands separator).
- `compactTiles(tiles: (SummaryTile | null)[]): SummaryTile[]` — filters out nulls, preserving order.

**No currency conversion** — one line per currency, never summed.

`SummaryTiles` component lays out the built tiles:
- `tiles: SummaryTile[]`, `loading: boolean`, `error: boolean`, `className?: string`.
- When `error`, renders "Totals unavailable" in muted text.
- When `loading && tiles.length === 0`, renders 4 pulsing skeleton boxes.
- When `loading && tiles.length > 0`, renders tiles with `opacity-60`.
- Otherwise, renders a flex row of `dl` elements: each tile has a `<dt>` label and `<dd>` value lines.

**Gotcha:** `summaryTileHelpers.ts` is pure and has a test
(`summaryTileHelpers.test.ts`). Keep all formatting (currency, count
grouping, hide-zero logic) in the helper functions, not in the `.tsx`. The
component only handles layout and loading states. See the rename note above
before naming any other file `summaryTiles*` in this folder.

## ThemeProvider.tsx

`"use client"`. Exports `ThemeProvider` and `useTheme()` (returns `{ theme:
"dark" | "light", toggle: () => void }`).

- Persists to `localStorage` under key `"kaufnest-theme"` and sets
  `data-theme` on `document.documentElement` — this is the attribute the CSS
  token system (`var(--color-*)`) switches on.
- Lazily initializes from `localStorage` so it matches the blocking
  inline script in `layout.tsx` that sets `data-theme` before hydration
  (avoids a flash-of-wrong-theme). If you touch this, keep both in sync
  (both fall back to the same default when `localStorage` has no value).
- Default theme is `"light"`.
- Also re-asserts `data-theme` in a `useEffect` keyed on `theme` (not just in
  `toggle()`), and `layout.tsx`'s `<html>` carries `suppressHydrationWarning`.
  **Both are required, not redundant**: without `suppressHydrationWarning`,
  React's hydration pass treats the blocking script's script-set attribute
  (absent from SSR markup) as a mismatch and it doesn't reliably survive
  hydration — the DOM then falls back to bare `:root`, whose token defaults
  are an inconsistent mix (dark sidebar tokens, light surface tokens, since
  `:root` normally only needs to seed the values `[data-theme="dark"]`
  doesn't override). Symptom was a permanently two-toned shell (dark
  sidebar/navbar, light content) on every load, not just an intermittent
  flash — fixed 2026-09-04.

## Toast.tsx

`"use client"`. Exports `ToastProvider`, `useToast()`, and the `Toast`/`ToastVariant` types.

`useToast()` returns `{ toast, success, warning, error, info }` — prefer the
variant-specific helpers: `toast.success(title, description?)`, etc. Throws if
called outside `<ToastProvider>`.

- Variants: `"success" | "warning" | "error" | "info"`, each with its own
  icon/color config (`VARIANT_CONFIG`).
- Auto-dismisses after 5000ms (tracked per-toast in a `useRef` timer map);
  caps the visible stack at 5 (`prev.slice(-4)` + new one).
- Renders a fixed bottom-right stack via the provider itself — no separate
  `<ToastContainer>` to mount; just wrap the app in `ToastProvider` once
  (already done at a high level — check `layout.tsx`/providers before adding
  another).

## AiUsageNote.tsx

`export function AiUsageNote({ refreshToken? })` — `"use client"`. Prop-free
by design apart from the optional `refreshToken: number` (bump it to
re-trigger the fetch after an action the caller knows changed usage).

- Computes its own visibility: `aiVisible = !!ent &&
  hasAiFeatures(ent) && aiEnabled`, read directly from `usePlan()` +
  `currentUserSlice` — it does not take `aiVisible` as a prop. Renders `null`
  when `!aiVisible`, or before its `GET /api/listings/ai/usage` fetch
  resolves. A failed fetch is swallowed silently (usage is informational,
  must never toast or block a caller's UI).
- Renders a one-line "used X of Y AI generations this month" note, plus a
  per-user breakdown list when the route returns `perUser` (admin/
  super_admin callers only — the route decides, not this component).
- Moved here (2026-09-02) from `dashboard/listings/_components/` when
  `dashboard/settings/` became a second consumer — see the repo's "3+
  consumers or core wiring" shared-component rule in the root `AGENTS.md`.
  Current consumers: `dashboard/listings/_components/ListingForm.tsx`
  (passes `refreshToken`, bumped after each AI call) and
  `dashboard/settings/page.tsx` (no props — plain mount-time read, gated in
  a `{aiVisible && ...}` section wrapper matching that page's other cards).

## Where these are wired up

`ThemeProvider` and `ToastProvider` are app-wide context providers — they're
mounted once near the root (check `src/app/layout.tsx` or a providers wrapper
before assuming you need to add them to a page). The rest (`Button`, `Badge`,
`DataTable`, `FilterBar`, `FormFields`, `Modal`, `StatCard`) are stateless/
controlled and imported directly wherever needed.
