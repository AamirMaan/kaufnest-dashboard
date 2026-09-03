import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { readTenantUsage, sumCalls, callsByUser } from "@/lib/ai/quota";
import { getAiGenerationLimit } from "@/lib/utils/planGating";
import { aiErrorMessage } from "@/lib/ai/errors";
import type { Profile, TenantPlan } from "@/types";

/**
 * Read-only current-period AI usage for the caller's tenant. Deliberately
 * does NOT use requireAiAccess — that guard 429s once quota is exhausted,
 * which is exactly when the UI most needs to read usage.
 */
export async function GET() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<Pick<Profile, "role">>();

  try {
    const control = createControlClient();
    const { data: tenant, error: tenantError } = await control
      .schema("control")
      .from("tenants")
      .select("id, plan")
      .eq("schema_name", tenantSchema)
      .single<{ id: string; plan: TenantPlan }>();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const limit = getAiGenerationLimit(tenant.plan);
    const rows = await readTenantUsage(tenant.id);
    const tenantUsed = sumCalls(rows);
    const byUser = callsByUser(rows);
    const mine = { calls: byUser[user.id] ?? 0 };

    const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

    if (!isAdmin) {
      return NextResponse.json({ limit, tenantUsed, mine });
    }

    const ids = Object.keys(byUser);
    let names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await client
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      names = new Map(
        ((profiles as Pick<Profile, "id" | "full_name">[] | null) ?? []).map((p) => [
          p.id,
          p.full_name,
        ])
      );
    }

    const perUser = ids.map((id) => ({
      userId: id,
      name: names.get(id) ?? "Unknown user",
      calls: byUser[id],
    }));

    return NextResponse.json({ limit, tenantUsed, mine, perUser });
  } catch (err) {
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 500 });
  }
}
