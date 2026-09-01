import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchActiveListings } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { Profile } from "@/types";

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — `err instanceof Error ? err.message : "generic
// fallback"` silently swallows the real message on those, replacing it with
// the fallback string. Confirmed live 2026-09-01: a genuine Supabase error
// in this route (missing migration 038's `origin` column/index) surfaced
// only as the generic "Sync failed", with the real cause invisible until
// this helper was added. Same fix already applied once in
// `api/billing/checkout/route.ts` for the identical gotcha.
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// PostgREST caps unbounded .select() reads at its configured db.max_rows
// (typically 1000) — past that many rows a plain .select() silently
// truncates instead of erroring. Both origin-scoped reads below page
// through .range() until a page comes back short, same pattern
// fetchActiveListings (lib/integrations/ebay/listings.ts) already uses for
// GetMyeBaySelling's pagination.
const PAGE_SIZE = 1000;

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
    const message = errorMessage(err);
    console.error("[listings/ebay/sync] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const listings = await fetchActiveListings(accessToken);

    // Never let this sync overwrite a listing the app itself published —
    // GetMyeBaySelling's summary carries none of its aspects/policies/
    // merchant_location_key, so upserting over it would blank them out.
    // Paginated (PAGE_SIZE at a time) since a plain .select() silently
    // truncates past PostgREST's row cap — see the PAGE_SIZE comment above.
    const appOwnedIds = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: appOwnedError } = await client
        .from("ebay_listing_drafts")
        .select("ebay_listing_id")
        .eq("origin", "app")
        .not("ebay_listing_id", "is", null)
        .range(from, from + PAGE_SIZE - 1);
      if (appOwnedError) throw appOwnedError;
      for (const row of page ?? []) {
        if (row.ebay_listing_id) appOwnedIds.add(row.ebay_listing_id);
      }
      if (!page || page.length < PAGE_SIZE) break;
    }

    const fetchedIds = new Set(listings.map((l) => l.ebayListingId));
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

    // Reconcile imported listings: a previously-imported listing that's no
    // longer in eBay's active list (sold out, expired, ended in Seller Hub,
    // or ended via this app's own Delete action if its local-row cleanup
    // ever failed) gets pruned here. Scoped strictly to origin="ebay_import"
    // — never touches an app-created draft, which can legitimately be
    // draft/failed with no active eBay listing yet.
    const existingImportedIds: (string | null)[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: existingError } = await client
        .from("ebay_listing_drafts")
        .select("ebay_listing_id")
        .eq("origin", "ebay_import")
        .range(from, from + PAGE_SIZE - 1);
      if (existingError) throw existingError;
      for (const row of page ?? []) existingImportedIds.push(row.ebay_listing_id);
      if (!page || page.length < PAGE_SIZE) break;
    }

    const staleIds = existingImportedIds.filter(
      (id): id is string => id !== null && !fetchedIds.has(id)
    );

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

    // Reconcile app-published listings too: this app's own listing can be
    // ended outside it (Seller Hub, expired, or ended once already via a
    // duplicate Delete click) — confirmed live 2026-09-01, a tenant's own
    // published listing stayed status="published" forever with nothing to
    // ever correct it, since the upsert exclusion above deliberately never
    // writes to origin="app" rows at all. This is a DIFFERENT operation
    // from that exclusion: that guard is about never blindly overwriting
    // an app row's rich data (aspects/policies/merchant_location_key) from
    // a bare GetMyeBaySelling summary; this is a narrow delete once a
    // listing is confirmed gone from eBay, using the appOwnedIds set
    // already fetched above — no second query needed. Once ended there's
    // nothing left to publish against, so deleting (not just flagging) it
    // matches the exact reconciliation this feature already does for
    // imported listings.
    const staleAppIds = [...appOwnedIds].filter((id) => !fetchedIds.has(id));
    if (staleAppIds.length > 0) {
      const { error: deleteAppError } = await client
        .from("ebay_listing_drafts")
        .delete()
        .eq("origin", "app")
        .in("ebay_listing_id", staleAppIds);
      if (deleteAppError) throw deleteAppError;
      removed += staleAppIds.length;
    }

    return NextResponse.json({ imported, removed });
  } catch (err) {
    const message = errorMessage(err);
    console.error("[listings/ebay/sync] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
