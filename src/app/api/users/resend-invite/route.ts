import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export async function POST(request: Request) {
  // 1. Verify the calling user is a super_admin
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
      { error: "Your account is not associated with a tenant yet." },
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

  // 2. Parse body
  const body = (await request.json()) as { email?: string };
  const { email } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // 3. Look up existing profile to confirm membership and get metadata for resend
  const tenantService = createServiceClientForTenant(tenantSchema);
  const { data: existingProfile } = await tenantService
    .from("profiles")
    .select("id, email, full_name, role")
    .ilike("email", email)
    .maybeSingle<Pick<Profile, "id" | "email" | "full_name" | "role">>();

  if (!existingProfile) {
    return NextResponse.json(
      { error: "No user with this email found in this team." },
      { status: 404 }
    );
  }

  // 4. Re-send invite via admin client (no profile insert — profile already exists)
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.boughtopia.com";

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
    data: {
      full_name: existingProfile.full_name ?? "",
      tenant_schema: tenantSchema,
      role: existingProfile.role,
    },
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  // 5. Write audit log
  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "resend_invite",
    entity_type: "user",
    entity_id: existingProfile.id,
    metadata: { target_email: email },
  });

  return NextResponse.json({ ok: true });
}
