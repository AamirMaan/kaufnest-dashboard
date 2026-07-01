# Tenant Status Lifecycle — Design Spec

**Date:** 2026-07-01
**Branch:** feat/resend-invite
**Scope:** Fix tenant status logic — correct lifecycle transitions, first-login auto-activation, deactivated-tenant access block, resend-invite visibility.
**Stripe:** Out of scope. Status transitions remain platform-admin-driven until Stripe is wired.

---

## 1. Status Vocabulary

| Status | Replaces | Set by | Meaning |
|---|---|---|---|
| `invited` | `inactive` | provisioning | Tenant provisioned; admin email sent; not yet logged in |
| `active` | — | system (first login) | Tenant admin has completed first login |
| `deactivated` | `cancelled` | platform admin | Access revoked for all users in this tenant |

`TenantStatus = "invited" | "active" | "deactivated"` (`src/types/index.ts`)

---

## 2. Lifecycle Transitions

```
provision-tenant  →  invited
                         │
              admin clicks invite link
                         │
              auth/confirm OTP verified
                         ↓
                       active
                         │
          platform admin sets deactivated
                         ↓
                    deactivated
```

- `invited → active`: automatic, triggered in `src/app/auth/confirm/route.ts` after successful OTP verification. Only fires when current status is `"invited"` — subsequent logins are no-ops.
- `* → deactivated`: platform admin only, via `EditTenantModal` → `PATCH /api/admin/tenants/[id]`.
- `deactivated → active`: platform admin can manually reinstate via `EditTenantModal`.

---

## 3. Database Migration

File: `supabase/migrations/006_tenant_status_rename.sql`

```sql
-- Migrate existing data
UPDATE control.tenants SET status = 'invited'     WHERE status = 'inactive';
UPDATE control.tenants SET status = 'deactivated' WHERE status = 'cancelled';

-- Update CHECK constraint
ALTER TABLE control.tenants
  DROP CONSTRAINT IF EXISTS tenants_status_check,
  ADD  CONSTRAINT tenants_status_check
       CHECK (status IN ('invited', 'active', 'deactivated'));
```

Data-only change — no new columns, no structural changes.

---

## 4. First-Login Auto-Activation (`auth/confirm`)

File: `src/app/auth/confirm/route.ts`

After successful `supabase.auth.verifyOtp()`:

1. Read `user.app_metadata.tenant_schema`
2. Query `control.tenants` via `createControlClient()` for that schema
3. If `status === "invited"`, `UPDATE control.tenants SET status = 'active' WHERE schema_name = tenantSchema`
4. Continue to existing redirect (`/set-password` or `/dashboard`)

Uses the existing `createControlClient()` (Project A service-role client) — no new credentials.

---

## 5. Proxy Enforcement (`proxy.ts`)

File: `src/proxy.ts`

Inside the existing `if (user && isDashboardRoute)` block, after reading `tenantSchema` from `user.app_metadata`:

1. Query `control.tenants` via `createControlClient()` where `schema_name = tenantSchema`
2. If `status === "deactivated"` → `NextResponse.redirect` to `/account-deactivated`
3. Otherwise → continue to existing RBAC check (`canAccessRoute`)

The `/account-deactivated` route is outside the proxy matcher (`/dashboard/*`, `/login`) so deactivated users can reach it without triggering a redirect loop.

**Performance note:** Adds one Project A DB call per authenticated dashboard request. Acceptable at current B2B request volumes. A short-lived cookie cache can be layered on later if needed.

---

## 6. New Page: `/account-deactivated`

File: `src/app/account-deactivated/page.tsx`

- Server component, no auth required
- Matches `/login` page visual style (logo, centred card)
- Heading: "Account Deactivated"
- Body: "Your organisation's KaufNest account has been deactivated. Please contact KaufNest support if you believe this is an error."
- No interactive elements, no redirect back into the app

---

## 7. Admin UI Changes

### `src/types/index.ts`
```ts
export type TenantStatus = "active" | "invited" | "deactivated";
```

### `src/app/admin/page.tsx`
- `STATUS_VARIANT`: `invited → "warning"`, `deactivated → "danger"`, `active → "success"`
- Stats cards: "Trial" → "Invited", "Cancelled" → "Deactivated"

### `src/app/admin/_components/EditTenantModal.tsx`
- Status `<select>` options: `invited / active / deactivated`

### `src/app/admin/_components/TenantActions.tsx`
- Resend Invite visibility: `tenant.status === "invited"` (was `"inactive"`)

### `src/app/api/admin/provision-tenant/route.ts`
- Change `status: "inactive"` → `status: "invited"` when inserting into `control.tenants`

---

## 8. Files Touched

| File | Change |
|---|---|
| `src/types/index.ts` | Update `TenantStatus` union |
| `src/app/admin/page.tsx` | Badge variants + stats card labels |
| `src/app/admin/_components/EditTenantModal.tsx` | Status dropdown options |
| `src/app/admin/_components/TenantActions.tsx` | Resend Invite condition |
| `src/app/api/admin/provision-tenant/route.ts` | `status: "invited"` at insert |
| `src/app/api/admin/resend-invite/route.ts` | Guard: return 400 if tenant status is not `"invited"` |
| `src/app/auth/confirm/route.ts` | Auto-activate on first login |
| `src/proxy.ts` | Deactivated-tenant redirect |
| `src/app/account-deactivated/page.tsx` | New blocked page |
| `supabase/migrations/006_tenant_status_rename.sql` | Data + constraint migration |
| `src/app/admin/CLAUDE.md` | Update docs |

---

## 9. Out of Scope

- Stripe integration (future — webhooks will drive `active`/`deactivated` transitions automatically)
- Notifying tenant users by email when their account is deactivated
- Proxy cookie caching for status (can add later if performance warrants it)
