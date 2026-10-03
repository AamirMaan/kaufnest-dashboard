import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types";
import { canManageBilling } from "./billingAccess";

export interface BillingAuthContext {
  userEmail: string;
  tenantSchema: string;
}

export type BillingAuthResult =
  | { context: BillingAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Shared guard for /api/billing/* routes: confirms the caller is signed in,
 * belongs to a tenant, holds admin/super_admin AND Settings: Edit
 * (`current_user_access('settings') >= 2`, 055) — subscribing, changing
 * plan, and cancelling are not actions a lower-privilege role (e.g.
 * accountant), or an admin whose Settings access was lowered, should be
 * able to trigger. Same rule as /api/billing/status's `canManageBilling`
 * (`canManageBilling()` in ./billingAccess). Never returns a raw DB error.
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

  const { data: settingsLevel, error: accessError } = await client.rpc("current_user_access", {
    p_section: "settings",
  });
  if (accessError) {
    console.error("[requireBillingAdmin] current_user_access failed", { code: accessError.code });
    return { error: NextResponse.json({ error: "Could not verify access" }, { status: 500 }) };
  }

  if (!canManageBilling(profile?.role, settingsLevel as number | null)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (!user.email) {
    return { error: NextResponse.json({ error: "No email on user" }, { status: 400 }) };
  }

  return { context: { userEmail: user.email, tenantSchema } };
}
