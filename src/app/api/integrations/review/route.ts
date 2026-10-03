import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, getConnection } from "@/lib/integrations/tokenStore";
import { createControlClient } from "@/lib/supabase/control";
import { getEntitlements } from "@/lib/plans/catalog";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";
import type { IntegrationPlatform } from "@/types";
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
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .maybeSingle<{ plan: string }>();
  if (tenantError) {
    console.error("[integrations/review] tenant lookup failed", tenantError.message);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  let ent: PlanEntitlements;
  try {
    ent = await getEntitlements(tenant?.plan ?? null);
  } catch (err) {
    console.error("[integrations/review] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const since = new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString();

  // Load connections for all platforms to find which are active
  let active: { platform: IntegrationPlatform; conn: Awaited<ReturnType<typeof getConnection>> }[];
  let importedSet: Set<string>;
  try {
    const connections = await Promise.all(
      PLATFORMS.map(async (p) => ({ platform: p, conn: await getConnection(client, p) }))
    );
    active = connections.filter((c) => c.conn?.status === "connected");

    if (active.length === 0) return NextResponse.json({});

    // Fetch existing external_order_ids from sales for dedup
    const activePlatforms = active.map((c) => c.platform);
    const { data: existingSales } = await client
      .from("sales")
      .select("platform, external_order_id")
      .in("platform", activePlatforms)
      .not("external_order_id", "is", null);

    importedSet = new Set(
      (existingSales ?? []).map(
        (s: { platform: string; external_order_id: string }) =>
          `${s.platform}:${s.external_order_id}`
      )
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to load connections", detail }, { status: 500 });
  }

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
