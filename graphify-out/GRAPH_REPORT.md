# Graph Report - .  (2026-06-24)

## Corpus Check
- 227 files · ~100,940 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 929 nodes · 2206 edges · 85 communities (49 shown, 36 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_OAuth Integration Callback Flow|OAuth Integration Callback Flow]]
- [[_COMMUNITY_Platform Integration Pages|Platform Integration Pages]]
- [[_COMMUNITY_Build Tooling & Dependencies|Build Tooling & Dependencies]]
- [[_COMMUNITY_Audit Log Viewer|Audit Log Viewer]]
- [[_COMMUNITY_SaaS Migration & Admin Docs|SaaS Migration & Admin Docs]]
- [[_COMMUNITY_Admin & Billing Routes|Admin & Billing Routes]]
- [[_COMMUNITY_Purchase & Tenant Modals|Purchase & Tenant Modals]]
- [[_COMMUNITY_Dropshipping Listings UI|Dropshipping Listings UI]]
- [[_COMMUNITY_Marketplace Planner Components|Marketplace Planner Components]]
- [[_COMMUNITY_App Shell Layout|App Shell Layout]]
- [[_COMMUNITY_Expense & Purchase Views|Expense & Purchase Views]]
- [[_COMMUNITY_Sales Entry Modal|Sales Entry Modal]]
- [[_COMMUNITY_Financial Import Modals|Financial Import Modals]]
- [[_COMMUNITY_Sales State & Import|Sales State & Import]]
- [[_COMMUNITY_TypeScript Path Aliases|TypeScript Path Aliases]]
- [[_COMMUNITY_Inventory Product Modals|Inventory Product Modals]]
- [[_COMMUNITY_Invoice Generation|Invoice Generation]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_User & Sales Import Modals|User & Sales Import Modals]]
- [[_COMMUNITY_Shared Feature Slices|Shared Feature Slices]]
- [[_COMMUNITY_Feature Documentation Cluster|Feature Documentation Cluster]]
- [[_COMMUNITY_Admin Tenant Management|Admin Tenant Management]]
- [[_COMMUNITY_Expense Entry Modal|Expense Entry Modal]]
- [[_COMMUNITY_Integrations State|Integrations State]]
- [[_COMMUNITY_Redux Store Core|Redux Store Core]]
- [[_COMMUNITY_Current User State|Current User State]]
- [[_COMMUNITY_Dropshipping Feature Docs|Dropshipping Feature Docs]]
- [[_COMMUNITY_Cross-Feature CLAUDE Docs|Cross-Feature CLAUDE Docs]]
- [[_COMMUNITY_Integration Order Review API|Integration Order Review API]]
- [[_COMMUNITY_Expenses State|Expenses State]]
- [[_COMMUNITY_Purchases State|Purchases State]]
- [[_COMMUNITY_Plan Gate & Dropshipping API|Plan Gate & Dropshipping API]]
- [[_COMMUNITY_Company Profile State|Company Profile State]]
- [[_COMMUNITY_Planner Calculations|Planner Calculations]]
- [[_COMMUNITY_Users & Tenant Auth|Users & Tenant Auth]]
- [[_COMMUNITY_Dev Feedback & Feature Plans|Dev Feedback & Feature Plans]]
- [[_COMMUNITY_Integrations Feature Docs|Integrations Feature Docs]]
- [[_COMMUNITY_Supabase Tenant Provisioning|Supabase Tenant Provisioning]]
- [[_COMMUNITY_Vercel Deployment Config|Vercel Deployment Config]]
- [[_COMMUNITY_Listings Refresh & Auth Guard|Listings Refresh & Auth Guard]]
- [[_COMMUNITY_Settings & Invoice Utils|Settings & Invoice Utils]]
- [[_COMMUNITY_Audit Logs Documentation|Audit Logs Documentation]]
- [[_COMMUNITY_Auth Bug Patterns|Auth Bug Patterns]]
- [[_COMMUNITY_Privacy Policy Page|Privacy Policy Page]]
- [[_COMMUNITY_Sales & Stock Triggers|Sales & Stock Triggers]]
- [[_COMMUNITY_Supabase Client Docs|Supabase Client Docs]]
- [[_COMMUNITY_UI Theme Components|UI Theme Components]]
- [[_COMMUNITY_Project Structure Docs|Project Structure Docs]]
- [[_COMMUNITY_Dashboard Documentation|Dashboard Documentation]]
- [[_COMMUNITY_ESLint Configuration|ESLint Configuration]]
- [[_COMMUNITY_Platform Integrations Migration|Platform Integrations Migration]]
- [[_COMMUNITY_Jest Test Config|Jest Test Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_Order Review Plan & Spec|Order Review Plan & Spec]]
- [[_COMMUNITY_Planner Plan & Spec|Planner Plan & Spec]]
- [[_COMMUNITY_Tenant Edit Plan & Spec|Tenant Edit Plan & Spec]]
- [[_COMMUNITY_PostCSS Configuration|PostCSS Configuration]]
- [[_COMMUNITY_KaufNest Project Overview|KaufNest Project Overview]]
- [[_COMMUNITY_Working Agreement Docs|Working Agreement Docs]]
- [[_COMMUNITY_Audit Log Detail Modal|Audit Log Detail Modal]]
- [[_COMMUNITY_Dashboard Overview Page|Dashboard Overview Page]]
- [[_COMMUNITY_Dropshipping Feature|Dropshipping Feature]]
- [[_COMMUNITY_Expenses Feature|Expenses Feature]]
- [[_COMMUNITY_eBay Account Deletion|eBay Account Deletion]]
- [[_COMMUNITY_Integrations Library|Integrations Library]]
- [[_COMMUNITY_Inventory Feature|Inventory Feature]]
- [[_COMMUNITY_Purchases Feature|Purchases Feature]]
- [[_COMMUNITY_README Overview|README Overview]]
- [[_COMMUNITY_Tenant Type Definition|Tenant Type Definition]]
- [[_COMMUNITY_Sales Feature|Sales Feature]]
- [[_COMMUNITY_Settings Feature|Settings Feature]]
- [[_COMMUNITY_Initial DB Migration|Initial DB Migration]]
- [[_COMMUNITY_Supabase Migrations|Supabase Migrations]]
- [[_COMMUNITY_Concurrent Index Creation|Concurrent Index Creation]]
- [[_COMMUNITY_UI Button Component|UI Button Component]]
- [[_COMMUNITY_DataTable Component|DataTable Component]]
- [[_COMMUNITY_Form Fields Component|Form Fields Component]]
- [[_COMMUNITY_Modal Component|Modal Component]]
- [[_COMMUNITY_StatCard Component|StatCard Component]]
- [[_COMMUNITY_Toast Component|Toast Component]]
- [[_COMMUNITY_Users Feature|Users Feature]]
- [[_COMMUNITY_Date Utility|Date Utility]]

## God Nodes (most connected - your core abstractions)
1. `useAppDispatch` - 44 edges
2. `useAppSelector` - 38 edges
3. `Button` - 34 edges
4. `useToast()` - 25 edges
5. `createControlClient()` - 24 edges
6. `Currency` - 24 edges
7. `createClient()` - 23 edges
8. `createTenantClient()` - 21 edges
9. `cn()` - 21 edges
10. `vatAmountFromGross()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `requireIntegrationAdmin (authGuard.ts)` --semantically_similar_to--> `hasPermission / canAccessRoute / PERMISSIONS (permissions.ts)`  [INFERRED] [semantically similar]
  src/lib/integrations/SKILL.md → src/lib/utils/SKILL.md
- `Feature-Folder Reorg Progress` --implements--> `Feature Folder Convention (Colocated Architecture)`  [INFERRED]
  REORG_PROGRESS.md → AGENTS.md
- `Shared Components (3+ Features Rule)` --conceptually_related_to--> `auditLogsSlice (Shared Slice — Not Colocated)`  [INFERRED]
  AGENTS.md → src/app/dashboard/audit-logs/CLAUDE.md
- `isPlatformAdmin() Helper` --references--> `Control Plane (Project A — Tenant Registry)`  [EXTRACTED]
  src/app/admin/SKILL.md → SAAS_MIGRATION.md
- `Dashboard Shell + Overview (layout.tsx)` --references--> `createControlClient (Server-Only Control Plane Client)`  [EXTRACTED]
  src/app/dashboard/CLAUDE.md → SAAS_MIGRATION.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tenant Provisioning Flow (provision_tenant_schema + addExposedSchema + inviteUserByEmail)** — admin_claude_md_provision_tenant_route, saas_migration_md_provision_tenant_schema, saas_migration_md_addexposedschema, saas_migration_md_createserviceclientfortenant [EXTRACTED 1.00]
- **Dashboard Hydration Pattern (layout fetches → StoreProvider dispatches → page reads Redux)** — dashboard_claude_md_layout_hydration, plan_dropshipping_dropshippingslice, dashboard_skill_md_add_new_feature, saas_migration_md_createclient [EXTRACTED 0.95]
- **Plan-Gated Features (Integrations, Dropshipping, Planner — all require Pro/Business)** — saas_migration_md_plangating, plan_dropshipping_page, plan_planner_page, plan_integration_order_review_get_route [EXTRACTED 0.95]
- **Supabase write then Redux slice update then audit log pattern (shared by Sales, Expenses, Purchases, Inventory, Users)** — supabase_skill_client_ts, utils_skill_audit_ts, expenses_claude_expensesslice, purchases_claude_purchasesslice, sales_claude_salesslice, inventory_claude_inventoryslice, users_claude_usersslice [EXTRACTED 0.95]
- **hasPlatformIntegrations plan gate used by Integrations, Dropshipping, and Planner** — integrations_claude_plan_gate, dropshipping_claude_page, planner_claude_page, integrations_claude_page [EXTRACTED 0.95]
- **Inventory stock change driven by DB triggers across Sales, Purchases, and Inventory features** — inventory_claude_db_trigger_stock, sales_skill_restock_stock_trigger, purchases_claude_inventory_link, inventory_claude_inventoryslice [EXTRACTED 0.95]

## Communities (85 total, 36 thin omitted)

### Community 0 - "OAuth Integration Callback Flow"
Cohesion: 0.06
Nodes (53): GET(), redirectToIntegrations(), redirectToIntegrationsWithError(), GET(), POST(), EbayInventoryItem, EbayListing, EbayOffer (+45 more)

### Community 1 - "Platform Integration Pages"
Cohesion: 0.08
Nodes (37): ConnectionCard(), DropshippingPage(), ExpensesPage(), IntegrationsContent(), PLATFORM_LABELS, PLATFORMS, InventoryPage(), PageHeader() (+29 more)

### Community 2 - "Build Tooling & Dependencies"
Cohesion: 0.04
Nodes (47): dependencies, @base-ui/react, class-variance-authority, clsx, jspdf, jspdf-autotable, lucide-react, next (+39 more)

### Community 3 - "Audit Log Viewer"
Cohesion: 0.07
Nodes (35): AuditLogsPage(), AuditLogDetailModal(), Props, PLATFORM_LABELS, STATUS_VARIANTS, DashboardPage(), describeRange(), FALLBACK_COLORS (+27 more)

### Community 4 - "SaaS Migration & Admin Docs"
Cohesion: 0.06
Nodes (46): Admin Panel Feature (/admin), impersonate/route.ts (Magic Link + Cookie), provision-tenant/route.ts (POST Provisioning Flow), addExposedSchema Automation (Exposed Schemas Gotcha), isPlatformAdmin() Helper, SaaS Migration (Multi-Tenant Conversion), auth/confirm/route.ts (OTP Verify + Redirect), Auth Feature (login/forgot-password/set-password) (+38 more)

### Community 5 - "Admin & Billing Routes"
Cohesion: 0.11
Nodes (29): AdminLayout(), POST(), GET(), DashboardLayout(), cleanupEbayUser(), POST(), errorMessage(), POST() (+21 more)

### Community 6 - "Purchase & Tenant Modals"
Cohesion: 0.10
Nodes (30): CURRENCIES, makeDefaults(), Props, today(), Plan, Props, blankForm, CATEGORIES (+22 more)

### Community 7 - "Dropshipping Listings UI"
Cohesion: 0.12
Nodes (25): EditSourceModal(), EditSourceModalProps, PlatformBadge(), ListingsTable(), ListingsTableProps, SourceBadge(), cn(), PATCH() (+17 more)

### Community 8 - "Marketplace Planner Components"
Cohesion: 0.10
Nodes (24): AmazonPlanner(), DEFAULT_FORM, FormState, DEFAULT_FORM, EbayPlanner(), FormState, PlannerResults(), PlannerResultsProps (+16 more)

### Community 9 - "App Shell Layout"
Cohesion: 0.08
Nodes (21): geistMono, geistSans, metadata, FormState, FormState, State, DashboardShell(), Props (+13 more)

### Community 10 - "Expense & Purchase Views"
Cohesion: 0.14
Nodes (21): CATEGORIES, DeleteConfirmModal(), Props, PLATFORMS, Button, ButtonProps, ButtonSize, ButtonVariant (+13 more)

### Community 11 - "Sales Entry Modal"
Cohesion: 0.14
Nodes (20): AddSaleModal(), CURRENCIES, FormState, makeDefaults(), PLATFORMS, Props, today(), blankForm (+12 more)

### Community 12 - "Financial Import Modals"
Cohesion: 0.10
Nodes (21): AddExpenseModal(), AddPurchaseModal(), EditPurchaseModal(), ImportExpensesModal(), Props, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, VALID_CATEGORIES (+13 more)

### Community 13 - "Sales State & Import"
Cohesion: 0.13
Nodes (19): Props, ParsedRow, initialState, salesSlice, SalesState, Sale, DEFAULT_EXPENSE_FILTERS, DEFAULT_PURCHASE_FILTERS (+11 more)

### Community 14 - "TypeScript Path Aliases"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 15 - "Inventory Product Modals"
Cohesion: 0.16
Nodes (13): AddProductModal(), defaults, FormState, Props, blankForm, EditProductModal(), FormState, Props (+5 more)

### Community 16 - "Invoice Generation"
Cohesion: 0.20
Nodes (17): ExpenseInvoiceProps, InvoiceModal(), InvoiceType, Props, PurchaseInvoiceProps, SalesInvoiceProps, totals(), addFooter() (+9 more)

### Community 17 - "TypeScript Configuration"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 18 - "User & Sales Import Modals"
Cohesion: 0.19
Nodes (14): EditUserModal(), ROLES, ImportSalesModal(), Props, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, VALID_CURRENCIES, VALID_PLATFORMS (+6 more)

### Community 19 - "Shared Feature Slices"
Cohesion: 0.17
Nodes (11): auditLogsSlice, dropshippingSlice, DropshippingState, initialState, AuditAction, AuditEntity, DashboardStats, DropshipListing (+3 more)

### Community 20 - "Feature Documentation Cluster"
Cohesion: 0.18
Nodes (15): expensesSlice Redux Slice, Supabase-write then slice-update then audit-log mutation pattern, inventorySlice Redux Slice, Inventory page.tsx, ImportPurchasesModal Component, Purchases page.tsx, purchasesSlice Redux Slice, ImportSalesModal Component (+7 more)

### Community 21 - "Admin Tenant Management"
Cohesion: 0.24
Nodes (9): PLAN_VARIANT, STATUS_VARIANT, AddTenantModal(), EditTenantModal(), Props, Props, TenantActions(), Tenant (+1 more)

### Community 22 - "Expense Entry Modal"
Cohesion: 0.23
Nodes (11): CATEGORIES, CURRENCIES, FormState, makeDefaults(), Props, today(), FormState, FormState (+3 more)

### Community 23 - "Integrations State"
Cohesion: 0.24
Nodes (8): ConnectionCardProps, initialState, integrationsSlice, IntegrationsState, makeStore(), StoreProvider(), StoreProviderProps, PlatformConnection

### Community 24 - "Redux Store Core"
Cohesion: 0.20
Nodes (6): inventorySlice, AppDispatch, AppStore, RootState, initialState, usersSlice

### Community 25 - "Current User State"
Cohesion: 0.29
Nodes (7): Props, currentUserSlice, CurrentUserState, initialState, UsersState, Profile, TenantPlan

### Community 26 - "Dropshipping Feature Docs"
Cohesion: 0.20
Nodes (10): PATCH /api/dropshipping/listings/[id], detectPlatform Utility, dropshippingSlice Redux Slice, EditSourceModal Component, hydrateListings Redux Action, PlatformBadge Component (Dropshipping), updateListingSource Redux Action, upsertListings Redux Action (+2 more)

### Community 27 - "Cross-Feature CLAUDE Docs"
Cohesion: 0.20
Nodes (10): ImportExpensesModal Component, Expenses page.tsx, Expense VAT pattern (additive vat_rate/vat_amount fields), current_stock is DB-trigger-derived (not client-editable) rationale, DB Trigger stock sync (apply_purchase_stock_change/apply_sale_stock_change), Purchase-to-Inventory product_id FK link, migrations/002_inventory_and_vat.sql (products, VAT, stock triggers), FilterBar UI Primitive (+2 more)

### Community 28 - "Integration Order Review API"
Cohesion: 0.22
Nodes (10): GET /api/integrations/review, POST /api/integrations/review/import, Integrations review/page.tsx, external_order_id dedup contract (upsert on platform,external_order_id), normalizedOrderToSaleRow (mapToSale.ts), NormalizedOrder Type, PlatformAdapter Interface, getAdapter / isIntegrationPlatform (registry.ts) (+2 more)

### Community 29 - "Expenses State"
Cohesion: 0.31
Nodes (6): Props, ParsedRow, expensesSlice, ExpensesState, initialState, Expense

### Community 30 - "Purchases State"
Cohesion: 0.31
Nodes (6): Props, ParsedRow, initialState, purchasesSlice, PurchasesState, Purchase

### Community 31 - "Plan Gate & Dropshipping API"
Cohesion: 0.38
Nodes (7): GET /api/dropshipping/listings, ListingsTable Component, Dropshipping page.tsx, Plan Gating Pattern (hasPlatformIntegrations), Profit Planner Feature, Planner is pure client-side, no Supabase no Redux writes rationale, hasPermission / canAccessRoute / PERMISSIONS (permissions.ts)

### Community 32 - "Company Profile State"
Cohesion: 0.43
Nodes (4): companyProfileSlice, CompanyProfileState, initialState, CompanyProfile

### Community 33 - "Planner Calculations"
Cohesion: 0.47
Nodes (6): AmazonPlanner Component, planner _lib/calculations.ts (calcEbayResult, calcAmazonResult), EbayPlanner Component, planner _lib/fees.ts (EBAY_CATEGORIES, AMAZON_CATEGORIES), Planner page.tsx, PlannerResults Component

### Community 34 - "Users & Tenant Auth"
Cohesion: 0.33
Nodes (6): createServiceClientForTenant, POST /api/users/invite Route Handler, InviteUserModal Component, Users page.tsx, usersSlice Redux Slice, Duplicate-email guard before inviteUserByEmail

### Community 35 - "Dev Feedback & Feature Plans"
Cohesion: 0.60
Nodes (5): Button Naming Conflict on macOS, Dark Mode via data-theme (Not .dark class), shadcn/ui Usage Policy, Dropshipping Listing Management Implementation Plan, Dropshipping Listing Management Design Spec

### Community 36 - "Integrations Feature Docs"
Cohesion: 0.40
Nodes (5): ConnectionCard Component, integrationsSlice Redux Slice, Integrations page.tsx, Connect is full browser navigation not fetch rationale, Integrations read-only Redux pattern (no direct Supabase calls)

### Community 37 - "Supabase Tenant Provisioning"
Cohesion: 0.40
Nodes (5): migrations/005_tenant_provisioning.sql (provision_tenant_schema, set_user_tenant), PostgREST 42501 permission denied - GRANT USAGE required gotcha, provision_tenant_schema() function, is_tenant_member() RLS helper function, Three places rule for schema changes (public, provision_tenant_schema, one-off ALTER)

### Community 38 - "Vercel Deployment Config"
Cohesion: 0.40
Nodes (4): buildCommand, framework, installCommand, regions

### Community 39 - "Listings Refresh & Auth Guard"
Cohesion: 0.50
Nodes (4): POST /api/dropshipping/listings/refresh, fetchActiveListings Function, eBay sell.inventory.readonly scope re-authorization requirement, requireIntegrationAdmin (authGuard.ts)

### Community 40 - "Settings & Invoice Utils"
Cohesion: 0.67
Nodes (4): companyProfileSlice Redux Slice, generateInvoice is shared not colocated rationale, Settings page.tsx, generateSalesInvoice / generateExpensesInvoice / generatePurchasesInvoice (generateInvoice.ts)

### Community 41 - "Audit Logs Documentation"
Cohesion: 0.67
Nodes (3): Shared Components (3+ Features Rule), Audit Logs Feature (/dashboard/audit-logs), auditLogsSlice (Shared Slice — Not Colocated)

### Community 42 - "Auth Bug Patterns"
Cohesion: 0.67
Nodes (3): OTP Prefetch Security Scanner Bug (Email Link Fix), SiteURL vs RedirectTo Template Variable (Supabase Bug), TokenHash-based Email Link Pattern (Anti-Prefetch Fix)

### Community 44 - "Sales & Stock Triggers"
Cohesion: 0.67
Nodes (3): Returned orders excluded from revenue everywhere rationale, apply_sale_stock_change DB trigger with restock awareness, migrations/003_add_order_status.sql (status/restock, return-aware trigger)

### Community 45 - "Supabase Client Docs"
Cohesion: 0.67
Nodes (3): createControlClient / isPlatformAdmin (control.ts), addExposedSchema (managementApi.ts), createClient server.ts (tenant-scoped server client)

### Community 46 - "UI Theme Components"
Cohesion: 0.67
Nodes (3): Badge UI Primitive, data-theme attribute (not .dark class) for dark mode rationale, ThemeProvider (data-theme dark/light)

## Knowledge Gaps
- **321 isolated node(s):** `husky.sh script`, `$schema`, `style`, `rsc`, `tsx` (+316 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createControlClient()` connect `Admin & Billing Routes` to `OAuth Integration Callback Flow`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `useAppSelector` connect `Platform Integration Pages` to `Audit Log Viewer`, `Purchase & Tenant Modals`, `Expense & Purchase Views`, `Sales Entry Modal`, `Financial Import Modals`, `Inventory Product Modals`, `Invoice Generation`, `User & Sales Import Modals`, `Expense Entry Modal`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `createClient()` connect `Admin & Billing Routes` to `OAuth Integration Callback Flow`, `Dropshipping Listings UI`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `husky.sh script`, `$schema`, `style` to the rest of the system?**
  _341 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `OAuth Integration Callback Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.05974124809741248 - nodes in this community are weakly interconnected._
- **Should `Platform Integration Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.0784313725490196 - nodes in this community are weakly interconnected._
- **Should `Build Tooling & Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._