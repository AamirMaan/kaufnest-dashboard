# Planner feature

Route: `/dashboard/planner`. A pure client-side profit calculator for eBay and Amazon.
Users enter costs and a selling price; results update in real time. No data is
persisted — no Supabase calls, no Redux writes. Available on Pro and Business plans
only (`hasPlatformIntegrations`). Accessible to all roles.

## Files in this folder

- `page.tsx` — `"use client"`. Plan gate (same pattern as Integrations) + eBay/Amazon
  tab switcher. Renders `<EbayPlanner />` or `<AmazonPlanner />` based on active tab.
- `_components/EbayPlanner.tsx` — eBay form: selling price, VAT mode/rate, purchase
  cost, eBay category (FVF) with custom override, shipping cost, advertising %. Uses
  local `useState`; computes result inside `useMemo` via `calcEbayResult`.
- `_components/AmazonPlanner.tsx` — Amazon form: selling price, VAT mode/rate, purchase
  cost, Amazon category (referral fee) with custom override, FBA/FBM toggle (FBA shows
  fulfillment + storage fee fields; FBM shows shipping cost), advertising %. Uses
  local `useState`; computes result inside `useMemo` via `calcAmazonResult`.
- `_components/PlannerResults.tsx` — shared results panel. Props: `result: CalcResult | null`,
  `vatMode: VatMode`, `shippingLabel: string`. Shows profit (green/red), profit margin,
  minimum selling price, and itemised fee breakdown. Renders placeholder text when
  `result` is null (selling price or purchase cost not yet entered).
- `_lib/fees.ts` — typed constants: `EBAY_CATEGORIES: EbayCategory[]` and
  `AMAZON_CATEGORIES: AmazonCategory[]`. Each entry has the display label and rate(s).
- `_lib/calculations.ts` — pure functions `calcEbayResult(EbayCalcInput): CalcResult`
  and `calcAmazonResult(AmazonCalcInput): CalcResult`. All rates stored as decimals.
  Shared internal `compute()` helper handles VAT, platform fees, break-even formula.
- `_lib/calculations.test.ts` — unit tests covering profit (VAT-inclusive + exclusive),
  break-even min price verification, advertising, FBA vs FBM, 0% VAT edge case.

## Data flow

No Supabase. No Redux writes. `page.tsx` reads `state.currentUser.tenantPlan` for the
plan gate. All other state is local `useState` in `EbayPlanner` / `AmazonPlanner`.
`calcEbayResult` / `calcAmazonResult` are called inside `useMemo` keyed on `form` state
and return `CalcResult | null` (null when selling price or purchase cost is empty).

## Shared dependencies

- `src/lib/utils/planGating` — `hasPlatformIntegrations`
- `src/lib/utils/currency` — `formatCurrency` (called with default EUR)
- `src/components/layout/PageHeader`
- `src/store/hooks` — `useAppSelector`
- `src/store/slices/currentUserSlice` — `tenantPlan`

## Tests

`npx jest dashboard/planner`
