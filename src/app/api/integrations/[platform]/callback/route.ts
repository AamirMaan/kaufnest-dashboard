import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { upsertConnection } from "@/lib/integrations/tokenStore";

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
  const { client, userId } = auth.context;

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

    // Amazon's SP-API redirect includes the seller's account id directly in
    // the query string — eBay requires no equivalent extra call for this flow.
    const externalAccountId =
      tokens.externalAccountId ?? req.nextUrl.searchParams.get("selling_partner_id") ?? null;

    await upsertConnection(client, platform, {
      status: "connected",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokens.expires_at,
      external_account_id: externalAccountId,
      marketplace_id: tokens.marketplaceId ?? null,
      last_sync_status: null,
      last_sync_error: null,
      connected_by: userId,
    });

    const success = redirectToIntegrations(req, { connected: platform });
    success.cookies.delete("kn_oauth_state");
    return success;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return redirectToIntegrationsWithError(req, platform, message);
  }
}

function redirectToIntegrationsWithError(req: NextRequest, platform: string, message: string): NextResponse {
  const response = redirectToIntegrations(req, { error: message, platform });
  response.cookies.delete("kn_oauth_state");
  return response;
}
