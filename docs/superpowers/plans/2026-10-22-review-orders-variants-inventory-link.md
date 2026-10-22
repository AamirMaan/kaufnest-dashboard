# Review Orders variants + inventory link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Expandable rows on Review Orders showing variant/SKU, plus a pre-matched inventory dropdown whose choice is saved as `sales.product_id` on import.

**Architecture:** eBay adapter adds `sku`/`variant` to `NormalizedOrder`; pure `matchInventory` seeds a per-order product choice (client-side, from `state.inventory.selectorItems`); import route validates `productLinks` against `products` and writes `product_id`, `sku`, `variant_text`. Migration 059 adds the two columns.

**Tech Stack:** Next.js (App Router), Redux Toolkit, Supabase, jest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-22-review-orders-variants-inventory-link-design.md`.
- Never hardcode a tenant schema; DDL via `run_on_all_tenant_schemas` AND mirrored in `provision_tenant_schema()` (005).
- Never return raw Postgres errors; ambiguous match proposes nothing; `sku`/`variant_text` fill-only on re-sync; `product_id` user-owned.
- Review page keeps its hand-rolled table (imported rows have no checkbox, select-all is unimported-only — `DataTable`'s selection can't express that); expandable behaviour is added locally with the same panel styling as `DataTable`.
- Migration written, NOT applied. Update CLAUDE.md/SKILL.md in the same commit.

## Task 1: Platform data + migration 059

**Files:** Modify `src/lib/integrations/types.ts`, `src/lib/integrations/ebay.ts`, `src/lib/integrations/mapToSale.ts`, `src/lib/integrations/mergeImportedSale.ts`, `src/types/index.ts`, `supabase/migrations/005_tenant_provisioning.sql`; Create `supabase/migrations/059_sales_sku_variant.sql`; Tests `ebay.test.ts`, `mapToSale.test.ts`, `mergeImportedSale.test.ts`.

**Interfaces — Produces:** `NormalizedOrder.sku?: string | null`, `NormalizedOrder.variant?: string | null` (already flattened `Size: M · Colour: Red`); `Sale.sku?`, `Sale.variant_text?`; `normalizedOrderToSaleRow(order, platform, by, fees?, connectionId?, productId?)`.

- [ ] Failing tests: eBay line item with `sku` + `variationAspects` → order has `sku`, `variant`; no aspects → `variant: null`; mapToSale writes `sku`, `variant_text`, `product_id` from 6th arg; merge keeps existing sku/variant_text, fills when null.
- [ ] Implement; run `npx jest lib/integrations`; commit.

## Task 2: matchInventory

**Files:** Create `src/app/dashboard/integrations/review/_lib/matchInventory.ts` + `.test.ts`.

**Produces:** `matchInventory(order: {sku?: string|null; product_name: string}, products: {id; name; sku?}[]): { productId: string; reason: "sku" | "name" } | null`.

- [ ] Tests: sku exact (case/trim), name fallback, ambiguous sku → null, ambiguous name → null, sku match wins over name, no match → null.
- [ ] Implement; run jest; commit.

## Task 3: Import route

**Files:** Modify `src/app/api/integrations/review/import/route.ts`, `src/lib/integrations/reviewImport.ts` (+ test).

**Produces:** `unknownProductLinks(links: Record<string,string>, knownIds: Set<string>): string[]` (ids not in set).

- [ ] Test `unknownProductLinks`; implement.
- [ ] Route: accept `productLinks`, load `products` ids for the distinct values via `.in("id", …)`, 400 `{error: "One of the selected inventory items no longer exists."}` if any unknown; pass `productLinks[order.external_order_id] ?? null` to `normalizedOrderToSaleRow`.
- [ ] Run jest; commit.

## Task 4: Review page UI

**Files:** Modify `src/app/dashboard/integrations/review/page.tsx`.

- [ ] State: `productLinks: Record<string,string>`, `autoMatched: Record<string,"sku"|"name">`, `expanded: Set<string>`. Seed once data + `selectorItems` available (functional merge, never overwrite user picks).
- [ ] Chevron column + expandable panel row (classes copied from DataTable); panel shows Variant, SKU, Marketplace, Buyer/Country (if present), Order ID.
- [ ] Inventory column: `Select` (Not linked + `name · sku`), "auto-matched" `Badge` until changed; imported rows show linked product name read-only is skipped (ReviewOrder has no product_id) — show nothing.
- [ ] `handleImport` posts `productLinks` for selected orders only. Bump `colSpan`.
- [ ] Commit.

## Task 5: Docs

- [ ] Update integrations `CLAUDE.md`/`SKILL.md`, `lib/integrations/SKILL.md`, `supabase/SKILL.md` (059 unapplied). Commit with Task 4 if not done.
