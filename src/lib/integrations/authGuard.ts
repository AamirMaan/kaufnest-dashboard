import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/utils/permissions";
import type { Profile } from "@/types";

export interface IntegrationAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
}

export type IntegrationAuthResult =
  | { context: IntegrationAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Shared guard for `/api/integrations/[platform]/*` routes: confirms the
 * caller is signed in, belongs to a tenant, and holds admin/super_admin
 * (the `manage_integrations` permission) — connections hold OAuth tokens, so
 * accountants get no access at all.
 */
export async function requireIntegrationAdmin(): Promise<IntegrationAuthResult> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role, permission_overrides")
    .eq("id", user.id)
    .single<Pick<Profile, "role" | "permission_overrides">>();

  if (!profile?.role || !hasPermission(profile.role, "manage_integrations", profile.permission_overrides)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { context: { client, userId: user.id, tenantSchema } };
}
