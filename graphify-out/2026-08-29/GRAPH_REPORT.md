# Graph Report - kaufnest-dashboard  (2026-08-27)

## Corpus Check
- 408 files · ~320,638 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2318 nodes · 4797 edges · 165 communities (149 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d3f2f2d0`
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
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
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
- encrypt-existing-tokens.mjs
- eslint-config-next
- husky
- @playwright/test
- tailwindcss
- ts-jest
- @types/jest
- @types/node
- @types/react
- typescript
- page.tsx
- @types/react
- typescript
- postcss.config.mjs
- createControlClient
- route.ts
- importAliases.ts
- ThemeProvider.tsx
- File structure
- File structure
- route.ts
- ebay.ts
- parseExcelBuffer
- stripe.ts
- vatPreservation.ts

## God Nodes (most connected - your core abstractions)
1. `useAppDispatch` - 64 edges
2. `useAppSelector` - 54 edges
3. `useToast()` - 47 edges
4. `Button` - 43 edges
5. `createTenantClient()` - 37 edges
6. `Currency` - 34 edges
7. `formatCurrency()` - 33 edges
8. `createControlClient()` - 32 edges
9. `Sale` - 31 edges
10. `createClient()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `repo_root()`  [INFERRED]
  .claude/hooks/reflect_claude_md.py → .claude/hooks/_areas.py
- `main()` --calls--> `repo_root()`  [INFERRED]
  .claude/hooks/refresh_graphify.py → .claude/hooks/_areas.py
- `main()` --calls--> `changed_paths()`  [INFERRED]
  .claude/hooks/refresh_graphify.py → .claude/hooks/_areas.py
- `main()` --calls--> `changed_paths()`  [INFERRED]
  .claude/verifiers/verify_changes.py → .claude/hooks/_areas.py
- `main()` --calls--> `repo_root()`  [INFERRED]
  .claude/verifiers/verify_changes.py → .claude/verifiers/guard_edit.py

## Import Cycles
- 1-file cycle: `src/lib/stripe.ts -> src/lib/stripe.ts`
- 1-file cycle: `src/components/ui/dialog.tsx -> src/components/ui/dialog.tsx`
- 1-file cycle: `src/components/ui/input.tsx -> src/components/ui/input.tsx`

## Communities (165 total, 16 thin omitted)

### Community 0 - "Dropshipping Listing Pipeline"
Cohesion: 0.08
Nodes (39): EditSourceModalProps, SourceBadge(), resolveInitialSourceUrl(), Dialog(), DialogContent(), DialogDescription(), DialogFooter(), DialogHeader() (+31 more)

### Community 1 - "Design Refresh Token System"
Cohesion: 0.08
Nodes (49): CATEGORIES, CURRENCIES, makeDefaults(), Props, today(), blankForm, CATEGORIES, CURRENCIES (+41 more)

### Community 2 - "Tenant Edit & Admin Auth"
Cohesion: 0.12
Nodes (29): AdminLayout(), POST(), verifyCanImpersonate(), errorMessage(), POST(), verifyPlatformAdmin(), POST(), verifyPlatformAdmin() (+21 more)

### Community 3 - "Planner VAT & Break-even Logic"
Cohesion: 0.06
Nodes (48): AuditLogDetailModal(), Props, AUDIT_ACTIONS, AuditLogsPage(), AddProductModal(), EditProductModal(), productToForm(), InventoryPage() (+40 more)

### Community 4 - "Integration Order Review"
Cohesion: 0.12
Nodes (41): RecordTransferModal(), today(), AddExpenseModal(), EditExpenseModal(), expenseToForm(), ImportExpensesModal(), CATEGORIES, ExpensesPage() (+33 more)

### Community 5 - "Planner Fee Calculation Engine"
Cohesion: 0.12
Nodes (17): aggregateSaleRevenue(), computePending(), DashboardPage(), describeRange(), FALLBACK_COLORS, PLATFORM_COLORS, platformColor(), RANGE_PRESETS (+9 more)

### Community 6 - "Planner Custom Charges & Freight"
Cohesion: 0.45
Nodes (15): jspdf, jspdf, addBillTo(), addFooter(), addHeader(), formatDate(), formatMoney(), generateExpensesInvoice() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (42): Architecture summary, Checklist — phase completion gates, KaufNest — Multi-Tenant SaaS Migration, Key rules for all future Claude Code sessions, Phase 1, Phase 1 — Control Plane (new Supabase project), Phase 2, Phase 2 — Schema-per-tenant isolation (Data Plane) (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (40): @base-ui/react, class-variance-authority, clsx, jspdf-autotable, lucide-react, next, dependencies, @base-ui/react (+32 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (38): PlatformBadge(), BusinessEbayGate(), Props, CategoryStep(), CategorySuggestion, Props, DetailsStep(), Props (+30 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (31): AmazonPlanner(), ChargeType, DEFAULT_FORM, FormState, parse(), ChargeType, DEFAULT_FORM, EbayPlanner() (+23 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (51): classifySkip(), EXPENSE_IMPORT_FORMAT_IDS, EXPENSE_IMPORT_FORMATS, ExpenseImportData, ExpenseImportFormat, ExpenseImportFormatId, ParsedExpenseRow, round2() (+43 more)

### Community 12 - "Community 12"
Cohesion: 0.19
Nodes (17): WriteAuditLogParams, AuditLogFilters, DEFAULT_AUDIT_LOG_FILTERS, DEFAULT_EXPENSE_FILTERS, DEFAULT_PURCHASE_FILTERS, DEFAULT_SALES_FILTERS, filterExpenses(), filterPurchases() (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (26): area_doc_paths(), areas_touched_by(), changed_paths(), git(), governed_areas(), is_doc_only(), Path, Shared git/area helpers for the doc-drift hooks.  `session_start_context.py`, `p (+18 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (25): Props, ReplyBox(), Props, ThreadList(), displayCurrency(), Props, ThreadView(), AVATAR_CLASSES (+17 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (20): GET(), Props, BusinessPolicies, BusinessPolicySummary, CategorySuggestion, ebayFetch(), fetchPolicyList(), publishListing() (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (33): Props, FormState, FormState, Props, FormState, FormState, CURRENCIES, FormState (+25 more)

### Community 18 - "Community 18"
Cohesion: 0.30
Nodes (12): NotificationBell(), buildFeed(), isSynthetic(), isUnread(), latestStoredTimestamp(), NOTIFICATION_LABELS, synthesizeLowStock(), base (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (24): API Routes, Architecture, Constraints & Non-Goals, Dashboard layout hydration, Data Model, `dropship_listings` table (tenant schema), Dropshipping — Listing Management Design Spec, `EditSourceModal.tsx` — shadcn Dialog (+16 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (24): Architecture, Behaviour, Constraints, Data Model, DB migration — `supabase/migrations/016_platform_payouts.sql`, Error handling, Fields, Files Changed (+16 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (11): EMPTY_OPTS, Props, PurchaseInvoiceProps, salesTotalsByCurrency(), simpleTotalsByCurrency(), InvoiceOptions, BulkTotals, computeBulkTotals() (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (27): POST(), GET(), POST(), POST(), POST(), basicAuthHeader(), ebayAdapter, EbayLineItem (+19 more)

### Community 23 - "Community 23"
Cohesion: 0.16
Nodes (7): initialState, usersSlice, UsersState, auditLogsSlice, AppDispatch, AppStore, RootState

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (22): After all tasks land, eBay Listing Creation Implementation Plan, File Structure, Global Constraints, Task 10: `publish.ts` — eBay Inventory/Taxonomy/Account API calls, Task 11: API routes — category search + business policies, Task 12: API route — resumable publish, Task 13: Sidebar link + listings table page (+14 more)

### Community 25 - "Community 25"
Cohesion: 0.09
Nodes (21): 0. Remediation status (updated 2026-07-31), 1. Executive summary, 2.1 High — Unauthenticated destructive webhook (eBay account-deletion), 2.2 High — OAuth tokens stored in plaintext, 2.3 High — Dependency vulnerabilities (`npm audit`), 2.4 Medium — Impersonation issues a magic link for an arbitrary email, 2.5 Medium — Dropshipping table RLS is broader than the feature's intent, 2.6 Low — Proxy fails open when the control plane is unreachable (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.10
Nodes (20): Global Constraints, In-App Notifications Implementation Plan, Known follow-ups (deliberately not in this plan), Phase 0 — Reconcile live schema drift, Phase 1 — Notifications schema, Phase 2 — Pure helpers (TDD), Phase 3 — Redux state, Phase 4 — UI (+12 more)

### Community 28 - "Community 28"
Cohesion: 0.10
Nodes (20): Amazon-only inputs, Amazon Referral Fee rates (UK), Architecture, Calculation Engine, Constraints & Non-Goals, Core formulas, Each platform form (two-column layout on desktop, stacked on mobile), eBay Final Value Fee rates (UK) (+12 more)

### Community 29 - "Community 29"
Cohesion: 0.21
Nodes (18): CURRENCY_BY_SYMBOL, detectCurrency(), isAliExpressSku(), parseAmount(), parsePriceString(), parseStock(), resolveSupplierUrl(), args (+10 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (19): Core simplification, Decisions taken, with rationale, Docs to update in the same commit, Extensibility to email and push, In-app notifications, Low stock fires only on the crossing, Migration checklist, Out of scope for v1 (+11 more)

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (13): RFC-4180, Props, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, VALID_CURRENCIES, validateRow(), CsvValue, Delimiter (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.11
Nodes (18): Average cost comes from a read-only DB view, Costing method: weighted average only (req 14), Currency forced a grouping decision, Data model, Decisions taken, Docs to update in the same commit, Fulfillment charges are recorded, not capitalised (req 12), Inventory batch fields + weighted-average cost (+10 more)

### Community 33 - "Community 33"
Cohesion: 0.30
Nodes (6): MarginFilterBand, matchesListingSearch(), matchesMarginFilter(), SupplierPriceCell(), computeMarginPct(), marginBadgeVariant()

### Community 34 - "Community 34"
Cohesion: 0.22
Nodes (14): buildGetMyeBaySellingRequest(), EbayListing, fetchActiveListings(), parseItem(), buildAddMemberMessageRTQRequest(), buildGetMemberMessagesRequest(), EbayMemberMessage, fetchMemberMessages() (+6 more)

### Community 35 - "Community 35"
Cohesion: 0.11
Nodes (18): audit.ts, csv.ts, currency.ts, date.ts, detectPlatform.ts, excel.ts, filters.ts, generateInvoice.ts (+10 more)

### Community 36 - "Community 36"
Cohesion: 0.21
Nodes (17): GET(), redirectToIntegrations(), redirectToIntegrationsWithError(), GET(), POST(), GET(), PLATFORMS, ReviewOrder (+9 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (22): ListingsTableProps, dropshippingSlice, DropshippingState, initialState, Props, Props, currentUserSlice, CurrentUserState (+14 more)

### Community 38 - "Community 38"
Cohesion: 0.12
Nodes (15): Added, API, Architecture, ConnectionCard change, Data flow, `GET /api/integrations/review`, Integration Order Review — Design Spec, Modified (+7 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (15): 1. Status Vocabulary, 2. Lifecycle Transitions, 3. Database Migration, 4. First-Login Auto-Activation (`auth/confirm`), 5. Proxy Enforcement (`proxy.ts`), 6. New Page: `/account-deactivated`, 7. Admin UI Changes, 8. Files Touched (+7 more)

### Community 40 - "Community 40"
Cohesion: 0.08
Nodes (35): AddTenantModal(), Plan, Props, DeleteTenantModal(), Props, EditTenantModal(), Props, Props (+27 more)

### Community 41 - "Community 41"
Cohesion: 0.24
Nodes (7): Props, initialState, salesSlice, SalesState, SalesInvoiceProps, SalesFilters, Sale

### Community 42 - "Community 42"
Cohesion: 0.43
Nodes (4): companyProfileSlice, CompanyProfileState, initialState, CompanyProfile

### Community 43 - "Community 43"
Cohesion: 0.13
Nodes (14): Branching — always work on a branch, Commit and push gates, During development (feature work), Feature folders, Keeping the graphify graph current, Mandatory docs update — SKILL.md and CLAUDE.md, Project structure: feature folders, Project verifier — the invariants above are enforced, not just documented (+6 more)

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (12): Finding, _marks(), Path, Project-invariant rules for KaufNest Dashboard, and the scanner that applies the, True when this line, or the line above it, carries the allow marker.      Same-l, Apply every applicable rule to one file's content.      `rel_path` must be repo-, One invariant.      `pattern` matches a single line. `path_include` / `path_excl, _route_auth_finding() (+4 more)

### Community 45 - "Community 45"
Cohesion: 0.13
Nodes (14): Global Constraints, Linked Purchase on Sale — Implementation Plan, Placeholder scan, Self-Review, Spec coverage, Task 1: DB migration + `Purchase` type, Task 2: `computeGrossProfit` pure helper + tests, Task 3: AddSaleModal — collapsible "Purchase cost" section (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (14): Call site (inside each generate function), Files Changed, Invoice Custom Fields — Design Spec, Layout (below existing records summary card), New helper, Out of Scope, Passing to generate functions, PDF — generateInvoice (`src/lib/utils/generateInvoice.ts`) (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (15): eslint, jest, jest-environment-jsdom, devDependencies, eslint, jest, jest-environment-jsdom, @tailwindcss/postcss (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (30): POST(), amazonAdapter, AmazonMoney, AmazonOrder, AmazonOrderItem, AmazonOrderItemsResponse, AmazonOrdersResponse, AmazonTokenResponse (+22 more)

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (5): LowStockProduct, initialState, notificationsSlice, NotificationsState, Notification

### Community 50 - "Community 50"
Cohesion: 0.14
Nodes (13): 1. Token Layer (`src/app/globals.css`), 2. Component Improvements, 3. Files to touch, 4. Out of scope, Badge (`src/components/ui/Badge.tsx`), Buttons, Dark theme additions (inside `[data-theme="dark"]`), DataTable / table rows (`src/components/ui/DataTable.tsx`) (+5 more)

### Community 51 - "Community 51"
Cohesion: 0.14
Nodes (13): Data model, eBay API integration, eBay Listing Creation — Design Spec, Error handling & retry, Files changed/added, Out of scope (this spec), Problem, Publish flow (resumable) (+5 more)

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (14): scripts, build, create-tenant-user, dev, encrypt-existing-tokens, lint, prepare, scrape:aliexpress (+6 more)

### Community 53 - "Community 53"
Cohesion: 0.32
Nodes (4): fetchListingsPage, initialState, listingsSlice, ListingsState

### Community 54 - "Community 54"
Cohesion: 0.14
Nodes (13): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Fee fields (`shipping_cost`, `shipping_charged`, `advertising_fee`, `platform_fee`), Files in this folder, Inventory link + VAT (additive fields on `Sale`), Linked Purchase (cost of goods), Order status + returns (additive fields on `Sale`) (+5 more)

### Community 55 - "Community 55"
Cohesion: 0.15
Nodes (12): Dropshipping Listing Management — Implementation Plan, Global Constraints, Self-Review, Task 1: DB Migration + TypeScript Types, Task 2: `detectPlatform` Utility + Tests, Task 3: `dropshippingSlice` + Tests, Task 4: Store Wiring + Sidebar Entry, Task 5: eBay Listings Fetcher + Scope Update (+4 more)

### Community 56 - "Community 56"
Cohesion: 0.15
Nodes (12): File Map, Global Constraints, Profit Planner Implementation Plan, Self-Review, Task 1: Fee constants, Task 2: Calculation library + unit tests, Task 3: Sidebar nav entry, Task 4: `PlannerResults` component (+4 more)

### Community 57 - "Community 57"
Cohesion: 0.15
Nodes (12): Amazon Inbound Freight (Amazon FBA only), Break-even update, Calculation, Calculation, Constraints, Custom Charge Field (both planners), Files Changed, Overview (+4 more)

### Community 58 - "Community 58"
Cohesion: 0.15
Nodes (12): 1. `src/lib/utils/filters.ts`, 2. `src/components/ui/FilterBar.tsx`, 3. Each slice thunk (`fetchSalesPage` / `fetchPurchasesPage` / `fetchExpensesPage`), 4. Each `page.tsx` (sales, purchases, expenses), Components & data flow, Files changed, Out of scope, Problem (+4 more)

### Community 59 - "Community 59"
Cohesion: 0.19
Nodes (9): Props, expensesSlice, ExpensesState, initialState, ExpenseInvoiceProps, ExpenseFilters, PageRequest, rangeFor() (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.15
Nodes (12): Adding a third platform, eBay account-deletion webhook (`/api/notifications/ebay-account-deletion`), eBay messages (Trading API), `external_order_id` dedup contract, Files, Gotchas, Merge rule (re-import field ownership), Platform integrations library (`src/lib/integrations/`) (+4 more)

### Community 61 - "Community 61"
Cohesion: 0.30
Nodes (11): git_lines(), Run a git command that emits NUL-separated paths, returning them as a list., all_tracked(), collect(), main(), Path, Verify the working tree's changed files against the project's invariants.  Two w, Keep source files we have rules for, and drop other people's code.      `.worktr (+3 more)

### Community 62 - "Community 62"
Cohesion: 0.17
Nodes (11): Backend, `EditTenantModal`, Files touched, Frontend, Out of scope, `page.tsx`, Problem, Route: `PATCH /api/admin/tenants/[id]` (+3 more)

### Community 63 - "Community 63"
Cohesion: 0.25
Nodes (6): fetchInventoryPage, fetchInventorySelectors, initialState, inventorySlice, InventoryState, ProductSelector

### Community 64 - "Community 64"
Cohesion: 0.17
Nodes (11): Badge.tsx, Button.tsx, DataTable.tsx, FilterBar.tsx, FormFields.tsx, Modal.tsx, StatCard.tsx, ThemeProvider.tsx (+3 more)

### Community 65 - "Community 65"
Cohesion: 0.18
Nodes (10): Data model, Dropshipping Margin Coloring + EU Customs Tax — Design Spec, Editing, Files changed, Margin calculation, Out of scope, Problem, Solution (+2 more)

### Community 66 - "Community 66"
Cohesion: 0.18
Nodes (10): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Files in this folder, Inventory link + VAT (additive fields on `Purchase`), Pagination data flow, Purchases feature, Sale link (`sale_id`) (+2 more)

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (9): deny(), main(), merged_content(), proposed_content(), Path, PreToolUse hook: refuse a Write/Edit that would break a project invariant.  Runs, The text this tool call wants to introduce., New text plus enough of the existing file for file-level rules to work.      A r (+1 more)

### Community 68 - "Community 68"
Cohesion: 0.20
Nodes (9): Adding a rule, Files, Known baseline, Project verifiers, Rule set, Running it, Severities, Suppressing a rule (+1 more)

### Community 69 - "Community 69"
Cohesion: 0.20
Nodes (9): Browser Verification Checklist, File Map, Global Constraints, Integration Order Review Implementation Plan, Task 1: GET /api/integrations/review, Task 2: POST /api/integrations/review/import, Task 3: Review page UI, Task 4: ConnectionCard + vercel.json (+1 more)

### Community 70 - "Community 70"
Cohesion: 0.20
Nodes (9): Dropshipping Margin Coloring + EU Customs Tax Implementation Plan, Final check, Global Constraints, Task 1: Migration + `DropshipListing` type, Task 2: Pure margin calculation helper, Task 3: `SupplierPriceCell` rewrite (badge + tax breakdown), Task 4: Slice — `updateCustomsTax` action + preserve/recompute logic, Task 5: Editable customs tax rate (modal + PATCH route) (+1 more)

### Community 71 - "Community 71"
Cohesion: 0.20
Nodes (9): CSV import/export, Data flow (the pattern every mutation follows), Delete gating (super_admin + permission overrides), Expenses feature, Files in this folder, Pagination data flow, Shared dependencies (live outside this folder on purpose), Tests (+1 more)

### Community 72 - "Community 72"
Cohesion: 0.38
Nodes (9): hydrateExpenses, hydrateProducts, hydrateListingDrafts, hydrateMessages, hydratePurchases, hydrateSales, hydrateAuditLogs, makeStore() (+1 more)

### Community 73 - "Community 73"
Cohesion: 0.22
Nodes (8): Browser Verification Checklist, File Map, Global Constraints, Task 1: PATCH API route, Task 2: EditTenantModal component, Task 3: Wire up TenantActions and page.tsx, Task 4: Update docs, Tenant Edit Implementation Plan

### Community 74 - "Community 74"
Cohesion: 0.22
Nodes (8): Design Refresh (Emerald Light / Violet Dark) Implementation Plan, Global Constraints, Task 1: Update design tokens (`globals.css`), Task 2: Badge — vivid fill and font weight, Task 3: StatCard — left border accent, icon prop, hover lift, Task 4: Dashboard page — add icons to StatCards, Task 5: DataTable — primary-muted row hover, Task 6: Sidebar — active pill + icon colour + hover transition

### Community 75 - "Community 75"
Cohesion: 0.22
Nodes (8): Global Constraints, Task 1: Database Migration, Task 2: TenantStatus Type + Admin UI, Task 3: API Route Fixes, Task 4: First-Login Auto-Activation (`auth/confirm`), Task 5: Proxy Enforcement + `/account-deactivated` Page, Task 6: Update CLAUDE.md, Tenant Status Lifecycle Implementation Plan

### Community 76 - "Community 76"
Cohesion: 0.22
Nodes (8): Final check, Global Constraints, Orders / Purchases / Expenses Text Search Implementation Plan, Task 1: `filters.ts` — search field, sanitize helper, updated predicates, Task 2: `FilterBar.tsx` — debounced search input, Task 3: Sales (Orders) — wire up search, Task 4: Purchases — wire up search, Task 5: Expenses — wire up search

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (8): Dropshipping Table Filters + Sorting — Design Spec, Files changed, Filters, Out of scope, Problem, Solution, Sorting, Testing

### Community 78 - "Community 78"
Cohesion: 0.22
Nodes (8): API routes, Data flow, Dropshipping feature, eBay API notes, Files in this folder, Margin calculation (customs_tax_amount), Shared dependencies, Tests

### Community 79 - "Community 79"
Cohesion: 0.22
Nodes (8): Data flow (the pattern every mutation follows), Files in this folder, How stock levels actually update — read this before changing anything here, Inventory feature, Pagination data flow, Shared dependencies (live outside this folder on purpose), Split selector fetch (critical constraint), Tests

### Community 80 - "Community 80"
Cohesion: 0.17
Nodes (11): Gotchas, Gotchas — Amazon VAT-report import (`priceColumnsAreLineTotals`/`vatRateIsFraction`), Gotchas — CSV import formats (German support), Gotchas — date-order detection, Gotchas — detail page, Gotchas — fee fields, Gotchas — `refunded_amount` idempotency, Gotchas — server-side pagination (+3 more)

### Community 81 - "Community 81"
Cohesion: 0.22
Nodes (8): Data flow, Deactivate/reactivate (revoke access, never a hard delete), Files in this folder, Permission overrides (additive per-user grants), Related files outside this folder (cannot be colocated), Shared dependencies (live outside this folder on purpose), Tests, Users feature

### Community 82 - "Community 82"
Cohesion: 0.22
Nodes (8): canDeactivateUser(), DeactivateGuardResult, GuardProfile, accountant, admin, deactivatedAccountant, superAdmin1, superAdmin2

### Community 83 - "Community 83"
Cohesion: 0.25
Nodes (7): `.claude/` — agent harness for this repo, Directories, Hook wiring (`settings.json`), `hooks/`, Requirements, Scratch state (gitignored), Why a dedicated API key variable

### Community 84 - "Community 84"
Cohesion: 0.25
Nodes (7): Global Constraints, Platform Payouts Implementation Plan, Task 1: DB migration + TypeScript type + pure helper + tests, Task 2: Redux slice + store registration, Task 3: Layout hydration + StoreProvider wiring, Task 4: Overview page — updated balance cards, Task 5: RecordTransferModal

### Community 86 - "Community 86"
Cohesion: 0.25
Nodes (7): AliExpress price scraper (local), Beating AliExpress throttling (important), Files, Notes, Prerequisites, Usage, Why this runs locally, not on Vercel

### Community 87 - "Community 87"
Cohesion: 0.25
Nodes (7): API routes, Data flow (different from other features), Files in this folder, Integrations feature, Plan gating, Shared dependencies, Tests

### Community 88 - "Community 88"
Cohesion: 0.50
Nodes (6): COMPANY_PROFILE_ROLES, SettingsPage(), validateEmail(), validateIBAN(), validateVATId(), validateVATRate()

### Community 89 - "Community 89"
Cohesion: 0.25
Nodes (7): client.ts, control.ts, Gotcha: `src/proxy.ts` doesn't use either of these, managementApi.ts, server.ts, Supabase clients (`src/lib/supabase/`), Where these are used

### Community 90 - "Community 90"
Cohesion: 0.25
Nodes (7): Apply order (for a fresh Project B, disaster recovery), File map + apply status, Gotchas, Index rationale (004_performance_indexes.sql), Supabase migrations (`supabase/`), The "2 places" rule for schema changes, Using `run_on_all_tenant_schemas`

### Community 91 - "Community 91"
Cohesion: 0.52
Nodes (6): build_prompt(), clip(), main(), Path, truncated(), verdict_for()

### Community 92 - "Community 92"
Cohesion: 0.38
Nodes (6): code_changed(), lock_is_held(), main(), Path, Stop hook: keep graphify-out/ in step with the code that just changed.  CLAUDE.m, True when another rebuild owns the lock and it hasn't gone stale.

### Community 93 - "Community 93"
Cohesion: 0.29
Nodes (6): Global Constraints, Invoice Custom Fields Implementation Plan, Self-Review, Task 1: Export `InvoiceOptions` type and add `addBillTo` helper to `generateInvoice.ts`, Task 2: Update `InvoiceModal` with customer info UI and extra fields, Task 3: Update docs

### Community 94 - "Community 94"
Cohesion: 0.29
Nodes (6): name, overrides, postcss, sharp, private, version

### Community 95 - "Community 95"
Cohesion: 0.29
Nodes (6): Architecture, Features, KaufNest Dashboard, Local Development, Stack, Testing

### Community 96 - "Community 96"
Cohesion: 0.29
Nodes (6): Cross-cutting state & infra, Dashboard shell + Overview, Feature folders (each documents itself — start there), Files at this level, `_lib/` — pure helpers for the Overview page, Shared shell components (live outside, in `src/components/layout/`)

### Community 97 - "Community 97"
Cohesion: 0.36
Nodes (5): ConnectionCardProps, initialState, integrationsSlice, IntegrationsState, PlatformConnection

### Community 98 - "Community 98"
Cohesion: 0.29
Nodes (6): Data flow, Files in this folder, Listings feature, Publish flow, Shared dependencies, Tests

### Community 99 - "Community 99"
Cohesion: 0.29
Nodes (6): Data flow, Files in this folder, Messages feature, Shared dependencies, Tests, v1 scope: reply-only, no new conversations

### Community 101 - "Community 101"
Cohesion: 0.47
Nodes (5): check(), guard_denies(), main(), Tests for the verifier rules and the PreToolUse guard.  Not part of the Jest sui, End-to-end: does the PreToolUse hook actually emit a deny for this write?

### Community 102 - "Community 102"
Cohesion: 0.33
Nodes (5): Dropshipping Table Filters + Sorting Implementation Plan, Final check, Global Constraints, Task 1: Pure filter-matching helpers, Task 2: Filter row + DataTable sorting in `ListingsTable.tsx`

### Community 103 - "Community 103"
Cohesion: 0.33
Nodes (5): npx, playwright, supabase-control, supabase-data, @playwright/mcp

### Community 104 - "Community 104"
Cohesion: 0.33
Nodes (5): fra1, buildCommand, framework, installCommand, regions

### Community 105 - "Community 105"
Cohesion: 0.33
Nodes (3): { email, name, password, role = "accountant", schema = "tenant_kaufnest" }, resetPassword, VALID_ROLES

### Community 106 - "Community 106"
Cohesion: 0.53
Nodes (5): DRY_RUN, encryptToken(), getKey(), isEncrypted(), main()

### Community 107 - "Community 107"
Cohesion: 0.33
Nodes (5): API routes (cannot be colocated — Next.js pins routes to `app/api/...`), Files in this folder, KaufNest platform admin panel, Shared dependencies, Tests

### Community 108 - "Community 108"
Cohesion: 0.33
Nodes (5): Auth feature, Files in this folder, Related files outside this folder (cannot be colocated), Shared dependencies, Tests

### Community 109 - "Community 109"
Cohesion: 0.33
Nodes (5): Audit Logs feature, Files in this folder, Important: the slice lives elsewhere — on purpose, Shared dependencies, Tests

### Community 111 - "Community 111"
Cohesion: 0.33
Nodes (5): Gotchas, Minimal file set for common changes, Pagination data flow, Test command, Working on the Audit Logs feature

### Community 112 - "Community 112"
Cohesion: 0.33
Nodes (5): Data flow, Files in this folder, Planner feature, Shared dependencies, Tests

### Community 113 - "Community 113"
Cohesion: 0.33
Nodes (5): Files in this folder, Settings feature, Shared dependencies, Tests, Why `generateInvoice` is NOT colocated here

### Community 114 - "Community 114"
Cohesion: 0.12
Nodes (16): Blast radius, CSV import — ambiguous date order, Data repair — 145 rows, separate from the code change, Decisions taken, Design, Detect the order from the file, do not assume it, Evidence — 145 wrong rows in production, Files affected (+8 more)

### Community 115 - "Community 115"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Auth feature

### Community 116 - "Community 116"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Expenses feature

### Community 117 - "Community 117"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Integrations feature

### Community 118 - "requireIntegrationAdmin"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Inventory feature

### Community 119 - "eBay Listing Creation — Design Spec"
Cohesion: 0.40
Nodes (4): Gotchas, Listings feature playbook, Minimal file set per change type, Tests

### Community 120 - "listingsSlice.ts"
Cohesion: 0.40
Nodes (4): Gotchas, Messages feature playbook, Minimal file set per change type, Tests

### Community 121 - "Badge.tsx"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Planner feature

### Community 122 - "route.ts"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Purchases feature

### Community 123 - "route.ts"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Settings feature

### Community 124 - "StoreProvider.tsx"
Cohesion: 0.40
Nodes (4): Adding a new feature with its own Supabase collection, Overview page changes, Test command, Working on the Dashboard shell / Overview

### Community 125 - "EditPurchaseModal.tsx"
Cohesion: 0.40
Nodes (4): Gotchas, Minimal file set for common changes, Test command, Working on the Users feature

### Community 126 - "Listings feature"
Cohesion: 0.50
Nodes (3): Gotchas, Minimal file set for common changes, Working on the admin panel

### Community 127 - "FilterBar.tsx"
Cohesion: 0.50
Nodes (3): Dropshipping — Agent Playbook, Gotchas, Minimal file set per change type

### Community 128 - "Listings feature playbook"
Cohesion: 0.50
Nodes (3): Files, Related code, Supabase SQL (`supabase/`)

### Community 133 - "husky"
Cohesion: 0.12
Nodes (16): A refund adjusts its matched sale — it never becomes its own row, Amazon import — SALE and REFUND only, Decisions taken, Design, Evidence — from the real April 2026 report, Files affected, Idempotency: `refunded_amount` guards the re-import, Ordering and dedup — two lessons carried over (+8 more)

### Community 134 - "@playwright/test"
Cohesion: 0.12
Nodes (15): Docs to update when done (mandatory per `AGENTS.md`), Hypothesis 1 (most likely) — `<MessageStatus>All</MessageStatus>` is not a valid enum, Hypothesis 2 — OAuth scope doesn't cover Trading API messaging, Hypothesis 3 — Date range rejected, Hypothesis 4 — Upsert failure, Independent bug to fix regardless — pagination parsing, Open questions, Phase 0 — Capture the real error (blocking, ~5 minutes) (+7 more)

### Community 137 - "@types/jest"
Cohesion: 0.12
Nodes (15): Amazon sales import — line totals, shipping, VAT and returns, Column semantics for the `amazon` format, Decisions taken, with rationale, Evidence — from a real April 2026 report, Files affected, Out of scope, Partial-success reporting — new behaviour, Per-import restock toggle (+7 more)

### Community 138 - "@types/node"
Cohesion: 0.13
Nodes (14): Categorisation, Column mapping (`vorsteuer`), Credit notes → negative expenses, Decisions taken, Design, Evidence — the real Q2-2026 sheet, Expenses import — German VAT ledger format, One shared bug this depends on (+6 more)

### Community 139 - "@types/react"
Cohesion: 0.08
Nodes (22): State, SetPasswordPage(), State, FormState, FormState, geistMono, geistSans, metadata (+14 more)

### Community 141 - "page.tsx"
Cohesion: 0.14
Nodes (13): Amazon Import — Line Totals, Shipping, VAT and Returns Implementation Plan, File structure, Global Constraints, Known follow-ups (deliberately not in this plan), Open decision for the user, Task 1: Format semantic flags + fractional VAT rate, Task 2: Line-total price semantics and the replaced total validation, Task 3: Explicit vat_amount column (+5 more)

### Community 142 - "@types/react"
Cohesion: 0.14
Nodes (13): Expenses Import Formats Implementation Plan, File structure, Global Constraints, Known limitations, carried from the spec, Task 1: Fix embedded newlines in CSV parsing, Task 2: Shared header vocabulary, Task 3: Allow negative expense amounts, Task 4: Multilingual category mapping (+5 more)

### Community 143 - "typescript"
Cohesion: 0.17
Nodes (10): Props, ParsedRow, fetchPurchasesPage, initialState, purchasesSlice, PurchasesState, computeGrossProfit(), computeNetProceeds() (+2 more)

### Community 154 - "createControlClient"
Cohesion: 0.32
Nodes (10): DELETE(), errorMessage(), makeServiceClient(), PATCH(), verifyPlatformAdmin(), addExposedSchema(), PostgrestConfig, projectRefFromUrl() (+2 more)

### Community 155 - "route.ts"
Cohesion: 0.21
Nodes (10): cleanupEbayUser(), POST(), getApplicationToken(), EbayPublicKeyResponse, fetchEbayPublicKey(), PUBLIC_KEY_URL(), publicKeyCache, ParsedEbaySignatureHeader (+2 more)

### Community 158 - "File structure"
Cohesion: 0.22
Nodes (8): CSV Import Date Order Implementation Plan, File structure, Global Constraints, Not in this plan, Task 1: `detectDateOrder` and an order-aware `parseFlexibleDate`, Task 2: Thread the order through `validateRowForFormat`, Task 3: Modal — detection, conflict refusal, override selector, Task 4: Documentation

### Community 159 - "File structure"
Cohesion: 0.22
Nodes (8): Amazon Refunds Implementation Plan, File structure, Global Constraints, Known limitations, carried from the spec, Task 1: Schema, type and badge, Task 2: Invert the skip set and parse REFUND rows, Task 3: Modal — replace return machinery with refunds, Task 4: Documentation

### Community 165 - "vatPreservation.ts"
Cohesion: 0.80
Nodes (3): resolveVatAmount(), VatFormSnapshot, vatInputsUnchanged()

## Knowledge Gaps
- **1023 isolated node(s):** `supabase-data`, `supabase-control`, `npx`, `@playwright/mcp`, `$schema` (+1018 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Community 8` to `Community 94`, `Planner Custom Charges & Freight`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `jspdf` connect `Planner Custom Charges & Freight` to `Community 8`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `formatCurrency()` connect `Integration Order Review` to `Design Refresh Token System`, `Community 33`, `Planner VAT & Break-even Logic`, `Planner Fee Calculation Engine`, `Community 40`, `Community 9`, `Community 10`, `Community 15`, `Community 17`, `Community 21`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `supabase-data`, `supabase-control`, `npx` to the rest of the system?**
  _1023 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dropshipping Listing Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.07662337662337662 - nodes in this community are weakly interconnected._
- **Should `Design Refresh Token System` be split into smaller, more focused modules?**
  _Cohesion score 0.08202323991797676 - nodes in this community are weakly interconnected._
- **Should `Tenant Edit & Admin Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.12234042553191489 - nodes in this community are weakly interconnected._