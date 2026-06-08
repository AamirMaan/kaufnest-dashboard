# Users feature

Route: `/dashboard/users`. Super-admin-only user management: invite new users,
edit profile/role, change roles (`super_admin`, `admin`, `accountant`).

## Files in this folder

- `page.tsx` — list view, role badges, wires up the modals below. Gated to
  `super_admin` (see `lib/utils/permissions.ts`).
- `_store/usersSlice.ts` — Redux slice for `state.users` (`items`, `loaded`).
  Actions: `hydrateUsers`, `addUser`, `updateUser`, `updateUserRole`. Used
  **only** by this feature — registered centrally in `src/store/store.ts` and
  hydrated in `src/store/StoreProvider.tsx`, but otherwise self-contained here.
- `_store/usersSlice.test.ts` — reducer tests. Run with `npx jest dashboard/users`.
- `_components/InviteUserModal.tsx` — sends an invite (calls the API route below),
  then dispatches `addUser`.
- `_components/EditUserModal.tsx` — edits profile fields and/or role, dispatches `updateUser`.

## Related file outside this folder (cannot be colocated)

- `src/app/api/users/invite/route.ts` — server route that creates the
  Supabase Auth user and profile row for an invite. Next.js requires API routes
  to live at their URL path (`/api/users/invite`), so it can't move into this
  feature's private folder — but it is conceptually part of this feature.
  `InviteUserModal` calls it via `fetch("/api/users/invite")`.

## Data flow

1. Invite: `InviteUserModal` POSTs to `/api/users/invite` (uses the Supabase
   admin client server-side), then dispatches `addUser` with the returned profile.
2. Edit/role-change: write to Supabase (`profiles` table) via
   `createClient()` (`@/lib/supabase/client`), dispatch `updateUser`/`updateUserRole`.
3. Both call `writeAuditLog` (`@/lib/utils/audit`) then dispatch `addAuditLog`
   (`@/store/slices/auditLogsSlice`) — role changes use the `role_change` audit action.

## Shared dependencies (live outside this folder on purpose)

- `components/ui/*` — `Button`, `DataTable`, `Badge` (`RoleBadge`)
- `store/slices/{auditLogsSlice,currentUserSlice}` — cross-cutting state
- `lib/utils/{audit,date,permissions}`
- `types` (`Profile`, `UserRole`)

## Tests

`npx jest dashboard/users` runs `_store/usersSlice.test.ts`.
