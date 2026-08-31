import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection } from "@/lib/integrations/tokenStore";
import {
  fetchRequiredAspects,
  getProductIdentifierNotApplicableText,
} from "@/lib/integrations/ebay/publish";

export async function GET(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim();
  if (!categoryId) {
    return NextResponse.json({ error: "Missing categoryId parameter" }, { status: 400 });
  }

  // Same as category search: uses an eBay application token (category
  // metadata isn't seller-specific), but still requires a connected eBay
  // account as a UX gate.
  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  try {
    const aspects = await fetchRequiredAspects(categoryId);
    return NextResponse.json({ aspects, notApplicableText: getProductIdentifierNotApplicableText() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch required item aspects";
    console.error("[listings/ebay/aspects] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
