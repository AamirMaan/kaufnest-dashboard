import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, getConnection } from "@/lib/integrations/tokenStore";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { IntegrationPlatform, TenantPlan } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export type ReviewOrder = NormalizedOrder & { imported: boolean };
export type ReviewResponse = Partial<Record<IntegrationPlatform, { orders: ReviewOrder[] }>> & {
  errors?: Record<string, string>;
};

const REVIEW_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];

export async function GET(_req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();
  if (!hasPlatformIntegrations((tenant?.plan ?? "trial") as TenantPlan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  // Load connections for all platforms to find which are active
  const connections = await Promise.all(
    PLATFORMS.map(async (p) => ({ platform: p, conn: await getConnection(client, p) }))
  );
  const active = connections.filter((c) => c.conn?.status === "connected");

  if (active.length === 0) return NextResponse.json({});

  // Fetch existing external_order_ids from sales for dedup
  const activePlatforms = active.map((c) => c.platform);
  const { data: existingSales } = await client
    .from("sales")
    .select("platform, external_order_id")
    .in("platform", activePlatforms)
    .not("external_order_id", "is", null);

  const importedSet = new Set(
    (existingSales ?? []).map(
      (s: { platform: string; external_order_id: string }) =>
        `${s.platform}:${s.external_order_id}`
    )
  );

  const result: ReviewResponse = {};
  const errors: Record<string, string> = {};

  // Fetch orders from each active platform in parallel
  await Promise.all(
    active.map(async ({ platform, conn }) => {
      try {
        const adapter = getAdapter(platform);
        const token = await ensureValidAccessToken(client, conn!, adapter);
        const orders = await adapter.fetchOrders(token, since, conn!.marketplace_id);
        result[platform] = {
          orders: orders.map((o) => ({
            ...o,
            imported: importedSet.has(`${platform}:${o.external_order_id}`),
          })),
        };
      } catch (err) {
        errors[platform] = err instanceof Error ? err.message : String(err);
      }
    })
  );

  if (Object.keys(errors).length > 0) result.errors = errors;
  return NextResponse.json(result);
}
