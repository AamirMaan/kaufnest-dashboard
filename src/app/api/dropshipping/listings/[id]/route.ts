import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import type { DropshipListing } from "@/types";

// All authenticated roles (including accountant) may link supplier source URLs —
// the Edit button is shown to all roles in the UI. Refresh (which calls eBay)
// is the admin-only action; source URL editing is a data-entry task for anyone.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { sourceUrl?: string };

  if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim() === "") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }

  const sourceUrl = body.sourceUrl.trim();
  const sourcePlatform = detectPlatform(sourceUrl);

  const { data, error } = await client
    .from("dropship_listings")
    .update({ source_url: sourceUrl, source_platform: sourcePlatform })
    .eq("id", id)
    .select("*")
    .single<DropshipListing>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
