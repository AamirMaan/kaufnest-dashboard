# Month and Arbitrary-Quarter Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Specific period" date-filter option — any month, any quarter, or a full year, for any year with data — to Overview, Sales, Expenses, Purchases, and Audit Logs.

**Architecture:** Two new pure helpers in `lib/utils/filters.ts` (`periodRange`, `describePeriod`) turn a `{year, unit}` pick into an ordinary `{from, to}` date pair and back. A period selection is just `preset: "custom"` with that computed pair — every existing consumer (the four `fetchXPage` thunks, Overview's own fetch) works completely unchanged. `FilterBar.tsx` grows an optional "Specific period" mode (two new selects, Year and Period) gated behind two new optional props, so it stays backward compatible while each of the five call sites is migrated one at a time. A new `fetchEarliestYear` helper (same test-friendly callback-injection shape as the existing `fetchAllRows`) resolves the Year select's lower bound per feature.

**Tech Stack:** Next.js App Router, TypeScript, React (Client Components), Redux Toolkit, Supabase, Jest.

## Global Constraints

- No schema or Redux slice changes — a period pick must resolve to a plain `{ from, to }` pair passed through the *existing* `preset: "custom"` path. Do not add a new `DatePreset` value.
- Reuse the existing `new Date(y, m + 1, 0)` month-end idiom (already in `getPresetRange`) for period/quarter/month-end arithmetic — this needs no leap-year special case.
- Per the working agreement: write/extend unit tests for every new pure helper; run the focused `npx jest <path>` for whatever you changed to verify before committing; do **not** run `npx tsc --noEmit` or `npm run lint` manually — `.husky/pre-commit` runs both on every `git commit` and will fail the commit if either catches something, so just fix what it reports and re-run the same `git commit` command; do not start the dev server or `curl` routes.
- Tests are colocated (`*.test.ts` next to the file they cover).
- Update the affected feature's `CLAUDE.md`/`SKILL.md` in the **same commit** as the code change — never as a follow-up.
- Continue directly on the current worktree/branch (`worktree-spec+multicurrency-expense-images-date-filters`) — do not create a new branch or attempt to sync with `main` first; this branch already diverged for the combined multicurrency/receipts/date-filters spec and the currency-conversion piece was already merged from it the same way.
- Money/date formatting conventions aside, this feature touches no currency or receipt code — stay scoped to date filtering only.

---

### Task 1: `periodRange` / `describePeriod` helpers

**Files:**
- Modify: `src/lib/utils/filters.ts`
- Test: `src/lib/utils/filters.test.ts`
- Modify (docs): `src/lib/utils/SKILL.md`

**Interfaces:**
- Produces (for later tasks): `export type PeriodUnit = "full" | "q1" | "q2" | "q3" | "q4" | "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12";`, `export function periodRange(year: number, unit: PeriodUnit): { from: string; to: string }`, `export function describePeriod(from: string, to: string): { year: number; unit: PeriodUnit } | null`, `export const PERIOD_UNIT_OPTIONS: { value: PeriodUnit; label: string }[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/utils/filters.test.ts` — first add `periodRange`, `describePeriod` to the existing import block at the top of the file:

```ts
import {
  resolveDateRange,
  getPresetRange,
  filterSales,
  isRevenueSale,
  isEbayIntegrationSyncedSale,
  DEFAULT_SALES_FILTERS,
  sanitizeIlikeSearchTerm,
  isDefaultFilters,
  DEFAULT_PURCHASE_FILTERS,
  periodRange,
  describePeriod,
} from "./filters";
```

Then append this to the end of the file:

```ts
describe("periodRange", () => {
  it("returns the full calendar year", () => {
    expect(periodRange(2026, "full")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("returns each quarter's exact bounds", () => {
    expect(periodRange(2026, "q1")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRange(2026, "q2")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(periodRange(2026, "q3")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange(2026, "q4")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("returns each month's exact bounds, including short and leap February", () => {
    expect(periodRange(2026, "01")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(periodRange(2026, "02")).toEqual({ from: "2026-02-01", to: "2026-02-28" }); // 2026 is not a leap year
    expect(periodRange(2028, "02")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); // 2028 is a leap year
    expect(periodRange(2026, "04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(periodRange(2026, "12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("describePeriod", () => {
  it.each([
    "full", "q1", "q2", "q3", "q4",
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
  ] as const)("round-trips periodRange(2026, %s)", (unit) => {
    const range = periodRange(2026, unit);
    expect(describePeriod(range.from, range.to)).toEqual({ year: 2026, unit });
  });

  it("round-trips a leap-year February", () => {
    const range = periodRange(2028, "02");
    expect(describePeriod(range.from, range.to)).toEqual({ year: 2028, unit: "02" });
  });

  it("returns null for a range that is not an exact period", () => {
    expect(describePeriod("2026-01-10", "2026-01-20")).toBeNull();
  });

  it("returns null for a range spanning parts of two months", () => {
    expect(describePeriod("2026-01-15", "2026-02-15")).toBeNull();
  });

  it("returns null for a range that starts on Jan 1 but ends early", () => {
    expect(describePeriod("2026-01-01", "2026-06-15")).toBeNull();
  });

  it("returns null for an empty or malformed 'from'", () => {
    expect(describePeriod("", "2026-12-31")).toBeNull();
    expect(describePeriod("not-a-date", "2026-12-31")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/lib/utils/filters.test.ts`
Expected: FAIL — `periodRange`/`describePeriod` are not exported from `./filters`.

- [ ] **Step 3: Implement `periodRange`, `describePeriod`, `PeriodUnit`, `PERIOD_UNIT_OPTIONS`**

In `src/lib/utils/filters.ts`, the file already has a private `pad`/`fmt` pair right after the imports:

```ts
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

Immediately after `getPresetRange`'s closing brace (right before `/** Resolve a preset ... */` / `export function resolveDateRange`), insert:

```ts
export type PeriodUnit =
  | "full" | "q1" | "q2" | "q3" | "q4"
  | "01" | "02" | "03" | "04" | "05" | "06"
  | "07" | "08" | "09" | "10" | "11" | "12";

export const PERIOD_UNIT_OPTIONS: { value: PeriodUnit; label: string }[] = [
  { value: "full", label: "Full Year" },
  { value: "q1", label: "Q1 (Jan–Mar)" },
  { value: "q2", label: "Q2 (Apr–Jun)" },
  { value: "q3", label: "Q3 (Jul–Sep)" },
  { value: "q4", label: "Q4 (Oct–Dec)" },
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const QUARTER_START_MONTH: Record<"q1" | "q2" | "q3" | "q4", number> = {
  q1: 0, q2: 3, q3: 6, q4: 9,
};

/**
 * Resolve a {year, unit} period pick into a concrete `{ from, to }` ISO date
 * range. Reuses the same `new Date(y, m + 1, 0)` month-end idiom
 * `getPresetRange` already uses for "this_month"/"this_quarter" — this needs
 * no leap-year special case, since `new Date` normalizes an out-of-range day
 * (e.g. `new Date(2026, 2, 0)` for "the day before March 1st" correctly
 * yields Feb 28, or Feb 29 in a leap year).
 */
export function periodRange(year: number, unit: PeriodUnit): { from: string; to: string } {
  if (unit === "full") {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (unit === "q1" || unit === "q2" || unit === "q3" || unit === "q4") {
    const startMonth = QUARTER_START_MONTH[unit];
    return {
      from: fmt(new Date(year, startMonth, 1)),
      to: fmt(new Date(year, startMonth + 3, 0)),
    };
  }
  const month = Number(unit) - 1;
  return {
    from: fmt(new Date(year, month, 1)),
    to: fmt(new Date(year, month + 1, 0)),
  };
}

/**
 * Inverse of `periodRange` — used so a filter UI whose only persisted state
 * is a `{ from, to }` pair (see `FilterBar`'s "Specific period" mode) can
 * re-derive which Year/Period it should show as selected, including after a
 * remount where local component state was lost. Returns `null` when the pair
 * is not an EXACT period span — deliberately, so a hand-typed custom range
 * that happens to land on a period boundary is the only case that could ever
 * be ambiguous, and even then this always prefers reporting it AS a period
 * (there is no meaningful difference once the bounds match exactly).
 * A pair that does not match any period at all (the common "manual custom
 * range" case) correctly falls through every candidate and returns `null`.
 */
export function describePeriod(from: string, to: string): { year: number; unit: PeriodUnit } | null {
  const year = Number(from.slice(0, 4));
  if (!Number.isInteger(year) || from.length < 4) return null;
  const units: PeriodUnit[] = [
    "full", "q1", "q2", "q3", "q4",
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
  ];
  for (const unit of units) {
    const range = periodRange(year, unit);
    if (range.from === from && range.to === to) return { year, unit };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/lib/utils/filters.test.ts`
Expected: PASS (all existing tests plus the new ones).

- [ ] **Step 5: Document in `src/lib/utils/SKILL.md`**

In the `## filters.ts` section, immediately after the `isDefaultFilters(f)` bullet (the section's last bullet), add:

```markdown
- `PeriodUnit = "full" | "q1" | "q2" | "q3" | "q4" | "01".."12"`,
  `periodRange(year, unit) → { from, to }`, `describePeriod(from, to) → {
  year, unit } | null` (2026-09-17) — the "Specific period" date filter's
  maths (`components/ui/FilterBar.tsx`'s Year/Period selects, and Overview's
  own bespoke date-range UI in `dashboard/page.tsx`). A period pick is never
  its own `DatePreset` — it always resolves to `preset: "custom"` plus a
  concrete pair, so every existing `resolveDateRange`/thunk consumer needs no
  changes. `describePeriod` is the inverse, used to re-derive which Year/Period
  a stored `{from, to}` pair represents (e.g. after a remount) — it returns
  `null` for any pair that is not an EXACT period span, which is what keeps a
  hand-typed custom range rendering as "Custom Range" instead of being
  mislabelled. `PERIOD_UNIT_OPTIONS` is the shared `{value, label}[]` list for
  the Period select, consumed by both `FilterBar.tsx` and `dashboard/page.tsx`
  so the two don't duplicate the same 17-entry array.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/filters.ts src/lib/utils/filters.test.ts src/lib/utils/SKILL.md
git commit -m "feat(filters): add periodRange/describePeriod for the Specific Period date filter"
```

---

### Task 2: `fetchEarliestYear` helper

**Files:**
- Create: `src/lib/utils/fetchEarliestYear.ts`
- Test: `src/lib/utils/fetchEarliestYear.test.ts`
- Modify (docs): `src/lib/utils/SKILL.md`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (for Tasks 4–8): `export async function fetchEarliestYear(fetchEarliestDate: () => Promise<string | null>, fallback?: number): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/utils/fetchEarliestYear.test.ts`:

```ts
import { fetchEarliestYear } from "./fetchEarliestYear";

describe("fetchEarliestYear", () => {
  it("returns the year from the fetched earliest date", async () => {
    const year = await fetchEarliestYear(async () => "2019-03-15");
    expect(year).toBe(2019);
  });

  it("works with a full ISO timestamp (e.g. audit_logs.created_at)", async () => {
    const year = await fetchEarliestYear(async () => "2021-07-01T10:23:00+00:00");
    expect(year).toBe(2021);
  });

  it("returns the given fallback when no date is found", async () => {
    const year = await fetchEarliestYear(async () => null, 2020);
    expect(year).toBe(2020);
  });

  it("defaults the fallback to the current year when not given", async () => {
    const year = await fetchEarliestYear(async () => null);
    expect(year).toBe(new Date().getFullYear());
  });

  it("falls back on an unparseable date string", async () => {
    const year = await fetchEarliestYear(async () => "not-a-date", 2020);
    expect(year).toBe(2020);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/lib/utils/fetchEarliestYear.test.ts`
Expected: FAIL — cannot find module `./fetchEarliestYear`.

- [ ] **Step 3: Implement**

Create `src/lib/utils/fetchEarliestYear.ts`:

```ts
/**
 * Resolves the earliest year a feature has data for, driven by a
 * caller-provided fetch of the single earliest row's date value — same
 * test-friendly callback-injection shape as `fetchAllRows`, so this stays
 * unit-testable without a live Supabase client. The caller is responsible
 * for the actual query, e.g.:
 *
 * ```ts
 * const year = await fetchEarliestYear(async () => {
 *   const { data } = await supabase
 *     .from("sales")
 *     .select("date")
 *     .order("date", { ascending: true })
 *     .limit(1)
 *     .maybeSingle();
 *   return data?.date ?? null;
 * });
 * ```
 *
 * Used to populate the "Specific period" filter's Year select lower bound
 * (see `components/ui/FilterBar.tsx` and `dashboard/page.tsx`).
 *
 * @param fetchEarliestDate - resolves the earliest row's date/timestamp
 *   string, or `null` when the table has no rows
 * @param fallback - returned when no date is found, or it can't be parsed;
 *   defaults to the current year
 */
export async function fetchEarliestYear(
  fetchEarliestDate: () => Promise<string | null>,
  fallback: number = new Date().getFullYear(),
): Promise<number> {
  const value = await fetchEarliestDate();
  if (!value) return fallback;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/utils/fetchEarliestYear.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Document in `src/lib/utils/SKILL.md`**

Immediately after the `## filters.ts` section's closing (right before `## csv.ts`), add a new section:

```markdown
## fetchEarliestYear.ts

`fetchEarliestYear(fetchEarliestDate, fallback?) → Promise<number>`
(2026-09-17) — resolves the lower bound for the "Specific period" filter's
Year select. Same test-friendly callback-injection shape as `fetchAllRows`
(the caller supplies the actual Supabase query, so this stays unit-testable
without a live client). `fallback` defaults to the current year, used both
when the table has no rows and when the fetched value doesn't parse as a
date. Called once on mount by each of Sales/Expenses/Purchases/Audit Logs'
`page.tsx` (one call, that feature's own table) and by Overview's `page.tsx`
(three calls — sales/expenses/purchases — taking the `Math.min` of the
three, since Overview's date filter spans all of them). Overview does
**not** derive this from its already-fetched `sales`/`expenses`/`purchases`
local state, even though that data is sitting right there — that state is
already scoped to the CURRENTLY SELECTED date range (see its own `.gte`/
`.lte` fetch), so once any narrower range is selected it would silently
undercount how far back real data actually goes. This helper always queries
unfiltered.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/fetchEarliestYear.ts src/lib/utils/fetchEarliestYear.test.ts src/lib/utils/SKILL.md
git commit -m "feat(filters): add fetchEarliestYear for the Specific Period filter's Year select"
```

---

### Task 3: `FilterBar.tsx` — "Specific period" mode

**Files:**
- Modify: `src/components/ui/FilterBar.tsx`
- Modify (docs): `src/components/ui/SKILL.md`

**Interfaces:**
- Consumes: `periodRange`, `describePeriod`, `PeriodUnit`, `PERIOD_UNIT_OPTIONS` from `@/lib/utils/filters` (Task 1).
- Produces (for Tasks 4–7): two new **optional** `FilterBarProps` fields — `earliestYear?: number` and `onPeriodChange?: (preset: DatePreset, dateFrom: string, dateTo: string) => void`. Both optional so this task compiles and ships standalone with zero changes required at the four existing call sites; the "Specific period" option only appears once a caller passes `onPeriodChange`.

No dedicated test file — this repo has no established pattern of component-level tests for filter/form UI shells (`FilterBar.tsx` has never had one; see e.g. `sales/CLAUDE.md`'s note that `ImportSalesModal.tsx` is deliberately untested at the component level, only its pure logic is). The new logic this task adds beyond wiring (`periodRange`/`describePeriod`) is already fully covered by Task 1's tests. Verify manually in the browser once Task 4 wires a real page.

- [ ] **Step 1: Update imports and the `PRESETS` handling**

In `src/components/ui/FilterBar.tsx`, replace the current import line:

```tsx
import type { DatePreset } from "@/lib/utils/filters";
```

with:

```tsx
import {
  type DatePreset,
  type PeriodUnit,
  periodRange,
  describePeriod,
  PERIOD_UNIT_OPTIONS,
} from "@/lib/utils/filters";
```

The `PRESETS` constant itself is unchanged — "Specific period" and "Custom Range" are rendered as separate explicit `<option>`s in Step 4 below (not added to this array), so no other code that reads `PRESETS` needs to change.

- [ ] **Step 2: Add the two new props**

Replace the `FilterBarProps` interface:

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

with:

```tsx
export interface FilterBarProps {
  preset: DatePreset;
  onPresetChange: (v: DatePreset) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  /**
   * Earliest year with data — the lower bound of the "Specific period"
   * mode's Year select. Only meaningful (and only rendered) when
   * `onPeriodChange` is also provided; falls back to the current year if
   * omitted, showing a single-year dropdown.
   */
  earliestYear?: number;
  /**
   * Atomically applies a period pick's resulting `preset`/`dateFrom`/
   * `dateTo`. Providing this prop is what enables the "Specific period"
   * dropdown option. **Required to be atomic**: a caller whose
   * `preset`/`dateFrom`/`dateTo` live in one merged filter object updated
   * via three separate single-field setters (the `setFilter(key, value)`
   * pattern already used by Sales/Expenses/Purchases/Audit Logs) would lose
   * two of the three fields if this component instead called
   * `onPresetChange`/`onDateFromChange`/`onDateToChange` separately in the
   * same handler — each call would compute its `next` object from the same
   * pre-update `filters` closure, so only the LAST call's field survives.
   */
  onPeriodChange?: (preset: DatePreset, dateFrom: string, dateTo: string) => void;
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

- [ ] **Step 3: Destructure the new props and add the local mode state + handlers**

In the `FilterBar` function signature, replace:

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
```

with:

```tsx
export function FilterBar({
  preset,
  onPresetChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  earliestYear,
  onPeriodChange,
  currency,
  onCurrencyChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  hasActive,
  onClear,
  children,
}: FilterBarProps) {
  const supportsPeriod = onPeriodChange !== undefined;

  // Local UI-only state: whether the "custom" preset is currently showing
  // the Year/Period selects ("period" mode) or the raw From/To date inputs
  // ("manual" mode) — both are `preset === "custom"` externally, so this is
  // the one piece of display state that can't be derived from props on
  // every render (doing so would flip the UI out from under a user mid-way
  // through typing a manual custom range that happens to land on an exact
  // period boundary). Computed ONCE at mount via `describePeriod` — this is
  // what gives the dropdown its own label back after a remount, per the
  // design's "re-derive its own label after a remount" requirement — and
  // changed afterward only by the user's own explicit dropdown choice
  // (`handlePresetSelect` below), never automatically re-derived again.
  const [customSubMode, setCustomSubMode] = useState<"period" | "manual">(() =>
    supportsPeriod && describePeriod(dateFrom, dateTo) ? "period" : "manual"
  );
```

Immediately after that (still inside the component, before the existing `localSearch`/`prevSearchValue` state), add:

```tsx
  type DisplayValue = DatePreset | "specific_period";
  const displayValue: DisplayValue =
    preset === "custom" && customSubMode === "period" ? "specific_period" : preset;

  function handlePresetSelect(v: string) {
    if (v === "specific_period") {
      setCustomSubMode("period");
      const range = periodRange(new Date().getFullYear(), "full");
      onPeriodChange!("custom", range.from, range.to);
      return;
    }
    if (v === "custom") {
      setCustomSubMode("manual");
    }
    onPresetChange(v as DatePreset);
  }

  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(earliestYear ?? currentYear, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const currentPeriod: { year: number; unit: PeriodUnit } =
    describePeriod(dateFrom, dateTo) ?? { year: currentYear, unit: "full" };

  function handlePeriodFieldChange(year: number, unit: PeriodUnit) {
    const range = periodRange(year, unit);
    onPeriodChange!("custom", range.from, range.to);
  }
```

- [ ] **Step 4: Update the rendered Date Range select and the custom-inputs block**

Replace:

```tsx
      {/* Date preset */}
      <div>
        <FilterLabel>Date Range</FilterLabel>
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as DatePreset)}
          className={inputCls}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Custom date inputs */}
      {preset === "custom" && (
        <>
          <div>
            <FilterLabel>From</FilterLabel>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <FilterLabel>To</FilterLabel>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}
```

with:

```tsx
      {/* Date preset */}
      <div>
        <FilterLabel>Date Range</FilterLabel>
        <select
          value={displayValue}
          onChange={(e) => handlePresetSelect(e.target.value)}
          className={inputCls}
        >
          {PRESETS.filter((p) => p.value !== "custom").map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          {supportsPeriod && <option value="specific_period">Specific Period</option>}
          <option value="custom">Custom Range</option>
        </select>
      </div>

      {/* Specific period — Year + Period selects */}
      {preset === "custom" && customSubMode === "period" && supportsPeriod && (
        <>
          <div>
            <FilterLabel>Year</FilterLabel>
            <select
              value={currentPeriod.year}
              onChange={(e) => handlePeriodFieldChange(Number(e.target.value), currentPeriod.unit)}
              className={inputCls}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FilterLabel>Period</FilterLabel>
            <select
              value={currentPeriod.unit}
              onChange={(e) => handlePeriodFieldChange(currentPeriod.year, e.target.value as PeriodUnit)}
              className={inputCls}
            >
              {PERIOD_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Custom date inputs — raw manual entry mode */}
      {preset === "custom" && customSubMode !== "period" && (
        <>
          <div>
            <FilterLabel>From</FilterLabel>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <FilterLabel>To</FilterLabel>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}
```

- [ ] **Step 5: Verify nothing else broke**

Run: `npx jest src/components/ui`
Expected: PASS (whatever `components/ui` tests already exist — no test targets `FilterBar.tsx` directly, so this step is a smoke check that the change didn't break an unrelated colocated test).

- [ ] **Step 6: Document in `src/components/ui/SKILL.md`**

In the `## FilterBar.tsx` section, replace the bullet:

```markdown
- `preset: DatePreset` (from `@/lib/utils/filters` — `"all" | "this_month" |
  "last_month" | "this_quarter" | "this_year" | "custom"`). Selecting `"custom"`
  reveals the From/To date inputs.
```

with:

```markdown
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
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/FilterBar.tsx src/components/ui/SKILL.md
git commit -m "feat(ui): add optional Specific Period mode to FilterBar"
```

---

### Task 4: Wire Sales page

**Files:**
- Modify: `src/app/dashboard/sales/page.tsx`
- Modify (docs): `src/app/dashboard/sales/CLAUDE.md`

**Interfaces:**
- Consumes: `fetchEarliestYear` (Task 2), `FilterBar`'s `earliestYear`/`onPeriodChange` props (Task 3).

- [ ] **Step 1: Add the `useEffect` import and `fetchEarliestYear` import**

Change:

```tsx
import { useState, useMemo, useCallback } from "react";
```

to:

```tsx
import { useState, useMemo, useCallback, useEffect } from "react";
```

Add, next to the existing `fetchAllRows` import:

```tsx
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
```

- [ ] **Step 2: Add `earliestYear` state and the mount-time fetch**

Immediately after the existing `const [filters, setFilters] = useState<SalesFilters>(DEFAULT_SALES_FILTERS);` / `const hasActive = !isDefaultFilters(filters);` pair, add:

```tsx
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("sales")
          .select("date")
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.date ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Add the combined `setPeriod` handler**

Immediately after the existing `setFilter` function, add:

```tsx
  /**
   * Atomic counterpart to `setFilter` for a period pick from FilterBar's
   * "Specific period" mode — sets preset + dateFrom + dateTo in one update,
   * required since `setFilter` computes `next` from the `filters` closure
   * and three separate calls in one handler would silently drop two of the
   * three fields. See FilterBar.tsx's SKILL.md entry for the full "why".
   */
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }
```

- [ ] **Step 4: Pass the two new props to `FilterBar`**

Change:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
```

to:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
        currency={filters.currency}
```

- [ ] **Step 5: Verify**

Run: `npx jest dashboard/sales`
Expected: PASS — this task adds no new pure logic (it's wiring), so this just confirms `salesSlice.test.ts` still passes and nothing else broke.

- [ ] **Step 6: Document in `src/app/dashboard/sales/CLAUDE.md`**

In the `page.tsx` bullet under "## Files in this folder", the sentence currently reads:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchSalesPage` thunk),
  `FilterBar` (date preset, currency, platform, status, general keyword
  search across product name/order ID/description), row selection, invoice
```

Change `date preset` to `date preset (incl. "Specific period" — any month/quarter/year, see FilterBar.tsx's SKILL.md entry)`:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchSalesPage` thunk),
  `FilterBar` (date preset — incl. "Specific period", any month/quarter/year,
  see `components/ui/SKILL.md`'s FilterBar entry — currency, platform,
  status, general keyword search across product name/order ID/description),
  row selection, invoice
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/page.tsx src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): wire up the Specific Period date filter"
```

---

### Task 5: Wire Expenses page

**Files:**
- Modify: `src/app/dashboard/expenses/page.tsx`
- Modify (docs): `src/app/dashboard/expenses/CLAUDE.md`

**Interfaces:**
- Consumes: same as Task 4.

- [ ] **Step 1: Add imports**

Change:

```tsx
import { useState, useMemo, useCallback } from "react";
```

to:

```tsx
import { useState, useMemo, useCallback, useEffect } from "react";
```

Add, next to the existing `fetchAllRows` import:

```tsx
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
```

- [ ] **Step 2: Add `earliestYear` state and mount-time fetch**

Immediately after this page's `const [filters, setFilters] = useState<ExpenseFilters>(DEFAULT_EXPENSE_FILTERS);` / `hasActive` pair, add:

```tsx
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("expenses")
          .select("date")
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.date ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Add the combined `setPeriod` handler**

Immediately after this page's `setFilter` function, add:

```tsx
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }
```

- [ ] **Step 4: Pass the two new props to `FilterBar`**

Change:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
```

to:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
        currency={filters.currency}
```

- [ ] **Step 5: Verify**

Run: `npx jest dashboard/expenses`
Expected: PASS.

- [ ] **Step 6: Document in `src/app/dashboard/expenses/CLAUDE.md`**

Change:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchExpensesPage` thunk),
  `FilterBar` (date preset, currency, category, general keyword search across
  title/vendor/description/invoice number), row selection, invoice trigger,
```

to:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchExpensesPage` thunk),
  `FilterBar` (date preset — incl. "Specific period", any month/quarter/year,
  see `components/ui/SKILL.md`'s FilterBar entry — currency, category,
  general keyword search across title/vendor/description/invoice number),
  row selection, invoice trigger,
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/expenses/page.tsx src/app/dashboard/expenses/CLAUDE.md
git commit -m "feat(expenses): wire up the Specific Period date filter"
```

---

### Task 6: Wire Purchases page

**Files:**
- Modify: `src/app/dashboard/purchases/page.tsx`
- Modify (docs): `src/app/dashboard/purchases/CLAUDE.md`

**Interfaces:**
- Consumes: same as Task 4.

- [ ] **Step 1: Add imports**

Change:

```tsx
import { useState, useMemo, useCallback } from "react";
```

to:

```tsx
import { useState, useMemo, useCallback, useEffect } from "react";
```

Add, next to the existing `fetchAllRows` import:

```tsx
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
```

- [ ] **Step 2: Add `earliestYear` state and mount-time fetch**

Immediately after this page's `const [filters, setFilters] = useState<PurchaseFilters>(DEFAULT_PURCHASE_FILTERS);` / `hasActive` pair, add:

```tsx
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("purchases")
          .select("date")
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.date ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Add the combined `setPeriod` handler**

Immediately after this page's `setFilter` function, add:

```tsx
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }
```

- [ ] **Step 4: Pass the two new props to `FilterBar`**

Change:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        currency={filters.currency}
```

to:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
        currency={filters.currency}
```

- [ ] **Step 5: Verify**

Run: `npx jest dashboard/purchases`
Expected: PASS.

- [ ] **Step 6: Document in `src/app/dashboard/purchases/CLAUDE.md`**

Change:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset, currency, general keyword search across product
  name/vendor/description), `<Pagination>`, loading overlay, Gross/VAT/Net
```

to:

```markdown
- `page.tsx` — list view: server-side pagination (`fetchPurchasesPage` thunk),
  `FilterBar` (date preset — incl. "Specific period", any month/quarter/year,
  see `components/ui/SKILL.md`'s FilterBar entry — currency, general keyword
  search across product name/vendor/description), `<Pagination>`, loading
  overlay, Gross/VAT/Net
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/purchases/page.tsx src/app/dashboard/purchases/CLAUDE.md
git commit -m "feat(purchases): wire up the Specific Period date filter"
```

---

### Task 7: Wire Audit Logs page

**Files:**
- Modify: `src/app/dashboard/audit-logs/page.tsx`
- Modify (docs): `src/app/dashboard/audit-logs/CLAUDE.md`

**Interfaces:**
- Consumes: same as Task 4, but the date column is `created_at` (timestamptz), not `date`, and `createTenantClient` is not currently imported in this file.

- [ ] **Step 1: Add imports**

Change:

```tsx
import { useState, useCallback } from "react";
```

to:

```tsx
import { useState, useCallback, useEffect } from "react";
```

Add two new imports (this file currently has neither):

```tsx
import { createTenantClient } from "@/lib/supabase/client";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
```

- [ ] **Step 2: Add `earliestYear` state and mount-time fetch**

Immediately after `const [filters, setFilters] = useState<AuditLogFilters>(DEFAULT_AUDIT_LOG_FILTERS);` / `const hasActive = !isDefaultAuditLogFilters(filters);`, add:

```tsx
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("audit_logs")
          .select("created_at")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.created_at ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Add the combined `setPeriod` handler**

Immediately after this page's `setFilter` function, add:

```tsx
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }
```

- [ ] **Step 4: Pass the two new props to `FilterBar`**

Change:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        hasActive={hasActive}
        onClear={clearFilters}
      >
```

to:

```tsx
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
        hasActive={hasActive}
        onClear={clearFilters}
      >
```

- [ ] **Step 5: Verify**

Run: `npx jest auditLogsSlice`
Expected: PASS.

- [ ] **Step 6: Document in `src/app/dashboard/audit-logs/CLAUDE.md`**

Change:

```markdown
- `page.tsx` — table of log entries with server-side pagination and filters
  (`FilterBar` for date preset/range, action type dropdown). Dispatches
```

to:

```markdown
- `page.tsx` — table of log entries with server-side pagination and filters
  (`FilterBar` for date preset/range — incl. "Specific period", any
  month/quarter/year, see `components/ui/SKILL.md`'s FilterBar entry —
  action type dropdown). Its `earliestYear` fetch queries `created_at`
  (timestamptz), not `date` like the other three FilterBar consumers.
  Dispatches
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/audit-logs/page.tsx src/app/dashboard/audit-logs/CLAUDE.md
git commit -m "feat(audit-logs): wire up the Specific Period date filter"
```

---

### Task 8: Wire Overview page (bespoke inline UI)

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify (docs): `src/app/dashboard/CLAUDE.md`

**Interfaces:**
- Consumes: `periodRange`, `describePeriod`, `PeriodUnit`, `PERIOD_UNIT_OPTIONS` (Task 1), `fetchEarliestYear` (Task 2). Does **not** use `FilterBar` — Overview has always had its own separate inline date-range UI (`RANGE_PRESETS`, its own `<select>`+inputs), so this task reimplements the same "Specific period" behavior directly here rather than through Task 3's component.

- [ ] **Step 1: Add imports**

Change:

```tsx
import { resolveDateRange, isRevenueSale, type DatePreset } from "@/lib/utils/filters";
```

to:

```tsx
import {
  resolveDateRange,
  isRevenueSale,
  periodRange,
  describePeriod,
  PERIOD_UNIT_OPTIONS,
  type DatePreset,
  type PeriodUnit,
} from "@/lib/utils/filters";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";
```

- [ ] **Step 2: Add `periodMode` and `earliestYear` state, and the mount-time fetch**

Immediately after the existing:

```tsx
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
```

add:

```tsx
  // Local UI-only state, same role as FilterBar.tsx's `customSubMode` — see
  // that component's SKILL.md entry for the full "why": computed once at
  // mount, changed afterward only by this page's own explicit dropdown pick.
  const [periodMode, setPeriodMode] = useState<"period" | "manual">(() =>
    describePeriod(dateFrom, dateTo) ? "period" : "manual"
  );
  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const years = await Promise.all([
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("sales")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("expenses")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
        fetchEarliestYear(async () => {
          const { data } = await supabase
            .from("purchases")
            .select("date")
            .order("date", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data?.date ?? null;
        }),
      ]);
      if (!cancelled) setEarliestYear(Math.min(...years));
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Add the selection handlers and Year-option list**

Immediately after the existing `range` useMemo (`const range = useMemo(() => resolveDateRange(preset, dateFrom, dateTo), [preset, dateFrom, dateTo]);`), add:

```tsx
  type OverviewRangeChoice = DatePreset | "specific_period";

  const overviewDisplayValue: OverviewRangeChoice =
    preset === "custom" && periodMode === "period" ? "specific_period" : preset;

  function handleRangeSelect(v: OverviewRangeChoice) {
    if (v === "specific_period") {
      setPeriodMode("period");
      const computed = periodRange(new Date().getFullYear(), "full");
      setPreset("custom");
      setDateFrom(computed.from);
      setDateTo(computed.to);
      return;
    }
    if (v === "custom") {
      setPeriodMode("manual");
    }
    setPreset(v as DatePreset);
  }

  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(earliestYear, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const currentPeriod: { year: number; unit: PeriodUnit } =
    describePeriod(dateFrom, dateTo) ?? { year: currentYear, unit: "full" };

  function handlePeriodFieldChange(year: number, unit: PeriodUnit) {
    const computed = periodRange(year, unit);
    setDateFrom(computed.from);
    setDateTo(computed.to);
  }
```

- [ ] **Step 4: Update the rendered dropdown and custom-inputs block**

Replace:

```tsx
            <div>
              <span className={labelCls}>Date Range</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as DatePreset)}
                className={inputCls}
              >
                {RANGE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {preset === "custom" && (
              <>
                <div>
                  <span className={labelCls}>From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </>
            )}
```

with:

```tsx
            <div>
              <span className={labelCls}>Date Range</span>
              <select
                value={overviewDisplayValue}
                onChange={(e) => handleRangeSelect(e.target.value as OverviewRangeChoice)}
                className={inputCls}
              >
                {RANGE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="specific_period">Specific Period</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {preset === "custom" && periodMode === "period" && (
              <>
                <div>
                  <span className={labelCls}>Year</span>
                  <select
                    value={currentPeriod.year}
                    onChange={(e) => handlePeriodFieldChange(Number(e.target.value), currentPeriod.unit)}
                    className={inputCls}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={labelCls}>Period</span>
                  <select
                    value={currentPeriod.unit}
                    onChange={(e) => handlePeriodFieldChange(currentPeriod.year, e.target.value as PeriodUnit)}
                    className={inputCls}
                  >
                    {PERIOD_UNIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {preset === "custom" && periodMode !== "period" && (
              <>
                <div>
                  <span className={labelCls}>From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className={labelCls}>To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </>
            )}
```

- [ ] **Step 5: Verify**

Run: `npx jest dashboard/_lib`
Expected: PASS — this task adds no new pure logic in `_lib/`, this just confirms nothing else in the Overview page's test coverage broke.

- [ ] **Step 6: Document in `src/app/dashboard/CLAUDE.md`**

In the `page.tsx` bullet under "## Files at this level", find the sentence:

```markdown
  Applies a user-controlled date-range filter (`resolveDateRange` from
  `lib/utils/filters`, preset + custom from/to) on top of the already
  range-scoped fetch, ...
```

and change it to:

```markdown
  Applies a user-controlled date-range filter (`resolveDateRange` from
  `lib/utils/filters`, preset + custom from/to — including a "Specific
  period" mode, any month/quarter/year, added 2026-09-17 via `periodRange`/
  `describePeriod`/`fetchEarliestYear` from `lib/utils/`; this page has its
  own bespoke inline date-range UI rather than the shared `FilterBar`
  component, so it reimplements the same period-picking logic directly —
  see `components/ui/SKILL.md`'s FilterBar entry for the shared version)
  on top of the already range-scoped fetch, ...
```

Also update the "Shared deps" line at the end of the `page.tsx` bullet — find:

```markdown
  Shared deps:
  `StatCard`, `CategoryBadge`, `formatCurrency`/`calculateNetProfit`,
  `resolveDateRange`, `ExpenseCategory` type, `useTheme`, `recharts`,
  `lib/supabase/client` (`createTenantClient`), `lib/utils/fetchAllRows`.
```

and change it to:

```markdown
  Shared deps:
  `StatCard`, `CategoryBadge`, `formatCurrency`/`calculateNetProfit`,
  `resolveDateRange`, `periodRange`/`describePeriod`, `ExpenseCategory` type,
  `useTheme`, `recharts`, `lib/supabase/client` (`createTenantClient`),
  `lib/utils/fetchAllRows`, `lib/utils/fetchEarliestYear`.
```

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/CLAUDE.md
git commit -m "feat(dashboard): wire up the Specific Period date filter on Overview"
```

---

## Manual verification (all tasks)

This repo's working agreement asks not to start the dev server or `curl` routes directly. Per that agreement: after Task 8, ask the user to open `/dashboard`, `/dashboard/sales`, `/dashboard/expenses`, `/dashboard/purchases`, and `/dashboard/audit-logs` in a browser and confirm, on each:

1. The "Date Range" dropdown shows a new "Specific Period" option.
2. Selecting it reveals Year + Period selects (not the raw From/To inputs), defaulting to the current year, Full Year.
3. Changing Year or Period updates the visible data/summary immediately.
4. Switching to "Custom Range" instead shows the original raw From/To inputs.
5. Navigating away and back (or a hard refresh with the same filter state) still shows the correct mode and selection — not a blank/misdated Year+Period pair.
6. The Year select's earliest option roughly matches the oldest record for that feature (exact verification isn't practical from the UI alone, but it shouldn't show implausibly early or obviously-missing recent years).
