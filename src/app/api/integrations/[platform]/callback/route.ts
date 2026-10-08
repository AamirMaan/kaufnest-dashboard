import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { insertConnection, listConnections, updateConnection } from "@/lib/integrations/tokenStore";
import { decideConnectionSave, defaultDisplayName } from "@/lib/integrations/connectionSave";
import { getTenantPlan } from "@/lib/integrations/tenantPlan";
import { INTEGRATION_ERRORS } from "@/lib/utils/integrationErrors";

function redirectToIntegrations(req: NextRequest, query: Record<string, string>): NextResponse {
  // Use NEXT_PUBLIC_SITE_URL so the redirect always resolves to the public
  // hostname — req.url can be an internal Vercel URL behind a reverse proxy.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const url = new URL("/dashboard/integrations", base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId, tenantSchema } = auth.context;

  // eBay returns the authorization code as the standard `code` param;
  // Amazon SP-API returns it as `spapi_oauth_code`.
  const code =
    req.nextUrl.searchParams.get("code") ?? req.nextUrl.searchParams.get("spapi_oauth_code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("kn_oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToIntegrationsWithError(req, platform, "Invalid or expired OAuth state. Please try connecting again.");
  }

  const adapter = getAdapter(platform);

  try {
    const tokens = await adapter.exchangeCode(code);

    // Amazon's SP-API redirect includes the seller's account id in the query
    // string; eBay's comes from the Identity API inside exchangeCode.
    const externalAccountId =
      tokens.externalAccountId ?? req.nextUrl.searchParams.get("selling_partner_id") ?? null;
    if (!externalAccountId) {
      return redirectToIntegrationsWithError(req, platform, INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_UNIDENTIFIED);
    }

    const plan = await getTenantPlan(tenantSchema);
    const rows = await listConnections(client, platform);
    const decision = decideConnectionSave(rows, platform, externalAccountId, plan);
    if (decision.kind === "limit") {
      return redirectToIntegrationsWithError(req, platform, INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT);
    }

    const fields = {
      status: "connected" as const,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokens.expires_at,
      external_account_id: externalAccountId,
      external_username: tokens.externalUsername ?? null,
      marketplace_id: tokens.marketplaceId ?? null,
      last_sync_status: null,
      last_sync_error: null,
      connected_by: userId,
    };
    const name = defaultDisplayName(platform, externalAccountId, tokens.externalUsername);

    let connectionId: string;
    if (decision.kind === "insert") {
      connectionId = await insertConnection(client, platform, { ...fields, display_name: name, is_active: true });
    } else {
      connectionId = decision.id;
      const existing = rows.find((r) => r.id === decision.id);
      await updateConnection(client, connectionId, {
        ...fields,
        // Never overwrite an admin's rename; fill it for adopted legacy rows.
        ...(existing?.display_name ? {} : { display_name: name }),
      });
    }

    const success = redirectToIntegrations(req, { connected: platform, account: connectionId });
    success.cookies.delete("kn_oauth_state");
    return success;
  } catch (err) {
    console.error("[integrations/callback] connect failed:", err instanceof Error ? err.message : err);
    return redirectToIntegrationsWithError(req, platform, "Connecting the account failed. Please try again.");
  }
}

function redirectToIntegrationsWithError(req: NextRequest, platform: string, message: string): NextResponse {
  const response = redirectToIntegrations(req, { error: message, platform });
  response.cookies.delete("kn_oauth_state");
  return response;
}
