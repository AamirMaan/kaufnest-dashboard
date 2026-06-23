---
name: planner-feature
description: Work on the Profit Planner at src/app/dashboard/planner — use when the task mentions profit calculator, planner, eBay/Amazon fee calculator, break-even price, or the /dashboard/planner route.
---

# Working on the Planner feature

Read `CLAUDE.md` in this folder first. The planner is a pure client-side calculator —
no Supabase, no Redux writes. All calculation logic is in `_lib/calculations.ts`.

## Minimal file set for common changes

- **Add a new eBay category**: `_lib/fees.ts` only — add an entry to `EBAY_CATEGORIES`.
- **Add a new Amazon category**: `_lib/fees.ts` only — add an entry to `AMAZON_CATEGORIES`.
- **Change calculation logic** (e.g. add a new fee type): `_lib/calculations.ts` +
  `_lib/calculations.test.ts` + whichever `_components/` form exposes the new field.
- **Add a new output metric** (e.g. ROI): `_lib/calculations.ts` (add to `CalcResult`) +
  `_lib/calculations.test.ts` + `_components/PlannerResults.tsx`.
- **Add a third platform** (e.g. Etsy): new entry in `_lib/fees.ts`, new
  `_components/EtsyPlanner.tsx` following the `EbayPlanner` pattern, add tab to
  `TABS` in `page.tsx`.
- **Change the results display**: `_components/PlannerResults.tsx` only.
- **Change the upgrade prompt**: `page.tsx` plan-gate branch only.

## Test command

`npx jest dashboard/planner`

## Gotchas

- **All rates are decimals, not percentages** — `vatRate: 0.20`, not `20`. Only convert
  at the UI boundary: `parse(form.vatRate) / 100` before passing to calc functions.
- **`minSellingPrice` can be `Infinity`** — when `divisor <= 0` (fees exceed 100% of
  revenue). `PlannerResults` renders "N/A" in this case — not a bug.
- **`result` is `null` until both `sellingPrice` and `purchaseCost` are non-zero** —
  `PlannerResults` handles null gracefully with a placeholder message.
- **VAT mode affects what `minSellingPrice` means** — inclusive: returns gross price;
  exclusive: returns net price (what the user would enter). The label in `PlannerResults`
  adjusts via the `vatMode` prop.
- **`flatFee` for Amazon is `0`** — only eBay has a per-transaction flat fee (€0.30
  default). The `compute()` helper accepts it but Amazon callers always pass `0`.
- **`category` is derived inside `useMemo`** — do not hoist it above `useMemo` as it
  creates a new object reference every render, causing stale-closure lint warnings.
- **`PlannerField` and `inputCls` are duplicated in `EbayPlanner` and `AmazonPlanner`** —
  intentional YAGNI. Extract only if a third platform is added.
- **No `<Suspense>` needed** — this page does not use `useSearchParams()`, so no
  Suspense boundary is required (unlike `integrations/page.tsx`).
- **Currency is EUR** — `formatCurrency(amount)` uses the default EUR. Do not pass
  a currency argument unless the project adds multi-currency support.
