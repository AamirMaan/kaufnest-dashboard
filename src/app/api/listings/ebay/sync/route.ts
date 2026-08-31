import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchActiveListings } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { Profile } from "@/types";

export async function POST() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const { data: profile } = await client
    .from("profiles")
    .select("role, permission_overrides")
    .eq("id", userId)
    .single<Pick<Profile, "role" | "permission_overrides">>();
  if (!profile?.role || !hasPermission(profile.role, "manage_listings", profile.permission_overrides)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    console.error("[listings/ebay/sync] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const listings = await fetchActiveListings(accessToken);

    // Never let this sync overwrite a listing the app itself published —
    // GetMyeBaySelling's summary carries none of its aspects/policies/
    // merchant_location_key, so upserting over it would blank them out.
    const { data: appOwned, error: appOwnedError } = await client
      .from("ebay_listing_drafts")
      .select("ebay_listing_id")
      .eq("origin", "app")
      .not("ebay_listing_id", "is", null);
    if (appOwnedError) throw appOwnedError;
    const appOwnedIds = new Set((appOwned ?? []).map((r) => r.ebay_listing_id));

    const importable = listings.filter((l) => !appOwnedIds.has(l.ebayListingId));

    let imported = 0;
    if (importable.length > 0) {
      const rows = importable.map((l) => ({
        ebay_listing_id: l.ebayListingId,
        title: l.title,
        image_urls: l.imageUrl ? [l.imageUrl] : [],
        price: l.currentPrice,
        currency: l.currency,
        ebay_sku: l.sku,
        origin: "ebay_import" as const,
        status: "published" as const,
        // source_type/quantity/condition don't meaningfully apply to an
        // imported listing (GetMyeBaySelling's summary doesn't carry
        // quantity/condition at all) — these are corrected the first time
        // someone opens the listing's Edit page, which does a full GetItem
        // fetch. The Listings table never shows source_type for an
        // origin="ebay_import" row, so this default is never misleadingly
        // displayed as "Inventory".
        source_type: "inventory" as const,
        quantity: 1,
        condition: "used" as const,
        created_by: userId,
      }));

      const { error: upsertError } = await client
        .from("ebay_listing_drafts")
        .upsert(rows, { onConflict: "ebay_listing_id" });
      if (upsertError) throw upsertError;
      imported = importable.length;
    }

    // Reconcile: a previously-imported listing that's no longer in eBay's
    // active list (sold out, expired, ended in Seller Hub, or ended via
    // this app's own Delete action if its local-row cleanup ever failed)
    // gets pruned here. Scoped strictly to origin="ebay_import" — never
    // touches an app-created draft, which can legitimately be draft/failed
    // with no active eBay listing yet.
    const { data: existingImported, error: existingError } = await client
      .from("ebay_listing_drafts")
      .select("ebay_listing_id")
      .eq("origin", "ebay_import");
    if (existingError) throw existingError;

    const fetchedIds = new Set(listings.map((l) => l.ebayListingId));
    const staleIds = (existingImported ?? [])
      .map((r) => r.ebay_listing_id)
      .filter((id): id is string => id !== null && !fetchedIds.has(id));

    let removed = 0;
    if (staleIds.length > 0) {
      const { error: deleteError } = await client
        .from("ebay_listing_drafts")
        .delete()
        .eq("origin", "ebay_import")
        .in("ebay_listing_id", staleIds);
      if (deleteError) throw deleteError;
      removed = staleIds.length;
    }

    return NextResponse.json({ imported, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[listings/ebay/sync] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
