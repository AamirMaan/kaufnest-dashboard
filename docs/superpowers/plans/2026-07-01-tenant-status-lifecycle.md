# Tenant Status Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `inactive`/`cancelled` tenant statuses with a correct `invited` → `active` / `deactivated` lifecycle, enforce `deactivated` at the proxy, and auto-activate tenants on first login.

**Architecture:** The `TenantStatus` type drives everything — changing it to `"invited" | "active" | "deactivated"` creates TypeScript errors at every consumer that must be fixed. The `auth/confirm` route auto-flips `invited → active` after OTP verification. The proxy checks `control.tenants` on every dashboard request and redirects deactivated tenants to a static blocked page.

**Tech Stack:** Next.js App Router, Supabase (Project A = control plane, Project B = data plane), TypeScript, Tailwind CSS (CSS vars)

## Global Constraints

- Never query `public.*` — all tenant data lives in `tenant_<slug>` schemas
- `createControlClient()` is server-only — never import it in Client Components
- Never hardcode schema names — always read from `user.app_metadata.tenant_schema`
- No unit tests for Supabase/network calls — verify manually in the browser
- No `src/middleware.ts` — the proxy lives in `src/proxy.ts` only
- Migration applies to Project A (control plane), not Project B

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/009_tenant_status_rename.sql`

**Interfaces:**
- Produces: `control.tenants.status` column accepts only `'invited' | 'active' | 'deactivated'`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/009_tenant_status_rename.sql
-- Rename tenant status values and update CHECK constraint.
-- Apply to: Project A (control plane Supabase project).

UPDATE control.tenants SET status = 'invited'     WHERE status = 'inactive';
UPDATE control.tenants SET status = 'deactivated' WHERE status = 'cancelled';

ALTER TABLE control.tenants
  DROP CONSTRAINT IF EXISTS tenants_status_check,
  ADD  CONSTRAINT tenants_status_check
       CHECK (status IN ('invited', 'active', 'deactivated'));
```

- [ ] **Step 2: Apply to Project A**

In the Supabase Dashboard for Project A (control plane), open the SQL editor and run the migration file contents. Verify with:

```sql
SELECT status, COUNT(*) FROM control.tenants GROUP BY status;
```

Expected: only `invited`, `active`, or `deactivated` values appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/009_tenant_status_rename.sql
git commit -m "feat(db): rename tenant status inactive→invited, cancelled→deactivated"
```

---

### Task 2: TenantStatus Type + Admin UI

**Files:**
- Modify: `src/types/index.ts:162`
- Modify: `src/app/admin/page.tsx:18-22,45-47,66-71`
- Modify: `src/app/admin/_components/EditTenantModal.tsx:146-149`
- Modify: `src/app/admin/_components/TenantActions.tsx:72-74`

**Interfaces:**
- Consumes: `TenantStatus` from `src/types/index.ts` — must be updated first; TypeScript errors downstream guide the remaining edits
- Produces: `TenantStatus = "active" | "invited" | "deactivated"` used by all admin UI

- [ ] **Step 1: Update `TenantStatus` in `src/types/index.ts`**

Find line 162 (currently `export type TenantStatus = "active" | "inactive" | "cancelled";`) and replace with:

```ts
export type TenantStatus = "active" | "invited" | "deactivated";
```

- [ ] **Step 2: Fix `STATUS_VARIANT` and stats in `src/app/admin/page.tsx`**

Replace lines 18–22 (the `STATUS_VARIANT` constant):

```ts
const STATUS_VARIANT: Record<TenantStatus, "success" | "warning" | "danger" | "default"> = {
  active:      "success",
  invited:     "warning",
  deactivated: "danger",
};
```

Replace lines 46–48 (the derived counts — `total` and `list` on lines 44–45 stay unchanged):

```ts
const active      = list.filter((t) => t.status === "active").length;
const invited     = list.filter((t) => t.status === "invited").length;
const deactivated = list.filter((t) => t.status === "deactivated").length;
```

Replace lines 66–69 (the stats cards array):

```ts
{ label: "Total Tenants", value: total },
{ label: "Active",        value: active },
{ label: "Invited",       value: invited },
{ label: "Deactivated",   value: deactivated },
```

- [ ] **Step 3: Fix status dropdown in `src/app/admin/_components/EditTenantModal.tsx`**

Replace lines 146–149 (the three `<option>` elements inside the status `<select>`):

```tsx
<option value="active">Active</option>
<option value="invited">Invited</option>
<option value="deactivated">Deactivated</option>
```

- [ ] **Step 4: Conditionally render Resend Invite in `src/app/admin/_components/TenantActions.tsx`**

Replace lines 72–74 (the Resend Invite `<Button>`):

```tsx
{tenant.status === "invited" && (
  <Button variant="secondary" onClick={handleResendInvite} disabled={resending}>
    {resending ? "Sending…" : "Resend Invite"}
  </Button>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts \
        src/app/admin/page.tsx \
        src/app/admin/_components/EditTenantModal.tsx \
        src/app/admin/_components/TenantActions.tsx
git commit -m "feat(admin): update TenantStatus type and admin UI to invited/deactivated"
```

---

### Task 3: API Route Fixes

**Files:**
- Modify: `src/app/api/admin/provision-tenant/route.ts:132`
- Modify: `src/app/api/admin/resend-invite/route.ts`

**Interfaces:**
- Consumes: `TenantStatus` — `"invited"` and `"deactivated"` are the new string literals
- Produces: provision sets `status: "invited"`; resend-invite returns 400 if status is not `"invited"`

- [ ] **Step 1: Change initial status in `provision-tenant/route.ts`**

Find line 132 (inside the `control.schema("control").from("tenants").insert({...})` call):

```ts
status: "inactive",
```

Change to:

```ts
status: "invited",
```

- [ ] **Step 2: Add guard to `resend-invite/route.ts`**

After the block that fetches `tenant` and checks `!tenant.admin_email` (currently around line 39–41), add:

```ts
if (tenant.status !== "invited") {
  return NextResponse.json(
    { error: "Invite can only be resent for tenants that have not yet logged in" },
    { status: 400 }
  );
}
```

The full updated route after the tenant fetch and email check should read:

```ts
if (tenantError || !tenant) {
  return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
}

if (!tenant.admin_email) {
  return NextResponse.json({ error: "Tenant has no admin email configured" }, { status: 400 });
}

if (tenant.status !== "invited") {
  return NextResponse.json(
    { error: "Invite can only be resent for tenants that have not yet logged in" },
    { status: 400 }
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/provision-tenant/route.ts \
        src/app/api/admin/resend-invite/route.ts
git commit -m "feat(api): set status=invited at provision; guard resend-invite to invited tenants only"
```

---

### Task 4: First-Login Auto-Activation (`auth/confirm`)

**Files:**
- Modify: `src/app/auth/confirm/route.ts`

**Interfaces:**
- Consumes: `createControlClient()` from `@/lib/supabase/control` — already used in other server routes; import it here
- Produces: after successful OTP verification, if the tenant's status is `"invited"`, updates it to `"active"` in `control.tenants` before redirecting

- [ ] **Step 1: Replace `src/app/auth/confirm/route.ts` with the updated version**

```ts
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Auth confirm route.
 *
 * Supabase email links (invite, password reset) point here with a
 * `token_hash` + `type` rather than `{{ .ConfirmationURL }}`'s `*.supabase.co`
 * verify link — corporate email security scanners pre-fetch `*.supabase.co`
 * links and burn the single-use token before the real user clicks
 * (https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0).
 * Routing through our own domain first avoids that.
 *
 * Configure in Supabase Dashboard → Authentication → URL Configuration:
 *   Redirect URLs: https://dashboard.kaufnest.com/auth/confirm**
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Auto-activate tenant on first login: flip invited → active
      const tenantSchema = user?.app_metadata?.tenant_schema as string | undefined;
      if (tenantSchema) {
        const control = createControlClient();
        const { data: tenantRow } = await control
          .schema("control")
          .from("tenants")
          .select("status")
          .eq("schema_name", tenantSchema)
          .single<{ status: string }>();
        if (tenantRow?.status === "invited") {
          await control
            .schema("control")
            .from("tenants")
            .update({ status: "active" })
            .eq("schema_name", tenantSchema);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=invalid_link`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/confirm/route.ts
git commit -m "feat(auth): auto-activate tenant on first OTP verification"
```

---

### Task 5: Proxy Enforcement + `/account-deactivated` Page

**Files:**
- Modify: `src/proxy.ts`
- Create: `src/app/account-deactivated/page.tsx`

**Interfaces:**
- Consumes: `createControlClient()` from `@/lib/supabase/control`
- Produces: any authenticated dashboard request for a `deactivated` tenant redirects to `/account-deactivated` before RBAC runs; the page itself needs no auth

- [ ] **Step 1: Replace `src/proxy.ts` with the updated version**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessRoute } from "@/lib/utils/permissions";
import { createControlClient } from "@/lib/supabase/control";
import type { UserRole } from "@/types";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  // Redirect unauthenticated users to login
  if (!user && isDashboardRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // RBAC: check route-level permissions
  if (user && isDashboardRoute) {
    const tenantSchema =
      (user.app_metadata?.tenant_schema as string | undefined) ?? "public";

    // Block deactivated tenants before any RBAC check
    const control = createControlClient();
    const { data: tenantRow } = await control
      .schema("control")
      .from("tenants")
      .select("status")
      .eq("schema_name", tenantSchema)
      .single<{ status: string }>();

    if (tenantRow?.status === "deactivated") {
      const url = request.nextUrl.clone();
      url.pathname = "/account-deactivated";
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .schema(tenantSchema)
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = (profile?.role ?? "accountant") as UserRole;

    if (!canAccessRoute(role, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/login"],
};
```

- [ ] **Step 2: Create `src/app/account-deactivated/page.tsx`**

```tsx
export default function AccountDeactivatedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4">
      <div className="w-full max-w-md bg-(--color-surface) border border-(--color-border) rounded-[var(--radius-card)] p-8 text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Account Deactivated
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your organisation&apos;s KaufNest account has been deactivated.
          Please contact KaufNest support if you believe this is an error.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts src/app/account-deactivated/page.tsx
git commit -m "feat(proxy): block deactivated tenants; add /account-deactivated page"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `src/app/admin/CLAUDE.md`

- [ ] **Step 1: Update the status references in `src/app/admin/CLAUDE.md`**

In the `page.tsx` description, replace references to `"inactive"`/`"cancelled"` with `"invited"`/`"deactivated"` and the stats card labels.

In the `TenantActions.tsx` description, update the Resend Invite condition from `tenant.status === "inactive"` to `tenant.status === "invited"`.

In the `provision-tenant/route.ts` description, update step 6 to show `status: "invited"` and note that status auto-flips to `"active"` when the admin verifies their invite link via `auth/confirm`.

In the `resend-invite/route.ts` description, add that the route returns 400 if `tenant.status !== "invited"`.

Add a new entry for `src/app/account-deactivated/page.tsx` under the shared dependencies or as a standalone note: static page shown when the proxy detects `tenant.status === "deactivated"`.

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/CLAUDE.md
git commit -m "docs(admin): update CLAUDE.md for invited/deactivated status lifecycle"
```
