# Expandable Table Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shared `DataTable` an expandable-row mode (columns flagged `detail: true` move into a chevron-revealed panel) and adopt it on Orders so the table no longer scrolls horizontally.

**Architecture:** Pure column/expand-state logic lives in a new `src/components/ui/dataTableColumns.ts` (unit-tested; jest runs in `node`, so no component render tests). `DataTable.tsx` consumes it additively — tables without `detail` columns or `renderExpanded` render exactly as before. Orders flags six columns as `detail` and gets a feature-private `feeBreakdown` helper for the new per-fee breakdown.

**Tech Stack:** Next.js App Router (client component pages), React, Tailwind v4 token classes (`bg-(--color-…)`), lucide-react, Jest (`testEnvironment: "node"`).

**Spec:** `docs/superpowers/specs/2026-10-21-expandable-table-rows-design.md`

## Global Constraints

- Branch: `feat/expandable-table-rows` (already created from `main`). Never commit to `main`.
- Additive only: the 14 other `<DataTable>` call sites must not change behaviour or markup.
- Tokens only — no hardcoded colours/radii/shadows; reuse existing type scale (`text-xs` labels, `text-sm` values).
- Icons from `lucide-react` only. Icon-only buttons need an `aria-label`.
- Expand trigger is the chevron button only — no whole-row click.
- Don't run `npx tsc --noEmit` / `npm run lint` by hand; `git commit` runs them via Husky. If the commit hook fails on `.next/dev/types/validator.ts` (half-written by the user's running dev server), delete that generated file and re-run the same commit.
- Run focused tests only: `npx jest <path>`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Docs (`sales/CLAUDE.md`, `sales/SKILL.md`, `AGENTS.md`) are updated in the same commit as the code they describe.

---

### Task 1: Pure expand/column helpers

**Files:**
- Create: `src/components/ui/dataTableColumns.ts`
- Test: `src/components/ui/dataTableColumns.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact signatures, used by Task 2):
  - `splitColumns<C extends { detail?: boolean }>(columns: C[]): { inline: C[]; detail: C[] }`
  - `isTableExpandable(columns: { detail?: boolean }[], hasRenderExpanded: boolean): boolean`
  - `toggleId(ids: Set<string>, id: string): Set<string>` — never mutates input
  - `pruneIds(ids: Set<string>, presentIds: Iterable<string>): Set<string>` — returns the **same instance** when nothing is removed
  - `totalColSpan(opts: { selectable: boolean; expandable: boolean; inlineCount: number }): number`

- [ ] **Step 1: Write the failing test**

`src/components/ui/dataTableColumns.test.ts`:

```ts
import { isTableExpandable, pruneIds, splitColumns, toggleId, totalColSpan } from "./dataTableColumns";

describe("splitColumns", () => {
  it("keeps order and splits on the detail flag", () => {
    const cols = [{ header: "A" }, { header: "B", detail: true }, { header: "C", detail: false }, { header: "D", detail: true }];
    const { inline, detail } = splitColumns(cols);
    expect(inline.map((c) => c.header)).toEqual(["A", "C"]);
    expect(detail.map((c) => c.header)).toEqual(["B", "D"]);
  });

  it("puts everything inline when nothing is flagged", () => {
    const cols = [{ header: "A" }, { header: "B" }];
    expect(splitColumns(cols)).toEqual({ inline: cols, detail: [] });
  });
});

describe("isTableExpandable", () => {
  it("is false with no detail columns and no renderExpanded", () => {
    expect(isTableExpandable([{}, { detail: false }], false)).toBe(false);
  });

  it("is true with a detail column", () => {
    expect(isTableExpandable([{}, { detail: true }], false)).toBe(true);
  });

  it("is true with renderExpanded alone", () => {
    expect(isTableExpandable([{}], true)).toBe(true);
  });
});

describe("toggleId", () => {
  it("adds a missing id without mutating the input", () => {
    const before = new Set(["a"]);
    const after = toggleId(before, "b");
    expect([...after].sort()).toEqual(["a", "b"]);
    expect([...before]).toEqual(["a"]);
    expect(after).not.toBe(before);
  });

  it("removes a present id", () => {
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
});

describe("pruneIds", () => {
  it("drops ids that are no longer present", () => {
    expect([...pruneIds(new Set(["a", "b", "c"]), ["b", "x"])]).toEqual(["b"]);
  });

  it("returns the same instance when nothing is removed", () => {
    const ids = new Set(["a"]);
    expect(pruneIds(ids, ["a", "b"])).toBe(ids);
  });
});

describe("totalColSpan", () => {
  it.each([
    [{ selectable: false, expandable: false, inlineCount: 5 }, 5],
    [{ selectable: true, expandable: false, inlineCount: 5 }, 6],
    [{ selectable: false, expandable: true, inlineCount: 5 }, 6],
    [{ selectable: true, expandable: true, inlineCount: 5 }, 7],
  ])("%o → %i", (opts, expected) => {
    expect(totalColSpan(opts)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/ui/dataTableColumns.test.ts`
Expected: FAIL — `Cannot find module './dataTableColumns'`.

- [ ] **Step 3: Write minimal implementation**

`src/components/ui/dataTableColumns.ts`:

```ts
/**
 * Pure helpers behind DataTable's expandable-row mode. Columns flagged
 * `detail: true` render in a chevron-revealed panel instead of the main row.
 */

export function splitColumns<C extends { detail?: boolean }>(columns: C[]): { inline: C[]; detail: C[] } {
  const inline: C[] = [];
  const detail: C[] = [];
  for (const col of columns) (col.detail ? detail : inline).push(col);
  return { inline, detail };
}

export function isTableExpandable(columns: { detail?: boolean }[], hasRenderExpanded: boolean): boolean {
  return hasRenderExpanded || columns.some((c) => c.detail);
}

export function toggleId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Drops ids not in `presentIds`; returns `ids` itself when nothing was dropped. */
export function pruneIds(ids: Set<string>, presentIds: Iterable<string>): Set<string> {
  const present = new Set(presentIds);
  let removed = false;
  const next = new Set<string>();
  for (const id of ids) {
    if (present.has(id)) next.add(id);
    else removed = true;
  }
  return removed ? next : ids;
}

export function totalColSpan({
  selectable,
  expandable,
  inlineCount,
}: {
  selectable: boolean;
  expandable: boolean;
  inlineCount: number;
}): number {
  return inlineCount + (selectable ? 1 : 0) + (expandable ? 1 : 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/ui/dataTableColumns.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dataTableColumns.ts src/components/ui/dataTableColumns.test.ts
git commit -m "feat(ui): pure helpers for expandable DataTable rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Expandable rows in `DataTable`

**Files:**
- Modify: `src/components/ui/DataTable.tsx` (whole file, 172 lines — full replacement below)
- Modify: `AGENTS.md` (UI conventions, the `**Clarity**:` paragraph near line 204)

**Interfaces:**
- Consumes: all five helpers from Task 1.
- Produces (used by Task 3):
  - `export interface Column<T>` — now exported, gains `detail?: boolean`.
  - `DataTableProps<T>` gains `renderExpanded?: (row: T) => React.ReactNode` and `isExpandable?: (row: T) => boolean`.

No unit test in this task: jest runs in `node` (no DOM), and all branching logic is in Task 1's helpers. Verification is manual in Task 3.

- [ ] **Step 1: Replace `src/components/ui/DataTable.tsx`**

```tsx
import { Fragment, useId, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronDown } from "lucide-react";
import { isTableExpandable, pruneIds, splitColumns, toggleId, totalColSpan } from "./dataTableColumns";

export interface Column<T> {
  header: string;
  /** Key of T, or a custom render function */
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** When provided, the column header becomes clickable and rows can be sorted by this value */
  sortValue?: (row: T) => string | number;
  /** Render this column in the expanded row panel instead of the main row (its sortValue is ignored) */
  detail?: boolean;
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: keyof T;
  emptyMessage?: string;
  /** When provided, renders a checkbox column and calls back with selected rows */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Extra content rendered below the detail-field grid in the expanded panel */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Return false to hide the chevron for a row with nothing to show (default: every row expandable) */
  isExpandable?: (row: T) => boolean;
}

function cellContent<T>(col: Column<T>, row: T): React.ReactNode {
  if (col.render) return col.render(row);
  if (col.accessor != null) return String(row[col.accessor] ?? "—");
  return null;
}

export function DataTable<T>({
  columns,
  rows,
  keyField,
  emptyMessage = "No records found.",
  selectedIds,
  onSelectionChange,
  renderExpanded,
  isExpandable,
}: DataTableProps<T>) {
  const selectable = !!onSelectionChange;
  const { inline, detail } = useMemo(() => splitColumns(columns), [columns]);
  const expandable = isTableExpandable(columns, !!renderExpanded);
  const colSpan = totalColSpan({ selectable, expandable, inlineCount: inline.length });
  const baseId = useId();

  const [sort, setSort] = useState<SortState>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = inline.find((c) => c.header === sort.key);
    if (!col?.sortValue) return rows;
    const { sortValue, direction } = { sortValue: col.sortValue, direction: sort.direction };
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sort, inline]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const allIds = sortedRows.map((r) => String(r[keyField]));
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));

  // Prune ids from a previous page on every toggle so the set stays bounded
  // without a sync effect.
  function toggleRow(id: string) {
    setExpandedIds((prev) => toggleId(pruneIds(prev, allIds), id));
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div
      className="rounded-(--radius-card) border border-(--color-border) overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-(--color-border)">
          <thead className="bg-(--color-surface-subtle)">
            <tr>
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="cursor-pointer accent-(--color-primary)"
                  />
                </th>
              )}
              {expandable && <th className="px-2 py-3 w-10" aria-label="Row details" />}
              {inline.map((col) => {
                const isSorted = sort?.key === col.header;
                const SortIcon = isSorted ? (sort!.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.header}
                    className={`px-4 py-3 text-left text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider ${col.className ?? ""}`}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.header)}
                        className="inline-flex items-center gap-1 cursor-pointer hover:text-(--color-text-strong) transition-colors duration-150"
                        title={`Sort by ${col.header}`}
                      >
                        {col.header}
                        <SortIcon size={12} className={isSorted ? "text-(--color-primary)" : "text-(--color-text-faint)"} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-border-subtle) bg-(--color-surface)">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-(--color-text-faint)">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const id = String(row[keyField]);
                const isSelected = selectedIds?.has(id) ?? false;
                const canExpand = expandable && (isExpandable?.(row) ?? true);
                const isOpen = canExpand && expandedIds.has(id);
                const panelId = `${baseId}-detail-${id}`;
                return (
                  <Fragment key={id}>
                    <tr
                      className={`hover:bg-(--color-surface-subtle) transition-colors duration-150 ${isSelected ? "bg-(--color-info-bg)" : ""}`}
                    >
                      {selectable && (
                        <td className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(id)}
                            className="cursor-pointer accent-(--color-primary)"
                          />
                        </td>
                      )}
                      {expandable && (
                        <td className="px-2 py-3 w-10">
                          {canExpand && (
                            <button
                              type="button"
                              onClick={() => toggleRow(id)}
                              aria-expanded={isOpen}
                              aria-controls={panelId}
                              aria-label={isOpen ? "Collapse row" : "Expand row"}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-(--radius-btn) text-(--color-text-muted) hover:bg-(--color-surface-subtle) hover:text-(--color-text-strong) cursor-pointer transition-colors duration-150"
                            >
                              <ChevronDown
                                size={16}
                                className={`transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                        </td>
                      )}
                      {inline.map((col) => (
                        <td key={col.header} className={`px-4 py-3 ${col.className ?? ""}`}>
                          {cellContent(col, row)}
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr id={panelId} className="bg-(--color-surface-subtle)">
                        <td colSpan={colSpan} className="px-4 py-4">
                          {detail.length > 0 && (
                            <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
                              {detail.map((col) => (
                                <div key={col.header} className="min-w-0">
                                  <dt className="text-xs text-(--color-text-muted)">{col.header}</dt>
                                  <dd className="mt-1 text-sm text-(--color-text-base)">{cellContent(col, row)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {renderExpanded && (
                            <div className={detail.length > 0 ? "mt-4" : ""}>{renderExpanded(row)}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Notes for the implementer:
- Before this change, the empty-state `colSpan` was `selectable ? columns.length + 1 : columns.length`. For a non-expandable table `totalColSpan` returns exactly that, so other tables are unchanged.
- Sorting now searches `inline` (not `columns`), so a `sortValue` on a detail column is ignored, as the spec requires.
- If the eslint `react-hooks` plugin flags `useMemo` deps, fix what it reports; don't suppress it.

- [ ] **Step 2: Add the convention to `AGENTS.md`**

In `AGENTS.md`, right after the paragraph that starts `**Clarity**: every \`DataTable\` gets an \`emptyMessage\`` (ending `(\`<ChevronLeft/>\` + label).`), insert this new paragraph:

```markdown
**Wide tables**: don't let a `DataTable` grow a horizontal scrollbar. Keep
the columns needed to scan and act (date, name, status, headline amount,
actions) inline and mark the rest `detail: true` — they render as a
label/value grid in a chevron-expanded row panel (`DataTable.tsx`, logic in
`dataTableColumns.ts`). Use `renderExpanded` for panel content that isn't a
column. Orders (`dashboard/sales/page.tsx`) is the reference adoption.
```

- [ ] **Step 3: Re-run the helper tests (DataTable imports them)**

Run: `npx jest src/components/ui`
Expected: PASS (`dataTableColumns`, `Badge`, `Pagination`, `summaryTileHelpers`).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DataTable.tsx AGENTS.md
git commit -m "feat(ui): expandable detail rows in DataTable

Columns flagged detail: true render in a chevron-revealed panel instead
of the main row. Additive: tables without detail columns are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The pre-commit hook runs `tsc` + `eslint` + the verifier. Fix anything it reports, then re-run the same commit.

---

### Task 3: Adopt on Orders (+ fee breakdown)

**Files:**
- Create: `src/app/dashboard/sales/_lib/feeBreakdown.ts`
- Test: `src/app/dashboard/sales/_lib/feeBreakdown.test.ts`
- Modify: `src/app/dashboard/sales/page.tsx:252-370` (the `columns` array)
- Modify: `src/app/dashboard/sales/CLAUDE.md` (`_lib/` file map near line 88; the DataTable-sorting note near line 326)
- Modify: `src/app/dashboard/sales/SKILL.md` (minimal-file-set list near line 67; `## Gotchas — fee fields` bullet about the "Fees" column near line 207; the "DataTable column sorting is page-local" gotcha near line 613)

**Interfaces:**
- Consumes: `Column<T>`'s `detail?: boolean` from Task 2 (passed via the plain `columns` array literal; no import needed).
- Produces: `feeBreakdown(sale: Pick<Sale, "shipping_cost" | "advertising_fee" | "platform_fee">): FeeBreakdown | null`, where
  `interface FeeBreakdown { lines: { label: string; amount: number | null }[]; total: number }`.

- [ ] **Step 1: Write the failing test**

`src/app/dashboard/sales/_lib/feeBreakdown.test.ts`:

```ts
import { feeBreakdown } from "./feeBreakdown";

const fees = (shipping_cost: number | null, advertising_fee: number | null, platform_fee: number | null) => ({
  shipping_cost,
  advertising_fee,
  platform_fee,
});

describe("feeBreakdown", () => {
  it("returns null when every fee is null", () => {
    expect(feeBreakdown(fees(null, null, null))).toBeNull();
  });

  it("lists all three fees in a fixed order with their total", () => {
    expect(feeBreakdown(fees(4.99, 1.5, 3))).toEqual({
      lines: [
        { label: "Shipping", amount: 4.99 },
        { label: "Advertising", amount: 1.5 },
        { label: "Platform fee", amount: 3 },
      ],
      total: 9.49,
    });
  });

  it("keeps null fees as null lines and treats them as 0 in the total", () => {
    expect(feeBreakdown(fees(null, 2, null))).toEqual({
      lines: [
        { label: "Shipping", amount: null },
        { label: "Advertising", amount: 2 },
        { label: "Platform fee", amount: null },
      ],
      total: 2,
    });
  });

  it("treats an explicit 0 as a value, not missing", () => {
    expect(feeBreakdown(fees(0, null, null))?.total).toBe(0);
  });

  it("rounds the total to cents", () => {
    expect(feeBreakdown(fees(0.1, 0.2, null))?.total).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/dashboard/sales/_lib/feeBreakdown.test.ts`
Expected: FAIL — `Cannot find module './feeBreakdown'`.

- [ ] **Step 3: Write minimal implementation**

`src/app/dashboard/sales/_lib/feeBreakdown.ts`:

```ts
import type { Sale } from "@/types";

export interface FeeBreakdown {
  lines: { label: string; amount: number | null }[];
  total: number;
}

/**
 * Seller-cost fee lines for the Orders expanded row. Same sum as the old
 * "Fees" column (shipping_cost + advertising_fee + platform_fee);
 * shipping_charged is buyer-facing and deliberately excluded.
 * Null when no fee is recorded.
 */
export function feeBreakdown(
  sale: Pick<Sale, "shipping_cost" | "advertising_fee" | "platform_fee">,
): FeeBreakdown | null {
  const lines = [
    { label: "Shipping", amount: sale.shipping_cost },
    { label: "Advertising", amount: sale.advertising_fee },
    { label: "Platform fee", amount: sale.platform_fee },
  ];
  if (lines.every((l) => l.amount == null)) return null;
  const total = Math.round(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0) * 100) / 100;
  return { lines, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/dashboard/sales/_lib/feeBreakdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Rework the Orders `columns` array in `page.tsx`**

Add the import next to the other `./_components` / `./_lib` imports:

```ts
import { feeBreakdown } from "./_lib/feeBreakdown";
```

In the `columns` array (starts at `const columns = [`, around line 252), make these edits. Leave **Date**, **Product**, **Status**, **Total** and **Actions** exactly as they are.

1. **Platform**: badge only, without the marketplace line. Replace its `render` with:

```tsx
      render: (s: Sale) => <PlatformBadge platform={s.platform} />,
```

2. **Marketplace**: new detail column, inserted directly after Platform:

```tsx
    {
      header: "Marketplace",
      detail: true,
      render: (s: Sale) => s.marketplace ?? "—",
    },
```

3. **Account** (inside the `showAccounts ? [...] : []` spread): add `detail: true,` after `header: "Account",` and remove its `sortValue` line. Leave `render` unchanged.

4. **Qty**, **Unit Price**, **VAT**: add `detail: true,` after each `header:` line and remove each one's `sortValue` line. Leave `render` unchanged.

5. **Fees**: replace the whole column object with:

```tsx
    {
      header: "Fees",
      detail: true,
      render: (s: Sale) => {
        const fees = feeBreakdown(s);
        if (!fees) return <span className="text-sm text-[var(--color-text-muted)]">—</span>;
        return (
          <div className="space-y-0.5 text-sm tabular-nums">
            {fees.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-4">
                <span className="text-[var(--color-text-muted)]">{line.label}</span>
                <span className="text-[var(--color-text-base)]">
                  {line.amount == null ? "—" : formatCurrency(line.amount, s.currency)}
                </span>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-0.5 font-semibold">
              <span className="text-[var(--color-text-base)]">Total</span>
              <span className="text-[var(--color-text-strong)]">{formatCurrency(fees.total, s.currency)}</span>
            </div>
          </div>
        );
      },
    },
```

Column order in the array after the edit: Date, Product, Platform, Marketplace*, Account* (conditional), Status, Qty*, Unit Price*, Total, VAT*, Fees*, Actions (`*` = detail). The inline header then reads **Date · Product · Platform · Status · Total · Actions**. The panel reads **Marketplace · Account · Qty · Unit Price · VAT · Fees**.

The `<DataTable … />` JSX (around line 503) needs no change.

- [ ] **Step 6: Update sales docs (same commit)**

`src/app/dashboard/sales/CLAUDE.md`: in the `_lib/` file map (next to the `_lib/importDispatch.ts` and `_lib/salesSummaryTiles.ts` bullets), add:

```markdown
- `_lib/feeBreakdown.ts` (+ colocated `.test.ts`) — pure
  `feeBreakdown(sale)` → `{ lines: [Shipping, Advertising, Platform fee], total }`
  or `null` when all three are null. Rendered as the "Fees" field of the
  Orders table's expanded row panel.
```

Then, below the existing **DataTable sorting** note (near line 326), add:

```markdown
**Expandable rows** (2026-10-21): the Orders table shows Date, Product,
Platform, Status, Total and Actions inline. Marketplace, Account, Qty, Unit
Price, VAT and Fees are `detail: true` columns that render in the shared
`DataTable`'s chevron-expanded panel, so they are not header-sortable.
```

`src/app/dashboard/sales/SKILL.md`:
- In `## Minimal file set for common changes`, add:

```markdown
- **Move an Orders column between the main row and the expanded panel**:
  `page.tsx` only. Toggle `detail: true` on the column object (and drop its
  `sortValue` when it becomes detail, because detail columns aren't sortable).
  Fee breakdown copy and maths: `_lib/feeBreakdown.ts` (+ test).
```

- In `## Gotchas — fee fields`, replace the bullet that starts `- The table "Fees" column sums` with:

```markdown
- The Orders expanded-row "Fees" field (`_lib/feeBreakdown.ts`) lists
  `shipping_cost`, `advertising_fee` and `platform_fee` separately, plus their
  sum (seller costs). `shipping_charged` is not in the sum. It's the
  buyer-facing amount and appears only in the CSV export.
```

- In the gotcha `- **DataTable column sorting is page-local**`, append this sentence: `Detail (expanded-panel) columns — Qty, Unit Price, VAT, Fees, Account, Marketplace — aren't sortable at all.`

- [ ] **Step 7: Run the sales tests**

Run: `npx jest dashboard/sales`
Expected: PASS (including the new `feeBreakdown.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/sales/_lib/feeBreakdown.ts src/app/dashboard/sales/_lib/feeBreakdown.test.ts src/app/dashboard/sales/page.tsx src/app/dashboard/sales/CLAUDE.md src/app/dashboard/sales/SKILL.md
git commit -m "feat(sales): expandable Orders rows with fee breakdown

Main row keeps Date, Product, Platform, Status, Total, Actions; Marketplace,
Account, Qty, Unit Price, VAT and a per-fee breakdown move to the expanded
panel, removing the horizontal scroll.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Check in the browser.** If the Playwright MCP is connected and `npm run dev` is already running (it was at plan time), drive `/dashboard/sales`. Otherwise ask the user to check these:
  1. At a 1280px-wide window, Orders shows a chevron plus Date, Product, Platform, Status, Total and Actions, with no horizontal scrollbar.
  2. Clicking the chevron opens a panel with Marketplace, Account (multi-account tenants only), Qty, Unit Price, VAT and Fees (per-line breakdown plus total). The chevron rotates. Clicking it again closes the panel.
  3. Several rows can be open at once. Sorting by Date or Total keeps open rows open.
  4. Moving to the next page shows all rows collapsed.
  5. Row checkboxes, select-all, the invoice action, Edit, Delete and the Product link all still work.
  6. An untouched table (e.g. `/dashboard/expenses`) has no chevron column and looks the same as before.
  7. Tabbing reaches the chevron button and Enter/Space toggles it.

- [ ] **Step 2: Report.** Say which checks were run, and how (Playwright or the user), and what was seen. Fix any failure with a new commit on this branch before opening a PR.
