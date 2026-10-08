import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { isIntegrationPlatform } from "@/lib/integrations/registry";
import { getConnectionById, updateConnection } from "@/lib/integrations/tokenStore";

export async function POST(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const body = (await req.json().catch(() => null)) as { connectionId?: unknown } | null;
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : null;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const conn = await getConnectionById(client, connectionId);
  if (!conn || conn.platform !== platform) {
    return NextResponse.json({ error: "INTEGRATION_ACCOUNT_UNKNOWN" }, { status: 404 });
  }

  // The row is kept (not deleted) so its orders keep their account link and
  // reconnecting the same account reuses it.
  await updateConnection(client, connectionId, {
    status: "disconnected",
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
  });

  return NextResponse.json({ ok: true });
}
