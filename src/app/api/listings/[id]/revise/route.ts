import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import {
  fetchListingDetail,
  reviseListing,
  buildAspectsForRevise,
  type ReviseListingInput,
} from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { EbayListingDraft, Profile } from "@/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let body: ReviseListingInput;
  try {
    body = (await req.json()) as ReviseListingInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
    console.error("[listings/revise] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    // Diff against a FRESH fetch, never the client-submitted "original" —
    // buildAspectsForRevise's decision is consequential enough that it
    // must not trust anything the client claims about prior state.
    const current = await fetchListingDetail(accessToken, draft.ebay_listing_id);
    const aspectsForRevise = buildAspectsForRevise(current.aspects, body.aspects ?? {});

    await reviseListing(accessToken, draft.ebay_listing_id, {
      title: body.title,
      description: body.description,
      price: body.price,
      quantity: body.quantity,
      condition: body.condition,
      imageUrls: body.imageUrls,
      aspects: aspectsForRevise,
    });

    const { data: updated, error: updateError } = await client
      .from("ebay_listing_drafts")
      .update({
        title: body.title,
        description: body.description,
        price: body.price,
        quantity: body.quantity,
        condition: body.condition,
        image_urls: body.imageUrls,
        aspects: body.aspects ?? {},
      })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();
    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revise listing";
    console.error("[listings/revise] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
