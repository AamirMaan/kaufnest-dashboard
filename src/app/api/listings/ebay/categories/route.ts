import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection } from "@/lib/integrations/tokenStore";
import { searchCategories } from "@/lib/integrations/ebay/publish";

export async function GET(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  // Category search uses an eBay application token (see searchCategories),
  // not this connection's user token — still require a connected eBay
  // account so category search isn't usable before Integrations is set up.
  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  try {
    const categories = await searchCategories(query);
    return NextResponse.json({ categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Category search failed" },
      { status: 502 }
    );
  }
}
