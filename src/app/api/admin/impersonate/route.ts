import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Returns the caller's email if they're a platform admin AND allowed to
 * impersonate (`control.admin_users.can_impersonate`), null otherwise. Does
 * its own query (rather than the shared `isPlatformAdmin`) because
 * impersonation specifically needs `can_impersonate`, not just admin-panel
 * access.
 */
async function verifyCanImpersonate(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const control = createControlClient();
  const { data: adminUser } = await control
    .schema("control")
    .from("admin_users")
    .select("can_impersonate")
    .eq("email", user.email)
    .single<{ can_impersonate: boolean }>();

  return adminUser?.can_impersonate ? user.email : null;
}

export async function POST(req: NextRequest) {
  const adminEmail = await verifyCanImpersonate();
  if (!adminEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId } = (await req.json()) as { tenantId: string };

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("id, name, schema_name, admin_email")
    .eq("id", tenantId)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // The target email is ALWAYS the tenant's own registered admin contact —
  // never client-supplied — so this endpoint can't be used to mint a login
  // link for an arbitrary address (see AUDIT_2026-07-24.md §2.4).
  if (!tenant.admin_email) {
    return NextResponse.json(
      { error: "This tenant has no admin_email on file — set one before impersonating." },
      { status: 400 }
    );
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: linkData, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: tenant.admin_email,
  });

  if (error || !linkData.properties?.action_link) {
    console.error("[impersonate] failed to generate magic link", error);
    return NextResponse.json({ error: "Failed to generate magic link" }, { status: 500 });
  }

  await control
    .schema("control")
    .from("admin_audit_log")
    .insert({
      admin_email: adminEmail,
      action: "impersonate",
      tenant_id: tenant.id,
      metadata: { tenant_name: tenant.name, target_email: tenant.admin_email },
    });

  const response = NextResponse.json({
    ok: true,
    magicLink: linkData.properties.action_link,
    tenantName: tenant.name,
  });

  response.cookies.set("kaufnest_impersonating", String(tenant.name), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
