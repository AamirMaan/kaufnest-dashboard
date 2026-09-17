import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface FxAuthContext {
  tenantSchema: string;
}

export type FxAuthResult =
  | { context: FxAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Guard for /api/fx/rates: confirms the caller is an authenticated tenant
 * member. No role check — FX rates aren't sensitive, and the actual
 * import-write action stays gated by each feature's own existing role
 * checks.
 */
export async function requireFxAccess(): Promise<FxAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return { error: NextResponse.json({ error: "No tenant schema" }, { status: 400 }) };
  }
  return { context: { tenantSchema } };
}
