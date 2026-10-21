# Expandable table rows — design

**Date:** 2026-10-21
**Branch:** `feat/expandable-table-rows`
**Status:** approved in brainstorming, pending spec review

## Problem

Wide tables scroll horizontally. Orders (`/dashboard/sales`) renders 11–12
columns (Date, Product, Platform, Account, Status, Qty, Unit Price, Total,
VAT, Fees, Actions), so on a normal laptop the user scrolls sideways to reach
Fees and the action buttons. More tables will hit the same problem as
columns are added.

## Goal

Give the shared `DataTable` atom (`src/components/ui/DataTable.tsx`) a
reusable expandable-row mode: secondary columns move out of the main row
into a panel revealed by a chevron. Ship it on Orders first; other tables
adopt it later by flagging columns, with no new markup.

## Non-goals

- Rolling out to Purchases/Expenses/Inventory/etc. (each is a follow-up that
  only flags columns).
- "Expand all" / "collapse all" control.
- Persisting expand state across pages, reloads or navigations.
- Whole-row click to expand (chevron button only — see Interaction).

## Approach

Column-level `detail` flag (chosen over a page-supplied `renderExpanded`
only, which would duplicate the label/value grid in every page, and over a
separate `ExpandableDataTable` component, which would fork sorting and
selection logic).

## API changes — `DataTable` (additive, backward-compatible)

```ts
interface Column<T> {
  header: string;
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortValue?: (row: T) => string | number;
  /** Render this column in the expanded row panel instead of the main row. */
  detail?: boolean;
}

interface DataTableProps<T> {
  // ...existing props unchanged...
  /** Extra content rendered below the detail-field grid in the expanded panel. */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Return false to hide the chevron for a row with nothing to show. Default: every row expandable. */
  isExpandable?: (row: T) => boolean;
}
```

- The table is **expandable** iff at least one column has `detail: true` or
  `renderExpanded` is provided. Otherwise rendering is byte-for-byte the
  same as today — none of the 15 existing call sites change behaviour.
- `detail` columns are excluded from `<thead>` and the main `<tr>`. A
  `sortValue` on a detail column is ignored (there is no header to click).

## Rendering

- **Chevron column:** a narrow (`w-10`) first column, placed after the
  selection checkbox column when `onSelectionChange` is set. Header cell is
  empty. Each expandable row gets a ghost icon button with
  `<ChevronDown size={16}/>` that rotates 180° (`transition-transform`)
  when open, `aria-expanded`, `aria-controls` pointing at the panel row,
  and `aria-label` "Expand row" / "Collapse row". Rows where
  `isExpandable(row)` is false render an empty cell.
- **Panel row:** directly after an open row, a `<tr>` with one
  `<td colSpan={full width}>` styled `bg-(--color-surface-subtle) px-4 py-4`.
  Content:
  1. A grid `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4`
     of detail fields. Each field: label `text-xs text-(--color-text-muted)`
     (the column's `header`) above the value (`render(row)` or
     `String(row[accessor] ?? "—")`, same fallback as inline cells).
  2. `renderExpanded(row)` below the grid (with `mt-4` when the grid is
     non-empty).
- Only existing tokens/classes — no new colours, radii or type sizes.
- Empty-state `colSpan` and panel `colSpan` both use the shared helper so
  they count selection + chevron + inline columns.

## State

- `expandedIds: Set<string>` in `DataTable` local state, keyed by
  `String(row[keyField])`. Multiple rows may be open at once.
- Survives client-side sort (keyed by id, not index).
- Ids no longer in `rows` are simply not rendered; when the page changes
  (server pagination swaps `rows`), stale ids are harmless and are pruned
  with the same helper so the set never grows unbounded.

## Pure helper — `src/components/ui/dataTableColumns.ts`

Extracted so the logic is unit-testable without rendering (colocated
`dataTableColumns.test.ts`):

- `splitColumns(columns) → { inline, detail }`
- `isTableExpandable(columns, hasRenderExpanded) → boolean`
- `toggleId(set, id) → Set<string>` (immutable)
- `pruneIds(set, presentIds) → Set<string>` (returns the same instance when
  nothing was removed, to avoid re-render loops)
- `totalColSpan({ selectable, expandable, inlineCount }) → number`

`Column<T>` is exported from `DataTable.tsx` (currently file-private) so the
helper and pages can type against it.

## Orders adoption — `src/app/dashboard/sales/page.tsx`

| Main row (inline) | Expanded panel (`detail: true`) |
| --- | --- |
| Date (sortable) | Marketplace |
| Product (sortable, links to `/dashboard/sales/[id]`) | Account — only when `showAccounts`, as today |
| Platform — badge only (sortable) | Qty |
| Status (sortable) | Unit Price |
| Total (sortable) | VAT — rate and amount, or "—" |
| Actions | Fees — breakdown (see below) |

- Marketplace moves out of the Platform cell into its own detail field
  ("—" when null).
- **Fees breakdown** (new information — today only the sum is shown):
  Shipping, Advertising, Platform fee, each `formatCurrency(…, s.currency)`
  or "—" when null, followed by a Total line. All null → single "—".
  The breakdown is a small feature-private pure function in
  `sales/_lib/` with a colocated test (`feeBreakdown(sale)`), so the page
  only renders it.
- Losing header-sort on Qty/Unit Price/VAT/Fees is accepted.

## Interaction

- Chevron button only. Row clicks do nothing new, so the Product link,
  action buttons and selection checkbox behave exactly as today.
- Keyboard: the chevron is a real `<button>`, so Tab/Enter/Space work.

## Testing

- `src/components/ui/dataTableColumns.test.ts` — split, expandable
  detection, toggle immutability, prune (incl. same-instance return),
  colSpan permutations.
- `src/app/dashboard/sales/_lib/feeBreakdown.test.ts` — all-null, partial,
  full, total.
- Manual / Playwright (if dev server is running): Orders shows six columns
  with no horizontal scroll at 1280px; expand/collapse; multiple open;
  sort keeps open rows open; page change; selection + invoice still work;
  an unchanged table (e.g. Expenses) renders as before.

## Docs to update in the same commit

- `src/app/dashboard/sales/CLAUDE.md` / `SKILL.md` — new `_lib/feeBreakdown`
  and the detail-column split.
- `AGENTS.md` UI conventions — a line telling future tables with too many
  columns to use `detail: true` instead of horizontal scroll.
