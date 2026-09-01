import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchListingDetail } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { EbayListingDraft, Profile } from "@/types";

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — the naive `err instanceof Error ? err.message :
// "generic fallback"` pattern silently swallows the real message on those.
// Confirmed live 2026-09-01 in the sibling sync route; same fix applied
// everywhere in this feature's routes for consistency.
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;

  const { data: draft, error: fetchError } = await client
    .from("ebay_listing_drafts")
    .select("ebay_listing_id")
    .eq("id", id)
    .single<Pick<EbayListingDraft, "ebay_listing_id">>();
  if (fetchError || !draft?.ebay_listing_id) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
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
    console.error("[listings/ebay-detail] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const detail = await fetchListingDetail(accessToken, draft.ebay_listing_id);
    return NextResponse.json(detail);
  } catch (err) {
    const message = errorMessage(err);
    console.error("[listings/ebay-detail] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
