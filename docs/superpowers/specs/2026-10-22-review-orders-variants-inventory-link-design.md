# Review Orders: expandable rows, variants, inventory link

Date: 2026-10-22. Sub-projects #2 (variants) and #3 (inventory link) of the
"missing eBay info" request (see `2026-10-21-ebay-finances-fees-design.md`).

## Goal

On `/dashboard/integrations/review`, show extra order detail (variant, SKU, …)
in an expandable row, and let the user link each order line to an inventory
item before import — pre-filled automatically where we can match it. A linked
order then flows through the existing stock deduction and the 057 dispatcher
notification with no extra code.

## Decisions

- **Suggest and confirm.** Auto-matches are pre-selected in the dropdown and
  badged; nothing links unless the user imports. Unmatched lines stay empty.
- Variant and SKU are **persisted** on `sales` (migration), so they stay
  visible in Orders, not just on the review page.
- Matching is a client-side hint against the hydrated inventory; the import
  route re-validates product ids server-side.

## 1. Platform data

- `NormalizedOrder` (`lib/integrations/types.ts`) gains optional `sku?: string |
  null` and `variant?: { name: string; value: string }[] | null`.
- `ebay.ts` fills them from the line item's `sku` and `variationAspects`.
- Amazon: `sku` only if the adapter's existing order-items call returns it;
  otherwise left undefined (UI shows "—"). No new Amazon API calls.
- Migration `059_sales_sku_variant.sql`: `sales.sku text`, `sales.variant_text
  text`, via `run_on_all_tenant_schemas`; `provision_tenant_schema()` in 005
  updated. Written, not applied.
- `variant_text` is the aspects flattened (`Size: M · Colour: Red`);
  `Sale` type gains `sku`, `variant_text`.
- `mergeImportedSale`: both fields fill-only (never overwrite an existing value).

## 2. Matching

Pure `matchInventory(order, products)` in
`dashboard/integrations/review/_lib/matchInventory.ts` → `{ productId, reason:
"sku" | "name" } | null`.

1. Exact SKU match (trim, case-insensitive) against `products.sku`.
2. Else exact normalised-name match (trim, lowercase, collapsed whitespace).
3. More than one candidate at a step → `null` (ambiguous proposes nothing).

## 3. Review UI

- `DataTable` with `detail: true` columns and `renderExpanded` (reference:
  Orders page). Inline: select, Order ID, Account, product, qty, total,
  Inventory, Purchase Cost, Ad Fee, Platform Fee, status. Panel: variant, SKU,
  marketplace, buyer/country, item/order ids.
- New **Inventory** column: `Select` of products (label `name · sku`), seeded
  from `matchInventory`; "auto-matched (SKU|name)" badge until the user changes
  it. Empty option = "Not linked". Transient state `productLinks`, same pattern
  as `orderFees`.
- Already-imported rows show their linked product name read-only.

## 4. Import

- `POST /api/integrations/review/import` accepts `productLinks?: Record<
  external_order_id, productId>`. The route loads the referenced ids from
  `products` through the tenant client; any unknown id → 400 with generic copy
  (no raw Postgres error). `normalizedOrderToSaleRow` gains the product id
  (and writes `sku`/`variant_text`).
- Stock deduction and dispatcher notification are the existing `sales`
  triggers (047/057) firing on `product_id`; no new code.
- "Sync Statuses" sends no `productLinks`; `product_id` is user-owned so a
  re-sync never relinks.

## Testing

Colocated jest: `matchInventory`, eBay variant/sku parsing (`ebay.test.ts`),
`mapToSale`, `mergeImportedSale`, `reviewImport` product-link validation.

## Docs

Update `dashboard/integrations/{CLAUDE,SKILL}.md`, `lib/integrations/SKILL.md`,
`supabase/SKILL.md` (file map, 059 not applied) in the same commit as code.

## Out of scope

Remembering manual picks per SKU (option 3), Amazon variant data beyond SKU,
bulk "link all" tools, editing the link after import (Edit Sale already does).
