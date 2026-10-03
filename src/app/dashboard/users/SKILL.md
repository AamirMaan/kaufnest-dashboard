---
name: users-feature
description: Work on the Users dashboard feature (invite users, edit profiles, change roles) at src/app/dashboard/users plus its API route — use when the task mentions user management, invites, roles, permissions UI, or the /dashboard/users route.
---

# Working on the Users feature

This feature is mostly colocated under `src/app/dashboard/users/`. Read
`CLAUDE.md` in this folder first — it explains the file map, including the one
file that *can't* be colocated (the invite API route, which Next.js pins to
`/api/users/invite`).

## Minimal file set for common changes

- **Invite flow / invite form fields**: `_components/InviteUserModal.tsx` AND
  `src/app/api/users/invite/route.ts` (the server-side half of the flow).
- **Edit profile / change role UI**: `_components/EditUserModal.tsx`.
- **Per-user section permissions / Permissions screen**:
  `[id]/permissions/page.tsx` (the editor) + `_lib/accessDiff.ts` (the pure
  overlay/diff helpers it and `page.tsx`'s "Custom access" badge both use).
  The section list/labels/levels/role-defaults/plan-gating come from
  `src/lib/permissions/sections.ts` — don't hardcode a second copy of
  `SECTIONS`/`LEVEL_LABELS`/`ROLE_DEFAULTS` here. If you add a new `Section`
  key there, it automatically appears as a row in this screen (the table
  body is `SECTIONS.map(...)`) — nothing in this folder needs a matching
  update unless the new section needs bespoke display text.
- **Add a field to a user profile**: `src/types/index.ts` (`Profile`), both
  modals above, `_store/usersSlice.ts` only if the Redux shape changes, and
  `page.tsx` if it should render in the table.
- **Section/role access rules**: `src/lib/permissions/sections.ts` (shared —
  also drives `src/proxy.ts`'s route guard and `useAccess()`'s button-level
  gates everywhere else in the app), not this folder. A new section needs a
  live DB counterpart too — see `supabase/SKILL.md`'s "2 places" rule and
  migration `055_section_permissions.sql`'s `section_level_allowed` check.
- **Pagination (client-side)**: `page.tsx` only — `page`/`pageSize` local state,
  `pagedUsers` useMemo slice, `<Pagination>` component. No slice changes needed.
- **Deactivate/reactivate**: `page.tsx` (button + `writeStatusChange`),
  `_lib/userStatusGuards.ts` (the block-rules), `src/proxy.ts` (the actual
  enforcement — profiles.status check), `src/app/account-suspended/page.tsx`
  (landing page). This is intentionally NOT a delete — see this folder's
  CLAUDE.md "Deactivate/reactivate" section for why (FK constraints on
  created_by across sales/expenses/purchases/etc.).

## Test command

`npx jest dashboard/users`

## Gotchas

- `usersSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` via the `@/app/dashboard/users/_store/usersSlice`
  alias — update those if you rename the slice file.
- This page is gated to `super_admin` — check `src/proxy.ts`'s section guard
  and `s.currentUser.profile?.role` checks before changing access logic.
- Role changes must go through `writeAuditLog` with action `role_change` —
  this is the audit trail super-admins rely on to review who changed what.
  Section-permission changes use action `update` (`entityType: "user"`,
  metadata key `user_access: { before, after }` — both full `AccessMap`s, not
  a diff), status changes (deactivate/reactivate) use `status_change` (also
  add to `ACTION_VARIANTS` in `components/ui/Badge.tsx` if you add a new
  `AuditAction` — it's a `Record<AuditAction, BadgeVariant>`, TS errors if
  you forget).
- **Deactivating never deletes anything** — `sales`/`expenses`/`purchases`/
  `ebay_listing_drafts` all have `created_by uuid NOT NULL REFERENCES
  profiles(id)` with no `ON DELETE` action, so a hard delete of any profile
  that's ever created a record throws a Postgres FK violation. Don't add a
  "permanently delete this user" action without first deciding how to handle
  those references (reassign? make the column nullable + `ON DELETE SET
  NULL` across every tenant schema via the "2 places" rule?) — this was
  explicitly scoped OUT when the feature was built (2026-07-29).
- `canDeactivateUser()` in `_lib/userStatusGuards.ts` is checked **client-side
  only** (disables the button + shows the reason as a tooltip) — there is no
  matching DB-level/RLS enforcement of "can't deactivate the last super_admin"
  or "can't deactivate yourself". If you're worried about a race (two
  super_admins deactivating different people simultaneously), that's a real
  gap, but matches this codebase's existing pattern of trusting the client
  for role-adjacent guards rather than duplicating every check in RLS.
- **Section permissions store exceptions only** — `user_section_access`
  never holds a full copy of the grid, only cells that differ from
  `ROLE_DEFAULTS[role]`. `diffAccess` is what turns "the user clicked a
  radio back to the role default" into a `delete`, not a redundant upsert —
  don't bypass it with a naive "upsert everything in `edited`" write, or
  every user ends up with 12 stored rows instead of however many they
  actually customized.
- **Role-change cleanup of now-redundant exceptions is a DB trigger**
  (migration 055), not application code — if you change a user's role on
  this page or anywhere else, don't add client-side logic to prune their
  `user_section_access` rows; the trigger already does it.
- **`user_section_access` rows for a `super_admin` user are rejected by a DB
  trigger** (`SECTION_ACCESS_SUPER_ADMIN`) — the Permissions screen mirrors
  this by not rendering a grid at all for a super_admin target, and the list
  page hides the "Manage permissions" link for super_admin rows for the same
  reason. Don't remove either client-side guard thinking the DB will just
  silently accept the write — it 403s.
- **The plan ceiling on the Permissions screen is display-only** — a row for
  a section the tenant's plan doesn't include (`!planAllows(...)`) is shown
  disabled with a "Not in your plan" badge so a super_admin can still see
  and set the role/exception value (it takes effect automatically if the
  tenant upgrades), but nothing here enforces the ceiling at save time — the
  same `applyPlanCeiling` that `useAccess()` applies elsewhere is what
  actually blocks a plan-gated action.
- `DeleteConfirmModal`'s new `requireReason` prop (Task 7) defaults `true` —
  every pre-existing caller (this folder's Deactivate confirmation, Sales'
  Delete Order, etc.) is unaffected. Only pass `requireReason={false}` for a
  genuinely reversible, not-yet-committed confirmation like "Reset to role
  defaults" where there's nothing yet to audit-log a reason against.
- **Invites are capped by the plan's user limit** (`control.plans.max_users`,
  enforced since plan-management Task 3). Step 3c of
  `src/app/api/users/invite/route.ts` counts the tenant's `profiles` rows
  whose `status` isn't `deactivated` and checks `canAddUser(ent, count)`
  (`getEntitlements(tenant.plan)`); at the limit it returns **403** `"Your
  plan allows up to <maxUsers> users. Upgrade your plan to invite more."`,
  which `InviteUserModal` shows inline (it already prefers `json.error`). A
  catalog/count failure is a 500 "Could not check your plan". Deactivating a
  user frees a seat.
- `src/app/api/users/invite/route.ts` invites users into the **caller's own**
  tenant (`user.app_metadata.tenant_schema`) — it 400s with a friendly message
  if that's missing (stale JWT from before Phase 2.3 stamping; user needs to
  re-login). It writes the new profile via `createServiceClientForTenant()`,
  not a plain `public`-schema client — there is no `handle_new_user` trigger
  to fall back on anymore.
- If invited users report they can't set a password / can't log in after
  accepting the invite, the `redirectTo` this route passes to
  `inviteUserByEmail` (`${NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/set-password`)
  is no longer what builds the email link — check the Supabase Dashboard
  (Authentication → Email Templates → "Invite user") instead: the link must be
  `{{ .SiteURL }}/auth/confirm?next=/set-password&token_hash={{ .TokenHash }}&type=invite`,
  not `{{ .ConfirmationURL }}` or `{{ .RedirectTo }}` (the latter is a known
  Supabase bug that falls back to a bare, broken Site URL — see the gotchas in
  `src/app/(auth)/SKILL.md` for the full invite→set-password→login chain and
  what to check).
- **Duplicate-email guard**: `inviteUserByEmail` does NOT error for an email
  that already has a pending (unconfirmed) invite — it silently resends and
  returns the *existing* `auth.users` row. Before calling it, the route now
  checks `tenant_<schema>.profiles` for that email (`.ilike`) and 409s with "A
  user with this email already exists in this team." if found. After the
  invite call, it also checks `inviteData.user.app_metadata?.tenant_schema` —
  if the returned user already belongs to a *different* tenant, it 409s with
  "This email is already associated with another organization." instead of
  inserting a second `profiles` row and re-stamping `tenant_schema` to this
  tenant (which would silently move that user out of their original tenant).
  `usersSlice.addUser` also dedupes by `id` as a second line of defense.
- **Permission-change audit entries are `entityType: "user"`** with
  `metadata.user_access: { before, after }` (full grids) — deliberate: the
  change is about a user, and the Audit Logs viewer already filters/links by
  user. Don't invent a new entity type for it.
- **Granting Audit logs: View exposes other sections' data.** Audit entries
  carry before/after payloads of the records they describe, so a user with
  Audit logs: View but Orders: None can still read order values through the
  trail. Warn the account owner before granting it on its own.
- **Listings/Messages depend on Integrations: Edit** (055's
  `current_user_access` wraps `current_user_access_base`; TS mirror
  `applyDependencies()` in `src/lib/permissions/sections.ts`). The editor
  disables their Edit radios below Integrations: Edit
  (`needsIntegrations()`), and lowering Integrations zeroes both in `edited`
  (`withLevel()`, `_lib/accessDiff.ts`). Stored rows that become ineffective
  are left alone — the DB ignores them.
- **The Permissions screen never shows role defaults on a load error** — it
  renders "Couldn't load…" + Retry (no grid, no Save), since saving over a
  defaults grid would wipe real exceptions. A failed save also re-fetches
  (`reloadKey`), because the delete can succeed before the upsert fails.
- **The list page's `user_section_access` read goes through `fetchAllRows`**
  (≤ 12 × users rows can still exceed PostgREST Max Rows; ordered by
  `user_id, section` for stable paging).
- **Only the super_admin (or the server) can change `profiles.role`/
  `status`/`permission_overrides`** — the `profiles_guard_privileged_fields`
  trigger (055) raises `PROFILE_PRIVILEGED_FIELDS` otherwise. Every app path
  that writes those fields is either on this super_admin-only page/
  `EditUserModal` or a service-role insert (invite/provision).

## Manual acceptance checklist (section permissions)

Run against a real tenant after 055/047/048 are re-applied:

- A non-super_admin cannot write `user_section_access` (insert/update/
  delete from their session) — expect an RLS error.
- An exception row for a super_admin user is rejected — expect
  `SECTION_ACCESS_SUPER_ADMIN`.
- A user cannot change their own role (e.g. an admin `update profiles set
  role = 'super_admin' where id = auth.uid()`) — expect
  `PROFILE_PRIVILEGED_FIELDS`. Same for `status` and
  `permission_overrides`; editing their own `full_name` still works.
- An accountant with Listings: Edit but Integrations: None gets 0 for
  Listings from `get_my_access()` and can't reach `/dashboard/listings`.
