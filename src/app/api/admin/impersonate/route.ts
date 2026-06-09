import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createClient } from "@/lib/supabase/server";
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

  const { tenantId, adminEmail } = (await req.json()) as {
    tenantId: string;
    adminEmail: string;
  };

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("id, name, schema_name")
    .eq("id", tenantId)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { data: linkData, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: adminEmail,
  });

  if (error || !linkData.properties?.action_link) {
    return NextResponse.json(
      { error: "Failed to generate magic link", detail: String(error) },
      { status: 500 }
    );
  }

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
