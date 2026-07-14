# Dropshipping Margin Coloring + EU Customs Tax — Design Spec

**Date:** 2026-07-13
**Status:** Approved

## Problem

The Dropshipping feature's "AliExpress Price" column shows a raw currency
delta (sell − cost) with hardcoded green/red text — not a percentage margin,
and with no way to account for the EU's new customs duty on low-value
imports (the removal of the duty-free de minimis threshold), which now adds
real cost to every dropshipped item and can silently erase what looked like a
healthy margin.

## Solution

Add a per-listing customs tax rate that factors into a proper percentage
margin calculation, shown as a color-coded badge (red <10%, yellow <25%,
otherwise neutral/green), with the tax breakdown visible in the cell for
transparency.

Stock/quantity tracking (also requested) is explicitly **out of scope** —
deferred until there's a concrete plan for populating it (no such field
exists today, and the AliExpress scraper doesn't currently fetch stock).

---

## Data model

New migration `supabase/migrations/020_dropship_customs_tax.sql`, targeting
`tenant_kaufnest.dropship_listings` **directly** (not via
`run_on_all_tenant_schemas`) — this table is deliberately KaufNest-only and
excluded from `provision_tenant_schema()` (see `019_dropship_supplier_price.sql`'s
header comment and `supabase/SKILL.md`'s file map), so the standard
"2 places" multi-tenant DDL rule does not apply here.

```sql
ALTER TABLE tenant_kaufnest.dropship_listings
  ADD COLUMN IF NOT EXISTS customs_tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS customs_tax_amount NUMERIC(12,2);
```

Both nullable, no default — customs rates vary too much by product
category/TARIC code to default sensibly. `customs_tax_amount` is always a
derived value (`supplier_price × customs_tax_rate / 100`, in
`supplier_currency`), recomputed whenever either input changes — never
entered directly by the user.

`src/types/index.ts`'s `DropshipListing` interface gains:
```ts
customs_tax_rate: number | null;
customs_tax_amount: number | null;
```

---

## Margin calculation

Replaces the current raw delta in `SupplierPriceCell`
(`src/app/dashboard/dropshipping/_components/ListingsTable.tsx:45-77`):

```
effective_cost = supplier_price + (customs_tax_amount ?? 0)
margin_pct = (current_price − effective_cost) / current_price × 100
```

Only computed when `supplier_currency === currency` (same gate as today's
`sameCurrency` check — currency-mismatched listings show no margin
indicator, unchanged behavior).

**Color thresholds:**
- `margin_pct < 10` → red (`danger`)
- `margin_pct < 25` → yellow (`warning`)
- `margin_pct >= 25` → neutral (`success`)

Rendered using the shared `Badge` component (`src/components/ui/Badge.tsx`,
generic `{ label, variant }` props — not a new wrapper added to that shared
file, since a margin badge is dropshipping-only and this project's
shared-vs-feature-private rule reserves `components/ui/*` for things 3+
features use) — e.g. "18% margin" pill, for visual consistency with
`StatusBadge`/`CategoryBadge`/`PlatformBadge` elsewhere in the app, replacing
today's raw `text-green-600`/`text-red-600` Tailwind classes. The
margin/threshold computation is a pure, colocated, unit-tested helper in the
dropshipping feature folder (mirroring how `orderMath.ts`/
`resolveInitialSourceUrl.ts` extract pure logic out of components elsewhere
in this codebase for testability).

**Tax breakdown line:** when `customs_tax_rate` is set, the cell shows an
extra small line under the supplier price, e.g. `Customs: 12% (€2.40)`, so a
sudden red badge has a visible cause.

---

## Editing

`EditSourceModal.tsx` (`src/app/dashboard/dropshipping/_components/`) gains a
new "Customs Tax Rate (%)" number input (plain optional field — no VAT-style
"includes tax" checkbox needed, since this is additive to cost, not
extracted from a gross total). On save, the modal computes
`customs_tax_amount` from the listing's current `supplier_price` and the
entered rate (`null` if either is missing) and includes both fields in the
`PATCH /api/dropshipping/listings/[id]` body.

`PATCH /api/dropshipping/listings/[id]/route.ts` validates and persists
`customs_tax_rate`/`customs_tax_amount` alongside the existing `source_url`
update.

---

## Sync safety (critical gotcha)

One place needs a code change, one needs none (verified against current
source, not just assumed from the pattern):

1. **`POST /api/dropshipping/listings/refresh`** (eBay sync upsert) —
   `route.ts:51-60` maps eBay data into a `rows` array that simply never
   includes `supplier_price`/`source_url`/etc. as keys at all — Supabase's
   `.upsert(..., { onConflict: "ebay_listing_id" })` only updates columns
   present in the row object, so omitted columns are left untouched on
   conflict. **No code change needed here**: as long as `customs_tax_rate`/
   `customs_tax_amount` are likewise never added as keys to that `rows` map,
   they're automatically excluded the same way `supplier_price` already is.
   (For a brand-new listing being inserted for the first time, the omitted
   columns take their column default, which is `NULL` — the correct value
   for a listing that's never had a tax rate entered.)
2. **`dropshippingSlice.ts`'s `upsertListings` reducer** — already preserves
   `source_url`/`source_platform` (per its own comment) when merging a
   refreshed row over an existing one. Extend it to also preserve
   `customs_tax_rate`/`customs_tax_amount`.

Additionally, both places that update `supplier_price` from a fresh scrape —
**`POST /api/dropshipping/listings/check-prices`** (effectively broken today
per its own route comment, since AliExpress moved to client-side rendering)
and **`scripts/aliexpress/scrape-prices.mjs`** (the working replacement,
writes to the DB directly, not through the route) — must recompute
`customs_tax_amount` from the *new* `supplier_price` whenever the row already
has a non-null `customs_tax_rate` — otherwise the tax amount silently goes
stale relative to the latest cost snapshot and the
margin badge would be wrong.

---

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/020_dropship_customs_tax.sql` (new) | `ALTER TABLE tenant_kaufnest.dropship_listings ADD COLUMN customs_tax_rate/customs_tax_amount` |
| `src/types/index.ts` | Add `customs_tax_rate`/`customs_tax_amount` to `DropshipListing` |
| `src/app/dashboard/dropshipping/_components/marginMath.ts` (new) | Pure `computeMarginPct(listing)` + `marginBadgeVariant(marginPct)` helpers, colocated test |
| `src/app/dashboard/dropshipping/_components/ListingsTable.tsx` | Rewrite `SupplierPriceCell` — percentage margin incl. customs tax via `marginMath.ts`, renders shared `Badge`, tax breakdown line |
| `src/app/dashboard/dropshipping/_components/EditSourceModal.tsx` | Add "Customs Tax Rate (%)" input; compute + send `customs_tax_amount` on save |
| `src/app/api/dropshipping/listings/[id]/route.ts` | Validate/persist the two new fields |
| `src/app/api/dropshipping/listings/refresh/route.ts` | **No change** — new columns are simply never added to the `rows` map, so they're excluded from the upsert the same way `supplier_price` already is |
| `src/app/api/dropshipping/listings/check-prices/route.ts` | Recompute `customs_tax_amount` when `supplier_price` changes and a rate is already set |
| `src/app/dashboard/dropshipping/_store/dropshippingSlice.ts` | `upsertListings` preserves the two new fields, same as `source_url`/`source_platform` |
| `scripts/aliexpress/scrape-prices.mjs` | Recompute `customs_tax_amount` in the same `update(patch)` call when `supplier_price` changes and a rate is set |
| `src/app/dashboard/dropshipping/CLAUDE.md` / `SKILL.md` | Document the new columns, margin formula, and the sync-preservation gotcha |

`scrape-prices.mjs`'s current `update(patch)` call is at lines 172-177,
patching `supplier_price`/`supplier_currency`/`supplier_price_checked_at` —
the recompute logic goes in that same `patch` object, using the row's
existing `customs_tax_rate` (its `select()` at line 190-192 needs
`customs_tax_rate` added to the column list to have it available).

---

## Testing

- `marginMath.ts`'s `computeMarginPct` and `marginBadgeVariant` get unit
  tests: <10% → danger, exactly at boundaries (10%, 25%), >=25% → success,
  null/missing inputs (no `supplier_price`, or currency mismatch) → no badge.
- `dropshippingSlice.test.ts` gets a case confirming `upsertListings`
  preserves `customs_tax_rate`/`customs_tax_amount` across a refresh, mirroring
  its existing `source_url` preservation test.

## Out of scope

- Stock/quantity tracking (explicitly deferred).
- Currency conversion for mismatched `supplier_currency`/`currency` pairs —
  margin indicator continues to hide in that case, unchanged from today.
- A company-wide default customs tax rate — per-listing only, no default,
  since rates vary by product category.
- Changing `scripts/aliexpress/scrape-prices.mjs`'s scraping logic itself
  (price-only scraping stays as-is).
