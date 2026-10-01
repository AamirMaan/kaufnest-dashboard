import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AccessLevel, Section } from "./sections";

export interface IntegrationAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
}

export type IntegrationAuthResult =
  | { context: IntegrationAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Route guard for section permissions (055): signed in, belongs to a tenant,
 * and current_user_access(section) >= minLevel. The RPC applies role
 * defaults + per-user exceptions exactly like the RLS policies do, so the
 * route and the database can't disagree. Never returns a raw DB error.
 */
export async function requireSectionAccess(section: Section, minLevel: AccessLevel): Promise<IntegrationAuthResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) return { error: NextResponse.json({ error: "No tenant schema on user" }, { status: 400 }) };

  const { data: level, error } = await client.rpc("current_user_access", { p_section: section });
  if (error) {
    console.error("[requireSectionAccess] current_user_access failed", { section, code: error.code });
    return { error: NextResponse.json({ error: "Could not verify access" }, { status: 500 }) };
  }
  if (typeof level !== "number" || level < minLevel) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { context: { client, userId: user.id, tenantSchema } };
}
