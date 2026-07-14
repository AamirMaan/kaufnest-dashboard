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
    customsTaxRate?: number | null;
    customsTaxAmount?: number | null;
  };

  if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim() === "") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }

  if (
    body.customsTaxRate !== undefined &&
    body.customsTaxRate !== null &&
    typeof body.customsTaxRate !== "number"
  ) {
    return NextResponse.json({ error: "customsTaxRate must be a number or null" }, { status: 400 });
  }

  const sourceUrl = body.sourceUrl.trim();
  const sourcePlatform = detectPlatform(sourceUrl);

  const { data, error } = await client
    .from("dropship_listings")
    .update({
      source_url: sourceUrl,
      source_platform: sourcePlatform,
      customs_tax_rate: body.customsTaxRate ?? null,
      customs_tax_amount: body.customsTaxAmount ?? null,
    })
    .eq("id", id)
    .select("*")
    .single<DropshipListing>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
