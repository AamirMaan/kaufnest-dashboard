import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { hasPermission } from "@/lib/utils/permissions";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { publishListing } from "@/lib/integrations/ebay/publish";
import { generateListingSku } from "@/lib/integrations/ebay/generateSku";
import type { EbayListingDraft, Profile } from "@/types";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<Pick<Profile, "role">>();
  if (!profile?.role || !hasPermission(profile.role, "manage_listings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const { data: draft, error: fetchError } = await client
    .from("ebay_listing_drafts")
    .select("*")
    .eq("id", id)
    .single<EbayListingDraft>();

  if (fetchError || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  // Step 1: assign a SKU on first publish attempt, persist before calling eBay.
  let sku = draft.ebay_sku;
  if (!sku) {
    sku = generateListingSku();
    await client.from("ebay_listing_drafts").update({ ebay_sku: sku }).eq("id", id);
  }

  await client.from("ebay_listing_drafts").update({ status: "publishing" }).eq("id", id);

  try {
    const result = await publishListing(
      accessToken,
      draft,
      sku,
      draft.ebay_offer_id,
      async (offerId) => {
        await client.from("ebay_listing_drafts").update({ ebay_offer_id: offerId }).eq("id", id);
      }
    );

    const { data: updated, error: updateError } = await client
      .from("ebay_listing_drafts")
      .update({
        status: "published",
        ebay_sku: sku,
        ebay_offer_id: result.offerId,
        ebay_listing_id: result.listingId,
        publish_error: null,
      })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";

    // Best-effort: persist whatever offerId was captured before the failure
    // (publishListing throws after createOffer but before publishOffer, for
    // example) so a retry resumes with updateOffer instead of createOffer.
    const { data: failed } = await client
      .from("ebay_listing_drafts")
      .update({ status: "failed", ebay_sku: sku, publish_error: message })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    return NextResponse.json(
      { error: message, draft: failed ?? null },
      { status: 502 }
    );
  }
}
