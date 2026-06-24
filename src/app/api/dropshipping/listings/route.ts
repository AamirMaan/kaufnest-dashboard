import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DropshipListing } from "@/types";

export async function GET() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await client
    .from("dropship_listings")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<DropshipListing[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
