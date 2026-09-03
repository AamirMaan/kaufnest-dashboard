import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { hasPermission } from "@/lib/utils/permissions";
import { hasAiFeatures, getAiGenerationLimit } from "@/lib/utils/planGating";
import { readTenantUsage, sumCalls } from "@/lib/ai/quota";
import { aiErrorMessage } from "@/lib/ai/errors";
import type { Profile, TenantPlan } from "@/types";

export interface AiAuthContext {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  tenantSchema: string;
  tenantId: string;
  used: number;
  limit: number;
}

export type AiAuthResult =
  | { context: AiAuthContext; error?: undefined }
  | { context?: undefined; error: NextResponse };

/**
 * Guard for `/api/listings/ai/*`. Checks, in order: signed in, has a tenant,
 * holds `manage_listings`, the plan includes AI, the platform admin has not
 * hidden AI for this tenant, and the tenant has quota left.
 *
 * The UI hides AI controls when the plan or tenant flag says so, but hidden
 * chrome is presentation — this is the enforcement.
 */
export async function requireAiAccess(): Promise<AiAuthResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();

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

  if (!profile?.role || !hasPermission(profile.role, "manage_listings", profile.permission_overrides)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  // The control-plane tenant lookup and the usage read both hit Supabase and
  // can throw (readTenantUsage throws a descriptive Error on a query failure;
  // createControlClient() throws synchronously if its env vars are missing).
  // Catch here so a DB hiccup surfaces as a clean 500 instead of an unhandled
  // exception / framework default error page.
  let row: { id: string; plan: TenantPlan; ai_enabled: boolean } | null;
  let used: number;
  let limit: number;
  try {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("id, plan, ai_enabled")
      .eq("schema_name", tenantSchema)
      .single();

    row = tenant as { id: string; plan: TenantPlan; ai_enabled: boolean } | null;
    if (!row) {
      return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
    }

    if (!hasAiFeatures(row.plan) || !row.ai_enabled) {
      return {
        error: NextResponse.json({ error: "AI features are not available on this account." }, { status: 403 }),
      };
    }

    limit = getAiGenerationLimit(row.plan);
    used = sumCalls(await readTenantUsage(row.id));
  } catch (err) {
    // The real cause — a Postgres error, readTenantUsage's own message, or a
    // missing-env-var throw from createControlClient() — stays server-side.
    // Every tenant user with `manage_listings` reaches this guard, so the
    // response body gets the same user-safe copy `usage/route.ts` returns.
    console.error("requireAiAccess failed", err);
    return {
      error: NextResponse.json({ error: aiErrorMessage(err) }, { status: 500 }),
    };
  }

  /* Known, accepted, bounded race: this is a read-then-decide check, so a
   * burst of concurrent requests can all read the same `used` and all pass
   * the gate before any of their increments land — the tenant can overshoot
   * `limit` by roughly the number of requests in flight. Closing it properly
   * needs a distributed lock or a reserve-then-commit scheme, which is more
   * machinery than a soft monthly quota warrants. What matters is that the
   * recorded count stays truthful: `recordUsage` increments atomically via
   * `control.record_ai_usage()` (control-plane migration 008), so an
   * over-limit burst is still counted in full and the next request is
   * correctly refused. Do not "fix" this by making the increment
   * non-atomic again. */
  if (used >= limit) {
    return {
      error: NextResponse.json(
        { error: `Your team has used all ${limit} AI generations for this month.`, used, limit },
        { status: 429 }
      ),
    };
  }

  return {
    context: { client, userId: user.id, tenantSchema, tenantId: row.id, used, limit },
  };
}
