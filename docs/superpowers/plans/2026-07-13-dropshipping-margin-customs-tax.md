# Dropshipping Margin Coloring + EU Customs Tax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-listing EU customs tax rate to the Dropshipping feature and use it to compute a proper percentage margin (color-coded red/yellow/green) on the "AliExpress Price" column, replacing today's raw currency-delta display.

**Architecture:** Two new nullable columns on `tenant_kaufnest.dropship_listings` (`customs_tax_rate`, `customs_tax_amount`), a pure colocated margin-calculation helper, a `Badge`-based UI treatment in `ListingsTable.tsx`, an editable field in `EditSourceModal.tsx`, and recompute-on-refresh logic in the two places that update `supplier_price` from a scrape.

**Tech Stack:** Next.js App Router, Redux Toolkit, Supabase (Postgres/PostgREST), Playwright (local scrape script), Jest + ts-jest (`testEnvironment: "node"` — no DOM/RTL; only pure functions and reducers are unit-tested here).

## Global Constraints

- Never run `npm test`/`npx jest`/`npx tsc --noEmit`/`npm run lint` yourself mid-task if you are the primary session assistant executing this plan directly — per this project's working agreement (`AGENTS.md`), write/extend tests then ask the user to run the given command and paste output back. **Exception**: if this plan is executed via subagent-driven-development, implementer/reviewer/fixer subagents run their own tests inside their isolated context and report results — this was the explicit choice made for the previous plan on this project and applies equally here unless the user says otherwise for this run.
- Never commit directly to `main`. All work happens on `feat/dropshipping-margin-customs-tax` (already checked out).
- Follow the "Mandatory docs update" rule in the root `AGENTS.md`: every task that touches a feature's code also updates that feature's `CLAUDE.md`/`SKILL.md` in the same commit.
- `tenant_kaufnest.dropship_listings` is a documented exception to the "2 places" tenant-schema DDL rule — it is KaufNest-only, excluded from `provision_tenant_schema()`, so the new migration uses a direct `ALTER TABLE tenant_kaufnest.dropship_listings`, **not** `run_on_all_tenant_schemas`.
- Margin thresholds (exact values from the spec): `< 10%` → `danger` (red), `< 25%` → `warning` (yellow), `>= 25%` → `success` (neutral/green).
- Margin formula: `effective_cost = supplier_price + (customs_tax_amount ?? 0)`, `margin_pct = (current_price - effective_cost) / current_price * 100`. Only computed when `supplier_currency === currency` (same gate as today's `sameCurrency` check) — otherwise no badge is shown, same as today.
- `customs_tax_amount = supplier_price * customs_tax_rate / 100`, always derived, never entered directly.
- `MarginBadge` stays feature-private (dropshipping `_components/`), not added to the shared `src/components/ui/Badge.tsx` — it's used by exactly one feature.
- No stock/quantity tracking in this plan (explicitly deferred per the spec).

---

### Task 1: Migration + `DropshipListing` type

**Files:**
- Create: `supabase/migrations/020_dropship_customs_tax.sql`
- Modify: `src/types/index.ts:222-238` (`DropshipListing` interface)
- Modify: `supabase/SKILL.md` (file map + apply status table)
- Modify: `supabase/CLAUDE.md` (file list)

**Interfaces:**
- Produces: `DropshipListing.customs_tax_rate: number | null`, `DropshipListing.customs_tax_amount: number | null`. Consumed by every later task.

No test file for this task — it's a schema/type change with no logic to unit test (matches how the earlier `018_expense_vendor_fields.sql`/`019_dropship_supplier_price.sql` migrations had no dedicated test either).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/020_dropship_customs_tax.sql`:

```sql
-- ============================================================
-- Migration 020: EU customs tax on dropship listings
-- (tenant_kaufnest ONLY — see 019_dropship_supplier_price.sql's header
-- comment: dropship_listings is deliberately excluded from
-- provision_tenant_schema() and run_on_all_tenant_schemas, since this
-- is a platform-admin-only feature customised to the KaufNest tenant.)
--
-- Adds a per-listing customs tax rate (entered manually — rates vary by
-- product category/TARIC code, no sensible company-wide default) and a
-- derived amount column, so the margin calculation can account for the
-- EU's removal of the duty-free de minimis threshold on low-value imports.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE tenant_kaufnest.dropship_listings
  ADD COLUMN IF NOT EXISTS customs_tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS customs_tax_amount NUMERIC(12,2);
```

- [ ] **Step 2: Update the `DropshipListing` type**

In `src/types/index.ts`, replace lines 222-238:

```ts
export interface DropshipListing {
  id: string;
  ebay_listing_id: string;
  title: string;
  image_url: string | null;
  ebay_url: string;
  current_price: number;
  currency: string;
  sku: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  supplier_price: number | null;
  supplier_currency: string | null;
  supplier_price_checked_at: string | null;
  customs_tax_rate: number | null;
  customs_tax_amount: number | null;
  last_synced_at: string;
  created_at: string;
}
```

- [ ] **Step 3: Ask the user to confirm nothing broke**

Ask the user to run: `npx tsc --noEmit`
Expected: FAIL at this point — every place that constructs a `DropshipListing` object literal (test helpers, mock data) is now missing two required fields. Task 2's new test file already includes them (written fresh in this plan), but `dropshippingSlice.test.ts`'s existing `makeListing` helper does not yet — that's fixed in Task 4. This is expected; if other unexpected errors appear (not related to missing `customs_tax_rate`/`customs_tax_amount` on `DropshipListing` literals), stop and investigate before continuing.

- [ ] **Step 4: Update `supabase/SKILL.md`**

In the "File map + apply status" table, add a row after the `019` line (find it via the existing `migrations/019_dropship_supplier_price.sql` reference — there may not be a dedicated table row for 019 either; if there is, follow its exact format; if not, add both as new rows):

```
| `migrations/020_dropship_customs_tax.sql` | `tenant_kaufnest.dropship_listings` | ⏳ **pending** — adds `customs_tax_rate`/`customs_tax_amount` nullable columns, direct `ALTER TABLE` (documented KaufNest-only exception to the "2 places" rule, same as 019) |
```

- [ ] **Step 5: Update `supabase/CLAUDE.md`**

Add a bullet to the "Files" list, after the line describing `migrations/013_backfill_all_tenants.sql` (or after whichever migration is listed last):

```
- `migrations/020_dropship_customs_tax.sql` — adds `customs_tax_rate`/
  `customs_tax_amount` nullable columns to `tenant_kaufnest.dropship_listings`
  directly (not via `run_on_all_tenant_schemas` — this table is KaufNest-only,
  same documented exception as `019_dropship_supplier_price.sql`). Backs the
  margin-coloring UI in `src/app/dashboard/dropshipping/`.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/020_dropship_customs_tax.sql src/types/index.ts supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat: add customs_tax_rate/customs_tax_amount to dropship_listings"
```

---

### Task 2: Pure margin calculation helper

**Files:**
- Create: `src/app/dashboard/dropshipping/_components/marginMath.ts`
- Create: `src/app/dashboard/dropshipping/_components/marginMath.test.ts`

**Interfaces:**
- Consumes: `DropshipListing` type (Task 1).
- Produces: `computeMarginPct(listing: DropshipListing): number | null`, `marginBadgeVariant(marginPct: number): "success" | "warning" | "danger"`. Consumed by Task 3 (`ListingsTable.tsx`).

This mirrors the existing extraction pattern in this codebase (`orderMath.ts`, `resolveInitialSourceUrl.ts`) — pure logic pulled out of a component so it's unit-testable without rendering.

- [ ] **Step 1: Write the failing tests**

Create `src/app/dashboard/dropshipping/_components/marginMath.test.ts`:

```ts
import { computeMarginPct, marginBadgeVariant } from "./marginMath";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Test Listing",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 25.99,
  currency: "EUR",
  sku: "SKU-001",
  source_url: null,
  source_platform: null,
  supplier_price: null,
  supplier_currency: null,
  supplier_price_checked_at: null,
  customs_tax_rate: null,
  customs_tax_amount: null,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});

describe("computeMarginPct", () => {
  it("returns null when supplier_price is not set", () => {
    const listing = makeListing({ supplier_price: null });
    expect(computeMarginPct(listing)).toBeNull();
  });

  it("returns null when currencies do not match", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 10,
      supplier_currency: "USD",
    });
    expect(computeMarginPct(listing)).toBeNull();
  });

  it("computes gross margin percentage without customs tax", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_rate: null,
      customs_tax_amount: null,
    });
    // (20 - 16) / 20 * 100 = 20
    expect(computeMarginPct(listing)).toBeCloseTo(20);
  });

  it("factors customs_tax_amount into effective cost", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_rate: 12.5,
      customs_tax_amount: 2, // 16 * 12.5 / 100 = 2
    });
    // effective_cost = 16 + 2 = 18; (20 - 18) / 20 * 100 = 10
    expect(computeMarginPct(listing)).toBeCloseTo(10);
  });

  it("allows a negative margin when cost exceeds selling price", () => {
    const listing = makeListing({
      current_price: 10,
      currency: "EUR",
      supplier_price: 9,
      supplier_currency: "EUR",
      customs_tax_rate: 20,
      customs_tax_amount: 1.8,
    });
    // effective_cost = 9 + 1.8 = 10.8; (10 - 10.8) / 10 * 100 = -8
    expect(computeMarginPct(listing)).toBeCloseTo(-8);
  });
});

describe("marginBadgeVariant", () => {
  it("returns danger below 10%", () => {
    expect(marginBadgeVariant(9.99)).toBe("danger");
    expect(marginBadgeVariant(-5)).toBe("danger");
  });

  it("returns warning at exactly 10% and below 25%", () => {
    expect(marginBadgeVariant(10)).toBe("warning");
    expect(marginBadgeVariant(24.99)).toBe("warning");
  });

  it("returns success at exactly 25% and above", () => {
    expect(marginBadgeVariant(25)).toBe("success");
    expect(marginBadgeVariant(50)).toBe("success");
  });
});
```

- [ ] **Step 2: Ask the user to confirm the tests fail**

Ask the user to run: `npx jest dashboard/dropshipping/_components/marginMath`
Expected: FAIL — `marginMath.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard/dropshipping/_components/marginMath.ts`:

```ts
import type { DropshipListing } from "@/types";

/**
 * Gross margin percentage: (sell − effective cost) / sell × 100, where
 * effective cost includes the EU customs tax amount on top of the supplier
 * price. Returns null when there's no supplier price yet, or when the
 * supplier and selling currencies don't match (comparison would be
 * misleading without a conversion rate).
 */
export function computeMarginPct(listing: DropshipListing): number | null {
  if (listing.supplier_price == null) return null;
  if (listing.supplier_currency !== listing.currency) return null;

  const effectiveCost = listing.supplier_price + (listing.customs_tax_amount ?? 0);
  return ((listing.current_price - effectiveCost) / listing.current_price) * 100;
}

export function marginBadgeVariant(marginPct: number): "success" | "warning" | "danger" {
  if (marginPct < 10) return "danger";
  if (marginPct < 25) return "warning";
  return "success";
}
```

- [ ] **Step 4: Ask the user to confirm the tests pass**

Ask the user to run: `npx jest dashboard/dropshipping/_components/marginMath`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dropshipping/_components/marginMath.ts src/app/dashboard/dropshipping/_components/marginMath.test.ts
git commit -m "feat: add pure margin calculation helper for dropshipping listings"
```

---

### Task 3: `SupplierPriceCell` rewrite (badge + tax breakdown)

**Files:**
- Modify: `src/app/dashboard/dropshipping/_components/ListingsTable.tsx:45-77` (`SupplierPriceCell`)
- Modify: `src/app/dashboard/dropshipping/CLAUDE.md`
- Modify: `src/app/dashboard/dropshipping/SKILL.md`

**Interfaces:**
- Consumes: `computeMarginPct`, `marginBadgeVariant` (Task 2); shared `Badge` component (`src/components/ui/Badge.tsx`, existing `{ label, variant }` props — no changes to that file).
- Produces: nothing new consumed by later tasks (Task 4/5 don't depend on this cell's rendering).

- [ ] **Step 1: Rewrite `SupplierPriceCell`**

In `src/app/dashboard/dropshipping/_components/ListingsTable.tsx`, add to the imports (near the top, alongside the existing `cn`/`formatCurrency` imports):

```tsx
import { Badge } from "@/components/ui/Badge";
import { computeMarginPct, marginBadgeVariant } from "./marginMath";
```

Replace `SupplierPriceCell` (current lines 45-77):

```tsx
function SupplierPriceCell({ listing }: { listing: DropshipListing }) {
  if (listing.supplier_price == null) {
    return <span className="text-[var(--color-text-faint)]">—</span>;
  }

  const marginPct = computeMarginPct(listing);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[var(--color-text-base)]">
        {formatCurrency(listing.supplier_price, listing.supplier_currency as Currency)}
      </span>
      {listing.customs_tax_rate != null && (
        <span className="text-xs text-[var(--color-text-faint)]">
          Customs: {listing.customs_tax_rate}%
          {listing.customs_tax_amount != null && (
            <> ({formatCurrency(listing.customs_tax_amount, listing.supplier_currency as Currency)})</>
          )}
        </span>
      )}
      {marginPct !== null && (
        <div>
          <Badge
            label={`${Math.round(marginPct)}% margin`}
            variant={marginBadgeVariant(marginPct)}
          />
        </div>
      )}
      {listing.supplier_price_checked_at && (
        <span className="text-xs text-[var(--color-text-faint)]">
          {new Date(listing.supplier_price_checked_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}
```

This removes the `cn(...)`/raw `text-green-600`/`text-red-600` usage from this
function — check whether `cn` is still used elsewhere in the file (it is, in
`SourceBadge`, lines 79-125) so the import stays; do not remove the `cn` import.

- [ ] **Step 2: Update `src/app/dashboard/dropshipping/CLAUDE.md`**

Find the bullet describing `ListingsTable.tsx`'s columns (it mentions
"AliExpress price (`SupplierPriceCell`: supplier price + margin vs eBay
price when currencies match + checked date)"). Replace that clause with:

```
AliExpress price (`SupplierPriceCell`: supplier price + customs tax
breakdown (rate/amount, when set) + a color-coded margin badge (`danger`
<10%, `warning` <25%, `success` >=25%, via `computeMarginPct`/
`marginBadgeVariant` in `_components/marginMath.ts`) when currencies match +
checked date)
```

Also add, in the same file, a new subsection after the "Data flow" section:

```
## Margin calculation (customs_tax_rate/customs_tax_amount)

`DropshipListing.customs_tax_rate`/`customs_tax_amount` (nullable, no
default — rates vary by product category) feed into the margin shown in
`SupplierPriceCell`: `effective_cost = supplier_price + customs_tax_amount`,
`margin_pct = (current_price - effective_cost) / current_price * 100`, only
computed when `supplier_currency === currency` (same gate as the old
raw-delta display). See `_components/marginMath.ts` for the pure
implementation (`computeMarginPct`, `marginBadgeVariant`) and its colocated
tests. Editable via `EditSourceModal.tsx`'s "Customs Tax Rate (%)" field.

**Sync safety**: `customs_tax_rate`/`customs_tax_amount` must survive an
eBay refresh (never touched — see `refresh/route.ts`'s row mapping, which
simply never includes them as keys) and must be recomputed whenever a fresh
AliExpress price check updates `supplier_price` (see `check-prices/route.ts`
and `scripts/aliexpress/scrape-prices.mjs`) — otherwise the tax amount goes
stale relative to the new cost snapshot.
```

- [ ] **Step 3: Append a gotcha to `src/app/dashboard/dropshipping/SKILL.md`**

Append to the end of the file:

```
- The margin badge in `SupplierPriceCell` is fed by
  `computeMarginPct`/`marginBadgeVariant` (`_components/marginMath.ts`, pure +
  unit-tested) — don't recompute margin math inline in the component; extend
  the pure helper instead so the tests stay meaningful.
- `customs_tax_amount` is always derived (`supplier_price × customs_tax_rate /
  100`) — never accept it as direct user input. Any code path that updates
  `supplier_price` (refresh, price-check route, the Playwright script) must
  also recompute `customs_tax_amount` if a rate is already set, or the two
  columns silently drift out of sync.
```

- [ ] **Step 4: Ask the user to manually verify in the browser**

Ask the user to open `/dashboard/dropshipping` and confirm: listings with a
supplier price show a margin badge in the right color; listings without a
supplier price still show "—"; listings with mismatched supplier/selling
currencies show no badge (same as before this change).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dropshipping/_components/ListingsTable.tsx src/app/dashboard/dropshipping/CLAUDE.md src/app/dashboard/dropshipping/SKILL.md
git commit -m "feat: show color-coded margin badge on dropshipping AliExpress price cell"
```

---

### Task 4: Slice — `updateCustomsTax` action + preserve/recompute logic

**Files:**
- Modify: `src/app/dashboard/dropshipping/_store/dropshippingSlice.ts`
- Modify: `src/app/dashboard/dropshipping/_store/dropshippingSlice.test.ts`

**Interfaces:**
- Consumes: `DropshipListing.customs_tax_rate`/`customs_tax_amount` (Task 1).
- Produces: `updateCustomsTax({ id, customsTaxRate, customsTaxAmount })` reducer action, consumed by Task 5's `EditSourceModal.tsx`. Comes before Task 5 specifically so Task 5 never references an action that doesn't exist yet.

- [ ] **Step 1: Add `updateCustomsTax` reducer + preserve fields in `upsertListings`**

In `src/app/dashboard/dropshipping/_store/dropshippingSlice.ts`, update the
`upsertListings` reducer (lines 17-36) to also preserve the two new columns:

```ts
upsertListings(state, action: PayloadAction<DropshipListing[]>) {
  for (const incoming of action.payload) {
    const index = state.listings.findIndex(
      (l) => l.ebay_listing_id === incoming.ebay_listing_id
    );
    if (index >= 0) {
      // Preserve supplier link, price snapshot, and customs tax — refresh must not overwrite them
      state.listings[index] = {
        ...incoming,
        source_url: state.listings[index].source_url,
        source_platform: state.listings[index].source_platform,
        supplier_price: state.listings[index].supplier_price,
        supplier_currency: state.listings[index].supplier_currency,
        supplier_price_checked_at: state.listings[index].supplier_price_checked_at,
        customs_tax_rate: state.listings[index].customs_tax_rate,
        customs_tax_amount: state.listings[index].customs_tax_amount,
      };
    } else {
      state.listings.push(incoming);
    }
  }
},
```

Add a new reducer after `updateListingSource` (after line 72, before the
closing `},` of the `reducers` object):

```ts
updateCustomsTax(
  state,
  action: PayloadAction<{ id: string; customsTaxRate: number | null; customsTaxAmount: number | null }>
) {
  const listing = state.listings.find((l) => l.id === action.payload.id);
  if (listing) {
    listing.customs_tax_rate = action.payload.customsTaxRate;
    listing.customs_tax_amount = action.payload.customsTaxAmount;
  }
},
```

Update the export line (line 76-77):

```ts
export const { hydrateListings, upsertListings, updateSupplierPrices, updateListingSource, updateCustomsTax } =
  dropshippingSlice.actions;
```

Also update `updateSupplierPrices` (the reducer that runs after a
single-listing price check via the UI's "Check AliExpress price" button —
lines 37-62): when it sets a new `supplier_price`, recompute
`customs_tax_amount` if the listing already has a `customs_tax_rate`:

```ts
updateSupplierPrices(
  state,
  action: PayloadAction<
    Array<{
      id: string;
      supplier_price: number;
      supplier_currency: string;
      supplier_price_checked_at: string;
      source_url?: string;
      source_platform?: SourcePlatform;
    }>
  >
) {
  for (const update of action.payload) {
    const listing = state.listings.find((l) => l.id === update.id);
    if (!listing) continue;
    listing.supplier_price = update.supplier_price;
    listing.supplier_currency = update.supplier_currency;
    listing.supplier_price_checked_at = update.supplier_price_checked_at;
    if (listing.customs_tax_rate != null) {
      listing.customs_tax_amount =
        Math.round(listing.supplier_price * listing.customs_tax_rate) / 100;
    }
    // The API derives+persists source_url from a numeric SKU on first check
    if (update.source_url && !listing.source_url) {
      listing.source_url = update.source_url;
      listing.source_platform = update.source_platform ?? "aliexpress";
    }
  }
},
```

- [ ] **Step 2: Update `dropshippingSlice.test.ts`**

Update `makeListing`'s defaults (lines 10-27) to include the two new fields:

```ts
const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Test Listing",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 25.99,
  currency: "EUR",
  sku: "SKU-001",
  source_url: null,
  source_platform: null,
  supplier_price: null,
  supplier_currency: null,
  supplier_price_checked_at: null,
  customs_tax_rate: null,
  customs_tax_amount: null,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});
```

Update the import at the top (lines 1-8) to include `updateCustomsTax`:

```ts
import {
  dropshippingSlice,
  hydrateListings,
  upsertListings,
  updateListingSource,
  updateSupplierPrices,
  updateCustomsTax,
} from "./dropshippingSlice";
```

Add these new test cases (after the existing "upsertListings preserves
supplier price snapshot on refresh" test, i.e. after line 96):

```ts
it("upsertListings preserves customs tax fields on refresh", () => {
  const existing = makeListing({
    customs_tax_rate: 12.5,
    customs_tax_amount: 2,
  });
  const state = { listings: [existing] };
  const refreshed = makeListing({ title: "New Title" }); // customs fields null
  const result = reducer(state, upsertListings([refreshed]));
  expect(result.listings[0].customs_tax_rate).toBe(12.5);
  expect(result.listings[0].customs_tax_amount).toBe(2);
});

it("updateCustomsTax sets rate and amount on the matching listing", () => {
  const listing1 = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
  const listing2 = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
  const state = { listings: [listing1, listing2] };
  const result = reducer(
    state,
    updateCustomsTax({ id: "uuid-1", customsTaxRate: 19, customsTaxAmount: 3.5 })
  );
  expect(result.listings[0].customs_tax_rate).toBe(19);
  expect(result.listings[0].customs_tax_amount).toBe(3.5);
  expect(result.listings[1].customs_tax_rate).toBeNull();
});

it("updateSupplierPrices recomputes customs_tax_amount when a rate is already set", () => {
  const listing = makeListing({
    id: "uuid-1",
    ebay_listing_id: "ebay-1",
    customs_tax_rate: 12.5,
    customs_tax_amount: 1, // stale, based on an old supplier_price
  });
  const state = { listings: [listing] };
  const result = reducer(
    state,
    updateSupplierPrices([
      {
        id: "uuid-1",
        supplier_price: 16,
        supplier_currency: "EUR",
        supplier_price_checked_at: "2026-07-10T00:00:00Z",
      },
    ])
  );
  // 16 * 12.5 = 200, rounded / 100 = 2
  expect(result.listings[0].customs_tax_amount).toBe(2);
});

it("updateSupplierPrices leaves customs_tax_amount null when no rate is set", () => {
  const listing = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
  const state = { listings: [listing] };
  const result = reducer(
    state,
    updateSupplierPrices([
      {
        id: "uuid-1",
        supplier_price: 16,
        supplier_currency: "EUR",
        supplier_price_checked_at: "2026-07-10T00:00:00Z",
      },
    ])
  );
  expect(result.listings[0].customs_tax_amount).toBeNull();
});
```

- [ ] **Step 3: Ask the user to confirm the slice tests pass**

Ask the user to run: `npx jest dashboard/dropshipping`
Expected: PASS (all existing + new tests).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/dropshipping/_store/dropshippingSlice.ts src/app/dashboard/dropshipping/_store/dropshippingSlice.test.ts
git commit -m "feat: add updateCustomsTax action and recompute logic to dropshipping slice"
```

---

### Task 5: Editable customs tax rate (modal + PATCH route)

**Files:**
- Modify: `src/app/dashboard/dropshipping/_components/EditSourceModal.tsx`
- Modify: `src/app/api/dropshipping/listings/[id]/route.ts`

**Interfaces:**
- Consumes: `DropshipListing.customs_tax_rate`/`customs_tax_amount` (Task 1); `updateCustomsTax` action (Task 4).
- Produces: nothing consumed by later tasks (Task 6 is independent).

No test file — `EditSourceModal.tsx` is a client component with no existing
test (this project has zero `.test.tsx` files); the PATCH route also has no
existing test. Verification is manual (Step 3, after the code changes).

- [ ] **Step 1: Add the input + save logic to `EditSourceModal.tsx`**

Add a new piece of local state and a computed `customsTaxAmount`.
`useState` is already imported (line 3); the only import change needed is
adding `updateCustomsTax` alongside `updateListingSource` (line 5), shown
further below.

Replace the `useState` declarations (lines 53-54):

```tsx
const [url, setUrl] = useState(() => resolveInitialSourceUrl(listing));
const [saving, setSaving] = useState(false);
const [customsTaxRate, setCustomsTaxRate] = useState<string>(
  () => listing?.customs_tax_rate?.toString() ?? ""
);
```

Replace `handleSave` (lines 56-86):

```tsx
async function handleSave() {
  if (!listing || url.trim() === "") return;
  setSaving(true);
  try {
    const rate = customsTaxRate.trim() === "" ? null : parseFloat(customsTaxRate);
    // supplier_price × rate gives a percentage-scaled number (e.g. 16 × 12.5 = 200);
    // Math.round(...) / 100 converts that back down to a currency amount rounded
    // to 2 decimal places (200 → 2.00), avoiding floating-point rounding drift.
    const amount =
      rate != null && listing.supplier_price != null
        ? Math.round(listing.supplier_price * rate) / 100
        : null;

    const res = await fetch(`/api/dropshipping/listings/${listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: url.trim(),
        customsTaxRate: rate,
        customsTaxAmount: amount,
      }),
    });

    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? "Failed to save source URL");
    }

    const updated = (await res.json()) as DropshipListing;
    dispatch(
      updateListingSource({
        id: listing.id,
        sourceUrl: updated.source_url,
        sourcePlatform: updated.source_platform,
      })
    );
    dispatch(
      updateCustomsTax({
        id: listing.id,
        customsTaxRate: updated.customs_tax_rate,
        customsTaxAmount: updated.customs_tax_amount,
      })
    );
    success("Listing saved.");
    onClose();
  } catch (err) {
    toastError(err instanceof Error ? err.message : "Failed to save");
  } finally {
    setSaving(false);
  }
}
```

This matches the test case from Task 2 (`supplier_price: 16, customs_tax_rate:
12.5` → `customs_tax_amount: 2`): `16 × 12.5 = 200`, `Math.round(200) = 200`,
`200 / 100 = 2`.

Add the "Customs Tax Rate (%)" input in the JSX, inside the `<div
className="space-y-4 py-1">` block, after the existing source-URL `<div
className="space-y-1.5">` block (after line 113, before the closing `</div>`
at line 114):

```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium text-[var(--color-text-base)]">
    Customs Tax Rate (%)
  </label>
  <Input
    type="number"
    step="0.01"
    min="0"
    placeholder="e.g. 12.5"
    value={customsTaxRate}
    onChange={(e) => setCustomsTaxRate(e.target.value)}
    className="w-full"
  />
</div>
```

Add the new `updateListingSource` sibling action import — update the import
on line 5:

```tsx
import { updateListingSource, updateCustomsTax } from "../_store/dropshippingSlice";
```

`updateCustomsTax` was added to the slice in Task 4, so this import resolves
cleanly.

- [ ] **Step 2: Update the PATCH route**

In `src/app/api/dropshipping/listings/[id]/route.ts`, replace the body
parsing and update call (lines 24-38):

```ts
const { id } = await params;
const body = (await req.json()) as {
  sourceUrl?: string;
  customsTaxRate?: number | null;
  customsTaxAmount?: number | null;
};

if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim() === "") {
  return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
}

if (
  body.customsTaxRate !== undefined &&
  body.customsTaxRate !== null &&
  typeof body.customsTaxRate !== "number"
) {
  return NextResponse.json({ error: "customsTaxRate must be a number or null" }, { status: 400 });
}

const sourceUrl = body.sourceUrl.trim();
const sourcePlatform = detectPlatform(sourceUrl);

const { data, error } = await client
  .from("dropship_listings")
  .update({
    source_url: sourceUrl,
    source_platform: sourcePlatform,
    customs_tax_rate: body.customsTaxRate ?? null,
    customs_tax_amount: body.customsTaxAmount ?? null,
  })
  .eq("id", id)
  .select("*")
  .single<DropshipListing>();
```

The rest of the route (error handling, response) is unchanged.

- [ ] **Step 3: Ask the user to manually verify in the browser**

Ask the user to open `/dashboard/dropshipping`, open the edit modal for a
listing that already has a supplier price, enter a customs tax rate, save,
and confirm: the rate persists (re-opening the modal shows the saved value),
and the margin badge in that listing's row (from Task 3) updates to reflect
the new effective cost.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/dropshipping/_components/EditSourceModal.tsx src/app/api/dropshipping/listings/[id]/route.ts
git commit -m "feat: add editable customs tax rate to dropshipping edit modal"
```

---

### Task 6: Price-refresh recompute — `check-prices` route + Playwright script

**Files:**
- Modify: `src/app/api/dropshipping/listings/check-prices/route.ts`
- Modify: `scripts/aliexpress/scrape-prices.mjs`

**Interfaces:**
- Consumes: `DropshipListing.customs_tax_rate`/`customs_tax_amount` (Task 1). Independent of Task 4/5 — touches different files, no shared symbols.
- Produces: nothing consumed by later tasks (this is the last code task).

No test file — both are server-side routes/scripts with no existing test
coverage in this codebase, and adding one here would require mocking the
Playwright browser and/or the AliExpress scrape session, which is out of
scope for this plan. Verification is the manual browser/CLI check in Step 3.

- [ ] **Step 1: Update `check-prices/route.ts`**

In `src/app/api/dropshipping/listings/check-prices/route.ts`, update the
`.update({...})` call inside the loop (lines 85-96) to recompute
`customs_tax_amount` when the listing already has a `customs_tax_rate`:

```ts
const { error: updateError } = await client
  .from("dropship_listings")
  .update({
    supplier_price: price,
    supplier_currency: currency,
    supplier_price_checked_at: checkedAt,
    ...(listing.customs_tax_rate != null
      ? { customs_tax_amount: Math.round(price * listing.customs_tax_rate) / 100 }
      : {}),
    // Persist the derived URL so the Source column links the listing too.
    ...(listing.source_url
      ? {}
      : { source_url: url, source_platform: "aliexpress" }),
  })
  .eq("id", listing.id);
```

(`listing` here is already the full row from the `.select("*")` query at
line 52-54, so `listing.customs_tax_rate` is available without any query
change — `DropshipListing`'s new fields from Task 1 make this compile.)

- [ ] **Step 2: Update `scripts/aliexpress/scrape-prices.mjs`**

Add `customs_tax_rate` to the `main()` function's `select()` column list
(line 189-192):

```js
let query = supabase
  .from("dropship_listings")
  .select("id, title, sku, source_url, source_platform, currency, supplier_price_checked_at, customs_tax_rate")
  .order("supplier_price_checked_at", { ascending: true, nullsFirst: true });
```

Update the `persist` function (lines 170-179) to accept the rate and
recompute the amount:

```js
async function persist(r, customsTaxRate) {
  const patch = {
    supplier_price: r.price,
    supplier_currency: r.currency,
    supplier_price_checked_at: new Date().toISOString(),
    ...(customsTaxRate != null
      ? { customs_tax_amount: Math.round(r.price * customsTaxRate) / 100 }
      : {}),
    ...(r.derived ? { source_url: r.url, source_platform: "aliexpress" } : {}),
  };
  const { error } = await supabase.from("dropship_listings").update(patch).eq("id", r.id);
  if (error) throw new Error(error.message);
}
```

Update the call site inside `main()`'s loop (around line 245, `await
persist(r);`) to pass the listing's rate — `listing` is in scope in that
loop (`const listing = checkable[i];`, line 234):

```js
await persist(r, listing.customs_tax_rate);
```

- [ ] **Step 3: Ask the user to manually verify**

Ask the user to run the Playwright script against a listing that already
has a `customs_tax_rate` set (e.g. `node --env-file=.env.local
scripts/aliexpress/scrape-prices.mjs --id=<uuid> --dry-run` to confirm the
console output looks right before a real run, then without `--dry-run`) and
confirm `customs_tax_amount` updates in the DB alongside `supplier_price`.
Separately, ask them to use the "Check AliExpress price" button in the UI
for a listing with a rate set and confirm the margin badge updates
immediately (exercises `updateSupplierPrices`'s recompute logic from Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/dropshipping/listings/check-prices/route.ts scripts/aliexpress/scrape-prices.mjs
git commit -m "feat: recompute customs tax amount when supplier price refreshes"
```

---

## Final check

After Task 6, the branch `feat/dropshipping-margin-customs-tax` has 8
commits (spec, spec correction, and 6 implementation tasks). Ask the user to
run the full suite once at the end:

Ask the user to run: `npx jest` and `npx tsc --noEmit`
Expected: PASS, no regressions in unrelated feature tests.

Then run `graphify update .` (AST-only, no API cost) per this project's
`CLAUDE.md` rule to keep the knowledge graph current, since this plan
touches several files.

Then hand off per `superpowers:finishing-a-development-branch` — only if
the user asks to proceed to that step. Note there is a second branch
(`fix/filterbar-search-position-purchases-vendor`) also pending from earlier
in this session — surface both to the user when discussing next steps
rather than assuming which one they mean.
