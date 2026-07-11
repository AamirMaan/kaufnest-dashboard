import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { verifyPlatformAdmin } from "@/lib/supabase/control";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchActiveListings } from "@/lib/integrations/ebay/listings";

export async function POST() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const { data: { user } } = await client.auth.getUser();
  const forbidden = await verifyPlatformAdmin(user?.email);
  if (forbidden) return forbidden;

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  let listings;
  try {
    listings = await fetchActiveListings(accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch listings from eBay" },
      { status: 502 }
    );
  }

  if (listings.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  // Map to DB shape — source_url and source_platform are excluded so the
  // upsert ON CONFLICT clause preserves existing supplier links.
  const rows = listings.map((l) => ({
    ebay_listing_id: l.ebayListingId,
    title: l.title,
    image_url: l.imageUrl,
    ebay_url: l.ebayUrl,
    current_price: l.currentPrice,
    currency: l.currency,
    sku: l.sku,
    last_synced_at: new Date().toISOString(),
  }));

  const { error } = await client.from("dropship_listings").upsert(rows, {
    onConflict: "ebay_listing_id",
    ignoreDuplicates: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ synced: rows.length });
}
