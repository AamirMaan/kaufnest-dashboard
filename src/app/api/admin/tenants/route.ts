import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";

// Shared helper: verify caller is a KaufNest platform admin via session
export async function verifyPlatformAdmin(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }) };
  }

  const control = createControlClient();
  const { data: adminUser } = await control
    .schema("control")
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .single();

  if (!adminUser) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true };
}

export async function GET() {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const control = createControlClient();
  const { data: tenants, error } = await control
    .schema("control")
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch tenants" }, { status: 500 });
  }

  return NextResponse.json({ tenants });
}
