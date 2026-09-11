import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { hasPermission } from "@/lib/utils/permissions";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { applyMarketingToDraft } from "@/lib/integrations/ebay/marketing";
import type { EbayListingDraft, Profile } from "@/types";

// Re-runs only the post-publish marketing steps (ad + multi-buy) for a live
// listing. Safe to call repeatedly: runMarketingSteps skips any step whose
// eBay id is already stored on the draft.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("*")
    .eq("id", id)
    .single<EbayListingDraft>();
  if (fetchError || !draft) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (draft.status !== "published" || !draft.ebay_listing_id) {
    return NextResponse.json(
      { error: "Only live listings can have advertising or discounts applied." },
      { status: 409 }
    );
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
    console.error("[listings/apply-marketing] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(await applyMarketingToDraft(client, draft, accessToken));
}
