# Section permissions — design

Date: 2026-09-30 · Branch: `feat/section-permissions` · Status: approved in brainstorming, awaiting spec review

Sub-project 1 of 2 from the request "a permission section to manage permission and access for each user, and for me to manage different business plans". Sub-project 2 (platform-admin plan management in `/admin`) gets its own spec afterwards.

## Problem

- Access is role-based (`accountant` / `admin` / `super_admin`) with additive per-user `permission_overrides` (`src/lib/utils/permissions.ts`, Users → Permissions modal). Overrides can only **add**; nothing can be taken away from a role.
- Most data has **no read restriction at all**: `sales`, `expenses`, `purchases`, `products`, `platform_payouts`, `shipments`, `company_profile`, the `stock_*` tables are readable by every tenant member (RLS checks only `is_tenant_member()`); Home, Analytics, Inventory and Settings are reachable by every role.
- The tenant owner cannot, for example, hide Analytics from a bookkeeper or make Purchases read-only for one user.

## Decisions (agreed 2026-09-30)

1. **Section × level grid per user.** Role supplies defaults; per-user exceptions can **grant or revoke**.
2. **Enforced in the database, the route guard and the UI.**
3. **Only the super_admin manages permissions** (and users). Their own access is always full and not editable.
4. **Storage approach A:** a per-tenant table of per-user **exceptions only**, role defaults defined once in SQL, one SQL function every RLS policy calls, mirrored in TypeScript.
5. **Overview and Analytics are separate sections; Payouts is its own section; Users & Permissions are super-admin-only** (not in the grid).
6. **Overview/Analytics "View" grants business totals even without record access** — the totals RPCs run as definer behind an access check.

Live-data facts checked 2026-09-30: no user in any of the 5 tenants has `permission_overrides` set; every stock/FIFO/notification trigger is already `SECURITY DEFINER` (except `inv_transfer_before_update`, which only touches its own row).

## 1. Sections, levels, defaults

Levels (cumulative): **0 None** (hidden; RLS returns no rows) · **1 View** (read-only) · **2 Edit** (create + update) · **3 Delete** (edit + delete).

Defaults reproduce **today's effective behaviour exactly**, so shipping the database change alters nobody's access. `super_admin` = maximum everywhere, locked.

| Section key | UI label | Pages / actions | Tables | Allowed levels | accountant | admin |
|---|---|---|---|---|---|---|
| `overview` | Overview | `/dashboard` (tiles, platform cards) | totals RPCs | 0, 1 | 1 | 1 |
| `analytics` | Analytics | `/dashboard/analytics` | totals RPCs | 0, 1 | 1 | 1 |
| `orders` | Orders | `/dashboard/sales`, `[id]`, shipping labels | `sales`, `shipments` | 0–3 | 2 | 3 |
| `expenses` | Expenses | `/dashboard/expenses` | `expenses` | 0–3 | 2 | 3 |
| `purchases` | Purchases | `/dashboard/purchases` | `purchases` | 0–3 | 2 | 3 |
| `inventory` | Inventory | `/dashboard/inventory` (+ locations, transfers, advanced inventory) | `products`, `stock_locations`, `stock_lots`, `stock_movements`, `stock_transfers`, `inventory_settings`, `platform_location_defaults` | 0–3 | 2 | 3 |
| `payouts` | Payouts | "Record Transfer" | `platform_payouts` | 0–3 | 1 | 3 |
| `integrations` | Integrations | `/dashboard/integrations`, Review Orders | `platform_connections` | 0, 2 | 0 | 2 |
| `listings` | Listings | `/dashboard/listings` | `ebay_listing_drafts` | 0, 2 | 0 | 2 |
| `messages` | Messages | `/dashboard/messages` | `ebay_messages` | 0, 2 | 0 | 2 |
| `audit_logs` | Audit logs | `/dashboard/audit-logs` | `audit_logs` (SELECT; INSERT stays open to members — every mutation writes a row) | 0, 1 | 0 | 1 |
| `settings` | Settings | `/dashboard/settings` (company, invoice, billing) | `company_profile` | 0, 1, 2 | 1 | 2 |

Current-behaviour notes behind the defaults: accountants today can create/update sales/expenses/purchases/products but not delete them; payouts insert/delete are admin-only; company profile update is admin-only; integrations/listings/messages are admin-only; the Analytics route is open to all roles today (the unused `view_analytics` permission is dropped).

**Dropshipping is not a tenant section:** `proxy.ts` restricts `/dashboard/dropshipping` to platform admins (Boughtopia staff) and `dropship_listings` exists only in `tenant_kaufnest` (verified live 2026-09-30). Its gate and policies are left unchanged.

**Outside the grid:** Support (all users, unchanged); Planner (a calculator — reads no tenant data); Dropshipping (platform staff only, above); Notifications (follow sections, §4); Users & Permissions pages and `profiles` management (super_admin only — today's grantable `manage_users`/`invite_user`/`change_user_role` overrides are retired; none are in use).

**Plan ceiling:** plan gates (`src/lib/utils/planGating.ts`) are applied on top — an exception can never unlock a feature the tenant's plan lacks (Integrations: Pro+Business; Listings/Messages: Business; advanced-inventory UI: Business).

**Billing** stays additionally gated to admin/super_admin roles by `requireBillingAdmin()` (Stripe checkout/plan change is not a grid permission).

## 2. Database — migration `055_section_permissions.sql`

**Shape: one reusable installer.** 055 defines `public.install_section_permissions(schema_name text)` (plpgsql, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, like `install_advanced_inventory`) holding everything below, then runs it for every tenant schema. It is idempotent (`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), skips tables a tenant lacks (`to_regclass`), and is also called:
- at the end of `provision_tenant_schema()` (005), after `install_advanced_inventory`, guarded by `to_regprocedure` like that call — so new tenants get it;
- at the end of `install_advanced_inventory()` (047) — that installer re-creates its own `stock_*` policies every time it runs and would otherwise silently revert them.

This replaces "mirror every statement into 005's `format()` copy": the rule set lives in one function.

- **Table** `{{schema}}.user_section_access`:
  `user_id uuid REFERENCES {{schema}}.profiles(id) ON DELETE CASCADE`, `section text NOT NULL CHECK (section IN (…12 keys…))`, `level smallint NOT NULL CHECK (level BETWEEN 0 AND 3)`, `updated_at timestamptz DEFAULT now()`, `updated_by uuid`, `PRIMARY KEY (user_id, section)`. RLS: SELECT own rows or super_admin; INSERT/UPDATE/DELETE super_admin only. A trigger rejects a row for a super_admin user and a level not allowed for the section (§1 "Allowed levels").
- **`{{schema}}.role_section_default(p_role text, p_section text) RETURNS smallint`** — `IMMUTABLE`, a `CASE` over §1's table; unknown → 0. The single SQL source of defaults.
- **`{{schema}}.current_user_access(p_section text) RETURNS smallint`** — `STABLE SECURITY DEFINER SET search_path = {{schema}}`: super_admin → 3; `profiles.status = 'deactivated'` → 0; else `coalesce(exception, role_section_default(role, section))`. Built on the existing `current_user_role()`.
- **`{{schema}}.get_my_access() RETURNS jsonb`** — `{section: level}` for all 12 sections for the caller (client hydration).
- **RLS rewrite** (idempotent): for each governed table the installer **drops every existing policy** (looping `pg_policies`, so no stale permissive policy can survive and widen access) and recreates the set: `SELECT` → `current_user_access(s) >= 1`, `INSERT`/`UPDATE` → `>= 2`, `DELETE` → `>= 3`, each still `AND is_tenant_member()`. `FOR ALL` admin policies are split per command. Exceptions that keep today's behaviour exactly:
  - `shipments` INSERT (buying a label spends money; admin-only today) → `orders >= 3`.
  - `stock_locations`, `platform_location_defaults` writes (admin config today) → `inventory >= 3`.
  - `stock_transfers` INSERT → `inventory >= 2 AND created_by = auth.uid()`; DELETE (undo) → `inventory >= 2` (any member today).
  - `company_profile` SELECT stays open to every member (invoices on the Orders page read it); INSERT/UPDATE → `settings >= 2`.
  - `audit_logs` INSERT stays open to every member.
  - `profiles` policies unchanged; `dropship_listings` untouched.
- **Totals RPCs become definer-with-guard, without copying their bodies:** for each of `get_sales_overview`, `get_expenses_overview`, `get_purchases_overview`, `get_payouts_overview`, `get_overview_timeseries`, `get_sales_by_marketplace`, `get_platform_running_balance` the installer renames the existing function to `<name>__impl`, marks it `SECURITY DEFINER SET search_path = <schema>` and revokes EXECUTE from `PUBLIC, anon, authenticated`; then creates `<name>` with the **same signature** as a `SECURITY DEFINER` SQL wrapper that returns `<name>__impl(args)` only when `greatest(current_user_access('overview'), current_user_access('analytics')) >= 1` (jsonb functions → `NULL`, table functions → no rows). The wrapper carries `COMMENT … IS 'section-permissions guard'`; on re-run the installer skips wrapped functions and re-wraps any that a later `CREATE OR REPLACE` migration replaced (dropping the stale `__impl` first). **Future edits to a totals function go into `<name>__impl`** — recorded as a gotcha in `dashboard/SKILL.md` and `supabase/SKILL.md`.
- **Page totals stay invoker** (`get_sales_summary`, `get_purchases_summary`, `get_expenses_summary`, `get_sales_marketplaces`) → follow the page's RLS.
- **Notifications:** `{{schema}}.notification_section(p_type text) RETURNS text` (`IMMUTABLE`; `sale.created`→`orders`, `purchase.created`→`purchases`, `message.received`→`messages`, else NULL); `notifications_select` becomes `current_user_role() = ANY(visible_to_roles) AND (notification_section(type) IS NULL OR current_user_access(notification_section(type)) >= 1)` — today's role list still applies, the section check narrows it. No column or trigger change; `visible_to_roles` / `required_permission` stay but are no longer read.
- **Role change cleanup:** an `AFTER UPDATE OF role ON profiles` trigger deletes that user's exceptions whose level now equals the new role's default (and all of them when the new role is super_admin) — covers every path that changes a role (Users page inline select, Edit User modal).
- **Legacy:** `current_user_has_override()` and `profiles.permission_overrides` stay (unused) for one release; removed in a later cleanup migration.

## 3. App

- **`src/lib/permissions/sections.ts`** (pure, client-safe, colocated test): `SECTIONS` (key, label, allowed levels, route prefixes, plan gate), `LEVELS`, `ROLE_DEFAULTS` (mirror of SQL), `effectiveAccess(role, exceptions, plan) → Record<Section, Level>` (super_admin → max; plan ceiling), `sectionForPath(pathname)`, `can(access, section, level)`.
- **`currentUserSlice.access`**: hydrated in `dashboard/layout.tsx` from `get_my_access()` (plan ceiling applied client-side with the already-hydrated `tenantPlan`); `useAccess()` hook returns `{ level(section), can(section, level) }`.
- **`src/proxy.ts`**: for `/dashboard/*`, resolve `sectionForPath`; if access < 1 → redirect to `/dashboard?denied=<section>` (Home shows a toast), or to the first viewable section when `overview` itself is 0. `/dashboard/users*` → super_admin only.
- **Sidebar** hides level-0 sections. **Buttons**: Add/Import need ≥ 2, Edit ≥ 2, Delete ≥ 3, Record Transfer `payouts` ≥ 2, Generate/buy label `orders` ≥ 3 (the free plain PDF label needs `orders` ≥ 1); Home's Recent Orders card needs `orders` ≥ 1; the order form's Inventory product picker needs `inventory` ≥ 1 (otherwise free-text product name only).
- **Server guards:** new `src/lib/permissions/requireSectionAccess.ts` — `requireSectionAccess(section, minLevel)` returns the same `{ context: { client, userId, tenantSchema } } | { error }` shape as `requireIntegrationAdmin()`, deciding via the `current_user_access` RPC. `requireIntegrationAdmin()` becomes `requireSectionAccess("integrations", 2)`; the 8 listings/messages routes replace their `requireIntegrationAdmin()` + inline `hasPermission` pair with `requireSectionAccess("listings" | "messages", 2)`; `requireAiAccess()` uses `listings` ≥ 2; `/api/shipping/{rates,buy}` use `orders` ≥ 3 (matches the `shipments` INSERT rule; plus the existing `requireShippingLabelAccess`).
- **Retire** `PERMISSIONS`/`hasPermission`/`canAccessRoute` and `PermissionsModal.tsx` once no caller remains (`hasMinimumRole` stays if still used).

## 4. Permissions screen

- Route `/dashboard/users/[id]/permissions` (super_admin only); "Permissions" button per user row on the Users page; "Custom access" badge on users with exceptions.
- Header: back link (`<ChevronLeft/> Users`), name · role, `Reset to role defaults` (secondary; confirm modal).
- Grid: one radio row per section, disallowed levels rendered "─"; cells differing from the role default marked **custom · role default: X**; plan-gated sections disabled with "Not in your plan".
- Save: real `<form>`, submit disabled until dirty, "Saving…" busy state, toast on success/failure. Writes only differences: upsert changed exceptions, delete rows whose level equals the role default. Audit log entry (`action: "update"`, entity `user_access`, before/after grids).
- Super_admin rows cannot be opened. Role change keeps exceptions; any that now equal the new role default are deleted by the database trigger (§2).
- Pure helper `diffAccess(roleDefaults, current, edited) → { upserts, deletes }` in `users/_lib/` with a colocated test.

## 5. Rollout

1. Apply 055 (+ re-apply 005). Defaults = today's behaviour, so the live app is unaffected.
2. Deploy the app (phases 2–3).
3. Owners start setting exceptions.

Delivered as three PRs: **(1)** migration 055 + SQL tests, no UI change; **(2)** app wiring (`sections.ts`, slice, proxy, sidebar, buttons, server guards, retire old matrix); **(3)** Permissions screen.

## 6. Testing

- Unit: `sections.ts` (defaults, `effectiveAccess` incl. plan ceiling and super_admin, `sectionForPath`), `diffAccess` (only differences, reset, role change), button/route gating helpers.
- Parity (integration): `role_section_default` equals `ROLE_DEFAULTS` for every role × section.
- Integration (live test tenant, test accountant): Orders=None → `sales` select returns 0 rows **and** `get_sales_overview` returns real totals; Orders=View → insert rejected; Orders=Edit + Inventory=None → an order linked to a product still decrements stock; Overview=None and Analytics=None → totals RPCs return NULL; non-super_admin cannot write `user_section_access`; exception on a super_admin rejected.
- Manual: log in as a restricted test user; sidebar, buttons and blocked URLs match the grid; an access cut applies to data immediately.

## Out of scope

- Custom named roles; admins managing permissions; per-record (row-owner) restrictions.
- Plan management in `/admin` (sub-project 2).
- Removing `permission_overrides` / `current_user_has_override()` (later cleanup).
