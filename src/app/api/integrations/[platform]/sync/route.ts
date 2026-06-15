import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { isIntegrationPlatform } from "@/lib/integrations/registry";
import { syncPlatformOrders } from "@/lib/integrations/sync";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const result = await syncPlatformOrders(client, platform, userId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
