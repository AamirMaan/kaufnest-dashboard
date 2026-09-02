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
- `CategoryBadge({ category: ExpenseCategory })` — always `variant="default"`, just maps the enum to a display label
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
  reveals the From/To date inputs.
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
elements and forward all native props directly.

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

## StatCard.tsx

`export function StatCard({ label, value, subtext?, trend? })` —
`trend?: "up" | "down" | "neutral"` only controls the `subtext` color
(success/danger/muted). Used on the dashboard overview for summary metrics.
Purely presentational, no state.

## ThemeProvider.tsx

`"use client"`. Exports `ThemeProvider` and `useTheme()` (returns `{ theme:
"dark" | "light", toggle: () => void }`).

- Persists to `localStorage` under key `"kaufnest-theme"` and sets
  `data-theme` on `document.documentElement` — this is the attribute the CSS
  token system (`var(--color-*)`) switches on.
- Lazily initializes from `localStorage` so it matches the blocking
  inline script in `layout.tsx` that sets `data-theme` before hydration
  (avoids a flash-of-wrong-theme). If you touch this, keep both in sync.
- Default theme is `"dark"`.

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

- Computes its own visibility: `aiVisible = !!tenantPlan &&
  hasAiFeatures(tenantPlan) && aiEnabled`, read directly from
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
