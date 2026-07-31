# Graph Report - kaufnest-dashboard  (2026-07-24)

## Corpus Check
- 327 files · ~208,449 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1810 nodes · 3891 edges · 130 communities (123 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bf15865f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Dropshipping Listing Pipeline
- Design Refresh Token System
- Tenant Edit & Admin Auth
- Planner VAT & Break-even Logic
- Integration Order Review
- Planner Fee Calculation Engine
- Planner Custom Charges & Freight
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 106
- Community 107
- Community 108
- Community 109
- requireIntegrationAdmin
- eBay Listing Creation — Design Spec
- listingsSlice.ts
- Badge.tsx
- route.ts
- route.ts
- StoreProvider.tsx
- EditPurchaseModal.tsx
- Listings feature
- FilterBar.tsx
- Listings feature playbook
- DataTable.tsx

## God Nodes (most connected - your core abstractions)
1. `useAppDispatch` - 60 edges
2. `useAppSelector` - 48 edges
3. `useToast()` - 43 edges
4. `Button` - 42 edges
5. `createTenantClient()` - 33 edges
6. `createControlClient()` - 31 edges
7. `Currency` - 31 edges
8. `createClient()` - 30 edges
9. `Sale` - 30 edges
10. `formatCurrency()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `addBillTo()` --references--> `jspdf`  [EXTRACTED]
  src/lib/utils/generateInvoice.ts → package.json
- `addFooter()` --references--> `jspdf`  [EXTRACTED]
  src/lib/utils/generateInvoice.ts → package.json
- `addHeader()` --references--> `jspdf`  [EXTRACTED]
  src/lib/utils/generateInvoice.ts → package.json
- `generateExpensesInvoice()` --references--> `jspdf`  [EXTRACTED]
  src/lib/utils/generateInvoice.ts → package.json
- `generateOrderInvoice()` --references--> `jspdf`  [EXTRACTED]
  src/lib/utils/generateInvoice.ts → package.json

## Import Cycles
- 1-file cycle: `src/lib/stripe.ts -> src/lib/stripe.ts`
- 1-file cycle: `src/components/ui/dialog.tsx -> src/components/ui/dialog.tsx`
- 1-file cycle: `src/components/ui/input.tsx -> src/components/ui/input.tsx`

## Communities (130 total, 7 thin omitted)

### Community 0 - "Dropshipping Listing Pipeline"
Cohesion: 0.08
Nodes (31): CategoryStep(), CategorySuggestion, Props, DetailsStep(), Props, ImagesStep(), Props, EMPTY_DRAFT (+23 more)

### Community 1 - "Design Refresh Token System"
Cohesion: 0.09
Nodes (22): After all tasks land, eBay Listing Creation Implementation Plan, File Structure, Global Constraints, Task 10: `publish.ts` — eBay Inventory/Taxonomy/Account API calls, Task 11: API routes — category search + business policies, Task 12: API route — resumable publish, Task 13: Sidebar link + listings table page (+14 more)

### Community 2 - "Tenant Edit & Admin Auth"
Cohesion: 0.22
Nodes (8): Browser Verification Checklist, File Map, Global Constraints, Task 1: PATCH API route, Task 2: EditTenantModal component, Task 3: Wire up TenantActions and page.tsx, Task 4: Update docs, Tenant Edit Implementation Plan

### Community 3 - "Planner VAT & Break-even Logic"
Cohesion: 0.15
Nodes (12): File Map, Global Constraints, Profit Planner Implementation Plan, Self-Review, Task 1: Fee constants, Task 2: Calculation library + unit tests, Task 3: Sidebar nav entry, Task 4: `PlannerResults` component (+4 more)

### Community 4 - "Integration Order Review"
Cohesion: 0.20
Nodes (9): Browser Verification Checklist, File Map, Global Constraints, Integration Order Review Implementation Plan, Task 1: GET /api/integrations/review, Task 2: POST /api/integrations/review/import, Task 3: Review page UI, Task 4: ConnectionCard + vercel.json (+1 more)

### Community 5 - "Planner Fee Calculation Engine"
Cohesion: 0.21
Nodes (18): CURRENCY_BY_SYMBOL, detectCurrency(), isAliExpressSku(), parseAmount(), parsePriceString(), parseStock(), resolveSupplierUrl(), args (+10 more)

### Community 6 - "Planner Custom Charges & Freight"
Cohesion: 0.06
Nodes (60): AdminLayout(), POST(), verifyPlatformAdmin(), errorMessage(), POST(), verifyPlatformAdmin(), POST(), verifyPlatformAdmin() (+52 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (42): Architecture summary, Checklist — phase completion gates, KaufNest — Multi-Tenant SaaS Migration, Key rules for all future Claude Code sessions, Phase 1, Phase 1 — Control Plane (new Supabase project), Phase 2, Phase 2 — Schema-per-tenant isolation (Data Plane) (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (12): ParsedSource, Props, EditUserModal(), InviteUserModal(), PERMISSION_GROUPS, PermissionsModal(), ROLES, UsersPage() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (31): AmazonPlanner(), ChargeType, DEFAULT_FORM, FormState, parse(), ChargeType, DEFAULT_FORM, EbayPlanner() (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (47): EditSourceModal(), EditSourceModalProps, PlatformBadge(), MarginFilterBand, matchesListingSearch(), matchesMarginFilter(), canCheckSupplierPrice(), ListingsTable() (+39 more)

### Community 11 - "Community 11"
Cohesion: 0.17
Nodes (15): GET(), GET(), POST(), basicAuthHeader(), ebayAdapter, EbayLineItem, EbayMoney, EbayOrder (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (37): jspdf, jspdf, Props, ParsedRow, PurchasesState, Props, computeGrossProfit(), computeNetProceeds() (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (25): ALIASES, canonicalizeRow(), ColumnSpec, HeaderResolution, IMPORT_FORMAT_IDS, IMPORT_FORMATS, ImportFormat, ImportFormatId (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (24): Architecture, Behaviour, Constraints, Data Model, DB migration — `supabase/migrations/016_platform_payouts.sql`, Error handling, Fields, Files Changed (+16 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (32): RecordTransferModal(), today(), AddExpenseModal(), EditExpenseModal(), expenseToForm(), ImportExpensesModal(), Props, TEMPLATE_EXAMPLE (+24 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (20): AddSaleModal(), CURRENCIES, makeDefaults(), PLATFORMS, Props, today(), blankForm, CURRENCIES (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (24): API Routes, Architecture, Constraints & Non-Goals, Dashboard layout hydration, Data Model, `dropship_listings` table (tenant schema), Dropshipping — Listing Management Design Spec, `EditSourceModal.tsx` — shadcn Dialog (+16 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (17): BusinessPolicies, BusinessPolicySummary, CategorySuggestion, ebayFetch(), fetchPolicyList(), publishListing(), PublishResult, searchCategories() (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): 1. `src/lib/utils/filters.ts`, 2. `src/components/ui/FilterBar.tsx`, 3. Each slice thunk (`fetchSalesPage` / `fetchPurchasesPage` / `fetchExpensesPage`), 4. Each `page.tsx` (sales, purchases, expenses), Components & data flow, Files changed, Out of scope, Problem (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.10
Nodes (20): Amazon-only inputs, Amazon Referral Fee rates (UK), Architecture, Calculation Engine, Constraints & Non-Goals, Core formulas, Each platform form (two-column layout on desktop, stacked on mobile), eBay Final Value Fee rates (UK) (+12 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (9): amazonAdapter, AmazonMoney, AmazonOrder, AmazonOrderItem, AmazonOrderItemsResponse, AmazonOrdersResponse, AmazonTokenResponse, ADAPTERS (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 24 - "Community 24"
Cohesion: 0.43
Nodes (4): companyProfileSlice, CompanyProfileState, initialState, CompanyProfile

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (9): Props, Props, initialState, usersSlice, UsersState, currentUserSlice, CurrentUserState, initialState (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (40): @base-ui/react, class-variance-authority, clsx, jspdf-autotable, lucide-react, next, dependencies, @base-ui/react (+32 more)

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (17): POST(), CURRENCIES, normalizeCurrency(), normalizedOrderToSaleRow(), SaleInsert, mergeImportedSale(), PLATFORM_OWNED, existingSale (+9 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (10): Data model, Dropshipping Margin Coloring + EU Customs Tax — Design Spec, Editing, Files changed, Margin calculation, Out of scope, Problem, Solution (+2 more)

### Community 29 - "Community 29"
Cohesion: 0.12
Nodes (16): Checklist (check off as completed; re-grep before checking "imports fixed"), CLAUDE.md per feature should cover, Config & root docs — REMAINING, Expenses, Purchases, Users, Audit logs, Shared-lib tests, jest config — ALL DONE, Feature-folder reorg — working plan & progress tracker, Feature-private vs shared (decided — do not re-litigate), Feature roadmap — future work (separate from this reorg, tracked here for continuity), Final verification (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.21
Nodes (8): Props, ParsedRow, expensesSlice, ExpensesState, initialState, ExpenseInvoiceProps, ExpenseFilters, Expense

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (15): Added, API, Architecture, ConnectionCard change, Data flow, `GET /api/integrations/review`, Integration Order Review — Design Spec, Modified (+7 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (15): 1. Status Vocabulary, 2. Lifecycle Transitions, 3. Database Migration, 4. First-Login Auto-Activation (`auth/confirm`), 5. Proxy Enforcement (`proxy.ts`), 6. New Page: `/account-deactivated`, 7. Admin UI Changes, 8. Files Touched (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.04
Nodes (48): eslint, eslint-config-next, husky, jest, jest-environment-jsdom, devDependencies, eslint, eslint-config-next (+40 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (27): AddProductModal(), EditProductModal(), productToForm(), Props, InventoryPage(), isLowStock(), fetchInventoryPage, initialState (+19 more)

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (14): Global Constraints, Linked Purchase on Sale — Implementation Plan, Placeholder scan, Self-Review, Spec coverage, Task 1: DB migration + `Purchase` type, Task 2: `computeGrossProfit` pure helper + tests, Task 3: AddSaleModal — collapsible "Purchase cost" section (+6 more)

### Community 36 - "Community 36"
Cohesion: 0.13
Nodes (14): Call site (inside each generate function), Files Changed, Invoice Custom Fields — Design Spec, Layout (below existing records summary card), New helper, Out of Scope, Passing to generate functions, PDF — generateInvoice (`src/lib/utils/generateInvoice.ts`) (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (8): Dropshipping Table Filters + Sorting — Design Spec, Files changed, Filters, Out of scope, Problem, Solution, Sorting, Testing

### Community 38 - "Community 38"
Cohesion: 0.20
Nodes (9): Dropshipping Margin Coloring + EU Customs Tax Implementation Plan, Final check, Global Constraints, Task 1: Migration + `DropshipListing` type, Task 2: Pure margin calculation helper, Task 3: `SupplierPriceCell` rewrite (badge + tax breakdown), Task 4: Slice — `updateCustomsTax` action + preserve/recompute logic, Task 5: Editable customs tax rate (modal + PATCH route) (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.14
Nodes (13): 1. Token Layer (`src/app/globals.css`), 2. Component Improvements, 3. Files to touch, 4. Out of scope, Badge (`src/components/ui/Badge.tsx`), Buttons, Dark theme additions (inside `[data-theme="dark"]`), DataTable / table rows (`src/components/ui/DataTable.tsx`) (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.27
Nodes (7): ConnectionCardProps, PLATFORM_LABELS, STATUS_VARIANTS, initialState, integrationsSlice, IntegrationsState, PlatformConnection

### Community 41 - "Community 41"
Cohesion: 0.15
Nodes (12): Branching — always work on a branch, Commit and push gates, During development (feature work), Feature folders, Mandatory docs update — SKILL.md and CLAUDE.md, Project structure: feature folders, SaaS migration (in progress), Shared vs. feature-private — how the split was decided (+4 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (12): Dropshipping Listing Management — Implementation Plan, Global Constraints, Self-Review, Task 1: DB Migration + TypeScript Types, Task 2: `detectPlatform` Utility + Tests, Task 3: `dropshippingSlice` + Tests, Task 4: Store Wiring + Sidebar Entry, Task 5: eBay Listings Fetcher + Scope Update (+4 more)

### Community 43 - "Community 43"
Cohesion: 0.15
Nodes (12): Amazon Inbound Freight (Amazon FBA only), Break-even update, Calculation, Calculation, Constraints, Custom Charge Field (both planners), Files Changed, Overview (+4 more)

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (7): Global Constraints, Platform Payouts Implementation Plan, Task 1: DB migration + TypeScript type + pure helper + tests, Task 2: Redux slice + store registration, Task 3: Layout hydration + StoreProvider wiring, Task 4: Overview page — updated balance cards, Task 5: RecordTransferModal

### Community 45 - "Community 45"
Cohesion: 0.14
Nodes (13): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Fee fields (`shipping_cost`, `shipping_charged`, `advertising_fee`), Files in this folder, Inventory link + VAT (additive fields on `Sale`), Linked Purchase (cost of goods), Order status + returns (additive fields on `Sale`) (+5 more)

### Community 46 - "Community 46"
Cohesion: 0.08
Nodes (22): State, SetPasswordPage(), State, FormState, FormState, geistMono, geistSans, metadata (+14 more)

### Community 47 - "Community 47"
Cohesion: 0.17
Nodes (11): Backend, `EditTenantModal`, Files touched, Frontend, Out of scope, `page.tsx`, Problem, Route: `PATCH /api/admin/tenants/[id]` (+3 more)

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (8): Final check, Global Constraints, Orders / Purchases / Expenses Text Search Implementation Plan, Task 1: `filters.ts` — search field, sanitize helper, updated predicates, Task 2: `FilterBar.tsx` — debounced search input, Task 3: Sales (Orders) — wire up search, Task 4: Purchases — wire up search, Task 5: Expenses — wire up search

### Community 49 - "Community 49"
Cohesion: 0.20
Nodes (8): purchasesSlice, initialState, platformPayoutsSlice, PlatformPayoutsState, AppDispatch, AppStore, RootState, PlatformPayout

### Community 50 - "Community 50"
Cohesion: 0.17
Nodes (11): Badge.tsx, Button.tsx, DataTable.tsx, FilterBar.tsx, FormFields.tsx, Modal.tsx, StatCard.tsx, ThemeProvider.tsx (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (4): fetchInventorySelectors, inventorySlice, ProductSelector, StoreProviderProps

### Community 52 - "Community 52"
Cohesion: 0.11
Nodes (35): Plan, Props, CATEGORIES, CURRENCIES, makeDefaults(), Props, today(), blankForm (+27 more)

### Community 53 - "Community 53"
Cohesion: 0.20
Nodes (11): Props, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, VALID_CURRENCIES, validateRow(), CsvValue, Delimiter, detectDelimiter() (+3 more)

### Community 54 - "Community 54"
Cohesion: 0.18
Nodes (10): audit.ts, currency.ts, date.ts, filters.ts, generateInvoice.ts, Gotchas, invoiceMath.ts, permissions.ts (+2 more)

### Community 55 - "Community 55"
Cohesion: 0.21
Nodes (12): AuditLogDetailModal(), Props, AUDIT_ACTIONS, AuditLogsPage(), ActionBadge(), formatDateTime(), getMonthRange(), DEFAULT_AUDIT_LOG_FILTERS (+4 more)

### Community 56 - "Community 56"
Cohesion: 0.17
Nodes (13): ConnectionCard(), IntegrationsContent(), PLATFORM_LABELS, PLATFORMS, ListingsPage(), ALL_PERMISSIONS, hasMinimumRole(), hasPermission() (+5 more)

### Community 57 - "Community 57"
Cohesion: 0.18
Nodes (10): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Files in this folder, Inventory link + VAT (additive fields on `Purchase`), Pagination data flow, Purchases feature, Sale link (`sale_id`) (+2 more)

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (4): salesSlice, PageRequest, rangeFor(), auditLogsSlice

### Community 59 - "Community 59"
Cohesion: 0.20
Nodes (9): Adding a third platform, `external_order_id` dedup contract, Files, Gotchas, Merge rule (re-import field ownership), Platform integrations library (`src/lib/integrations/`), Review window, The `PlatformAdapter` interface (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.22
Nodes (8): Design Refresh (Emerald Light / Violet Dark) Implementation Plan, Global Constraints, Task 1: Update design tokens (`globals.css`), Task 2: Badge — vivid fill and font weight, Task 3: StatCard — left border accent, icon prop, hover lift, Task 4: Dashboard page — add icons to StatCards, Task 5: DataTable — primary-muted row hover, Task 6: Sidebar — active pill + icon colour + hover transition

### Community 61 - "Community 61"
Cohesion: 0.22
Nodes (8): Global Constraints, Task 1: Database Migration, Task 2: TenantStatus Type + Admin UI, Task 3: API Route Fixes, Task 4: First-Login Auto-Activation (`auth/confirm`), Task 5: Proxy Enforcement + `/account-deactivated` Page, Task 6: Update CLAUDE.md, Tenant Status Lifecycle Implementation Plan

### Community 62 - "Community 62"
Cohesion: 0.25
Nodes (7): AliExpress price scraper (local), Beating AliExpress throttling (important), Files, Notes, Prerequisites, Usage, Why this runs locally, not on Vercel

### Community 63 - "Community 63"
Cohesion: 0.20
Nodes (9): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Expenses feature, Files in this folder, Pagination data flow, Shared dependencies (live outside this folder on purpose), Tests (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.22
Nodes (8): Data flow (the pattern every mutation follows), Files in this folder, How stock levels actually update — read this before changing anything here, Inventory feature, Pagination data flow, Shared dependencies (live outside this folder on purpose), Split selector fetch (critical constraint), Tests

### Community 65 - "Community 65"
Cohesion: 0.22
Nodes (8): Gotchas, Gotchas — CSV import formats (German support), Gotchas — detail page, Gotchas — fee fields, Gotchas — server-side pagination, Minimal file set for common changes, Test command, Working on the Sales feature

### Community 66 - "Community 66"
Cohesion: 0.50
Nodes (6): COMPANY_PROFILE_ROLES, SettingsPage(), validateEmail(), validateIBAN(), validateVATId(), validateVATRate()

### Community 67 - "Community 67"
Cohesion: 0.22
Nodes (8): API routes, Data flow, Dropshipping feature, eBay API notes, Files in this folder, Margin calculation (customs_tax_amount), Shared dependencies, Tests

### Community 68 - "Community 68"
Cohesion: 0.25
Nodes (7): API routes, Data flow (different from other features), Files in this folder, Integrations feature, Plan gating, Shared dependencies, Tests

### Community 69 - "Community 69"
Cohesion: 0.12
Nodes (22): AddTenantModal(), DeleteTenantModal(), Props, EditTenantModal(), Props, Props, TenantActions(), PLAN_VARIANT (+14 more)

### Community 70 - "Community 70"
Cohesion: 0.25
Nodes (7): client.ts, control.ts, Gotcha: `src/proxy.ts` doesn't use either of these, managementApi.ts, server.ts, Supabase clients (`src/lib/supabase/`), Where these are used

### Community 71 - "Community 71"
Cohesion: 0.33
Nodes (5): Dropshipping Table Filters + Sorting Implementation Plan, Final check, Global Constraints, Task 1: Pure filter-matching helpers, Task 2: Filter row + DataTable sorting in `ListingsTable.tsx`

### Community 72 - "Community 72"
Cohesion: 0.25
Nodes (7): Apply order (for a fresh Project B, disaster recovery), File map + apply status, Gotchas, Index rationale (004_performance_indexes.sql), Supabase migrations (`supabase/`), The "2 places" rule for schema changes, Using `run_on_all_tenant_schemas`

### Community 73 - "Community 73"
Cohesion: 0.48
Nodes (6): find_claude_md_areas(), main(), map_files_to_areas(), Path, Stop hook — the *trigger* half of the self-improving AI Layer.  After each Claud, run()

### Community 74 - "Community 74"
Cohesion: 0.48
Nodes (6): find_claude_md_areas(), main(), map_files_to_areas(), Path, SessionStart hook — dynamic per-module orientation.  Prints a short orientation, run()

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (6): Global Constraints, Invoice Custom Fields Implementation Plan, Self-Review, Task 1: Export `InvoiceOptions` type and add `addBillTo` helper to `generateInvoice.ts`, Task 2: Update `InvoiceModal` with customer info UI and extra fields, Task 3: Update docs

### Community 77 - "Community 77"
Cohesion: 0.25
Nodes (7): Data flow, Files in this folder, Permission overrides (additive per-user grants), Related files outside this folder (cannot be colocated), Shared dependencies (live outside this folder on purpose), Tests, Users feature

### Community 78 - "Community 78"
Cohesion: 0.33
Nodes (5): Features, KaufNest Dashboard, Local Development, Stack, Testing

### Community 79 - "Community 79"
Cohesion: 0.33
Nodes (5): API routes (cannot be colocated — Next.js pins routes to `app/api/...`), Files in this folder, KaufNest platform admin panel, Shared dependencies, Tests

### Community 80 - "Community 80"
Cohesion: 0.33
Nodes (5): Auth feature, Files in this folder, Related files outside this folder (cannot be colocated), Shared dependencies, Tests

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (5): Audit Logs feature, Files in this folder, Important: the slice lives elsewhere — on purpose, Shared dependencies, Tests

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (5): Gotchas, Minimal file set for common changes, Pagination data flow, Test command, Working on the Audit Logs feature

### Community 83 - "Community 83"
Cohesion: 0.33
Nodes (5): Cross-cutting state & infra, Dashboard shell + Overview, Feature folders (each documents itself — start there), Files at this level, Shared shell components (live outside, in `src/components/layout/`)

### Community 84 - "Community 84"
Cohesion: 0.33
Nodes (5): Data flow, Files in this folder, Planner feature, Shared dependencies, Tests

### Community 85 - "Community 85"
Cohesion: 0.33
Nodes (5): Files in this folder, Settings feature, Shared dependencies, Tests, Why `generateInvoice` is NOT colocated here

### Community 86 - "Community 86"
Cohesion: 0.16
Nodes (12): aggregateSaleRevenue(), computePending(), DashboardPage(), describeRange(), FALLBACK_COLORS, PLATFORM_COLORS, platformColor(), RANGE_PRESETS (+4 more)

### Community 87 - "Community 87"
Cohesion: 0.70
Nodes (4): main(), Path, read_truncated(), run()

### Community 88 - "Community 88"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Auth feature

### Community 89 - "Community 89"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Expenses feature

### Community 90 - "Community 90"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Integrations feature

### Community 91 - "Community 91"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Inventory feature

### Community 92 - "Community 92"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Planner feature

### Community 93 - "Community 93"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Purchases feature

### Community 94 - "Community 94"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Settings feature

### Community 95 - "Community 95"
Cohesion: 0.40
Nodes (4): Adding a new feature with its own Supabase collection, Overview page changes, Test command, Working on the Dashboard shell / Overview

### Community 96 - "Community 96"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Users feature

### Community 97 - "Community 97"
Cohesion: 0.33
Nodes (5): fra1, buildCommand, framework, installCommand, regions

### Community 98 - "Community 98"
Cohesion: 0.17
Nodes (15): Props, FormState, FormState, AddPurchaseModal(), CURRENCIES, FormState, makeDefaults(), Props (+7 more)

### Community 99 - "Community 99"
Cohesion: 0.50
Nodes (3): Gotchas, Minimal file set for common changes, Working on the admin panel

### Community 100 - "Community 100"
Cohesion: 0.50
Nodes (3): Dropshipping — Agent Playbook, Gotchas, Minimal file set per change type

### Community 101 - "Community 101"
Cohesion: 0.50
Nodes (3): Files, Related code, Supabase SQL (`supabase/`)

### Community 102 - "Community 102"
Cohesion: 0.26
Nodes (13): AuditLogFilters, DEFAULT_EXPENSE_FILTERS, DEFAULT_PURCHASE_FILTERS, DEFAULT_SALES_FILTERS, filterExpenses(), filterPurchases(), filterSales(), fmt() (+5 more)

### Community 118 - "requireIntegrationAdmin"
Cohesion: 0.33
Nodes (11): GET(), redirectToIntegrations(), redirectToIntegrationsWithError(), GET(), POST(), GET(), IntegrationAuthResult, requireIntegrationAdmin() (+3 more)

### Community 119 - "eBay Listing Creation — Design Spec"
Cohesion: 0.14
Nodes (13): Data model, eBay API integration, eBay Listing Creation — Design Spec, Error handling & retry, Files changed/added, Out of scope (this spec), Problem, Publish flow (resumable) (+5 more)

### Community 120 - "listingsSlice.ts"
Cohesion: 0.22
Nodes (8): Props, STATUS_VARIANTS, fetchListingsPage, initialState, listingsSlice, ListingsState, EbayListingDraft, ListingStatus

### Community 121 - "Badge.tsx"
Cohesion: 0.17
Nodes (11): ACTION_VARIANTS, BadgeProps, BadgeVariant, CATEGORY_LABELS, CategoryBadge(), PLATFORM_LABELS, PLATFORM_VARIANTS, ROLE_VARIANTS (+3 more)

### Community 122 - "route.ts"
Cohesion: 0.20
Nodes (6): PLATFORMS, ReviewOrder, ReviewResponse, PLAN_LIMITS, PlanLimits, TenantPlan

### Community 123 - "route.ts"
Cohesion: 0.42
Nodes (8): POST(), buildGetMyeBaySellingRequest(), decodeXml(), EbayListing, fetchActiveListings(), parseItem(), tagText(), tradingApiCall()

### Community 124 - "StoreProvider.tsx"
Cohesion: 0.42
Nodes (8): hydrateExpenses, hydrateProducts, hydrateListingDrafts, hydratePurchases, hydrateSales, hydrateAuditLogs, makeStore(), StoreProvider()

### Community 125 - "EditPurchaseModal.tsx"
Cohesion: 0.25
Nodes (6): blankForm, CURRENCIES, EditPurchaseModal(), purchaseToForm(), initialState, PurchaseFilters

### Community 126 - "Listings feature"
Cohesion: 0.29
Nodes (6): Data flow, Files in this folder, Listings feature, Publish flow, Shared dependencies, Tests

### Community 127 - "FilterBar.tsx"
Cohesion: 0.40
Nodes (4): CURRENCIES, FilterBarProps, PRESETS, DatePreset

### Community 128 - "Listings feature playbook"
Cohesion: 0.40
Nodes (4): Gotchas, Listings feature playbook, Minimal file set per change type, Tests

### Community 129 - "DataTable.tsx"
Cohesion: 0.50
Nodes (3): Column, DataTableProps, SortState

## Knowledge Gaps
- **794 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+789 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Community 26` to `Community 33`, `Community 12`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `jspdf` connect `Community 12` to `Community 26`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _794 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dropshipping Listing Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.08139534883720931 - nodes in this community are weakly interconnected._
- **Should `Design Refresh Token System` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `Planner Custom Charges & Freight` be split into smaller, more focused modules?**
  _Cohesion score 0.06269592476489028 - nodes in this community are weakly interconnected._
- **Should `Community 7` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._