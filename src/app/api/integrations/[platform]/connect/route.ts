import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { listConnections } from "@/lib/integrations/tokenStore";
import { getTenantPlan } from "@/lib/integrations/tenantPlan";
import { canAddAccount, hasPlatformIntegrations } from "@/lib/utils/planGating";
import { connectedCount } from "@/lib/utils/activeAccounts";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  const plan = await getTenantPlan(tenantSchema);
  if (!hasPlatformIntegrations(plan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
  }

  // A reconnect of an existing account (?reconnect=1) skips the cap check; the
  // callback re-checks via decideConnectionSave, which allows updating it.
  const isReconnect = req.nextUrl.searchParams.get("reconnect") === "1";
  if (!isReconnect) {
    const connections = await listConnections(client, platform);
    if (!canAddAccount(plan, connectedCount(connections, platform))) {
      return NextResponse.json({ error: "INTEGRATION_ACCOUNT_LIMIT" }, { status: 403 });
    }
  }

  const adapter = getAdapter(platform);
  const state = randomUUID();

  const response = NextResponse.redirect(adapter.getAuthUrl(state));
  response.cookies.set("kn_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
