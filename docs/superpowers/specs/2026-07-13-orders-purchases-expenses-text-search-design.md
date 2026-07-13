# Text Search — Orders / Purchases / Expenses — Design Spec

**Date:** 2026-07-13
**Status:** Draft (pending review)

## Problem

Sales ("Orders"), Purchases, and Expenses each support filtering by date range,
currency, and one entity-specific field (platform/status, vendor, category) —
but there's no way to search by keyword. Finding a specific record by product
name, order ID, invoice number, etc. requires paging through server-paginated
results by eye.

## Solution

Add a free-text "Search" input to the shared `FilterBar` component
(`src/components/ui/FilterBar.tsx`), used identically by all three features.
Each module's filters gain a `search: string` field that's pushed down into
the Supabase query via `.or()` with `ilike` across a broad set of relevant
columns, debounced ~400ms so it doesn't fire a query on every keystroke.
Purchases keeps its existing standalone `vendor` filter alongside the new
general search — both apply together (ANDed), since they're independent
Supabase filter predicates chained on the same query.

---

## Search targets (broad match across multiple columns)

| Module | Columns OR'd together | Thunk / file |
|---|---|---|
| Sales (Orders) | `product_name`, `external_order_id`, `description` | `fetchSalesPage` in `src/app/dashboard/sales/_store/salesSlice.ts` |
| Purchases | `product_name`, `vendor`, `description` | `fetchPurchasesPage` in `src/app/dashboard/purchases/_store/purchasesSlice.ts` |
| Expenses | `title`, `vendor`, `description`, `invoice_number` | `fetchExpensesPage` in `src/app/dashboard/expenses/_store/expensesSlice.ts` |

Column choices are based on `src/types/index.ts`: `Sale` (L75-92), `Purchase`
(L57-73), `Expense` (L27-40).

---

## Components & data flow

### 1. `src/lib/utils/filters.ts`

- Add `search: string` to `SalesFilters` (L62-69), `ExpenseFilters` (L71-77),
  `PurchaseFilters` (L79-85); default `""` in each corresponding
  `DEFAULT_*_FILTERS` constant.
- Extend `isDefaultFilters()` (L165-176) with `f.search === ""`.
- Extend `filterSales`/`filterExpenses`/`filterPurchases` (L134-163, the
  in-memory equivalents) to match the same broad column set case-insensitively,
  for consistency — these aren't used for live pagination, but keeping them in
  sync avoids the exported helpers silently diverging from the DB-side query.
- New helper:
  ```ts
  /** Escapes a user search term for safe embedding in a PostgREST ilike/.or() value. */
  export function sanitizeIlikeSearchTerm(term: string): string {
    return term
      .trim()
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/,/g, "\\,");
  }
  ```
  Backslash first (so it doesn't double-escape the chars added after it), then
  `%`/`_` (LIKE wildcards — escaped so literal input doesn't behave as a
  wildcard), then `,` (PostgREST's `.or()` condition separator — a literal
  comma in the search term would otherwise inject an unintended extra
  condition).

### 2. `src/components/ui/FilterBar.tsx`

New optional props on `FilterBarProps` (L29):
```ts
searchValue?: string;
onSearchChange?: (v: string) => void;
searchPlaceholder?: string;
```
Rendered/hidden the same way `currency`/`onCurrencyChange` already are (L100:
only shown when both props are defined) — an `<input type="text">` with a
`Search` icon (lucide), placed before the entity-specific `children` slot.

Debouncing lives inside `FilterBar`, not each page, so the three call sites
don't reimplement it:
```ts
const [localSearch, setLocalSearch] = useState(searchValue ?? "");

useEffect(() => {
  setLocalSearch(searchValue ?? "");
}, [searchValue]);

useEffect(() => {
  if (!onSearchChange || localSearch === searchValue) return;
  const handle = setTimeout(() => onSearchChange(localSearch), 400);
  return () => clearTimeout(handle);
}, [localSearch]);
```
The `localSearch === searchValue` guard prevents firing on mount and after the
sync effect (e.g. right after the existing "Clear" button resets filters
externally).

### 3. Each slice thunk (`fetchSalesPage` / `fetchPurchasesPage` / `fetchExpensesPage`)

Following the exact pattern already used for `vendor` in
`purchasesSlice.ts:48-50`, add after the existing filter predicates:
```ts
if (filters.search.trim() !== "") {
  const term = sanitizeIlikeSearchTerm(filters.search);
  query = query.or(
    `product_name.ilike.%${term}%,external_order_id.ilike.%${term}%,description.ilike.%${term}%`
  ); // sales — column list differs per module per the table above
}
```
Purchases keeps its separate `.ilike("vendor", ...)` call untouched — both
filters chain onto the same `query` and combine with AND, so a vendor filter
plus a search term narrows to rows matching both.

### 4. Each `page.tsx` (sales, purchases, expenses)

- Add `search: ""` handling automatically via the existing generic
  `setFilter<K>(key, value)` helper (e.g. `purchases/page.tsx:92-96`) — no new
  per-field function needed, same as every other filter field.
- Pass `searchValue={filters.search}` and
  `onSearchChange={(v) => setFilter("search", v)}` to `<FilterBar>`, with a
  module-specific `searchPlaceholder`:
  - Sales: `"Search product, order ID, description…"`
  - Purchases: `"Search product, vendor, description…"`
  - Expenses: `"Search title, vendor, invoice #, description…"`
- Mirror the same `.or(...)` predicate in `handleExport` (e.g.
  `purchases/page.tsx:105-134`) so exported CSVs match what's on screen.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/utils/filters.ts` | Add `search` field + default to 3 filter interfaces; extend `isDefaultFilters`; extend `filterSales`/`filterExpenses`/`filterPurchases`; add `sanitizeIlikeSearchTerm` |
| `src/components/ui/FilterBar.tsx` | Add `searchValue`/`onSearchChange`/`searchPlaceholder` props, debounced text input |
| `src/app/dashboard/sales/_store/salesSlice.ts` | `.or()` search pushdown in `fetchSalesPage` |
| `src/app/dashboard/purchases/_store/purchasesSlice.ts` | `.or()` search pushdown in `fetchPurchasesPage` (alongside existing vendor `.ilike`) |
| `src/app/dashboard/expenses/_store/expensesSlice.ts` | `.or()` search pushdown in `fetchExpensesPage` |
| `src/app/dashboard/sales/page.tsx` | Wire `search` filter + `FilterBar` props + mirror in `handleExport` |
| `src/app/dashboard/purchases/page.tsx` | Same |
| `src/app/dashboard/expenses/page.tsx` | Same |
| `src/lib/utils/filters.test.ts` (existing file) | Add unit tests for `sanitizeIlikeSearchTerm` and updated `isDefaultFilters`/`DEFAULT_*_FILTERS` |

No DB migration — no schema change, query-side only. No new files besides
tests.

---

## Testing

- `sanitizeIlikeSearchTerm`: pure-function tests for backslash/percent/
  underscore/comma escaping and whitespace trimming.
- `isDefaultFilters`: confirm a non-empty `search` makes it return `false`.
- Existing slice tests (`salesSlice.test.ts`, `purchasesSlice.test.ts`,
  `expensesSlice.test.ts`) aren't expected to change behavior for their
  existing cases, since `search` defaults to `""` (no-op filter).

## Out of scope

- Full-text search / `tsvector` columns or Postgres FTS indexes — plain
  `ilike` is sufficient at current data volumes; no migration needed.
- Highlighting matched text in the results table.
- Searching across joined/related tables (e.g. linked inventory product
  fields beyond `product_name`).
- Changing the existing Purchases `vendor` filter's behavior (no debounce
  there today) — explicitly left as-is per product decision.
