# Dropshipping Table Filters + Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add margin-health + search filters and column sorting (via the shared `DataTable`) to the Dropshipping listings table.

**Architecture:** A new pure filter-matching module, plus a rewrite of `ListingsTable.tsx`'s table body from raw shadcn `Table` primitives to the shared `DataTable` component (which already supports per-column sorting). All state (filters, pagination, sort) stays client-side inside `ListingsTable.tsx` — this feature already uses client-side pagination only.

**Tech Stack:** Next.js App Router, Redux Toolkit (read-only here), Jest + ts-jest (`testEnvironment: "node"` — no DOM/RTL; only the new pure module gets unit tests).

## Global Constraints

- Never run `npm test`/`npx jest`/`npx tsc --noEmit`/`npm run lint` yourself mid-task if you are the primary session assistant executing this plan directly — write/extend tests, then ask the user to run the given command and paste output back. **Exception**: if executed via subagent-driven-development, implementer/reviewer/fixer subagents run their own tests inside their isolated context and report results.
- **This repo's `.husky/pre-commit` hook runs `npx tsc --noEmit` then `npm run lint` on EVERY commit, with zero exceptions. Never bypass it with `--no-verify` or any flag. If it fails, find and fix the actual reported errors — even in files outside this plan's stated list — and commit again normally.** A prior task on this branch had a subagent violate this; it must not recur.
- Never commit directly to `main`. Continue on `feat/dropshipping-margin-customs-tax` (already checked out) — this feature builds directly on that branch's not-yet-merged `marginMath.ts`/`SupplierPriceCell` work.
- `DataTable` (`src/components/ui/DataTable.tsx`) supports exactly one `sortValue` per column header — this is why the checked date is split into its own "Last Checked" column rather than sharing a sort key with "AliExpress Price" (margin).
- Sortable columns: **eBay Price** (by `current_price`), **AliExpress Price** (by `computeMarginPct(listing) ?? -Infinity`), **Last Checked** (by `supplier_price_checked_at ?? ""`). Title/Image/SKU/Source/Actions stay unsorted.
- Filters: **Margin Health** (`all`/`danger`/`warning`/`success`, reusing `marginBadgeVariant`'s existing thresholds) and **Search** (title or SKU, case-insensitive substring, no debounce — in-memory filter). No currency or source-platform filter.
- Do not use the shared `FilterBar` component — its date-preset props are mandatory and irrelevant here. Build a small bespoke filter row matching its visual style instead.
- Sorting is page-local (rows are paginated before being handed to `DataTable`) — this is an accepted, pre-existing limitation shared with Sales/Purchases/Expenses, not something to fix here.

---

### Task 1: Pure filter-matching helpers

**Files:**
- Create: `src/app/dashboard/dropshipping/_components/listingFilters.ts`
- Create: `src/app/dashboard/dropshipping/_components/listingFilters.test.ts`

**Interfaces:**
- Consumes: `computeMarginPct`, `marginBadgeVariant` from `./marginMath` (already exist on this branch).
- Produces: `type MarginFilterBand = "all" | "danger" | "warning" | "success"`; `matchesMarginFilter(listing: DropshipListing, band: MarginFilterBand): boolean`; `matchesListingSearch(listing: DropshipListing, term: string): boolean`. Both consumed by Task 2 (`ListingsTable.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/app/dashboard/dropshipping/_components/listingFilters.test.ts`:

```ts
import { matchesMarginFilter, matchesListingSearch } from "./listingFilters";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Wireless Charger",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 20,
  currency: "EUR",
  sku: "WC-001",
  source_url: null,
  source_platform: null,
  supplier_price: null,
  supplier_currency: null,
  supplier_price_checked_at: null,
  customs_tax_amount: 3,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});

describe("matchesMarginFilter", () => {
  it("matches everything when band is 'all', including listings with no margin", () => {
    expect(matchesMarginFilter(makeListing(), "all")).toBe(true);
  });

  it("excludes a listing with no computed margin from any specific band", () => {
    const listing = makeListing({ supplier_price: null });
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'danger' for margin below 10%", () => {
    // effective_cost = 16 + 3 = 19; (20 - 19) / 20 * 100 = 5
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "danger")).toBe(true);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'warning' for margin between 10% and 25%", () => {
    // effective_cost = 14 + 3 = 17; (20 - 17) / 20 * 100 = 15
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 14,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "warning")).toBe(true);
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "success")).toBe(false);
  });

  it("matches 'success' for margin at or above 25%", () => {
    // effective_cost = 10 + 3 = 13; (20 - 13) / 20 * 100 = 35
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 10,
      supplier_currency: "EUR",
      customs_tax_amount: 3,
    });
    expect(matchesMarginFilter(listing, "success")).toBe(true);
    expect(matchesMarginFilter(listing, "danger")).toBe(false);
    expect(matchesMarginFilter(listing, "warning")).toBe(false);
  });
});

describe("matchesListingSearch", () => {
  it("matches everything when the search term is empty or whitespace", () => {
    expect(matchesListingSearch(makeListing(), "")).toBe(true);
    expect(matchesListingSearch(makeListing(), "   ")).toBe(true);
  });

  it("matches on title, case-insensitively", () => {
    const listing = makeListing({ title: "Wireless Charger" });
    expect(matchesListingSearch(listing, "wireless")).toBe(true);
    expect(matchesListingSearch(listing, "CHARGER")).toBe(true);
    expect(matchesListingSearch(listing, "keyboard")).toBe(false);
  });

  it("matches on sku, case-insensitively", () => {
    const listing = makeListing({ sku: "WC-001" });
    expect(matchesListingSearch(listing, "wc-001")).toBe(true);
    expect(matchesListingSearch(listing, "xyz")).toBe(false);
  });

  it("does not crash when sku is null", () => {
    const listing = makeListing({ sku: null });
    expect(matchesListingSearch(listing, "wireless")).toBe(true);
    expect(matchesListingSearch(listing, "anything-else")).toBe(false);
  });
});
```

- [ ] **Step 2: Ask the user to confirm the tests fail**

Ask the user to run: `npx jest dashboard/dropshipping/_components/listingFilters`
Expected: FAIL — `listingFilters.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard/dropshipping/_components/listingFilters.ts`:

```ts
import type { DropshipListing } from "@/types";
import { computeMarginPct, marginBadgeVariant } from "./marginMath";

export type MarginFilterBand = "all" | "danger" | "warning" | "success";

/**
 * A listing with no computed margin (no supplier price yet, or a
 * currency mismatch) never matches a specific band — only "all".
 */
export function matchesMarginFilter(listing: DropshipListing, band: MarginFilterBand): boolean {
  if (band === "all") return true;
  const marginPct = computeMarginPct(listing);
  if (marginPct === null) return false;
  return marginBadgeVariant(marginPct) === band;
}

export function matchesListingSearch(listing: DropshipListing, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    listing.title.toLowerCase().includes(needle) ||
    (listing.sku?.toLowerCase().includes(needle) ?? false)
  );
}
```

- [ ] **Step 4: Ask the user to confirm the tests pass**

Ask the user to run: `npx jest dashboard/dropshipping/_components/listingFilters`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dropshipping/_components/listingFilters.ts src/app/dashboard/dropshipping/_components/listingFilters.test.ts
git commit -m "feat: add pure margin/search filter helpers for dropshipping listings"
```

---

### Task 2: Filter row + DataTable sorting in `ListingsTable.tsx`

**Files:**
- Modify: `src/app/dashboard/dropshipping/_components/ListingsTable.tsx`
- Modify: `src/app/dashboard/dropshipping/CLAUDE.md`
- Modify: `src/app/dashboard/dropshipping/SKILL.md`

**Interfaces:**
- Consumes: `matchesMarginFilter`, `matchesListingSearch`, `MarginFilterBand` (Task 1); `computeMarginPct`, `marginBadgeVariant` (already on this branch, unchanged); shared `DataTable` (`src/components/ui/DataTable.tsx`, existing `{ columns, rows, keyField, emptyMessage? }` props — no changes to that file).
- Produces: nothing consumed elsewhere — `page.tsx` is unchanged, still just passes `listings`.

No test file for this task — `ListingsTable.tsx` is a client component with no existing test (zero `.test.tsx` files in this codebase). Verification is manual (Step 3).

- [ ] **Step 1: Rewrite `ListingsTable.tsx`**

Replace the imports and the `DEFAULT_PAGE_SIZE` constant (current lines 1-26 — everything from the top of the file through `const DEFAULT_PAGE_SIZE = 25;`, i.e. everything before `interface ListingsTableProps`):

```tsx
"use client";

import { useState, useMemo } from "react";
import { ImageIcon, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils/currency";
import { isAliExpressSku, aliExpressUrlFromSku } from "@/lib/utils/detectPlatform";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { updateSupplierPrices } from "../_store/dropshippingSlice";
import { computeMarginPct, marginBadgeVariant } from "./marginMath";
import { matchesMarginFilter, matchesListingSearch, type MarginFilterBand } from "./listingFilters";
import { EditSourceModal } from "./EditSourceModal";
import type { DropshipListing, Currency } from "@/types";

const DEFAULT_PAGE_SIZE = 25;

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";
```

(The `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow` import from `@/components/ui/table` is removed entirely — no longer used.)

Remove the checked-date `<span>` from `SupplierPriceCell` (it moves to its own column) — replace the whole function (current lines 47-81):

```tsx
function SupplierPriceCell({ listing }: { listing: DropshipListing }) {
  if (listing.supplier_price == null) {
    return <span className="text-[var(--color-text-faint)]">—</span>;
  }

  const marginPct = computeMarginPct(listing);
  const roundedMarginPct = marginPct !== null ? Math.round(marginPct) : null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[var(--color-text-base)]">
        {formatCurrency(listing.supplier_price, listing.supplier_currency as Currency)}
      </span>
      <span className="text-xs text-[var(--color-text-faint)]">
        Customs: {formatCurrency(listing.customs_tax_amount, listing.supplier_currency as Currency)}
      </span>
      {roundedMarginPct !== null && (
        <div>
          <Badge
            label={`${roundedMarginPct}% margin`}
            variant={marginBadgeVariant(roundedMarginPct)}
          />
        </div>
      )}
    </div>
  );
}
```

`SourceBadge` (current lines 83-129) is unchanged.

Replace the whole `ListingsTable` function (current lines 131-291):

```tsx
export function ListingsTable({ listings }: ListingsTableProps) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [editTarget, setEditTarget] = useState<DropshipListing | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [marginFilter, setMarginFilter] = useState<MarginFilterBand>("all");
  const [search, setSearch] = useState("");
  const hasActiveFilters = marginFilter !== "all" || search.trim() !== "";

  async function handleCheckPrice(listing: DropshipListing) {
    setCheckingId(listing.id);
    try {
      const res = await fetch("/api/dropshipping/listings/check-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listing.id }),
      });
      const json = (await res.json()) as { results?: PriceCheckResult[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Price check failed");

      const result = json.results?.[0];
      if (!result?.ok || result.supplier_price == null) {
        throw new Error(result?.error ?? "Price check failed");
      }

      dispatch(
        updateSupplierPrices([
          {
            id: result.id,
            supplier_price: result.supplier_price,
            supplier_currency: result.supplier_currency ?? "EUR",
            supplier_price_checked_at:
              result.supplier_price_checked_at ?? new Date().toISOString(),
          },
        ])
      );
      success("AliExpress price updated.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Price check failed");
    } finally {
      setCheckingId(null);
    }
  }

  const filteredListings = useMemo(
    () =>
      listings.filter(
        (l) => matchesMarginFilter(l, marginFilter) && matchesListingSearch(l, search)
      ),
    [listings, marginFilter, search]
  );

  const pagedListings = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredListings.slice(start, start + pageSize);
  }, [filteredListings, page, pageSize]);

  if (listings.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          No listings found. Click <strong>Refresh from eBay</strong> to import your active listings.
        </p>
      </div>
    );
  }

  const columns = [
    {
      header: "Image",
      className: "w-14",
      render: (listing: DropshipListing) =>
        listing.image_url ? (
          <img
            src={listing.image_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded bg-[var(--color-surface-subtle)]">
            <ImageIcon size={20} className="text-[var(--color-text-faint)]" />
          </div>
        ),
    },
    {
      header: "Title",
      className: "max-w-[240px]",
      render: (listing: DropshipListing) => (
        <a
          href={listing.ebay_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-[var(--color-text-base)] hover:text-[var(--color-primary)] hover:underline line-clamp-2"
        >
          {listing.title}
        </a>
      ),
    },
    {
      header: "eBay Price",
      className: "w-28",
      sortValue: (listing: DropshipListing) => listing.current_price,
      render: (listing: DropshipListing) => (
        <span className="text-sm text-[var(--color-text-base)]">
          {formatCurrency(listing.current_price, listing.currency as Currency)}
        </span>
      ),
    },
    {
      header: "AliExpress Price",
      className: "w-36",
      sortValue: (listing: DropshipListing) => computeMarginPct(listing) ?? -Infinity,
      render: (listing: DropshipListing) => <SupplierPriceCell listing={listing} />,
    },
    {
      header: "Last Checked",
      className: "w-28",
      sortValue: (listing: DropshipListing) => listing.supplier_price_checked_at ?? "",
      render: (listing: DropshipListing) =>
        listing.supplier_price_checked_at ? (
          <span className="text-xs text-[var(--color-text-faint)]">
            {new Date(listing.supplier_price_checked_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-faint)]">—</span>
        ),
    },
    {
      header: "SKU",
      className: "w-32",
      render: (listing: DropshipListing) =>
        listing.sku ? (
          <span className="text-sm text-[var(--color-text-base)]">{listing.sku}</span>
        ) : (
          <span className="text-sm text-[var(--color-text-faint)]">—</span>
        ),
    },
    {
      header: "Source",
      render: (listing: DropshipListing) => <SourceBadge listing={listing} />,
    },
    {
      header: "Actions",
      className: "w-32 text-right",
      render: (listing: DropshipListing) => (
        <div className="flex items-center justify-end gap-1">
          {canCheckSupplierPrice(listing) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCheckPrice(listing)}
              disabled={checkingId !== null}
              title="Check AliExpress price"
              aria-label="Check AliExpress price"
            >
              <RefreshCw
                size={14}
                className={checkingId === listing.id ? "animate-spin" : ""}
              />
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditTarget(listing)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
            Margin Health
          </span>
          <select
            value={marginFilter}
            onChange={(e) => {
              setMarginFilter(e.target.value as MarginFilterBand);
              setPage(1);
            }}
            className={filterInputCls}
          >
            <option value="all">All</option>
            <option value="danger">Red (&lt;10%)</option>
            <option value="warning">Yellow (&lt;25%)</option>
            <option value="success">Green (&gt;=25%)</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
            Search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search title or SKU…"
            className={`${filterInputCls} w-full cursor-text`}
          />
        </div>
        {hasActiveFilters && (
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
              &nbsp;
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMarginFilter("all");
                setSearch("");
                setPage(1);
              }}
            >
              <X size={13} />
              Clear
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={pagedListings}
        keyField="id"
        emptyMessage="No listings match the current filters."
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={filteredListings.length}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      <EditSourceModal key={editTarget?.id ?? "none"} listing={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}
```

Note the removed `<div className="rounded-... overflow-hidden">` wrapper around the old `<Table>` — `DataTable` renders its own bordered/rounded wrapper internally (see `DataTable.tsx`'s outer `<div className="rounded-(--radius-card) border ...">`), so wrapping it again would double the border. Do not add an extra wrapper div around `<DataTable>`.

- [ ] **Step 2: Update `src/app/dashboard/dropshipping/CLAUDE.md`**

In the `_components/ListingsTable.tsx` bullet (under "Files in this folder"), append after the existing description (which ends "...actions (per-row AliExpress price-check icon button ... and Edit button opening `EditSourceModal`)."):

```
  **Filtering + sorting (client-side)**: a filter row above the table offers
  Margin Health (`all`/`danger`/`warning`/`success`, via `matchesMarginFilter`
  in `_components/listingFilters.ts`) and a Search box (title/SKU substring,
  via `matchesListingSearch`) — both pure, unit-tested helpers. The table
  body uses the shared `DataTable` component (not raw shadcn `Table`
  primitives) for column sorting: eBay Price (by price), AliExpress Price
  (by computed margin %, via `computeMarginPct`), and a dedicated "Last
  Checked" column (by `supplier_price_checked_at`) — split out from the
  AliExpress Price cell specifically because `DataTable` only supports one
  `sortValue` per column header. Filtering happens before pagination;
  sorting happens only within the current page (same limitation as Sales/
  Purchases/Expenses' `DataTable` usage).
```

- [ ] **Step 3: Append a gotcha to `src/app/dashboard/dropshipping/SKILL.md`**

Append to the end of the file:

```
- `ListingsTable.tsx` filters/sorts/paginates entirely client-side (small
  dataset). Order of operations: filter (`listingFilters.ts`) → paginate →
  hand the current page to `DataTable` for local sort. If you add a new
  filter, filter `listings` before `pagedListings` is computed, not after —
  filtering after pagination would only filter the visible page instead of
  the whole list.
- `DataTable` supports exactly one `sortValue` per column — this is why the
  checked date has its own "Last Checked" column instead of sharing a sort
  key with the "AliExpress Price" (margin) column. Don't try to attach two
  sort behaviors to one header.
```

- [ ] **Step 4: Ask the user to manually verify in the browser**

Ask the user to open `/dashboard/dropshipping` and confirm: the Margin
Health dropdown narrows the table to the selected band; the Search box
matches on title and SKU; Clear resets both and hides itself; clicking the
eBay Price, AliExpress Price, and Last Checked column headers sorts
ascending/descending with an arrow icon; other columns have no sort arrow;
the table still renders images/links/badges/actions identically to before.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dropshipping/_components/ListingsTable.tsx src/app/dashboard/dropshipping/CLAUDE.md src/app/dashboard/dropshipping/SKILL.md
git commit -m "feat: add margin/search filters and column sorting to dropshipping table"
```

---

## Final check

After Task 2, the branch `feat/dropshipping-margin-customs-tax` has 2 more
commits on top of the customs-tax work already reviewed and approved. Ask
the user to run the full suite once at the end:

Ask the user to run: `npx jest` and `npx tsc --noEmit`
Expected: PASS, no regressions in unrelated feature tests.

Then run `graphify update .` per this project's `CLAUDE.md` rule and fold
the result into one commit. Given the prior customs-tax work on this same
branch already went through a full whole-branch review, a second full
whole-branch review for just these 2 small, additive, non-overlapping
commits is likely unnecessary — a per-task review after each (as this plan
already does) should suffice, but ask the user if they'd like the final
whole-branch review repeated anyway before finishing the branch.
