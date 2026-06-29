import { NextRequest, NextResponse } from "next/server";
import { createControlClient, isPlatformAdmin } from "@/lib/supabase/control";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import { addExposedSchema } from "@/lib/supabase/managementApi";
import { createClient as createServiceClient } from "@supabase/supabase-js";

async function verifyPlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return (await isPlatformAdmin(user.email)) ? user : null;
}

export async function POST(req: NextRequest) {
  const admin = await verifyPlatformAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name: string;
    slug: string;
    plan: string;
    adminEmail: string;
    adminName?: string;
  };

  const { name, plan, adminEmail, adminName = "" } = body;

  const safeSlug = body.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-/g, "_")
    .slice(0, 40);
  const schemaName = `tenant_${safeSlug}`;

  const control = createControlClient();

  const { data: existing } = await control
    .schema("control")
    .from("tenants")
    .select("id")
    .eq("slug", safeSlug)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dashboard.kaufnest.com";

  try {
    // 1. Create tenant schema in Data Plane
    const { error: schemaError } = await service.rpc("provision_tenant_schema", {
      schema_name: schemaName,
    });
    if (schemaError) throw schemaError;

    // Add the new schema to Project B's "Exposed schemas" API setting via the
    // Management API — required before any PostgREST request against
    // schemaName (the inserts below) will succeed.
    await addExposedSchema(schemaName);

    // Tenant-scoped service client (db.schema = schemaName) for inserts into
    // the new schema's tables.
    const tenantService = createServiceClientForTenant(schemaName);

    // 2. Seed company_profile — guard against a duplicate row if a previous
    // attempt got this far before failing at a later step (retries reuse the
    // same schemaName).
    const { data: existingProfile } = await tenantService
      .from("company_profile")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!existingProfile) {
      await tenantService.from("company_profile").insert({ name, currency: "EUR", timezone: "UTC" });
    }

    // 3. Invite admin user
    const { data: inviteData, error: inviteError } =
      await service.auth.admin.inviteUserByEmail(adminEmail, {
        redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
        data: { full_name: adminName, tenant_schema: schemaName, role: "super_admin" },
      });
    if (inviteError) throw inviteError;

    // inviteUserByEmail resends (no error) for an email that already has a
    // pending/accepted invite elsewhere, returning that existing user instead
    // of creating a new one. If it already belongs to another tenant, bail out
    // rather than re-stamping its app_metadata.tenant_schema to this new
    // tenant and creating a second profiles row for the same auth user.
    const existingTenantSchema = inviteData.user?.app_metadata?.tenant_schema as string | undefined;
    if (existingTenantSchema && existingTenantSchema !== schemaName) {
      throw new Error(
        `Admin email "${adminEmail}" is already associated with another tenant. Use a different admin email.`
      );
    }

    // 4. Create profile row + stamp app_metadata
    if (inviteData.user) {
      const { error: profileError } = await tenantService.from("profiles").insert({
        id: inviteData.user.id,
        email: adminEmail,
        full_name: adminName,
        role: "super_admin",
      });
      if (profileError) throw profileError;

      await service.rpc("set_user_tenant", {
        user_id: inviteData.user.id,
        schema_name: schemaName,
      });
    }

    // 5. Register in control plane
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    await control.schema("control").from("tenants").insert({
      name,
      slug: safeSlug,
      schema_name: schemaName,
      admin_email: adminEmail,
      plan,
      status: "inactive",
      trial_ends_at: trialEnd.toISOString(),
    });

    return NextResponse.json({ ok: true, schemaName });
  } catch (err: unknown) {
    console.error("Provisioning failed:", err);
    return NextResponse.json(
      { error: "Provisioning failed", detail: errorMessage(err) },
      { status: 500 }
    );
  }
}

// Supabase's PostgrestError/AuthError carry a `.message`, but aren't always
// `instanceof Error` — String(err) on those yields "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
