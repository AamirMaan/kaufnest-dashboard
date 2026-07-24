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
- **Per-user permission overrides / Permissions modal**:
  `_components/PermissionsModal.tsx` (grouping/labels come from
  `ALL_PERMISSIONS`/`PERMISSION_LABELS` in `lib/utils/permissions.ts`, don't
  hardcode a second list here). If you add a new `Permission` key to
  `PERMISSIONS` in `permissions.ts`, also add it to `PERMISSION_LABELS`
  (TS enforces this via `Record<Permission, string>`) and to one of the
  `PERMISSION_GROUPS` in `PermissionsModal.tsx` (NOT type-enforced — an
  unlisted permission just won't show up in the modal, silently).
- **Add a field to a user profile**: `src/types/index.ts` (`Profile`), both
  modals above, `_store/usersSlice.ts` only if the Redux shape changes, and
  `page.tsx` if it should render in the table.
- **Role/permission rules**: `src/lib/utils/permissions.ts` (shared — also
  drives route access in `src/proxy.ts`), not this folder. Adding a new
  overridable capability to an EXISTING permission that's checked in RLS
  (currently only `delete_sale`/`delete_expense`/`delete_purchase`) also
  needs a matching RLS policy change — see `supabase/SKILL.md`'s "2 places"
  rule and `023_user_permission_overrides.sql`. Permissions checked only in
  application code need no DB change at all.
- **Pagination (client-side)**: `page.tsx` only — `page`/`pageSize` local state,
  `pagedUsers` useMemo slice, `<Pagination>` component. No slice changes needed.

## Test command

`npx jest dashboard/users`

## Gotchas

- `usersSlice` is registered centrally in `src/store/store.ts` and hydrated in
  `src/store/StoreProvider.tsx` via the `@/app/dashboard/users/_store/usersSlice`
  alias — update those if you rename the slice file.
- This page is gated to `super_admin` — check `lib/utils/permissions.ts` and
  `s.currentUser.profile?.role` checks before changing access logic.
- Role changes must go through `writeAuditLog` with action `role_change` —
  this is the audit trail super-admins rely on to review who changed what.
  Permission-override changes use action `permission_change` (also add to
  `ACTION_VARIANTS` in `components/ui/Badge.tsx` if you add a new
  `AuditAction` — it's a `Record<AuditAction, BadgeVariant>`, TS errors if
  you forget).
- `PermissionsModal` reuses `usersSlice`'s generic `updateUser` action (full
  profile replace) rather than a dedicated `updatePermissions` action — same
  pattern as `EditUserModal`. Don't add a new slice action for this unless
  the write shape actually diverges from "replace the whole profile row".
- Overrides are **additive only**: the modal always renders a permission as
  checked+disabled (not editable) when `hasPermission(user.role, permission)`
  is already `true` from the role alone — there's no way to use this UI to
  take a permission away from what the role grants. If a future ask is "let
  a super_admin restrict what an admin can do below their role default",
  that's a different (breaking) model change, not an extension of this one.
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
