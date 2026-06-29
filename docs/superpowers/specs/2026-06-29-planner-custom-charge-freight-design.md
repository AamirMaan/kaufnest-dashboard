# Planner: Custom Charge + Amazon Inbound Freight

**Date:** 2026-06-29  
**Route:** `/dashboard/planner`  
**Scope:** Pure UI + calculation logic — no Supabase, no Redux

---

## Overview

Two additions to the existing profit planner:

1. **Custom charge field** — on both eBay and Amazon tabs. A free-label, user-defined cost that can be either a percentage of the selling price or a flat € per unit.
2. **Amazon inbound freight** — on the Amazon tab only, FBA mode only. A fixed € per-unit cost to ship inventory to Amazon's warehouse (separate from FBA fulfillment/storage fees).

Both feed into the existing `compute()` function and appear in the Fee Breakdown results panel.

---

## Custom Charge Field (both planners)

### UI — appears below "Advertising %" on both EbayPlanner and AmazonPlanner

Three sub-fields rendered together under a single `PlannerField` label:

| Sub-field | Type | Purpose |
|---|---|---|
| Label input | text | User names the charge (e.g. "PayPal fee", "Import duty") |
| Type toggle | % / fixed button toggle | Switches between % of gross selling price or flat € |
| Value input | number | The rate (%) or amount (€) |

- Label defaults to empty string, type defaults to `%`, value defaults to empty.
- Label input is a standard text input, styled consistently with the rest of the form.
- The toggle follows the same pattern as the VAT mode / FBA/FBM toggles (two-button flex row).

### Calculation

- If type is `%`: treated as `customChargeRate` (applied to `grossPrice`, same mechanics as `advertisingRate`)
- If type is `fixed`: treated as `customChargeFixed` (added to `fixedCosts`, same mechanics as shipping)
- Both fields always exist in `NormalizedInput`; one will always be 0.

### Break-even update

The algebraic break-even formula in `compute()` must include the custom charge:

```
divisor = 1 - platformFeeRate - advertisingRate - customChargeRate - vatRate/(1+vatRate)
minGrossPrice = (purchaseCost + flatFee + fixedCosts + customChargeFixed) / divisor
```

### Results panel

- `CalcBreakdown` gets a new `customCharge: number` field (0 when unused).
- `PlannerResults` accepts a new optional prop `customChargeLabel?: string`.
- When `customChargeLabel` is non-empty, a row is rendered in Fee Breakdown using that label and `result.breakdown.customCharge` as the value.
- When `customChargeLabel` is empty, the row is hidden regardless of the value.

---

## Amazon Inbound Freight (Amazon FBA only)

### UI — appears after "FBA storage fee" field, inside the `isFba` conditional block

| Field | Type | Label |
|---|---|---|
| Inbound freight | number (€) | "Inbound freight to Amazon (€)" |

- Only visible when FBA is selected (already inside `{isFba && ...}` block).
- Defaults to empty (treated as 0).
- Represents the per-unit cost of shipping inventory from the seller to Amazon's fulfillment center.

### Calculation

Added to `fixedCosts` in `calcAmazonResult` alongside `fbaFulfillmentFee` and `fbaStorageFee`:

```ts
const fixedCosts = fbaFulfillmentFee + fbaStorageFee + inboundFreight;
```

Shown in the breakdown under the existing "FBA fees" label — no separate breakdown row needed.

---

## Files Changed

| File | What changes |
|---|---|
| `_lib/calculations.ts` | Add `customChargeRate`, `customChargeFixed` to `EbayCalcInput` and `AmazonCalcInput`; add `inboundFreight` to `AmazonCalcInput`; add `customRate`/`customFixed` to `NormalizedInput`; update `compute()` to derive and subtract `customCost`; add `customCharge` to `CalcBreakdown`; update break-even divisor and numerator |
| `_components/EbayPlanner.tsx` | Add `customChargeLabel`, `customChargeType` (`"pct" \| "fixed"`), `customChargeValue` to `FormState`; render custom charge UI; pass values to `calcEbayResult`; pass label to `PlannerResults` |
| `_components/AmazonPlanner.tsx` | Add `inboundFreight`, `customChargeLabel`, `customChargeType`, `customChargeValue` to `FormState`; render inbound freight field inside FBA block; render custom charge UI; pass values to `calcAmazonResult`; pass label to `PlannerResults` |
| `_components/PlannerResults.tsx` | Add `customChargeLabel?: string` prop; conditionally render custom charge breakdown row |
| `_lib/calculations.test.ts` | Add tests: custom charge as %, custom charge as fixed, inbound freight with FBA, break-even with custom charge |

---

## Constraints

- No persistence — all state remains local `useState` in each planner component.
- `CalcResult` stays clean: the label string is passed as a separate prop to `PlannerResults`, not embedded in the result object.
- Inbound freight only applies to FBA; when switching to FBM the field hides but the value persists in state (same pattern as existing FBA fields — `calcAmazonResult` ignores it via the FBA/FBM ternary).
- `customChargeType` defaults to `"pct"`. When value is empty, `customChargeRate` and `customChargeFixed` are both 0.
