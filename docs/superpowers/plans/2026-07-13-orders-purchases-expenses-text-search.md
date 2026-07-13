# Orders / Purchases / Expenses Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debounced free-text search box to the shared `FilterBar`, wired into Sales (Orders), Purchases, and Expenses so users can keyword-search across product name / order ID / vendor / invoice number / description without paging through results by eye.

**Architecture:** One new optional prop pair (`searchValue`/`onSearchChange`) on `FilterBar` owns debouncing internally; each feature's `XFilters` type gains a `search: string` field pushed into its `fetchXPage` thunk via a Supabase `.or()` + `ilike` clause across a broad column set, mirrored into that feature's CSV export.

**Tech Stack:** Next.js App Router, Redux Toolkit, Supabase (PostgREST `.or()`/`.ilike()`), Jest + ts-jest (`testEnvironment: "node"` — no DOM/RTL in this project; only pure functions and reducers are unit-tested here).

## Global Constraints

- **Never run `npm test`, `npx jest`, `npx tsc --noEmit`, or `npm run lint` yourself mid-task.** Per this project's working agreement (`AGENTS.md`), write/extend the test file, then explicitly ask the user to run the given command and paste the output back before treating a step as verified or committing. Every "run test" step below is phrased this way — follow that phrasing, don't silently run the command instead.
- Never commit directly to `main`. All work in this plan happens on `feat/orders-purchases-expenses-search` (already checked out).
- Follow the "Mandatory docs update" rule in the root `AGENTS.md`: every task that touches a feature's code also updates that feature's `CLAUDE.md`/`SKILL.md` in the **same commit**.
- Search columns per module (from the approved spec, `docs/superpowers/specs/2026-07-13-orders-purchases-expenses-text-search-design.md`):
  - Sales: `product_name`, `external_order_id`, `description`
  - Purchases: `product_name`, `vendor`, `description` (existing standalone `vendor` filter stays, both apply/AND together)
  - Expenses: `title`, `vendor`, `description`, `invoice_number`
- Debounce: 400ms, owned by `FilterBar` itself (not duplicated per page).
- No DB migration — query-side only.

---

### Task 1: `filters.ts` — search field, sanitize helper, updated predicates

**Files:**
- Modify: `src/lib/utils/filters.ts`
- Test: `src/lib/utils/filters.test.ts`

**Interfaces:**
- Produces: `sanitizeIlikeSearchTerm(term: string): string`; `SalesFilters.search: string`, `ExpenseFilters.search: string`, `PurchaseFilters.search: string`; `DEFAULT_SALES_FILTERS.search === ""`, `DEFAULT_EXPENSE_FILTERS.search === ""`, `DEFAULT_PURCHASE_FILTERS.search === ""`. These are consumed by Tasks 2–4 (thunks and `page.tsx` files) and by `isDefaultFilters`.

- [ ] **Step 1: Add failing tests for `sanitizeIlikeSearchTerm` and the updated `isDefaultFilters`**

Append to `src/lib/utils/filters.test.ts` (after the existing `filterSales` describe block, i.e. after line 101):

```ts
import { sanitizeIlikeSearchTerm, isDefaultFilters, DEFAULT_PURCHASE_FILTERS } from "./filters";

describe("sanitizeIlikeSearchTerm", () => {
  it("trims surrounding whitespace", () => {
    expect(sanitizeIlikeSearchTerm("  widget  ")).toBe("widget");
  });

  it("escapes backslashes first so later escapes aren't double-escaped", () => {
    expect(sanitizeIlikeSearchTerm("a\\b")).toBe("a\\\\b");
  });

  it("escapes ilike wildcards % and _", () => {
    expect(sanitizeIlikeSearchTerm("50% off_sale")).toBe("50\\% off\\_sale");
  });

  it("escapes commas so they can't inject an extra .or() condition", () => {
    expect(sanitizeIlikeSearchTerm("foo,bar")).toBe("foo\\,bar");
  });
});

describe("isDefaultFilters with search", () => {
  it("returns true when search is empty", () => {
    expect(isDefaultFilters(DEFAULT_PURCHASE_FILTERS)).toBe(true);
  });

  it("returns false when search is non-empty", () => {
    expect(isDefaultFilters({ ...DEFAULT_PURCHASE_FILTERS, search: "widget" })).toBe(false);
  });
});
```

Note: this duplicates the `import` line already at the top of the file (line 1) — that's fine, merge the new named imports (`sanitizeIlikeSearchTerm`, `isDefaultFilters`, `DEFAULT_PURCHASE_FILTERS`) into the existing `import { resolveDateRange, getPresetRange, filterSales, isRevenueSale, DEFAULT_SALES_FILTERS } from "./filters";` on line 1 instead of adding a second import statement:

```ts
import {
  resolveDateRange,
  getPresetRange,
  filterSales,
  isRevenueSale,
  DEFAULT_SALES_FILTERS,
  sanitizeIlikeSearchTerm,
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
} from "./filters";
```

- [ ] **Step 2: Ask the user to confirm the test fails**

Ask the user to run: `npx jest src/lib/utils/filters.test.ts`
Expected: FAIL — `sanitizeIlikeSearchTerm` and `DEFAULT_PURCHASE_FILTERS` are not exported/defined yet (or `isDefaultFilters` not imported). Wait for the user to paste back confirmation before continuing.

- [ ] **Step 3: Add `search` to the three filter interfaces and their defaults**

In `src/lib/utils/filters.ts`, update lines 62-110:

```ts
export interface SalesFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  platform: string;
  currency: string;
  status: string;
  search: string;
}

export interface ExpenseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  category: string;
  currency: string;
  search: string;
}

export interface PurchaseFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  vendor: string;
  currency: string;
  search: string;
}

export const DEFAULT_SALES_FILTERS: SalesFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  platform: "all",
  currency: "all",
  status: "all",
  search: "",
};

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  category: "all",
  currency: "all",
  search: "",
};

export const DEFAULT_PURCHASE_FILTERS: PurchaseFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  vendor: "",
  currency: "all",
  search: "",
};
```

- [ ] **Step 4: Add the `sanitizeIlikeSearchTerm` helper**

Add just above `isRevenueSale` (before line 128 in the current file):

```ts
/**
 * Escapes a user-typed search term for safe embedding in a PostgREST
 * `.or()`/`.ilike()` value: backslash first (so later escapes aren't
 * double-escaped), then `%`/`_` (LIKE wildcards — escaped so literal input
 * doesn't behave as a wildcard), then `,` (the `.or()` condition separator —
 * a literal comma would otherwise inject an unintended extra condition).
 */
export function sanitizeIlikeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "\\,");
}
```

- [ ] **Step 5: Extend `filterSales`/`filterExpenses`/`filterPurchases` and `isDefaultFilters` with `search`**

Replace the three filter functions and `isDefaultFilters` (current lines 134-176) with:

```ts
function matchesSearch(term: string, ...fields: (string | null)[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export function filterSales(sales: Sale[], f: SalesFilters): Sale[] {
  let result = sales;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((s) => s.date >= range.from && s.date <= range.to);
  if (f.platform !== "all") result = result.filter((s) => s.platform === f.platform);
  if (f.currency !== "all") result = result.filter((s) => s.currency === f.currency);
  if (f.status !== "all") result = result.filter((s) => s.status === f.status);
  if (f.search.trim())
    result = result.filter((s) =>
      matchesSearch(f.search, s.product_name, s.external_order_id, s.description)
    );
  return result;
}

export function filterExpenses(expenses: Expense[], f: ExpenseFilters): Expense[] {
  let result = expenses;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((e) => e.date >= range.from && e.date <= range.to);
  if (f.category !== "all") result = result.filter((e) => e.category === f.category);
  if (f.currency !== "all") result = result.filter((e) => e.currency === f.currency);
  if (f.search.trim())
    result = result.filter((e) =>
      matchesSearch(f.search, e.title, e.vendor, e.description, e.invoice_number)
    );
  return result;
}

export function filterPurchases(purchases: Purchase[], f: PurchaseFilters): Purchase[] {
  let result = purchases;
  const range = resolveDateRange(f.preset, f.dateFrom, f.dateTo);
  if (range) result = result.filter((p) => p.date >= range.from && p.date <= range.to);
  if (f.vendor.trim())
    result = result.filter((p) =>
      p.vendor?.toLowerCase().includes(f.vendor.toLowerCase())
    );
  if (f.currency !== "all") result = result.filter((p) => p.currency === f.currency);
  if (f.search.trim())
    result = result.filter((p) =>
      matchesSearch(f.search, p.product_name, p.vendor, p.description)
    );
  return result;
}

export function isDefaultFilters(f: SalesFilters | ExpenseFilters | PurchaseFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.currency === "all" &&
    f.search === "" &&
    ("platform" in f ? f.platform === "all" : true) &&
    ("status" in f ? f.status === "all" : true) &&
    ("category" in f ? f.category === "all" : true) &&
    ("vendor" in f ? f.vendor === "" : true)
  );
}
```

`isDefaultAuditLogFilters` (below, unaffected) stays as-is.

- [ ] **Step 6: Ask the user to confirm the tests now pass**

Ask the user to run: `npx jest src/lib/utils/filters.test.ts`
Expected: PASS (all tests, including the new ones from Step 1). Wait for confirmation.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/filters.ts src/lib/utils/filters.test.ts
git commit -m "feat: add search field + sanitize helper to filter types"
```

---

### Task 2: `FilterBar.tsx` — debounced search input

**Files:**
- Modify: `src/components/ui/FilterBar.tsx`
- Modify: `src/components/ui/SKILL.md`

**Interfaces:**
- Consumes: nothing new from Task 1 (this component is filter-type-agnostic — it only deals in `string` search values).
- Produces: `FilterBarProps.searchValue?: string`, `FilterBarProps.onSearchChange?: (v: string) => void`, `FilterBarProps.searchPlaceholder?: string`. Consumed by Tasks 3–5's `page.tsx` files.

No test file — this project has zero `.test.tsx` files (`jest.config.ts` uses `testEnvironment: "node"`, no jsdom/RTL setup), so component-level tests aren't part of this codebase's conventions. Verify by manual exercise in the browser once wired up in Task 5 (last module), per this project's UI-change verification rule.

- [ ] **Step 1: Add the new props and debounced local state**

In `src/components/ui/FilterBar.tsx`, update the imports (line 1-4):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./Button";
import type { DatePreset } from "@/lib/utils/filters";
```

Update `FilterBarProps` (lines 29-42):

```tsx
export interface FilterBarProps {
  preset: DatePreset;
  onPresetChange: (v: DatePreset) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  currency?: string;
  onCurrencyChange?: (v: string) => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  hasActive: boolean;
  onClear: () => void;
  /** Entity-specific filter slots */
  children?: React.ReactNode;
}
```

Update the function signature and body (lines 44-58) to destructure the new props and add debounced local state:

```tsx
export function FilterBar({
  preset,
  onPresetChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  currency,
  onCurrencyChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  hasActive,
  onClear,
  children,
}: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(searchValue ?? "");

  // Keep local state in sync when the parent resets/changes the value
  // externally (e.g. the "Clear" button, or switching tabs).
  useEffect(() => {
    setLocalSearch(searchValue ?? "");
  }, [searchValue]);

  // Latest-callback ref so the debounce effect doesn't need `onSearchChange`
  // in its deps — that prop is a new function identity on every parent
  // render, which would otherwise restart the timer before it ever fires.
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    if (!onSearchChangeRef.current || localSearch === searchValue) return;
    const handle = setTimeout(() => onSearchChangeRef.current?.(localSearch), 400);
    return () => clearTimeout(handle);
  }, [localSearch, searchValue]);

  return (
```

- [ ] **Step 2: Render the search input**

In the JSX (currently lines 58-131), insert a new block right after the Currency block (after the closing `)}` at line 115, i.e. right before `{/* Entity-specific slot */}` / `{children}` at line 117-118):

```tsx
      {/* Free-text search — hidden when the feature has no search handler */}
      {onSearchChange !== undefined && (
        <div className="col-span-2 sm:flex-1 sm:min-w-[220px]">
          <FilterLabel>Search</FilterLabel>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
            />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder={searchPlaceholder ?? "Search…"}
              className={`${inputCls} w-full pl-7 cursor-text`}
            />
          </div>
        </div>
      )}

      {/* Entity-specific slot */}
      {children}
```

- [ ] **Step 3: Update `src/components/ui/SKILL.md`**

In the `## FilterBar.tsx` section (around lines 63-80), replace:

```
Controlled component — caller owns all state:
`preset, onPresetChange, dateFrom, onDateFromChange, dateTo, onDateToChange,
currency, onCurrencyChange, hasActive, onClear`, plus `children` for
entity-specific filter slots (e.g. a platform/category dropdown) rendered
inline after the currency filter.
```

with:

```
Controlled component — caller owns all state:
`preset, onPresetChange, dateFrom, onDateFromChange, dateTo, onDateToChange,
currency, onCurrencyChange, searchValue, onSearchChange, searchPlaceholder,
hasActive, onClear`, plus `children` for entity-specific filter slots (e.g. a
platform/category dropdown) rendered inline after the search box.

- `searchValue`/`onSearchChange` render a free-text search input (hidden when
  `onSearchChange` is undefined, same pattern as `currency`/`onCurrencyChange`).
  `FilterBar` owns a 400ms debounce internally via local state + a
  `setTimeout` effect — the caller's `onSearchChange` only fires 400ms after
  the user stops typing, so callers don't need their own debounce logic.
  Pair with `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`) on the page/thunk
  side before building a Supabase `.or()`/`.ilike()` query.
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/FilterBar.tsx src/components/ui/SKILL.md
git commit -m "feat: add debounced search input to FilterBar"
```

---

### Task 3: Sales (Orders) — wire up search

**Files:**
- Modify: `src/app/dashboard/sales/_store/salesSlice.ts`
- Modify: `src/app/dashboard/sales/page.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/sales/SKILL.md`

**Interfaces:**
- Consumes: `SalesFilters.search` (Task 1), `sanitizeIlikeSearchTerm` (Task 1), `FilterBar`'s `searchValue`/`onSearchChange`/`searchPlaceholder` props (Task 2).
- Produces: nothing consumed by later tasks — Sales, Purchases, Expenses are independent.

No new/changed reducer behavior in `salesSlice.test.ts` — that file never constructs a `SalesFilters` literal (it only tests `hydratePage`/`addSale`/`updateSale`/`removeSale`/`setFetching`), so no test changes are needed here.

- [ ] **Step 1: Add search pushdown to `fetchSalesPage`**

In `src/app/dashboard/sales/_store/salesSlice.ts`, update the import on line 5-6:

```ts
import { getPresetRange, sanitizeIlikeSearchTerm } from "@/lib/utils/filters";
import type { SalesFilters } from "@/lib/utils/filters";
```

Add after the existing `status` filter block (after line 56, before `const [from, to] = rangeFor(...)` on line 58):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike.%${term}%,external_order_id.ilike.%${term}%,description.ilike.%${term}%`
      );
    }
```

- [ ] **Step 2: Wire `search` into `page.tsx`'s `FilterBar` and `handleExport`**

In `src/app/dashboard/sales/page.tsx`, update the `import` for filters utilities (line 26-33) — no signature change needed, `isDefaultFilters`/`DEFAULT_SALES_FILTERS` already cover `search` after Task 1.

Update the `<FilterBar>` call (lines 313-324) to add the three new props:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        searchValue={filters.search}
        onSearchChange={(v) => setFilter("search", v)}
        searchPlaceholder="Search product, order ID, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
```

Update `handleExport` (lines 122-139) to mirror the same predicate — add after the existing `status` filter line (after line 139, before `const { data: allRows } = await query;` on line 141):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike.%${term}%,external_order_id.ilike.%${term}%,description.ilike.%${term}%`
      );
    }
```

This requires importing `sanitizeIlikeSearchTerm` in `page.tsx` too — add it to the existing `@/lib/utils/filters` import block (lines 26-33):

```tsx
import {
  isDefaultFilters,
  isRevenueSale,
  DEFAULT_SALES_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type SalesFilters,
  type DatePreset,
} from "@/lib/utils/filters";
```

- [ ] **Step 3: Update `src/app/dashboard/sales/CLAUDE.md`**

Replace the `page.tsx` bullet under "Files in this folder":

```
- `page.tsx` — list view: filtering (`FilterBar` + `filterSales`), row selection,
  invoice trigger, Gross/VAT/Net summary, **Export CSV** button (exports `filtered`
  via `lib/utils/csv`), **Import CSV** button, wires up the modals below.
  Product-name cells are `<Link>`s to `/dashboard/sales/[id]`.
```

with:

```
- `page.tsx` — list view: server-side pagination (`fetchSalesPage` thunk),
  `FilterBar` (date preset, currency, platform, status, general keyword
  search across product name/order ID/description), row selection, invoice
  trigger, Gross/VAT/Net summary **(this page)**, **Export CSV** button
  (server-side query, no `.range()`, capped at 5 000 rows), **Import CSV**
  button, wires up the modals below. Product-name cells are `<Link>`s to
  `/dashboard/sales/[id]`.
```

Also update the `salesSlice.ts` bullet's thunk description:

```
  Thunk: `fetchSalesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown, `.select("*", { count: "exact" })`, `.order("date")`,
  and `.range(from, to)` from `rangeFor()`. Dispatches `hydratePage` on success.
```

→

```
  Thunk: `fetchSalesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, platform, currency, status, and a keyword
  `search` matched via `.or()`/`ilike` across `product_name`/
  `external_order_id`/`description`, sanitized with `sanitizeIlikeSearchTerm`),
  `.select("*", { count: "exact" })`, `.order("date")`, and `.range(from, to)`
  from `rangeFor()`. Dispatches `hydratePage` on success.
```

- [ ] **Step 4: Append a gotcha to `src/app/dashboard/sales/SKILL.md`**

Append to the end of the file:

```
- The "Search" box in `FilterBar` matches `product_name`, `external_order_id`,
  and `description` via a Supabase `.or()`/`ilike` clause (see
  `fetchSalesPage` in `_store/salesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`) before being embedded —
  don't build the `.or()` string from a raw, unsanitized value. `handleExport`
  mirrors the same predicate; keep both in sync if the column set ever changes.
```

- [ ] **Step 5: Ask the user to manually verify in the browser**

Per this project's UI-change verification rule, ask the user to open
`/dashboard/sales`, type a product name / order ID fragment / description
fragment into the new Search box, and confirm: (a) results narrow after ~400ms
without a request firing on every keystroke, (b) clearing the box (or hitting
"Clear") restores the full list, (c) Export produces a CSV matching the
filtered rows on screen.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/_store/salesSlice.ts src/app/dashboard/sales/page.tsx src/app/dashboard/sales/CLAUDE.md src/app/dashboard/sales/SKILL.md
git commit -m "feat: add keyword search to Orders (sales)"
```

---

### Task 4: Purchases — wire up search

**Files:**
- Modify: `src/app/dashboard/purchases/_store/purchasesSlice.ts`
- Modify: `src/app/dashboard/purchases/_store/purchasesSlice.test.ts`
- Modify: `src/app/dashboard/purchases/page.tsx`
- Modify: `src/app/dashboard/purchases/CLAUDE.md`
- Modify: `src/app/dashboard/purchases/SKILL.md`

**Interfaces:**
- Consumes: `PurchaseFilters.search` (Task 1), `sanitizeIlikeSearchTerm` (Task 1), `FilterBar`'s new props (Task 2).
- Produces: nothing consumed by later tasks.

Purchases keeps its existing standalone `vendor` `.ilike()` filter untouched — it and the new `search` `.or()` both chain onto the same query and combine with AND.

- [ ] **Step 1: Fix the now-required `search` field in existing test literals**

`purchasesSlice.test.ts` constructs `PurchaseFilters` object literals inline four times (lines 95, 108, 119, 123), all currently `{ preset: "all", dateFrom: "", dateTo: "", vendor: "", currency: "all" }`. Since `PurchaseFilters.search` is now required (Task 1), update all four occurrences to include `search: ""`:

```ts
{ preset: "all", dateFrom: "", dateTo: "", vendor: "", currency: "all", search: "" }
```

- [ ] **Step 2: Ask the user to confirm this alone doesn't break the test suite**

Ask the user to run: `npx jest dashboard/purchases`
Expected: PASS (this step only fixes a type error the Task 1 interface change would otherwise introduce; no behavior changed yet).

- [ ] **Step 3: Add search pushdown to `fetchPurchasesPage`**

In `src/app/dashboard/purchases/_store/purchasesSlice.ts`, update the import on line 5-6:

```ts
import { getPresetRange, sanitizeIlikeSearchTerm } from "@/lib/utils/filters";
import type { PurchaseFilters } from "@/lib/utils/filters";
```

Add after the existing `currency` filter block (after line 53, before `const [from, to] = rangeFor(...)` on line 55):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%`
      );
    }
```

(This chains after the existing standalone `vendor` `.ilike()` at lines 48-50 — both apply together.)

- [ ] **Step 4: Wire `search` into `page.tsx`'s `FilterBar` and `handleExport`**

In `src/app/dashboard/purchases/page.tsx`, update the `<FilterBar>` opening tag (lines 287-298, which is immediately followed by the existing `vendor` child `<div>` at lines 299-308) to add the three new props:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        searchValue={filters.search}
        onSearchChange={(v) => setFilter("search", v)}
        searchPlaceholder="Search product, vendor, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
```

(Leave the existing `vendor` text-input `children` block below it exactly as-is — both filters remain available side by side.)

Update `handleExport` (lines 105-134) to mirror the same predicate — add after the existing `currency` filter line (after line 123, before `const { data: allRows } = await query;` on line 125):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `product_name.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%`
      );
    }
```

Add `sanitizeIlikeSearchTerm` to the existing `@/lib/utils/filters` import block (lines 25-31):

```tsx
import {
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type PurchaseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
```

- [ ] **Step 5: Update `src/app/dashboard/purchases/CLAUDE.md`**

Replace the `page.tsx` bullet under "Files in this folder":

```
- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset, currency, vendor text search), `<Pagination>`,
  loading overlay, Gross/VAT/Net summary **(this page)**, **Export CSV** button
  (server-side query, no `.range()`, capped at 5 000 rows), **Import CSV** button,
  wires up the modals below.
```

with:

```
- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset, currency, vendor text search, general keyword
  search across product name/vendor/description — both apply together),
  `<Pagination>`, loading overlay, Gross/VAT/Net summary **(this page)**,
  **Export CSV** button (server-side query, no `.range()`, capped at 5 000
  rows), **Import CSV** button, wires up the modals below.
```

And the `purchasesSlice.ts` bullet's thunk description:

```
  Thunk: `fetchPurchasesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, vendor ilike, currency), `.select("*", { count: "exact" })`,
  `.order("date")`, and `.range(from, to)` from `rangeFor()`.
```

→

```
  Thunk: `fetchPurchasesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, vendor ilike, currency, and a keyword
  `search` matched via `.or()`/`ilike` across `product_name`/`vendor`/
  `description`, sanitized with `sanitizeIlikeSearchTerm` — chains alongside
  the standalone vendor filter, both apply/AND together),
  `.select("*", { count: "exact" })`, `.order("date")`, and `.range(from, to)`
  from `rangeFor()`.
```

- [ ] **Step 6: Append a gotcha to `src/app/dashboard/purchases/SKILL.md`**

Append to the end of the file:

```
- The general "Search" box and the standalone "Vendor" text filter are
  independent Supabase predicates that both apply (ANDed) — a user can narrow
  by vendor AND search a keyword simultaneously. Search matches
  `product_name`, `vendor`, and `description` via `.or()`/`ilike` (see
  `fetchPurchasesPage`), sanitized with `sanitizeIlikeSearchTerm`
  (`@/lib/utils/filters`). `handleExport` mirrors the same predicate — keep
  both in sync if the column set ever changes.
```

- [ ] **Step 7: Ask the user to run the purchases test suite**

Ask the user to run: `npx jest dashboard/purchases`
Expected: PASS.

- [ ] **Step 8: Ask the user to manually verify in the browser**

Ask the user to open `/dashboard/purchases`, confirm the new Search box
narrows results after ~400ms, confirm it combines correctly with the existing
Vendor filter (both active at once further narrows results), and confirm
Export matches the on-screen filtered rows.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/purchases/_store/purchasesSlice.ts src/app/dashboard/purchases/_store/purchasesSlice.test.ts src/app/dashboard/purchases/page.tsx src/app/dashboard/purchases/CLAUDE.md src/app/dashboard/purchases/SKILL.md
git commit -m "feat: add keyword search to Purchases"
```

---

### Task 5: Expenses — wire up search

**Files:**
- Modify: `src/app/dashboard/expenses/_store/expensesSlice.ts`
- Modify: `src/app/dashboard/expenses/page.tsx`
- Modify: `src/app/dashboard/expenses/CLAUDE.md`
- Modify: `src/app/dashboard/expenses/SKILL.md`

**Interfaces:**
- Consumes: `ExpenseFilters.search` (Task 1), `sanitizeIlikeSearchTerm` (Task 1), `FilterBar`'s new props (Task 2).
- Produces: nothing consumed by later tasks — this is the last module.

No new/changed reducer behavior in `expensesSlice.test.ts` — like `salesSlice.test.ts`, it never constructs an `ExpenseFilters` literal, so no test changes are needed here.

- [ ] **Step 1: Add search pushdown to `fetchExpensesPage`**

In `src/app/dashboard/expenses/_store/expensesSlice.ts`, update the import on line 5-6:

```ts
import { getPresetRange, sanitizeIlikeSearchTerm } from "@/lib/utils/filters";
import type { ExpenseFilters } from "@/lib/utils/filters";
```

Add after the existing `currency` filter block (after line 53, before `const [from, to] = rangeFor(...)` on line 55):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `title.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%,invoice_number.ilike.%${term}%`
      );
    }
```

- [ ] **Step 2: Wire `search` into `page.tsx`'s `FilterBar` and `handleExport`**

In `src/app/dashboard/expenses/page.tsx`, update the `<FilterBar>` call (lines 261-286) to add the three new props:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        searchValue={filters.search}
        onSearchChange={(v) => setFilter("search", v)}
        searchPlaceholder="Search title, vendor, invoice #, description…"
        hasActive={hasActive}
        onClear={clearFilters}
      >
```

Update `handleExport` (lines 109-135) to mirror the same predicate — add after the existing `currency` filter line (after line 125, before `const { data: allRows } = await query;` on line 127):

```ts
    if (filters.search.trim() !== "") {
      const term = sanitizeIlikeSearchTerm(filters.search);
      query = query.or(
        `title.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%,invoice_number.ilike.%${term}%`
      );
    }
```

Add `sanitizeIlikeSearchTerm` to the existing `@/lib/utils/filters` import block (lines 25-31):

```tsx
import {
  isDefaultFilters,
  DEFAULT_EXPENSE_FILTERS,
  getPresetRange,
  sanitizeIlikeSearchTerm,
  type ExpenseFilters,
  type DatePreset,
} from "@/lib/utils/filters";
```

- [ ] **Step 3: Update `src/app/dashboard/expenses/CLAUDE.md`**

Replace the `page.tsx` bullet under "Files in this folder":

```
- `page.tsx` — list view: filtering (`FilterBar` + `filterExpenses`), row
  selection, invoice trigger, Gross/VAT/Net summary, **Export CSV** button
  (exports `filtered` via `lib/utils/csv`), **Import CSV** button, wires up the
  modals below.
```

with:

```
- `page.tsx` — list view: server-side pagination (`fetchExpensesPage` thunk),
  `FilterBar` (date preset, currency, category, general keyword search across
  title/vendor/description/invoice number), row selection, invoice trigger,
  Gross/VAT/Net summary **(this page)**, **Export CSV** button (server-side
  query, no `.range()`, capped at 5 000 rows), **Import CSV** button, wires up
  the modals below.
```

And the `expensesSlice.ts` bullet's thunk description:

```
  Thunk: `fetchExpensesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown, `.select("*", { count: "exact" })`, `.order("date")`,
  and `.range(from, to)` from `rangeFor()`. Dispatches `hydratePage` on success.
```

→

```
  Thunk: `fetchExpensesPage({ page, pageSize, filters })` — builds a Supabase query
  with filter pushdown (date range, category, currency, and a keyword `search`
  matched via `.or()`/`ilike` across `title`/`vendor`/`description`/
  `invoice_number`, sanitized with `sanitizeIlikeSearchTerm`),
  `.select("*", { count: "exact" })`, `.order("date")`, and `.range(from, to)`
  from `rangeFor()`. Dispatches `hydratePage` on success.
```

- [ ] **Step 4: Append a gotcha to `src/app/dashboard/expenses/SKILL.md`**

Append to the end of the file:

```
- The "Search" box in `FilterBar` matches `title`, `vendor`, `description`,
  and `invoice_number` via a Supabase `.or()`/`ilike` clause (see
  `fetchExpensesPage` in `_store/expensesSlice.ts`), sanitized with
  `sanitizeIlikeSearchTerm` (`@/lib/utils/filters`). `handleExport` mirrors
  the same predicate — keep both in sync if the column set ever changes.
```

- [ ] **Step 5: Ask the user to manually verify in the browser**

Ask the user to open `/dashboard/expenses`, confirm the new Search box narrows
results after ~400ms, confirm it combines correctly with the Category filter,
and confirm Export matches the on-screen filtered rows.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/expenses/_store/expensesSlice.ts src/app/dashboard/expenses/page.tsx src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "feat: add keyword search to Expenses"
```

---

## Final check

After Task 5, the branch `feat/orders-purchases-expenses-search` has 5 commits
(filters.ts, FilterBar.tsx, Sales, Purchases, Expenses) plus the pre-existing
spec commit. Ask the user to run the full suite once at the end:

Ask the user to run: `npx jest`
Expected: PASS, no regressions in unrelated feature tests.

Then hand off per `superpowers:finishing-a-development-branch` (push branch,
open PR) — only if the user asks to proceed to that step.
