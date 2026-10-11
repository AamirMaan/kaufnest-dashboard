import { NextResponse } from "next/server";
import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchMemberMessages } from "@/lib/integrations/ebay/messages";
import type { EbayMessage } from "@/types";
import { requireMessagingAndListings } from "@/lib/plans/requirePlanFeature";

// Default lookback when no message has ever been synced (mirrors
// REVIEW_LOOKBACK_MS in api/integrations/review/route.ts).
const DEFAULT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function POST() {
  const auth = await requireSectionAccess("messages", 2);
  if (auth.error) return auth.error;
  const planError = await requireMessagingAndListings(auth.context.tenantSchema);
  if (planError) return planError;
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
    console.error("[messages/ebay/sync] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: latest } = await client
    .from("ebay_messages")
    .select("ebay_created_at")
    .order("ebay_created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<EbayMessage, "ebay_created_at">>();

  const since = latest?.ebay_created_at ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();

  // 502 is reserved for the eBay call itself failing (a genuinely bad
  // upstream response); a failure in our own Supabase write is a 500. Folding
  // both into one catch previously meant a DB error was reported to the user
  // as an eBay failure — and either way, nothing was ever logged server-side,
  // which is what made the original 502 here take hours to diagnose.
  let messages;
  try {
    messages = await fetchMemberMessages(accessToken, since);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[messages/ebay/sync] eBay fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  const { error: upsertError } = await client
    .from("ebay_messages")
    .upsert(
      messages.map((m) => ({
        external_message_id: m.externalMessageId,
        item_id: m.itemId,
        buyer_username: m.buyerUsername,
        direction: m.direction,
        subject: m.subject,
        body: m.body,
        question_type: m.questionType,
        is_read: m.isRead,
        ebay_created_at: m.ebayCreatedAt,
        item_title: m.itemTitle,
        item_price: m.itemPrice,
        item_currency: m.itemCurrency,
        item_url: m.itemUrl,
      })),
      { onConflict: "external_message_id" }
    );

  if (upsertError) {
    console.error("[messages/ebay/sync] upsert failed:", upsertError.message);
    return NextResponse.json({ error: "Failed to save synced messages" }, { status: 500 });
  }

  return NextResponse.json({ synced: messages.length });
}
