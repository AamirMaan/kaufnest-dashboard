# Profit Planner — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Route:** `/dashboard/planner`

## Overview

A pure client-side profit calculator for eBay and Amazon seller accounts. Users enter
costs and a selling price; the planner instantly shows profit, profit margin, minimum
break-even selling price, and a fee breakdown. No data is persisted — every result is
derived in real time from the current input values.

Available on **Pro and Business plans only** (same gate as Integrations).
Accessible to all roles (`super_admin`, `admin`, `accountant`).

---

## Architecture

No API routes, no Redux slice, no Supabase access. All state is local React `useState`
inside each platform component. Calculation logic is extracted into a pure library so
it is independently testable.

### File structure

```
src/app/dashboard/planner/
  page.tsx                      — plan gate + eBay/Amazon tab switcher
  _components/
    EbayPlanner.tsx             — eBay form; wires inputs to calculation lib
    AmazonPlanner.tsx           — Amazon form; wires inputs to calculation lib
    PlannerResults.tsx          — shared results panel (profit, min price, breakdown)
  _lib/
    calculations.ts             — pure functions: calcProfit(), calcMinPrice()
    calculations.test.ts        — unit tests for all calculation logic
    fees.ts                     — fee constants: eBay FVF rates, Amazon referral rates,
                                   FBA fee defaults
  CLAUDE.md
  SKILL.md
```

### Sidebar change

One new entry added to `NAV_ITEMS` in `src/components/layout/Sidebar.tsx`:

```ts
{
  label: "Planner",
  href: "/dashboard/planner",
  Icon: Calculator,           // from lucide-react
  roles: ["super_admin", "admin", "accountant"],
}
```

Plan gating is handled inside `page.tsx`, not at the nav level — same pattern as
Integrations.

---

## Calculation Engine

### Shared inputs

| Field | Type | Notes |
|---|---|---|
| Selling price | £ | The price entered by the user |
| VAT mode | Toggle | Inclusive or Exclusive |
| VAT rate | % | Default 20%, editable |
| Purchase / cost price | £ | What the seller paid for the item |
| Advertising cost | % of gross | Optional, default 0 |

### eBay-only inputs

| Field | Type | Notes |
|---|---|---|
| Final Value Fee | Category selector + custom % | Preset rates per eBay category; "Custom" reveals a free-text % field. Flat fee: £0.30 per transaction. |
| Postage / shipping cost | £ | What the seller pays to ship the item |

### Amazon-only inputs

| Field | Type | Notes |
|---|---|---|
| Referral fee | Category selector + custom % | Preset rates per Amazon category; "Custom" reveals a free-text % field |
| Fulfillment method | FBA / FBM toggle | Controls which cost fields are visible |
| FBA fulfillment fee | £ | Visible only when FBA selected |
| FBA storage fee | £/unit/month | Visible only when FBA selected |
| Shipping cost | £ | Visible only when FBM selected |

### VAT logic

Platform fees always apply to the **gross price** (the amount the buyer pays).

**VAT-inclusive** (user enters gross price):
```
grossPrice    = sellingPrice
netRevenue    = grossPrice / (1 + vatRate)
vatCollected  = grossPrice - netRevenue
```

**VAT-exclusive** (user enters net price):
```
netPrice      = sellingPrice
grossPrice    = netPrice × (1 + vatRate)
vatCollected  = netPrice × vatRate
```

### Core formulas

```
platformFees = grossPrice × platformFeeRate + flatFee   // flatFee = £0.30 for eBay, £0 for Amazon
advertisingCost = grossPrice × advertisingRate
fixedCosts   = purchaseCost + shippingCost + fbaFulfillmentFee + fbaStorageFee

profit = grossPrice - platformFees - vatCollected - fixedCosts - advertisingCost

profitMargin = profit / grossPrice × 100
```

**Minimum break-even selling price** (solved algebraically — no iteration):

For VAT-inclusive mode:
```
minGrossPrice = (purchaseCost + flatFee + shippingCost + fbaFees)
              / (1 - platformFeeRate - advertisingRate - vatRate / (1 + vatRate))
```

For VAT-exclusive mode, the gross price at break-even is the same formula but the
displayed "minimum price" is reported as `minGrossPrice / (1 + vatRate)` (the net
price the user would enter).

### Outputs

| Output | Description |
|---|---|
| Profit | £ amount; shown in green if positive, red if negative |
| Profit margin | % of gross price |
| Minimum selling price | Break-even gross (or net) price |
| Fee breakdown | Itemised: platform fee, VAT collected, shipping / FBA fees, advertising |

Results update on every keystroke — no "Calculate" button.

---

## Fee Constants (`fees.ts`)

### eBay Final Value Fee rates (UK)

| Category | Rate | Flat fee |
|---|---|---|
| Most categories | 12.8% | £0.30 |
| Clothes, Shoes & Accessories | 13.0% | £0.30 |
| Books, Comics & Magazines | 14.6% | £0.30 |
| Music | 14.6% | £0.30 |
| DVDs & Films | 14.6% | £0.30 |
| Vehicle Parts & Accessories | 9.0% | £0.30 |
| Motors | 2.0% | £0.30 |
| Custom | — | user enters % |

### Amazon Referral Fee rates (UK)

| Category | Rate |
|---|---|
| Baby Products | 8% |
| Books | 15% |
| Camera & Photo | 8% |
| Clothing & Accessories | 17% |
| Consumer Electronics | 8% |
| Electronics Accessories | 15% |
| Garden & Outdoors | 15% |
| Health & Beauty | 8% |
| Home & Kitchen | 15% |
| Musical Instruments | 12% |
| Office Products | 15% |
| Pet Supplies | 15% |
| Shoes & Handbags | 17% |
| Sports & Outdoors | 15% |
| Toys & Games | 15% |
| Video Games | 15% |
| Custom | user enters % |

---

## UI Layout

### `page.tsx`

```
PageHeader: "Profit Planner"
  ↳ If not Pro/Business → upgrade prompt card (same pattern as Integrations page)
  ↳ Otherwise:
      Tab bar: [eBay] [Amazon]
      Tab panel: <EbayPlanner /> or <AmazonPlanner />
```

### Each platform form (two-column layout on desktop, stacked on mobile)

```
Left column — Inputs          Right column — Results (live)
┌──────────────────────┐      ┌──────────────────────────┐
│ Selling Price [£ __] │      │ Profit          £ 12.40  │
│ VAT Mode  [Incl ▾]  │      │ Profit Margin    18.5 %  │
│ VAT Rate     [20 %] │      │ Min. Sell Price £ 28.60  │
│ Purchase Cost [£ __] │      │                          │
│ Platform Fees [Cat▾] │      │ Fee Breakdown            │
│   Custom fee  [_ %] │      │   Platform fee   £ 4.20  │
│ Fulfillment [FBA|FBM]│      │   VAT collected  £ 5.00  │
│ FBA Fulfil. Fee [£_] │      │   Shipping       £ 3.00  │
│ FBA Storage Fee [£_] │      │   Advertising    £ 1.40  │
│ Shipping Cost  [£ _] │      └──────────────────────────┘
│ Advertising   [_ %] │
└──────────────────────┘
```

Conditional visibility:
- "Custom fee %" field: shown only when category = "Custom"
- FBA Fulfillment Fee + FBA Storage Fee: Amazon, FBA mode only
- Shipping Cost: eBay always; Amazon, FBM mode only

---

## Testing

All tests are in `_lib/calculations.test.ts`. No mocks needed — pure functions only.

Coverage:
- `calcProfit()` with VAT-inclusive and VAT-exclusive mode, for both eBay and Amazon
- `calcMinPrice()` — plugging result back into `calcProfit()` confirms profit ≈ 0
- Edge cases: 0% advertising, 0% VAT, FBA vs FBM switching
- Fee constants sanity check: all rates within realistic bounds

Run: `npx jest dashboard/planner`

---

## Constraints & Non-Goals

- **No persistence** — calculations are not saved; no DB writes
- **No Redux** — local `useState` only; no cross-feature state needed
- **No currency conversion** — all values assumed to be GBP
- **FBA fees are manually entered** — exact FBA rates depend on product dimensions/weight which are outside scope; the user enters the fee they know from Seller Central
- **Advertising is a flat % input** — does not model ACoS/TACoS attribution in detail
