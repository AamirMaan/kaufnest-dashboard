# Dropshipping Table Filters + Sorting — Design Spec

**Date:** 2026-07-14
**Status:** Approved

## Problem

The Dropshipping listings table has no filtering and no sorting — it's a
plain shadcn `Table` with client-side pagination only. With the margin
badge feature just added, there's no quick way to find underperforming
listings (red/yellow margin) or stale price checks, and no way to search a
growing list by title/SKU.

## Solution

Add a small margin-health + search filter row, and switch the table body
from raw shadcn `Table` primitives to the shared `DataTable` component to
get column sorting for free (same mechanism already used by Sales/
Purchases/Expenses). All filtering/sorting/pagination stays client-side —
this feature already uses client-side pagination only (small dataset, per
`AGENTS.md`), so no new server-side query logic is needed.

---

## Filters

A new bespoke filter row (not the shared `FilterBar` — that component's
date-preset props are mandatory and irrelevant here; forcing them in would
show a meaningless "Date Range" control). Lives inside `ListingsTable.tsx`,
above the table, styled to match `FilterBar`'s visual language (bordered
surface row, labeled controls) without importing it.

- **Margin Health** dropdown: `All` / `Red (<10%)` / `Yellow (<25%)` /
  `Green (>=25%)`. Uses the existing `computeMarginPct`/`marginBadgeVariant`
  from `marginMath.ts` — a listing with no computed margin (no supplier
  price yet, or currency mismatch) is excluded from any specific band and
  only appears under `All`.
- **Search** box: case-insensitive substring match against `title` OR `sku`.
  No debounce — this filters an already-loaded in-memory array, so there's
  no network cost to a keystroke-by-keystroke re-render.
- **Clear** button/link, shown only when either filter is non-default —
  same visual pattern as `FilterBar`'s Clear button, reset to `All`/empty.

Filtering happens before pagination: `listings` → filtered → paginated →
current page handed to `DataTable`.

---

## Sorting

Switch `ListingsTable.tsx`'s table body from shadcn `Table`/`TableHeader`/
`TableBody`/`TableRow`/`TableCell`/`TableHead` to the shared `DataTable`
component (`src/components/ui/DataTable.tsx`), which already supports
per-column `sortValue` and renders an asc/desc sort icon on click. All
existing custom cell renderers (image thumbnail, title link, `SourceBadge`,
`SupplierPriceCell`, per-row action buttons) port over as `render` functions
per column — `DataTable` supports arbitrary render functions, not just
plain accessors.

**Design correction found during this spec**: `DataTable` only supports one
`sortValue` per column header. The original ask was for both "Margin %" and
"Last synced/price-checked date" to be independently sortable, but both
currently live inside the single "AliExpress Price" cell (price + customs
breakdown + margin badge + checked date). Resolution: split the checked
date out into its own new **"Last Checked"** column (formatted date, "—"
when never checked), sortable by the raw `supplier_price_checked_at` string
(empty/null sorts first, representing "never checked"). "AliExpress Price"
keeps price + customs + margin badge, sortable by `computeMarginPct(listing)
?? -Infinity` (unscored listings sink to one end consistently). This also
declutters the AliExpress Price cell.

**Sortable columns** (per the approved scope — not every column):
- **eBay Price** — `sortValue: (l) => l.current_price`
- **AliExpress Price** — `sortValue: (l) => computeMarginPct(l) ?? -Infinity`
  (sorts by margin, not raw price, since margin is the more actionable
  signal and was the explicit ask)
- **Last Checked** (new column) — `sortValue: (l) => l.supplier_price_checked_at ?? ""`

Title, Image, SKU, Source, and Actions stay unsorted (no `sortValue`),
matching the approved scope.

**Known limitation carried over from the rest of the codebase**: `DataTable`
sorts only the rows it's given — since `ListingsTable` paginates before
handing rows to `DataTable`, sorting is scoped to the current page, not the
full filtered set. This is the same accepted v1 limitation already
documented for Sales/Purchases/Expenses ("DataTable sorting is page-local
only") — not a new gap introduced here.

---

## Files changed

| File | Change |
|---|---|
| `src/app/dashboard/dropshipping/_components/listingFilters.ts` (new) | Pure `matchesMarginFilter(listing, band)` + `matchesListingSearch(listing, term)` helpers, colocated tests |
| `src/app/dashboard/dropshipping/_components/ListingsTable.tsx` | Add filter state + filter row UI; swap table body to shared `DataTable`; split "Last Checked" into its own column; wire `sortValue` for the 3 sortable columns |
| `src/app/dashboard/dropshipping/CLAUDE.md` | Document the new filter row, the `DataTable` swap, the new "Last Checked" column, and the page-local-sort limitation |
| `src/app/dashboard/dropshipping/SKILL.md` | Add a gotcha for the page-local sort + the single-sortValue-per-column constraint that drove the "Last Checked" column split |

`page.tsx` is unchanged — all new state (filters, pagination, sort) stays
inside `ListingsTable.tsx`, which already owned pagination state.

---

## Testing

- `listingFilters.ts` gets unit tests: margin-band matching at/around the
  10%/25% boundaries (reusing `marginMath.ts`'s existing threshold
  semantics), a listing with no computed margin excluded from every
  specific band, case-insensitive title/SKU search matching, and empty
  search term matching everything.
- No test for `ListingsTable.tsx` itself (this codebase has zero
  `.test.tsx` files, no jsdom) — verified manually in the browser instead,
  per this project's UI-change convention.

## Out of scope

- Server-side filtering/pagination (this feature stays client-side per its
  existing small-dataset architecture).
- Sorting across the full filtered set rather than just the current page
  (matches the existing codebase-wide `DataTable` limitation, not something
  this spec introduces or is expected to fix).
- Currency and source-platform filters (considered, not requested).
- Making Title/SKU/Source/Actions sortable (not requested).
