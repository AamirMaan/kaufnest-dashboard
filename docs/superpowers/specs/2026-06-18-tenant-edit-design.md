# Tenant Edit — Design Spec

**Date:** 2026-06-18
**Scope:** Add the ability for platform admins to update a tenant's `plan`, `status`, and `admin_email` from the Tenant Management page (`/admin`).

---

## Problem

The admin panel currently only supports provisioning new tenants and impersonating their admins. There is no way to update a tenant after creation — changing plan tier, toggling status (e.g. cancelling or reactivating), or correcting an admin's email requires direct database access.

---

## Solution Overview

- A new `PATCH /api/admin/tenants/[id]` route accepts partial updates (`plan`, `status`, `admin_email`).
- A new `EditTenantModal` component surfaces those three fields pre-filled.
- `TenantActions` gains an "Edit" button that opens the modal and triggers a list refresh on success.

---

## Backend

### Route: `PATCH /api/admin/tenants/[id]`

**File:** `src/app/api/admin/tenants/[id]/route.ts`

**Auth:** `verifyPlatformAdmin()` — same guard used by all other `/api/admin/*` routes.

**Request body:** `{ plan?: TenantPlan, status?: TenantStatus, admin_email?: string }` — all fields optional; only fields present in the body are applied.

**Execution order:**

1. Fetch the current tenant row from `control.tenants` by `id`. Return 404 if not found.
2. If `admin_email` is present and differs from the current value:
   - Look up the existing user in Project B Auth by the old email: call `auth.admin.listUsers()` (returns all users) and filter the result array by `email === oldEmail`. Acceptable given the low number of users in a SaaS admin context; no `getUserByEmail` exists in the Supabase JS admin API.
   - Call `auth.admin.updateUserById(userId, { email: newEmail })`. This triggers Supabase's standard re-verification email to the new address.
   - If this step fails, return `{ error: "Failed to update admin email", detail }` (500) without touching `control.tenants`.
3. `UPDATE control.tenants SET <changed fields>, updated_at = now() WHERE id = $id` using the Supabase client's `.update()` with `.eq("id", id)`.
4. Return `{ tenant: updatedRow }` (200) on success.

**Error shape:** `{ error: string, detail?: string }` — matches the existing `provision-tenant` convention. `detail` carries the raw Supabase/Postgres message via the shared `errorMessage()` helper.

**Consistency note:** If step 2 succeeds but step 3 fails, Auth and control are briefly out of sync. This is acceptable for a low-frequency admin action — step 2 (`updateUserById`) is idempotent, so the admin can retry and the Auth state will converge.

**Note on Stripe:** `plan` and `status` are normally written by Stripe webhooks, not the UI. This route is a deliberate **platform-admin override** — it writes directly to `control.tenants` without touching Stripe. Admins should use it for manual corrections (e.g. granting a plan upgrade outside of billing, reactivating a cancelled tenant). It does not create or modify any Stripe subscription.

---

## Frontend

### `EditTenantModal`

**File:** `src/app/admin/_components/EditTenantModal.tsx`

Mirrors `AddTenantModal` in structure (uses `Modal`, `FormFields`, `useToast` from shared UI).

**Props:** `{ open: boolean, tenant: Tenant, onClose: () => void }`

**Fields (all pre-filled from `tenant`):**
- **Admin Email** — `<input type="email">`. If changed, renders an inline note: *"A verification email will be sent to the new address."*
- **Plan** — `<select>`: trial / starter / pro / business
- **Status** — `<select>`: active / inactive / cancelled

**Submit behaviour:**
- Computes a partial patch object containing only fields that differ from the original tenant values — avoids unnecessary Auth side-effects if `admin_email` is unchanged.
- `PATCH /api/admin/tenants/[tenant.id]` with `Content-Type: application/json`.
- On success: `useToast().success("Tenant updated")`, call `onClose()` (parent bumps `refreshKey`).
- On failure: inline red banner showing `data.detail ?? data.error` + `useToast().error(...)`.

### `TenantActions`

**File:** `src/app/admin/_components/TenantActions.tsx`

**Changes:**
- Add `onRefresh: () => void` prop.
- Render an "Edit" `<Button variant="secondary">` before the "Impersonate" button. Clicking it sets local `editOpen` state to `true`.
- Render `<EditTenantModal open={editOpen} tenant={tenant} onClose={() => { setEditOpen(false); onRefresh(); }} />`.

### `page.tsx`

**File:** `src/app/admin/page.tsx`

**Changes:**
- Pass `onRefresh={() => setRefreshKey(k => k + 1)}` to each `<TenantActions>` in the table rows.

---

## Files touched

| File | Change |
|------|--------|
| `src/app/api/admin/tenants/[id]/route.ts` | **New** — PATCH handler |
| `src/app/admin/_components/EditTenantModal.tsx` | **New** — edit modal |
| `src/app/admin/_components/TenantActions.tsx` | Add Edit button + `onRefresh` prop + `EditTenantModal` |
| `src/app/admin/page.tsx` | Pass `onRefresh` to `TenantActions` |
| `src/app/admin/CLAUDE.md` | Update file map + data-flow |
| `src/app/admin/SKILL.md` | Add minimal-file-set entry for "edit tenant" |

---

## Out of scope

- Updating `name` or `slug` / `schema_name` — renaming a schema requires a Postgres migration, not a runtime update.
- `trial_ends_at` — not included in this edit form; can be added later.
- Stripe subscription management — plan/status here is a direct override; webhook-driven sync is unchanged.
