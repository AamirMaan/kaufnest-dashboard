import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types";

export interface BillingAuthContext {
  userEmail: string;
  tenantSchema: string;
}

export type BillingAuthResult =
  | { context: BillingAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Shared guard for /api/billing/* routes: confirms the caller is signed in,
 * belongs to a tenant, and holds admin/super_admin — subscribing, changing
 * plan, and cancelling are not actions a lower-privilege role (e.g.
 * accountant) should be able to trigger.
 */
export async function requireBillingAdmin(): Promise<BillingAuthResult> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }) };
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (!user.email) {
    return { error: NextResponse.json({ error: "No email on user" }, { status: 400 }) };
  }

  return { context: { userEmail: user.email, tenantSchema } };
}
