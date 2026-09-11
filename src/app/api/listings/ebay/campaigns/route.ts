import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchManualCampaigns } from "@/lib/integrations/ebay/marketing";

export async function GET() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[listings/ebay/campaigns] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    // A missing sell.marketing scope comes back as needsReconnect: true with
    // a 200 — it's an expected state the form renders, not an error.
    return NextResponse.json(await fetchManualCampaigns(accessToken));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch campaigns";
    console.error("[listings/ebay/campaigns] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
