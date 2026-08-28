import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client for the control plane (Project A — kaufnest-control).
 * Never import this in Client Components or expose to the browser.
 * All tables are in the `control` schema — use .schema('control').from('table').
 */
export function createControlClient() {
  return createClient(
    process.env.CONTROL_SUPABASE_URL!,
    process.env.CONTROL_SUPABASE_SERVICE_KEY!
  );
}

/**
 * True if `email` is a Boughtopia platform admin (control.admin_users).
 * Shared by /admin's auth guard, the api/admin/* route checks, and the
 * dashboard sidebar's "Admin Panel" link gating.
 */
export async function isPlatformAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;

  const control = createControlClient();
  const { data: adminUser } = await control
    .schema("control")
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .single();

  return !!adminUser;
}

/**
 * Returns a 403 NextResponse if the caller is not a platform admin, or null
 * if the check passes. Use in API route handlers after resolving the user.
 */
export async function verifyPlatformAdmin(
  email: string | null | undefined
): Promise<NextResponse | null> {
  const ok = await isPlatformAdmin(email);
  return ok ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
