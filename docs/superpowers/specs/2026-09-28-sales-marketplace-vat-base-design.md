# Sales marketplace + VAT base — design

Date: 2026-09-28 · Branch: `feat/sales-marketplace-vat-base`

## Problem

1. **Marketplace is discarded.** Amazon's VAT report carries `MARKETPLACE`
   (`amazon.de`, `amazon.co.uk`, `amazon.fr`…), but the Amazon/eBay import
   formats force `platform` and have no marketplace column, and the generic
   format's `normalizePlatform()` (`sales/_components/importFormats.ts`) folds
   `amazon.de` → `amazon`. Per-market revenue/VAT is therefore unknowable.
2. **No VAT base.** Sales store `vat_rate` and `vat_amount` but not the net
   amount VAT was charged on — the *Bemessungsgrundlage* declared on the
   Umsatzsteuervoranmeldung / OSS return.

## Decisions (agreed 2026-09-28)

- VAT base = **net taxable base**: `sum(total_amount − vat_amount)` over
  orders with `vat_amount > 0`. Derived in SQL, **not stored**.
- Marketplace is **stored** per sale, shown in the Orders table, filterable,
  and broken down on Analytics.
- Existing orders get their marketplace by **re-importing** the original
  reports: a matched duplicate with a null marketplace gets only that field
  filled.

## 1. Data model

Migration `052_sales_marketplace.sql`:

```sql
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales ADD COLUMN IF NOT EXISTS marketplace text;
  CREATE INDEX IF NOT EXISTS sales_marketplace_idx ON {{schema}}.sales (marketplace);
$$);
```

Plus the same column/index in `provision_tenant_schema()` (the "2 places"
rule, `supabase/SKILL.md`). Nullable — null means "unknown" (manual entries,
pre-052 imports not yet re-imported).

`Sale.marketplace: string | null` in `src/types/index.ts`.

**Stored form:** lower-case domain, e.g. `amazon.de`, `amazon.co.uk`,
`ebay.de`. Free text beyond normalisation (no enum) — Amazon/eBay add
markets over time and an enum would reject them.

## 2. VAT base (derived)

Why derived: `total_amount` and `vat_amount` are already kept consistent by
every writer, including the Amazon REFUND path (which reduces both —
`ImportSalesModal.tsx`'s refund update). A stored `net_amount` would need a
backfill and a third field to keep in sync.

Correctness per source:
- **Amazon**: `total_amount` = `TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL` (items +
  shipping), `vat_amount` = combined item + shipping VAT → base includes
  shipping, which is what is declared.
- **Generic/eBay**: `vat_amount` either comes from the sheet or is derived by
  `vatAmountFromGross(total_amount, vat_rate)` → base = `total_amount` net of
  that VAT, consistent.
- Orders with `vat_amount` null or 0 (non-VAT sales, e.g. exports/reverse
  charge) are **excluded** from the base — they are declared separately, if
  at all.
- Same `counts` rule as the existing `gross`/`vat` sums in
  `get_sales_summary`: returned/cancelled excluded unless the status filter
  explicitly selects them.

## 3. Marketplace capture

### `normalizeMarketplace(raw: string | undefined): string | null`

Pure, in **`src/lib/utils/marketplace.ts`** (colocated
`marketplace.test.ts`). Lives in `lib/utils/`, not the Sales feature,
because it has three consumers: the Sales importer, the server-side
integrations adapters (`src/lib/integrations/`), and the Add/Edit Sale
modals. No React/Supabase imports, so it is safe on both sides.

| Input | Output |
| --- | --- |
| `"Amazon.de"`, `" amazon.DE "` | `amazon.de` |
| `"amazon.co.uk"` | `amazon.co.uk` |
| `"EBAY_DE"`, `"EBAY_GB"` (eBay API ids) | `ebay.de`, `ebay.co.uk` |
| `"EBAY_US"` | `ebay.com` |
| `"amazon"`, `"ebay"`, `""`, `undefined` | `null` (no market info) |
| anything else non-empty | trimmed, lower-cased as-is |

eBay id → domain uses an explicit map only where the suffix differs from
the country code: `EBAY_GB`→`ebay.co.uk`, `EBAY_US`→`ebay.com`,
`EBAY_AU`→`ebay.com.au`, `EBAY_BE`→`ebay.be` (eBay splits Belgium into
`EBAY_BE` only at the API level; one market for reporting). Every other
`EBAY_XX` becomes `ebay.xx` (`EBAY_DE`→`ebay.de`, `EBAY_FR`→`ebay.fr`, …).

### Import formats

- `importAliases.ts`: new `marketplace` canonical key, aliases
  `marketplace`, `sales_channel`, `sales channel`, `marktplatz`,
  `verkaufskanal`.
- Amazon + eBay formats (`RICH_COLUMNS`/`RICH_HEADERS`): add optional
  `marketplace` column; template examples gain `amazon.de` / `ebay.de`.
- Generic format: keep `platform` normalisation to `amazon`/`ebay` as today,
  and set `marketplace = normalizeMarketplace(raw.marketplace ??
  raw.platform)` — so a `platform` value of `amazon.de` is no longer lost.
  An explicit `marketplace` column wins over the `platform` value.
- `ParsedRow.data` / the refund branch: carry `marketplace`. The
  `dedupeImportRows` merge of same-order+sku lines keeps the first line's
  marketplace (lines of one order share it).

### Platform API sync

- `NormalizedOrder.marketplace?: string | null` (`lib/integrations/types.ts`).
- Amazon (`amazon.ts`): `AmazonOrder.SalesChannel` (e.g. `"Amazon.de"`) →
  `normalizeMarketplace`. Add `SalesChannel?: string` to the interface.
- eBay (`ebay.ts`): each `EbayLineItem.purchaseMarketplaceId` (e.g.
  `"EBAY_DE"`) → `normalizeMarketplace`. Add the field to the interface.
- The review/import route (`api/integrations/review/import/route.ts`) and
  `mergeImportedSale.ts`: `marketplace` is **platform-owned but fill-only** —
  written on insert, and on re-sync only when the stored value is null
  (never overwrites a non-null value).

## 4. Re-import backfill

In `ImportSalesModal.tsx`'s existing duplicate pre-check (the `IN_CHUNK`
`.in()` read over `(platform, external_order_id)`):

- Also select `id, marketplace` for matched rows.
- A pure helper `marketplaceBackfills(parsedRows, existingRows) →
  { id, marketplace }[]` (new file `sales/_components/marketplaceBackfill.ts`,
  colocated test) returns matches where the existing row's `marketplace` is
  null and the parsed row's is non-null. Existing non-null values are never
  changed.
- Apply as one `.update({ marketplace })` per distinct marketplace value,
  `.in("id", ids)` chunked by `IN_CHUNK` — a handful of calls, not one per
  row.
- The duplicate rows are still counted as skipped duplicates; the summary
  adds a line: "Marketplace added to N existing orders". Failure of the
  backfill update fires an error toast but does not undo the rest of the
  import.
- Refund rows do not trigger a backfill (their matched sale gets it from
  its own SALE row in the same or an earlier report).

## 5. SQL functions

Migration `052` also redefines (via `run_on_all_tenant_schemas` +
`provision_tenant_schema()`):

- **`get_sales_summary`**: new param `p_marketplace text` and a new output
  column `vat_base numeric`:
  ```sql
  AND (p_marketplace IS NULL
       OR (p_marketplace = '__unknown__' AND s.marketplace IS NULL)
       OR s.marketplace = p_marketplace)
  …
  coalesce(sum(f.total_amount - f.vat_amount)
           FILTER (WHERE f.counts AND coalesce(f.vat_amount, 0) > 0), 0)
  ```
  The signature changes, so `DROP FUNCTION IF EXISTS … (old signature)`
  first — `CREATE OR REPLACE` cannot change a parameter list or return
  type. Re-apply the existing grants.
- **New `get_sales_by_marketplace(p_from date, p_to date)`** returning
  `(marketplace text, platform text, currency text, order_count int, gross
  numeric, vat numeric, vat_base numeric)`, grouped by `coalesce(marketplace,
  '')`, platform, currency, same `counts` rule (returned/cancelled
  excluded). `SECURITY INVOKER`, `SET search_path = {{schema}}`, `STABLE`,
  same grants as 051's functions.
- **New `get_sales_marketplaces()`** returning `setof text` — distinct
  non-null marketplaces, for the filter dropdown. Structurally bounded by
  the number of marketplaces a seller trades on (tens at most).

## 6. UI

### Orders (`/dashboard/sales`)

- **Platform cell**: marketplace shown under the platform badge,
  `text-xs text-[var(--color-text-muted)]`; nothing rendered when null.
- **Marketplace filter** in the existing `FilterBar`: "All marketplaces",
  each value from `get_sales_marketplaces()`, and "Unknown" (`__unknown__`).
  Added to `SalesFilters`/`salesFilterParams` (`lib/utils/filters.ts`) so
  `fetchSalesPage` (`.eq("marketplace", …)` / `.is("marketplace", null)`)
  and `fetchSalesSummary` use the same param — table and tiles cannot
  disagree.
- **Summary tile** "VAT base (net)" next to the VAT tile, built in
  `sales/_lib/salesSummaryTiles.ts` from the new `vat_base` column, one value
  per currency like the other money tiles.
- **Add/Edit Sale modals**: optional "Marketplace" text input (free text,
  normalised on save) so manual orders and corrections can set it.
- **CSV export**: `marketplace` column added after `platform`.
- **Order detail** (`sales/[id]`): marketplace shown next to platform.

### Analytics (`/dashboard/analytics`)

- New `MarketplaceCard.tsx` in `dashboard/_components/` (the Analytics card
  family lives there): a **ranked table** in the `TopProductsCard` style —
  marketplace (or "Unknown"), orders, gross, VAT, VAT base, share bar of
  gross — for the page's picked date range, base currency only (rows in
  other currencies are listed with their currency code, not converted).
  Uses `ChartCard` shell, "No data in this period" empty state.
- Data: `useOverviewData` gains a `get_sales_by_marketplace` call scoped to
  the picked range (not the trailing window). Pure shaping in
  `dashboard/_lib/marketplaceRows.ts` (sort by gross desc, share %, label
  "Unknown" for empty marketplace), colocated test.
- Home is unchanged (numbers-only page; this is an Analytics breakdown).

## 7. Error handling

- Unknown/odd marketplace strings are stored as-is (lower-cased), never a
  row failure — marketplace is informational.
- Backfill failures toast and leave the import itself committed.
- Summary RPC failure keeps the existing "Couldn't load order totals" path.

## 8. Testing

Unit (colocated, `npx jest`):
- `lib/utils/marketplace.test.ts`: the `normalizeMarketplace` table above.
- `importFormats.test.ts`: marketplace parsed for amazon/ebay/generic;
  generic `platform: amazon.de` → platform `amazon`, marketplace
  `amazon.de`; explicit `marketplace` column beats `platform`.
- `dedupeImportRows.test.ts`: merged lines keep marketplace.
- `marketplaceBackfill.test.ts`: fills only null → non-null; never
  overwrites; groups by value.
- `salesSummaryTiles.test.ts`: VAT base tile.
- `marketplaceRows.test.ts`: sort, share, Unknown label.
- `filters` test: `salesFilterParams` marketplace + `__unknown__`.
- Integrations: Amazon `SalesChannel` / eBay `purchaseMarketplaceId`
  normalisation in the adapters' existing tests; `mergeImportedSale` fill-only
  rule.

Integration (`npm run test:integration`, after 052 is applied): extend the
overview/summary integration test for `vat_base` (a VAT-bearing and a
zero-VAT sale → base counts only the first) and `p_marketplace`.

## 9. Docs to update (same commit as code)

`sales/CLAUDE.md` + `SKILL.md` (marketplace field, backfill, filter, VAT
base tile), `dashboard/CLAUDE.md` + `analytics/CLAUDE.md`/`SKILL.md`
(MarketplaceCard, new RPC), `lib/integrations/SKILL.md` (marketplace
capture, fill-only merge), `supabase/SKILL.md` + `supabase/CLAUDE.md`
(052 row in the file map, apply-status "not applied").

## Out of scope

- OSS-style breakdown by VAT rate × destination country (the user chose the
  single net base; the marketplace filter + date range covers per-market
  totals). Revisit if the declaration needs per-rate lines.
- Marketplace on Expenses/Purchases.
- Currency conversion inside `MarketplaceCard`.
