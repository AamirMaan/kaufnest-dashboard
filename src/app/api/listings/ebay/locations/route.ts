import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import {
  fetchInventoryLocations,
  createInventoryLocation,
  type CreateInventoryLocationInput,
} from "@/lib/integrations/ebay/publish";

async function resolveAccessToken(): Promise<
  { accessToken: string } | { error: NextResponse }
> {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return { error: auth.error };
  const { client } = auth.context;

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return {
      error: NextResponse.json(
        { error: "eBay is not connected. Connect it in Integrations first." },
        { status: 400 }
      ),
    };
  }

  try {
    const accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
    return { accessToken };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[listings/ebay/locations] token refresh failed:", message);
    return { error: NextResponse.json({ error: message }, { status: 500 }) };
  }
}

export async function GET() {
  const resolved = await resolveAccessToken();
  if ("error" in resolved) return resolved.error;

  try {
    const locations = await fetchInventoryLocations(resolved.accessToken);
    return NextResponse.json({ locations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch inventory locations";
    console.error("[listings/ebay/locations] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAccessToken();
  if ("error" in resolved) return resolved.error;

  let body: Partial<CreateInventoryLocationInput>;
  try {
    body = (await req.json()) as Partial<CreateInventoryLocationInput>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, city, postalCode, country } = body;
  if (!name?.trim() || !city?.trim() || !postalCode?.trim() || !country?.trim()) {
    return NextResponse.json(
      { error: "Name, city, postal code, and country are required." },
      { status: 400 }
    );
  }
  if (!/^[A-Z]{2}$/.test(country.trim().toUpperCase())) {
    return NextResponse.json(
      { error: "Country must be a 2-letter code, e.g. DE, US, GB." },
      { status: 400 }
    );
  }

  try {
    const location = await createInventoryLocation(resolved.accessToken, {
      name: name.trim(),
      city: city.trim(),
      postalCode: postalCode.trim(),
      country: country.trim().toUpperCase(),
      addressLine1: body.addressLine1?.trim() || undefined,
      stateOrProvince: body.stateOrProvince?.trim() || undefined,
    });
    return NextResponse.json({ location });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create inventory location";
    console.error("[listings/ebay/locations] create failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
