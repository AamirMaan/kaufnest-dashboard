import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient, verifyPlatformAdmin } from "@/lib/supabase/control";
import { currentPeriod, sumCalls, callsByUser, type UsageRow } from "@/lib/ai/quota";
import { getAiGenerationLimit } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Current-period AI usage for every tenant, for the platform admin panel. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const forbidden = await verifyPlatformAdmin(user?.email);
  if (forbidden) return forbidden;

  const control = createControlClient();
  const period = currentPeriod();

  try {
    const { data: tenants, error: tenantsError } = await control
      .schema("control")
      .from("tenants")
      .select("id, plan");

    if (tenantsError) {
      throw new Error(`Failed to read tenants: ${tenantsError.message}`);
    }

    const { data: rows, error: usageError } = await control
      .schema("control")
      .from("tenant_ai_usage")
      .select("tenant_id, user_id, kind, calls")
      .eq("period", period);

    if (usageError) {
      throw new Error(`Failed to read AI usage: ${usageError.message}`);
    }

    const allRows = (rows as (UsageRow & { tenant_id: string })[] | null) ?? [];

    const usage = ((tenants as { id: string; plan: TenantPlan }[] | null) ?? []).map(
      (tenant) => {
        const mine = allRows.filter((row) => row.tenant_id === tenant.id);
        return {
          tenantId: tenant.id,
          used: sumCalls(mine),
          limit: getAiGenerationLimit(tenant.plan),
          byUser: callsByUser(mine),
        };
      }
    );

    return NextResponse.json({ period, usage });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load AI usage", detail: errorMessage(err) },
      { status: 500 }
    );
  }
}
