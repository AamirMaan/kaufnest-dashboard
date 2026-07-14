import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyPlatformAdmin } from "@/lib/supabase/control";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import type { DropshipListing } from "@/types";

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

  const forbidden = await verifyPlatformAdmin(user.email);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = (await req.json()) as {
    sourceUrl?: string;
    customsTaxAmount?: number;
  };

  if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim() === "") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }

  if (
    body.customsTaxAmount !== undefined &&
    (typeof body.customsTaxAmount !== "number" || body.customsTaxAmount < 0)
  ) {
    return NextResponse.json(
      { error: "customsTaxAmount must be a number >= 0" },
      { status: 400 }
    );
  }

  const sourceUrl = body.sourceUrl.trim();
  const sourcePlatform = detectPlatform(sourceUrl);

  const { data, error } = await client
    .from("dropship_listings")
    .update({
      source_url: sourceUrl,
      source_platform: sourcePlatform,
      // Only set when the caller actually sent it — never silently overwrite
      // a stored customs fee for a future caller that only patches sourceUrl.
      ...(body.customsTaxAmount !== undefined
        ? { customs_tax_amount: body.customsTaxAmount }
        : {}),
    })
    .eq("id", id)
    .select("*")
    .single<DropshipListing>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
