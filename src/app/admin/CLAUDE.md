# KaufNest platform admin panel

Route: `/admin`. This is **not** a tenant feature — it's the KaufNest-internal
"Tenant Management" dashboard used to provision new tenants and impersonate
their admins. Gated to platform staff via `control.admin_users` (Project A),
not tenant roles.

## Files in this folder

- `layout.tsx` — server component auth guard: redirects to `/login` if no
  session, then redirects to `/dashboard` if `isPlatformAdmin(user.email)`
  (`@/lib/supabase/control`) is `false`. Renders the admin header/shell, wrapped
  in `<ToastProvider>` so `_components/*` can call `useToast()`.
- `page.tsx` — "Tenant Management" page: stats cards (Total/Active/Invited/
  Deactivated) + a slim tenants table (Tenant, **Admin Email**, Plan, Status,
  **AI Usage**, and a final unlabeled column holding a hamburger-icon `Link`
  to `/admin/tenants/[id]`), fetched client-side from `GET /api/admin/tenants`.
  Trial Ends, Created, and all mutating actions live on the detail page now
  (2026-09-03) — this table is read-mostly navigation. "Add Tenant" button
  opens `AddTenantModal`; closing it bumps `refreshKey` to refetch the list.
  The **AI Usage** column is populated by a second fetch effect (also keyed
  on `refreshKey`) against `GET /api/admin/ai-usage`, kept in an
  `aiUsage: Record<tenantId, {used, limit, byUser}>` state map. Cell shows a
  `used / limit` link (opens `AiUsageModal`, stores the clicked row in
  `usageTenant`) when the tenant's plan has a nonzero `limit`, otherwise `—`
  (Starter/Pro have no AI allowance — see `getAiGenerationLimit` in
  `planGating.ts`). Plan/Status badge variants come from the shared
  `_components/tenantVariants.ts` (also used by the detail page) rather than
  being defined here.
- `tenants/[id]/page.tsx` — tenant detail page (2026-09-03). Client component;
  fetches the same `GET /api/admin/tenants` + `GET /api/admin/ai-usage`
  responses as `page.tsx` and finds the row by `id` (from
  `params: Promise<{ id: string }>`, resolved via React's `use()` — same
  pattern as `dashboard/sales/[id]/page.tsx`; **not** `useParams()`). Renders
  a back-link to `/admin`, the name/schema/Plan/Status header, a Details card
  (Admin Email, Trial Ends, Created — moved off the main table), an AI Usage
  card (`AiUsageBreakdown` inline, or a "not available on this plan" note
  when `limit` is 0), and an Actions card (`TenantDetailActions`). A
  `refreshKey` bumped by `TenantDetailActions.onRefresh` re-runs both fetches
  in place, mirroring `page.tsx`'s own refresh pattern.
- `_components/AddTenantModal.tsx` — "Provision New Tenant" form (company
  name → auto-slug, plan, admin email/name). Posts to
  `/api/admin/provision-tenant`. On failure shows `data.detail ?? data.error`
  both inline (red banner in the form) and via `useToast().error(...)`; on
  success shows a `useToast().success(...)` toast before closing.
- `_components/EditTenantModal.tsx` — "Edit Tenant" modal: pre-filled form for
  `plan`, `status`, `admin_email`, and `ai_enabled` (rendered as a `Checkbox`
  from `@/components/ui/FormFields`, "AI features visible to this tenant").
  Computes a partial diff against the current tenant and sends only changed
  fields to `PATCH /api/admin/tenants/[tenant.id]`. Shows inline note when
  email changes ("A verification email will be sent to the new address.").
  Calls `onClose()` on success (parent bumps `refreshKey`).
- `_components/TenantDetailActions.tsx` — per-tenant action buttons
  (2026-09-03, replaces `TenantActions.tsx`), rendered only on
  `tenants/[id]/page.tsx`. Accepts `{ tenant: Tenant, onRefresh: () => void }`.
  Every button carries a `lucide-react` icon and a semantic icon tint (no new
  `Button` variants): "Edit" (`Pencil`, opens `EditTenantModal`, calls
  `onRefresh` on close, no pre-confirmation — Save Changes is the commit
  point), "AI: On"/"AI: Off" (`Sparkles`, tinted
  `--color-success-text`/`--color-text-faint`, opens a `ConfirmActionModal`
  before PATCHing `{ ai_enabled: !tenant.ai_enabled }` to
  `/api/admin/tenants/[tenant.id]`), "Resend Invite" (`Mail`, tinted
  `--color-info-text`, only shown when `tenant.status === "invited"`, posts
  to `/api/admin/resend-invite` directly — **no confirmation**, unchanged
  from before), "Impersonate" (`UserCog`, tinted `--color-warning-text`,
  opens a `ConfirmActionModal` — replacing the previous `window.confirm()` —
  naming `tenant.admin_email`, then posts `{ tenantId }` only to
  `/api/admin/impersonate` and redirects to the returned magic link; a
  failure now toasts via `useToast().error(...)` instead of `alert(...)`),
  and "Delete" (`Trash2`, danger variant, opens the existing
  `DeleteTenantModal`, unchanged).
- `_components/ConfirmActionModal.tsx` — generic yes/no confirmation dialog
  (2026-09-03). `{ open, title, message, confirmLabel, confirmingLabel, tone:
  "warning"|"success"|"info", loading, onConfirm, onClose }`. Distinct from
  the shared `src/components/modals/DeleteConfirmModal.tsx`, which forces a
  typed reason for delete-style flows elsewhere in the app — this one is for
  actions (Toggle AI, Impersonate) that need a plain confirm, no reason
  field. `tone` colors an informational banner only; the confirm button is
  always `variant="primary"` regardless of tone.
- `_components/tenantVariants.ts` — `PLAN_VARIANT`/`STATUS_VARIANT` badge
  maps (2026-09-03), shared between `page.tsx`'s table and
  `tenants/[id]/page.tsx`'s header badges. Extracted so the two don't define
  the same maps twice.
- `_components/AiUsageModal.tsx` — thin `Modal` wrapper (2026-09-03) around
  `AiUsageBreakdown`, kept only so the table's AI Usage cell can open it in a
  popup. Accepts `{ open, tenant, used, limit, byUser, onClose }`, unchanged
  since before the split.
- `_components/AiUsageBreakdown.tsx` — presentational (2026-09-03): the
  actual `{used} of {limit} generations this month` line + `userId → calls`
  table (sorted descending by calls, "No AI usage this month." when empty),
  extracted out of `AiUsageModal.tsx` so the detail page can render the same
  markup inline, without a `Modal` wrapper. `userId`s are shown raw
  (font-mono, truncated) since the admin panel has no access to tenant
  `profiles` names and a cross-project lookup isn't worth it for an internal
  tool.
- `_components/DeleteTenantModal.tsx` — destructive-confirmation modal for
  tenant deletion. Accepts `{ open, tenant, onClose, onDeleted }`. The user must
  **type the tenant's `schema_name` exactly** before the "Delete tenant" button
  enables (`confirmed = confirmation === tenant.schema_name`) — deletion drops
  the entire tenant schema and every associated auth user, so a plain yes/no
  confirm was judged too easy to fire by accident. Posts to
  `DELETE /api/admin/tenants/[tenant.id]`, then calls `onDeleted()` (the parent
  closes and bumps `refreshKey`). Closing is blocked while `deleting` is in
  flight, and the typed confirmation resets on close so a reopened modal never
  starts pre-confirmed.

## API routes (cannot be colocated — Next.js pins routes to `app/api/...`)

All under `src/app/api/admin/`, all guarded by a local `verifyPlatformAdmin()`
(or, in `layout.tsx`/`dashboard/layout.tsx`, a direct call) that wraps the
shared `isPlatformAdmin(email)` helper (`@/lib/supabase/control`):

- **`provision-tenant/route.ts`** (`POST`) — the "invite tenant + initial
  setup" flow, in order:
  1. Sanitize `slug` → `schemaName = tenant_<slug>`; reject if the slug is
     already in `control.tenants`.
  2. `service.rpc("provision_tenant_schema", { schema_name })` — creates the
     full `tenant_<slug>` schema (tables, RLS, triggers, indexes, grants); see
     `supabase/migrations/005_tenant_provisioning.sql`.
  3. `addExposedSchema(schemaName)` (`@/lib/supabase/managementApi`) — adds
     the new schema to Project B's PostgREST "Exposed schemas" via the
     Supabase Management API. **Must** run before step 4/5, which use
     `createServiceClientForTenant(schemaName)` (PostgREST calls that 404/406
     against an unexposed schema).
  4. Seed `company_profile` (name, EUR, UTC) in the new schema — skipped if a
     row already exists (retry-safe for the same `schemaName`).
  5. `service.auth.admin.inviteUserByEmail(adminEmail, { redirectTo:
     "${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password", data: {
     full_name, tenant_schema, role: "super_admin" } })` — same `redirectTo`
     pattern as `/api/users/invite`, kept for compatibility, but the invite
     email's actual link is built by `email-templates/invite.html` from
     `{{ .SiteURL }}`, not `redirectTo` (see `src/app/(auth)/SKILL.md`). If
     `adminEmail` already belongs to another tenant (detected
     via `inviteData.user.app_metadata.tenant_schema`), provisioning aborts
     with `detail: 'Admin email "..." is already associated with another
     tenant...'` — see the duplicate-email gotcha in `SKILL.md`. Otherwise,
     insert the matching `profiles` row and
     `service.rpc("set_user_tenant", ...)` to stamp `app_metadata.tenant_schema`
     (belt-and-suspenders — `inviteUserByEmail`'s `data` only sets
     `user_metadata`; `set_user_tenant` is the canonical `app_metadata` writer
     used everywhere else).
  6. Register the tenant in `control.tenants` (plan, `admin_email`,
     `status: "invited"`, `trial_ends_at` = now + 14 days). Status stays
     `invited` until the admin accepts their invite and logs in (or a platform
     admin flips it via `EditTenantModal`).

  On any thrown error, returns `{ error: "Provisioning failed", detail }`
  (500) where `detail` is the underlying Supabase/Postgres error message
  (`errorMessage()` helper unwraps `PostgrestError`/`AuthError`-shaped objects
  that aren't `instanceof Error`) — `AddTenantModal` surfaces `detail` to the
  admin via toast + inline banner.
- **`tenants/route.ts`** (`GET`) — lists `control.tenants`, newest first.
- **`ai-usage/route.ts`** (`GET`) — current-period AI usage for every tenant,
  for the AI Usage column/modal. Guarded by `verifyPlatformAdmin(email)` from
  `@/lib/supabase/control` (the `NextResponse | null` variant, not the local
  `{ok, response}` wrapper `tenants/route.ts` defines for itself). For each
  `control.tenants` row, filters `control.tenant_ai_usage` rows (fetched once
  for `currentPeriod()`, not per-tenant) down to that tenant and returns
  `{ tenantId, used: sumCalls(...), limit: getAiGenerationLimit(tenant.plan),
  byUser: callsByUser(...) }` (`sumCalls`/`callsByUser`/`currentPeriod` from
  `@/lib/ai/quota`, `getAiGenerationLimit` from `@/lib/utils/planGating`).
  Response: `{ period, usage: [...] }`. **Both Supabase queries are wrapped in
  a try/catch that returns `{ error, detail }` (500) on failure** — this
  route reads `tenant_ai_usage` directly rather than going through
  `readTenantUsage` (which is per-tenant; this route needs one bulk read), so
  the same "throw on Supabase error, don't silently return `[]`" invariant
  `readTenantUsage` enforces is reproduced here by hand rather than
  inherited.
- **`tenants/[id]/route.ts`** (`PATCH`, `DELETE`) —
  - `PATCH`: partial update for `{ plan?, status?, admin_email?, ai_enabled? }`.
    Steps: (1) fetch current row — 404 on `PGRST116`; (2) if `admin_email`
    changed, scan Project B Auth users and call `updateUserById`; (3)
    `.update(patch)` only changed fields (`ai_enabled` uses a `!== undefined`
    guard, not truthiness — `false` is a real value: a platform admin actually
    revoking AI). Platform-admin override — writes `plan`/`status` directly,
    bypassing Stripe. `ai_enabled` is the AI-visibility switch, not a plan
    field — it doesn't touch the Stripe-owns-`plan`/`status` invariant.
  - `DELETE`: permanently destroys a tenant. Steps: (1) fetch tenant `schema_name`;
    (2a) `removeExposedSchema(schema_name)` — removes the schema from Project B's
    PostgREST "Exposed schemas" list via the Management API **before** dropping.
    Order is critical: a dropped schema left in the exposed list makes PostgREST's
    schema-cache load fail (`3F000`), which breaks the entire Data API for every
    tenant (`PGRST002` on all requests). Returns 500 and aborts on failure —
    nothing has been destroyed yet, safe to retry;
    (2b) `service.rpc("drop_tenant_schema", { schema_name })` (requires migration
    `017_drop_tenant_schema.sql` applied in Project B) — returns 500 on failure
    (schema is unexposed but intact — retryable, `removeExposedSchema` is a no-op
    on retry);
    (3) scan auth users by `app_metadata.tenant_schema` and delete them
    (best-effort via `Promise.allSettled`); (4) delete row from `control.tenants`.
    **Irreversible** — all tenant data is gone after step 2b.
- **`resend-invite/route.ts`** (`POST`) — resends the invite email for an
  existing tenant's `admin_email`. Verifies platform admin, looks up the tenant
  by `tenantId` from `control.tenants`, reads the admin's `full_name` from
  `tenant_<schema>.profiles`, then re-calls
  `service.auth.admin.inviteUserByEmail` (no profile/schema changes — all already
  stamped at provision time). Returns `400` if `tenant.status !== "invited"` —
  invites cannot be resent once the admin logs in for the first time. The detail page's
  `TenantDetailActions` shows this button only when `tenant.status === "invited"`.
- **`src/app/auth/confirm/route.ts`** (not in admin/, but cross-referenced) —
  verifies the Supabase OTP token from the invite link. After successful OTP
  verification (line 27), checks if the user's `tenant_schema` corresponds to a
  tenant in `control.tenants` with `status === "invited"`. If so, auto-updates
  the status to `"active"` (lines 39-45) to mark the tenant as having completed
  first login. This is the transition point: invites become non-resendable once
  the admin logs in.
- **`impersonate/route.ts`** (`POST`, body `{ tenantId }` only) — checks the
  caller is a platform admin AND `control.admin_users.can_impersonate` is
  true (a column that existed but was previously unchecked — see
  `verifyCanImpersonate()` in this file, a locally-scoped variant of the
  shared `isPlatformAdmin`, needed because impersonation requires the extra
  `can_impersonate` flag that plain admin-panel access doesn't). Looks up the
  tenant in `control.tenants` and generates a Supabase magic link
  (`service.auth.admin.generateLink`) for `tenant.admin_email` **only** —
  never a client-supplied address (previously accepted an arbitrary
  `adminEmail` from the request body, see AUDIT_2026-07-24.md §2.4 — fixed).
  400s if the tenant has no `admin_email` on file. Writes a row to
  `control.admin_audit_log` (`control-plane/004_admin_audit_log.sql`) before
  returning the link, and sets the `kaufnest_impersonating` cookie (httpOnly,
  8h) read by `DashboardShell`'s impersonation banner.
- **`exit-impersonation/route.ts`** (`POST`) — clears the
  `kaufnest_impersonating` cookie.

## Shared dependencies

- `src/lib/supabase/control.ts` (`createControlClient`, `isPlatformAdmin`,
  `verifyPlatformAdmin`) — Project A, server-only. `isPlatformAdmin(email)` is
  also called from `dashboard/layout.tsx` to decide whether to show the
  sidebar's "Admin Panel" link (see `src/app/dashboard/CLAUDE.md`).
- `src/lib/ai/quota.ts` (`currentPeriod`, `sumCalls`, `callsByUser`) and
  `src/lib/utils/planGating.ts` (`getAiGenerationLimit`) — used by
  `ai-usage/route.ts` to compute the AI Usage column's `used`/`limit`/
  `byUser` per tenant.
- `src/components/layout/BrandMark.tsx` — the theme-switching Boughtopia icon
  next to the header wordmark; `layout.tsx` (a server component) renders it
  as a child even though it's a client component, same as any other
  server-renders-client-child composition. See `dashboard/CLAUDE.md`'s
  "Shared shell components" section for the full theming rationale.
- `src/proxy.ts` — Next.js request middleware. Updated to query `control.tenants`
  and check each authenticated user's tenant `status` (lines 58–71). If a user
  whose tenant is `"deactivated"` tries to access `/dashboard/*`, they are
  redirected to `/account-deactivated` before any RBAC check occurs.
- `src/app/account-deactivated/page.tsx` — static page shown when `proxy.ts`
  detects `tenant.status === "deactivated"`. No authentication required (outside
  the proxy matcher), displays a message that the organisation's account has been
  deactivated. Not part of the admin feature, but driven by platform admin status
  changes via `EditTenantModal`.
- `src/lib/supabase/server.ts` (`createServiceClientForTenant`) — Project B,
  schema-scoped service-role client for tenant-table seeding.
- `src/lib/supabase/managementApi.ts` (`addExposedSchema`) — Project B's
  Management API, for the Exposed-schemas step.
- `components/ui/{Button,Badge,Modal,FormFields}`, `types` (`Tenant` — incl.
  `admin_email`, `TenantPlan`, `TenantStatus`).
- `next/link` — the tenants table's hamburger-icon cell and the detail
  page's back link both use `Link`, not `Button` (`Button` renders a plain
  `<button>`, so navigation-as-a-link is styled by copying its ghost-variant
  classes directly rather than extending `Button` to accept `as="a"`).

## Tests

No test suite targets this folder — it's almost entirely Supabase/network
calls (provisioning, impersonation, control-plane queries), which the working
agreement keeps out of unit tests. Verify by using `/admin` → "Add Tenant" in
the browser.
