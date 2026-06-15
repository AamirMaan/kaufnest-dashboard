import { NextRequest, NextResponse } from "next/server";
import type { ConnectionRow } from "@/lib/integrations/tokenStore";
import { syncPlatformOrders } from "@/lib/integrations/sync";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

interface TenantRow {
  schema_name: string;
  plan: TenantPlan;
}

interface TenantSyncResult {
  schema: string;
  platform: string;
  ok: boolean;
  synced?: number;
  error?: string;
}

/**
 * Scheduled sync for all tenants on a plan with platform integrations
 * (see vercel.json). Uses the service role to bypass RLS — there's no user
 * session here. Each connection is synced independently so one
 * tenant/platform erroring doesn't abort the rest of the run.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const control = createControlClient();
  const { data: tenants, error: tenantsError } = await control
    .schema("control")
    .from("tenants")
    .select("schema_name, plan")
    .eq("status", "active")
    .returns<TenantRow[]>();

  if (tenantsError) {
    return NextResponse.json({ error: tenantsError.message }, { status: 500 });
  }

  const results: TenantSyncResult[] = [];

  for (const tenant of tenants ?? []) {
    if (!hasPlatformIntegrations(tenant.plan)) continue;

    const tenantClient = createServiceClientForTenant(tenant.schema_name);
    const { data: connections, error: connectionsError } = await tenantClient
      .from("platform_connections")
      .select("*")
      .eq("status", "connected")
      .returns<ConnectionRow[]>();

    if (connectionsError) {
      results.push({ schema: tenant.schema_name, platform: "*", ok: false, error: connectionsError.message });
      continue;
    }

    for (const connection of connections ?? []) {
      if (!connection.connected_by) {
        results.push({
          schema: tenant.schema_name,
          platform: connection.platform,
          ok: false,
          error: "No connected_by user recorded for this connection",
        });
        continue;
      }

      const result = await syncPlatformOrders(tenantClient, connection.platform, connection.connected_by);
      results.push({ schema: tenant.schema_name, platform: connection.platform, ...result });
    }
  }

  return NextResponse.json({ ok: true, results });
}
