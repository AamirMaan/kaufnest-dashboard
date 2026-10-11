# Users feature

Route: `/dashboard/users`. Super-admin-only user management: invite new users,
edit profile/role, change roles (`super_admin`, `admin`, `accountant`), grant
per-user **section permissions** beyond the role's defaults (Task 7,
2026-09-30 — replaced the old flat permission-overrides checklist), and
deactivate/reactivate a user's dashboard access.

## Files in this folder

- `page.tsx` — list view, role + status badges, wires up the modals below.
  Gated to `super_admin` (enforced by `src/proxy.ts`'s section guard — see
  `src/lib/permissions/sections.ts`). Client-side pagination via local
  `page`/`pageSize` state (default 25 rows/page) slicing `state.users.items`;
  renders `<Pagination>` (`@/components/ui/Pagination`) below the
  `DataTable`. Also loads **every** `user_section_access` row once on mount
  (via `fetchAllRows`, `@/lib/utils/fetchAllRows`)
  (`user_id, section, level` — bounded: ≤ 12 rows per user × `users.length`,
  never a growth-unbounded read) and, for each user, overlays it onto their
  role defaults via `exceptionsToGrid`/`customSections` to compute which
  users have a non-empty diff — those render a "Custom access" `Badge` next
  to their `RoleBadge` in the Role column. Row actions: Edit
  (`EditUserModal`), Manage permissions (a `Link` to
  `/dashboard/users/[id]/permissions`, `ShieldCheck` icon — **hidden for
  `super_admin` rows**, since the account owner always has full access and
  can't hold an exception row), Resend invite, Deactivate/Reactivate
  (`UserX`/`UserCheck` icon, toggles based on `p.status`) — see
  "Deactivate/reactivate" below.
- `[id]/permissions/page.tsx` (Task 7, 2026-09-30) — the Permissions screen:
  a section × level grid for one user. See "Section permissions" below.
- `_store/usersSlice.ts` — Redux slice for `state.users` (`items`, `loaded`).
  Actions: `hydrateUsers`, `addUser`, `updateUser`, `updateUserRole`. Used
  **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/usersSlice.test.ts` — reducer tests. Run with `npx jest dashboard/users`.
- `_lib/userStatusGuards.ts` (+ colocated test) — pure `canDeactivateUser(target,
  currentUserId, allUsers)` helper. Blocks deactivating an already-deactivated
  user, deactivating your own account, or deactivating the last remaining
  active `super_admin`. `page.tsx` uses this to disable the Deactivate button
  (with the block reason as its `title` tooltip) rather than letting the
  write fail server-side.
- `_lib/accessDiff.ts` (+ colocated test) — pure helpers for the Permissions
  screen, consumed by both `page.tsx` (the "Custom access" badge computation)
  and `[id]/permissions/page.tsx`: `exceptionsToGrid(role, rows)` overlays
  stored exception rows on role defaults into a full `AccessMap`,
  `diffAccess(role, saved, edited)` computes `{ upserts, deletes }` — what to
  write on save (a cell back at the role default is a delete, not a zero-level
  upsert), `customSections(role, grid)` lists sections differing from the
  role default (drives both the list page's badge and the editor's per-row
  "custom" badge), `withLevel(grid, section, level)` sets one cell and zeroes
  Listings/Messages when Integrations drops below Edit, and
  `needsIntegrations(grid, section, level)` says whether a Listings/Messages
  radio is locked by that dependency.
- `_components/InviteUserModal.tsx` — sends an invite (calls the API route below),
  then dispatches `addUser`.
- `_components/EditUserModal.tsx` — edits profile fields and/or role, dispatches `updateUser`.

## Section permissions (`user_section_access`, replaces the old permission-overrides matrix)

- **`[id]/permissions/page.tsx`** (Client Component — dynamic route `params`
  is a `Promise<{ id: string }>` in this Next.js version, read via React's
  `use()`). Guards, in order: current user isn't `super_admin` → "Only the
  account owner can manage permissions."; `id` doesn't match any
  `state.users.items` row → not-found + back link; target user IS
  `super_admin` → "The account owner always has full access.", no grid
  rendered (a DB trigger on `user_section_access` rejects any row for a
  super_admin user anyway — `SECTION_ACCESS_SUPER_ADMIN`).
  Otherwise: fetches this user's stored exceptions
  (`user_section_access.select("section, level").eq("user_id", id)` —
  bounded ≤ 12 rows, one per `Section`), builds `saved = exceptionsToGrid
  (role, rows)`, and seeds `edited` from it. A load error shows
  "Couldn't load this user's permissions." + Retry — no grid, no Save, never
  a role-defaults fallback; a failed save re-fetches the rows. Listings/
  Messages' Edit radios are disabled with a "Needs Integrations: Edit" note
  while `edited.integrations < 2`. Renders a table: rows =
  `SECTIONS` (`@/lib/permissions/sections`), columns = None/View/Edit/Delete
  radios (only for levels in that section's `levels`, else "─"). A section
  not allowed on the tenant's plan (`!planAllows(key, planEntitlements)`, from
  `state.currentUser.planEntitlements`) is
  disabled with a "Not in your plan" `Badge` — this is **display-only**,
  mirroring how `useAccess()`'s `can()` applies the plan ceiling; this page
  doesn't enforce it itself, the DB/other pages do. A section in
  `customSections(role, edited)` shows a "custom" `Badge` plus a small
  "role default: `<Level>`" line. "Reset to role defaults" (secondary button)
  opens `DeleteConfirmModal` with `confirmLabel="Reset"`/
  `confirmingLabel="Resetting…"` and `requireReason={false}` (see below) —
  it only replaces the local `edited` state with `ROLE_DEFAULTS[role]`; the
  user still has to click Save to persist it. Save (`diffAccess(role, saved,
  edited)` → `.delete().in("section", deletes)` then
  `.upsert(upserts.map(u => ({ user_id, ...u })), { onConflict:
  "user_id,section" })`) writes an audit log (`action: "update"`,
  `entityType: "user"`, `metadata: { user_access: { before, after } }`) and a
  toast on success; a raw DB error never reaches the user
  (`toastError("Couldn't save permissions", "Please try again.")`). Save
  button is `disabled={saving || !isDirty}` where `isDirty` comes from
  `diffAccess` producing any upserts/deletes — not a plain object-equality
  check, so a cell edited back to its original value correctly reports
  "not dirty" again.
- **`components/modals/DeleteConfirmModal`** grew an optional
  `requireReason?: boolean` prop (default `true`, Task 7) for this screen's
  "Reset to role defaults" confirmation — a reversible, non-destructive,
  not-yet-saved action that doesn't need an audit-trail reason the way a
  real delete/deactivate does. `false` hides the Textarea field entirely and
  skips the "reason required" validation; every other caller is unaffected
  (default unchanged).
- **The exceptions-only model**: `user_section_access` stores ONLY cells
  that differ from the role default — never a full copy of the grid. Role
  changes auto-delete now-redundant exceptions via a DB trigger (migration
  055), so this UI never has to reconcile that itself.
- Live DB: migration `055_section_permissions.sql` — `user_section_access
  (user_id, section, level, updated_at, updated_by)` per tenant schema,
  readable by the super_admin (and the user for their own rows), writable by
  super_admin only; a trigger rejects a level not in that section's allowed
  set (`SECTION_LEVEL_NOT_ALLOWED`) and any row for a super_admin user
  (`SECTION_ACCESS_SUPER_ADMIN`).

## Deactivate/reactivate (revoke access, never a hard delete)

- `Profile.status: "active" | "deactivated"` (`profiles.status`, see
  `supabase/migrations/025_user_status.sql`) — deliberately NOT a delete.
  `sales`/`expenses`/`purchases`/`ebay_listing_drafts` all have a NOT NULL
  `created_by REFERENCES profiles(id)` with no cascade, so hard-deleting any
  profile that's ever created a record throws a foreign-key error. Mirrors
  the existing whole-tenant deactivation pattern
  (`control.tenants.status`, gated in `src/proxy.ts`) at the per-user level.
- `page.tsx`'s Deactivate button opens the shared `DeleteConfirmModal`
  (`components/modals/DeleteConfirmModal`, relabeled via its
  `confirmLabel`/`reasonLabel` props — see that component's own note) and
  requires a reason. Reactivate is a single click, no modal, no reason
  (mirrors Resend Invite's "low-friction, easily reversible" treatment).
  Both go through the same local `writeStatusChange()` helper in `page.tsx`:
  write `profiles.status`, dispatch `updateUser`, `writeAuditLog` with action
  `status_change` (metadata `{ from, to, target_email, reason? }`), dispatch
  `addAuditLog`.
- **`src/proxy.ts`** is what actually enforces this — it fetches
  `role, status` and redirects to `/account-suspended` when
  `status === "deactivated"`, before the section-access RBAC check. A
  deactivated user can still authenticate with Supabase (proxy can't
  intercept that client-side call, same as tenant-level deactivation) but is
  bounced out of every `/dashboard/*` route immediately after.
- `src/app/account-suspended/page.tsx` — the page they land on. Distinct from
  `src/app/account-deactivated/page.tsx` (whole-tenant deactivation) so the
  messaging is accurate ("a super admin on your team" vs. "your organisation").

## Related files outside this folder (cannot be colocated)

- `src/app/api/users/invite/route.ts` — server route that creates the
  Supabase Auth user and profile row for an invite. Next.js requires API routes
  to live at their URL path (`/api/users/invite`), so it can't move into this
  feature's private folder — but it is conceptually part of this feature.
  `InviteUserModal` calls it via `fetch("/api/users/invite")`.
  Tenant-aware: reads the calling super_admin's `tenant_schema` from
  `user.app_metadata`, inserts the new user's profile directly into
  `tenant_<schema>.profiles` via `createServiceClientForTenant()`, and stamps
  the invitee's own `app_metadata.tenant_schema` via the `set_user_tenant` RPC
  (`public.handle_new_user` no longer auto-creates profile rows — dropped in
  step 5 of `supabase/migrations/006_bootstrap_tenant_kaufnest.sql`).
  Before inviting, it rejects (409) if `email` already has a `profiles` row in
  this tenant, or already belongs to a different tenant — see the
  duplicate-email gotcha in `SKILL.md`.

- `src/app/api/users/resend-invite/route.ts` — server route that resends an
  invite for an existing user whose link has expired. Calls
  `adminClient.auth.admin.inviteUserByEmail` again (Supabase resends the invite
  email for users with a pending invite) using the existing profile's
  `full_name`/`role` from `tenant_<schema>.profiles`. Does **not** create a
  profile row (already exists) and does **not** call `set_user_tenant` RPC
  (already stamped). Returns 404 if the email has no profile in this tenant.
  `page.tsx` calls it inline via `fetch("/api/users/resend-invite")` — no modal.

## Data flow

1. Invite: `InviteUserModal` POSTs to `/api/users/invite` (uses the Supabase
   admin client server-side), then dispatches `addUser` with the returned profile.
   The route 403s once the tenant is at its plan's user limit
   (`control.plans.max_users` via `getEntitlements` + `canAddUser`; deactivated
   users don't count) — see `SKILL.md`.
2. Resend invite: `page.tsx` POSTs to `/api/users/resend-invite` with `{ email }`;
   no Redux dispatch needed (profile row unchanged). Shows a toast on success/error.
3. Edit/role-change: write to Supabase (`profiles` table) via
   `await createTenantClient()` (`@/lib/supabase/client`), dispatch `updateUser`/`updateUserRole`.
4. Permissions: `[id]/permissions/page.tsx` writes `user_section_access` rows
   (upsert/delete the diff only) the same way, dispatches `addAuditLog` — it
   does NOT touch `profiles` or dispatch `updateUser`.
5. Deactivate/reactivate: `page.tsx`'s `writeStatusChange()` writes
   `profiles.status` the same way, dispatches `updateUser`.
6. All of invite/role-change/permission-change/status-change call
   `writeAuditLog` (`@/lib/utils/audit`) then dispatch `addAuditLog`
   (`@/store/slices/auditLogsSlice`) — role changes use the `role_change`
   audit action, permission changes use `update` (entityType `"user"`,
   metadata key `user_access`), status changes use `status_change`.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Button`, `DataTable`, `Badge` (`RoleBadge`, `StatusBadge`,
  the generic `Badge` for "Custom access"/"custom"/"Not in your plan"),
  `Pagination`, `FormFields` (`Checkbox`)
- `components/modals/DeleteConfirmModal` — reused for the Deactivate
  confirmation and the Permissions screen's "Reset to role defaults" (via
  its `requireReason={false}` option, Task 7) — NOT shared-with-Sales/
  Expenses/Purchases in the sense of touching the same data, just the same
  component
- `lib/permissions/sections.ts` — `SECTIONS`, `LEVEL_LABELS`, `ROLE_DEFAULTS`,
  `planAllows`, types `Section`/`AccessLevel`/`AccessMap` — the section ×
  level model the Permissions screen edits
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state
- `lib/utils/{audit,date}` — `audit.ts` supplies `writeAuditLog`
- `types` (`Profile`, `UserRole`, `UserStatus`)

## Tests

`npx jest dashboard/users` runs `_store/usersSlice.test.ts`,
`_lib/userStatusGuards.test.ts`, and `_lib/accessDiff.test.ts`.
