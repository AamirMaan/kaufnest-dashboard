import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { hasPermission } from "@/lib/utils/permissions";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { replyToMessage } from "@/lib/integrations/ebay/messages";
import { writeAuditLog } from "@/lib/utils/audit";
import type { EbayMessage, Profile } from "@/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const { data: profile } = await client
    .from("profiles")
    .select("role, permission_overrides, email")
    .eq("id", userId)
    .single<Pick<Profile, "role" | "permission_overrides" | "email">>();
  if (!profile?.role || !hasPermission(profile.role, "manage_messages", profile.permission_overrides)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
  }

  const { data: original, error: fetchError } = await client
    .from("ebay_messages")
    .select("*")
    .eq("id", id)
    .single<EbayMessage>();

  if (fetchError || !original) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (!original.external_message_id) {
    return NextResponse.json(
      { error: "Cannot reply to a message with no eBay message id" },
      { status: 400 }
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  try {
    await replyToMessage(
      accessToken,
      original.item_id,
      original.external_message_id,
      original.buyer_username,
      text.trim()
    );

    const { data: sent, error: insertError } = await client
      .from("ebay_messages")
      .insert({
        item_id: original.item_id,
        buyer_username: original.buyer_username,
        direction: "outbound",
        body: text.trim(),
        ebay_created_at: new Date().toISOString(),
      })
      .select()
      .single<EbayMessage>();

    if (insertError) throw insertError;

    await writeAuditLog(client, {
      userId,
      userEmail: profile.email ?? "",
      action: "create",
      entityType: "message",
      entityId: sent.id,
      metadata: { item_id: original.item_id, buyer_username: original.buyer_username },
    });

    return NextResponse.json(sent);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reply failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
