import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { upsertConnection } from "@/lib/integrations/tokenStore";
import { normalizedOrderToSaleRow } from "@/lib/integrations/mapToSale";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { IntegrationPlatform, TenantPlan } from "@/types";
import type { NormalizedOrder } from "@/lib/integrations/types";

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

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

  const body = (await req.json()) as {
    items: { platform: IntegrationPlatform; order: NormalizedOrder }[];
  };

  if (!body.items?.length) {
    return NextResponse.json({ imported: 0 });
  }

  const rows = body.items.map(({ platform, order }) =>
    normalizedOrderToSaleRow(order, platform, userId)
  );

  const { error } = await client
    .from("sales")
    .upsert(rows, { onConflict: "platform,external_order_id" });

  if (error) {
    return NextResponse.json(
      { error: "Import failed", detail: error.message },
      { status: 500 }
    );
  }

  // Update last_synced_at for each platform that had items imported
  const platforms = [...new Set(body.items.map((i) => i.platform))];
  await Promise.all(
    platforms.map((platform) =>
      upsertConnection(client, platform, {
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      })
    )
  );

  return NextResponse.json({ imported: rows.length });
}
