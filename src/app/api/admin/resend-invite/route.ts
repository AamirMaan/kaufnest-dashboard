import { NextRequest, NextResponse } from "next/server";
import { createControlClient, isPlatformAdmin } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Tenant } from "@/types";

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

  const body = (await req.json()) as { tenantId?: string };
  const { tenantId } = body;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("id, name, admin_email, schema_name, status")
    .eq("id", tenantId)
    .single<Pick<Tenant, "id" | "name" | "admin_email" | "schema_name" | "status">>();

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

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dashboard.kaufnest.com";

  // Look up the existing profile to get full_name (stored at invite time)
  const { createServiceClientForTenant } = await import("@/lib/supabase/server");
  const tenantService = createServiceClientForTenant(tenant.schema_name);
  const { data: profile } = await tenantService
    .from("profiles")
    .select("full_name")
    .ilike("email", tenant.admin_email)
    .maybeSingle<{ full_name: string | null }>();

  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(
    tenant.admin_email,
    {
      redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
      data: {
        full_name: profile?.full_name ?? "",
        tenant_schema: tenant.schema_name,
        role: "super_admin",
      },
    }
  );

  if (inviteError) {
    // Supabase rejects inviteUserByEmail for already-confirmed users.
    // This means the admin logged in before status was auto-updated — correct it now.
    if (inviteError.message.toLowerCase().includes("already been registered")) {
      await control
        .schema("control")
        .from("tenants")
        .update({ status: "active" })
        .eq("id", tenant.id);
      return NextResponse.json(
        { error: "This admin has already accepted their invite and logged in. Their tenant status has been updated to Active." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
