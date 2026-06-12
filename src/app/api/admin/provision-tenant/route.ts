import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

async function verifyPlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const control = createControlClient();
  const { data: adminUser } = await control
    .schema("control")
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .single();

  return adminUser ? user : null;
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

  try {
    // 1. Create tenant schema in Data Plane
    const { error: schemaError } = await service.rpc("provision_tenant_schema", {
      schema_name: schemaName,
    });
    if (schemaError) throw schemaError;

    // Tenant-scoped service client (db.schema = schemaName) for inserts into
    // the new schema's tables. NOTE: schemaName must also be added to this
    // project's "Exposed schemas" API setting (Project Settings -> API ->
    // Data API Settings) or these requests will fail with a 406 — see
    // SAAS_MIGRATION.md Phase 4 for the dynamic-tenant follow-up.
    const tenantService = createServiceClientForTenant(schemaName);

    // 2. Seed company_profile
    await tenantService.from("company_profile").insert({ name, currency: "EUR", timezone: "UTC" });

    // 3. Invite admin user
    const { data: inviteData, error: inviteError } =
      await service.auth.admin.inviteUserByEmail(adminEmail, {
        data: { full_name: adminName, tenant_schema: schemaName, role: "super_admin" },
      });
    if (inviteError) throw inviteError;

    // 4. Create profile row + stamp app_metadata
    if (inviteData.user) {
      await tenantService.from("profiles").insert({
        id: inviteData.user.id,
        email: adminEmail,
        full_name: adminName,
        role: "super_admin",
      });
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
      plan,
      status: "active",
      trial_ends_at: trialEnd.toISOString(),
    });

    return NextResponse.json({ ok: true, schemaName });
  } catch (err: unknown) {
    console.error("Provisioning failed:", err);
    return NextResponse.json(
      { error: "Provisioning failed", detail: String(err) },
      { status: 500 }
    );
  }
}
