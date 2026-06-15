import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { isIntegrationPlatform } from "@/lib/integrations/registry";
import { upsertConnection } from "@/lib/integrations/tokenStore";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  await upsertConnection(client, platform, {
    status: "disconnected",
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
  });

  return NextResponse.json({ ok: true });
}
