# Graph Report - ./docs  (2026-06-29)

## Corpus Check
- 11 files · ~23,707 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 34 nodes · 39 edges · 7 communities
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dropshipping Listing Pipeline|Dropshipping Listing Pipeline]]
- [[_COMMUNITY_Design Refresh Token System|Design Refresh Token System]]
- [[_COMMUNITY_Tenant Edit & Admin Auth|Tenant Edit & Admin Auth]]
- [[_COMMUNITY_Planner VAT & Break-even Logic|Planner VAT & Break-even Logic]]
- [[_COMMUNITY_Integration Order Review|Integration Order Review]]
- [[_COMMUNITY_Planner Fee Calculation Engine|Planner Fee Calculation Engine]]
- [[_COMMUNITY_Planner Custom Charges & Freight|Planner Custom Charges & Freight]]

## God Nodes (most connected - your core abstractions)
1. `Dropshipping Listing Management Implementation Plan` - 6 edges
2. `Profit Planner Implementation Plan` - 6 edges
3. `Design Refresh Emerald Light Violet Dark Implementation Plan` - 6 edges
4. `Pure Profit Calculation Engine calcEbayResult calcAmazonResult` - 5 edges
5. `Tenant Edit Implementation Plan` - 4 edges
6. `Planner Custom Charge and Amazon Inbound Freight Design Spec` - 4 edges
7. `Algebraic Break-even Minimum Selling Price Formula` - 4 edges
8. `Integration Order Review Implementation Plan` - 3 edges
9. `Emerald Primary CSS Token Light Theme` - 3 edges
10. `Profit Planner Design Spec` - 2 edges

## Surprising Connections (you probably didn't know these)
- `Profit Planner Implementation Plan` --references--> `Profit Planner Design Spec`  [INFERRED]
  superpowers/plans/2026-06-23-planner.md → superpowers/specs/2026-06-23-planner-design.md
- `Custom Charge Field Percent or Flat Fixed Per Unit` --conceptually_related_to--> `Pure Profit Calculation Engine calcEbayResult calcAmazonResult`  [INFERRED]
  superpowers/specs/2026-06-29-planner-custom-charge-freight-design.md → superpowers/plans/2026-06-23-planner.md
- `Dropshipping Listing Management Implementation Plan` --references--> `Dropshipping Listing Management Design Spec`  [INFERRED]
  superpowers/plans/2026-06-23-dropshipping-listing-management.md → superpowers/specs/2026-06-23-dropshipping-listing-management-design.md
- `Design Refresh Emerald Light Violet Dark Implementation Plan` --references--> `Design Refresh Design Spec`  [INFERRED]
  superpowers/plans/2026-06-25-design-refresh.md → superpowers/specs/2026-06-25-design-refresh-design.md
- `Amazon FBA Inbound Freight to Warehouse Field` --conceptually_related_to--> `Pure Profit Calculation Engine calcEbayResult calcAmazonResult`  [INFERRED]
  superpowers/specs/2026-06-29-planner-custom-charge-freight-design.md → superpowers/plans/2026-06-23-planner.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dropshipping Data Pipeline: DB Table, Redux Slice, eBay Fetcher** — plans_2026_06_23_dropshipping_dropship_listings_table, plans_2026_06_23_dropshipping_slice, plans_2026_06_23_dropshipping_fetch_active_listings [EXTRACTED 0.95]
- **Planner Calculation Core: Engine, Fee Constants, Break-even Formula** — superpowers_plans_2026_06_23_planner_calculation_engine, superpowers_plans_2026_06_23_planner_fee_constants, superpowers_plans_2026_06_23_planner_min_selling_price_formula [EXTRACTED 0.95]
- **Design Token Theming System: Emerald Light, Violet Dark, Vivid Badges** — superpowers_plans_2026_06_25_design_refresh_emerald_primary, superpowers_plans_2026_06_25_design_refresh_violet_dark_primary, superpowers_plans_2026_06_25_design_refresh_badge_semantic_vivid [INFERRED 0.85]

## Communities (7 total, 0 thin omitted)

### Community 0 - "Dropshipping Listing Pipeline"
Cohesion: 0.38
Nodes (7): detectPlatform Pure Utility Function, dropship_listings Database Table, eBay sell inventory readonly Scope Re-authorization Requirement, fetchActiveListings eBay Sell Inventory API Fetcher, Source URL Preservation on eBay Refresh Rationale, Dropshipping Listing Management Implementation Plan, Dropshipping Listing Management Design Spec

### Community 1 - "Design Refresh Token System"
Cohesion: 0.38
Nodes (7): Design Refresh Emerald Light Violet Dark Implementation Plan, Badge Vivid Semantic Fill Colors and font-semibold, Tailwind v4 CSS Variable bg dash dash var Canonical Form Rationale, Emerald Primary CSS Token Light Theme, Success Color Shift Emerald to Green to Avoid Primary Clash Rationale, Violet Primary CSS Token Dark Theme, Design Refresh Design Spec

### Community 2 - "Tenant Edit & Admin Auth"
Cohesion: 0.40
Nodes (5): Tenant Edit Implementation Plan, Auth Email Update Before Control Plane Update Ordering Rationale, Platform Admin Override Bypasses Stripe Webhooks, verifyPlatformAdmin Auth Guard, Tenant Edit Design Spec

### Community 3 - "Planner VAT & Break-even Logic"
Cohesion: 0.50
Nodes (5): Profit Planner Implementation Plan, Algebraic Break-even Minimum Selling Price Formula, Planner No Persistence Pure Client-Side Design Rationale, VAT Inclusive Exclusive Mode Logic Gross Price Derivation, compute Break-even Divisor and Numerator Update for Custom Charge

### Community 4 - "Integration Order Review"
Cohesion: 0.50
Nodes (4): Integration Order Review Implementation Plan, Cron Job Removal Replaced by Manual Review Rationale, ReviewOrder imported Boolean Deduplication Flag, Integration Order Review Design Spec

### Community 5 - "Planner Fee Calculation Engine"
Cohesion: 0.67
Nodes (3): Pure Profit Calculation Engine calcEbayResult calcAmazonResult, eBay FVF and Amazon Referral Fee Rate Constants, Amazon FBA Inbound Freight to Warehouse Field

### Community 6 - "Planner Custom Charges & Freight"
Cohesion: 0.67
Nodes (3): Profit Planner Design Spec, Planner Custom Charge and Amazon Inbound Freight Design Spec, Custom Charge Field Percent or Flat Fixed Per Unit

## Knowledge Gaps
- **8 isolated node(s):** `Tenant Edit Design Spec`, `Integration Order Review Design Spec`, `Dropshipping Listing Management Design Spec`, `Design Refresh Design Spec`, `verifyPlatformAdmin Auth Guard` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Profit Planner Implementation Plan` connect `Planner VAT & Break-even Logic` to `Planner Fee Calculation Engine`, `Planner Custom Charges & Freight`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Pure Profit Calculation Engine calcEbayResult calcAmazonResult` (e.g. with `Custom Charge Field Percent or Flat Fixed Per Unit` and `Amazon FBA Inbound Freight to Warehouse Field`) actually correct?**
  _`Pure Profit Calculation Engine calcEbayResult calcAmazonResult` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Tenant Edit Design Spec`, `Integration Order Review Design Spec`, `Dropshipping Listing Management Design Spec` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._