import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import type { UserRole, Profile } from "@/types";

export async function POST(request: Request) {
  // 1. Verify the calling user is authenticated and is a super_admin
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json(
      { error: "Your account is not associated with a tenant yet. Log out and back in, then retry." },
      { status: 400 }
    );
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<Pick<Profile, "role">>();

  if (callerProfile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse and validate request body
  const body = await request.json() as { email?: string; full_name?: string; role?: UserRole };
  const { email, full_name = "", role = "accountant" } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const validRoles: UserRole[] = ["super_admin", "admin", "accountant"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // 3. Use the Supabase Admin client (service role) to invite the user
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { error: "Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set" },
      { status: 500 }
    );
  }

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dashboard.kaufnest.com";

  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/set-password`,
      data: { full_name, tenant_schema: tenantSchema, role },
    });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  // 4. Create the profile row directly in the caller's tenant schema and
  // stamp app_metadata.tenant_schema — handle_new_user no longer does this,
  // see supabase/migrations/006_remove_handle_new_user_trigger.sql
  const tenantService = createServiceClientForTenant(tenantSchema);

  if (inviteData.user) {
    await tenantService.from("profiles").insert({
      id: inviteData.user.id,
      email,
      full_name,
      role,
    });

    await adminClient.rpc("set_user_tenant", {
      user_id: inviteData.user.id,
      schema_name: tenantSchema,
    });
  }

  // 5. Write audit log
  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "create",
    entity_type: "user",
    entity_id: inviteData.user?.id ?? null,
    metadata: { invited_email: email, assigned_role: role },
  });

  // 6. Return the freshly created profile
  const { data: newProfile } = await tenantService
    .from("profiles")
    .select("*")
    .eq("id", inviteData.user!.id)
    .single<Profile>();

  return NextResponse.json({ profile: newProfile });
}
