import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";

// Must match exactly what you register in the eBay developer portal.
const ENDPOINT_URL = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/notifications/ebay-account-deletion`;

/**
 * GET ?challenge_code=<code>
 * eBay calls this to verify the endpoint before activating notifications.
 * Response: { challengeResponse: SHA256(challengeCode + verificationToken + endpointUrl) }
 */
export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN ?? "";
  const hash = createHash("sha256")
    .update(challengeCode + verificationToken + ENDPOINT_URL)
    .digest("hex");

  return NextResponse.json({ challengeResponse: hash });
}

/**
 * POST — eBay MARKETPLACE_ACCOUNT_DELETION notification.
 * Always returns 200 to acknowledge receipt. Cleanup is best-effort:
 * finds any tenant whose eBay connection's external_account_id matches
 * the deleted user's userId or username, then removes their synced eBay
 * sales and the connection row.
 */
export async function POST(req: NextRequest) {
  let userId: string | undefined;
  let username: string | undefined;

  try {
    const body = (await req.json()) as {
      notification?: { data?: { userId?: string; username?: string } };
    };
    userId = body.notification?.data?.userId;
    username = body.notification?.data?.username;
  } catch {
    // Malformed body — still acknowledge
    return new NextResponse(null, { status: 200 });
  }

  if (userId || username) {
    // Fire-and-forget cleanup — don't block the acknowledgement on it
    cleanupEbayUser(userId, username).catch(() => undefined);
  }

  return new NextResponse(null, { status: 200 });
}

async function cleanupEbayUser(userId?: string, username?: string) {
  const control = createControlClient();
  const { data: tenants } = await control
    .schema("control")
    .from("tenants")
    .select("schema_name")
    .eq("status", "active");

  if (!tenants?.length) return;

  for (const { schema_name } of tenants) {
    try {
      const client = createServiceClientForTenant(schema_name as string);

      const { data: connection } = await client
        .from("platform_connections")
        .select("id, external_account_id")
        .eq("platform", "ebay")
        .maybeSingle();

      if (!connection?.external_account_id) continue;

      const accountId = connection.external_account_id;
      if (accountId !== userId && accountId !== username) continue;

      // Delete synced eBay sales (external_order_id NOT NULL = synced, not manual)
      await client
        .from("sales")
        .delete()
        .eq("platform", "ebay")
        .not("external_order_id", "is", null);

      // Remove the connection row (clears tokens and OAuth state)
      await client
        .from("platform_connections")
        .delete()
        .eq("platform", "ebay");
    } catch {
      // Skip this tenant on error — continue with others
    }
  }
}
