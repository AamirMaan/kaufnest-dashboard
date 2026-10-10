import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { parseSignatureHeader, verifySignature } from "@/lib/integrations/ebay/verifyNotificationSignature";
import { fetchEbayPublicKey } from "@/lib/integrations/ebay/publicKey";
import { matchDeletedEbayConnections } from "@/lib/integrations/ebay/deletionMatch";

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
 *
 * SECURITY: this endpoint deletes tenant data, so the caller must be proven
 * to be eBay before anything runs. eBay signs every notification with the
 * `X-EBAY-SIGNATURE` header (base64 JSON: key id + digest algo + base64
 * signature over the raw body) — see verifyNotificationSignature.ts. A
 * missing/invalid signature returns 401 and skips cleanup entirely; this is
 * intentionally NOT a silent 200, so a broken/misconfigured signature check
 * shows up as failed deliveries in eBay's Developer Portal rather than
 * failing open.
 *
 * On a verified notification, cleanup is still best-effort and matches per
 * account: in each tenant, only the eBay connection(s) whose
 * external_account_id (or, for legacy rows, external_username / a username
 * stored in external_account_id) matches the deleted user's userId or
 * username are removed, together with their synced eBay sales. Other eBay
 * accounts of the same tenant are left alone.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const parsedSignature = parseSignatureHeader(req.headers.get("x-ebay-signature"));
  if (!parsedSignature) {
    return NextResponse.json({ error: "Missing or malformed X-EBAY-SIGNATURE header" }, { status: 401 });
  }

  let verified: boolean;
  try {
    const { key, digest } = await fetchEbayPublicKey(parsedSignature.kid);
    verified = verifySignature(rawBody, parsedSignature.signature, key, digest || parsedSignature.digest);
  } catch (err) {
    console.error("[ebay-account-deletion] signature verification failed", err);
    verified = false;
  }

  if (!verified) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  let userId: string | undefined;
  let username: string | undefined;

  try {
    const body = JSON.parse(rawBody) as {
      notification?: { data?: { userId?: string; username?: string } };
    };
    userId = body.notification?.data?.userId;
    username = body.notification?.data?.username;
  } catch {
    // Malformed body despite a valid signature — nothing to act on.
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
    .from("tenants") // verifier:allow unpaginated-collection-read — bounded by active tenant count, not per-tenant data growth
    .select("schema_name")
    .eq("status", "active");

  if (!tenants?.length) return;

  for (const { schema_name } of tenants) {
    try {
      const client = createServiceClientForTenant(schema_name as string);

      const { data: connections } = await client
        .from("platform_connections") // verifier:allow unpaginated-collection-read — one row per seller account
        .select("id, external_account_id, external_username")
        .eq("platform", "ebay");

      const ids = matchDeletedEbayConnections(connections ?? [], userId, username);
      if (ids.length === 0) continue;

      // Only this account's synced orders — other eBay accounts of the same
      // tenant are untouched (multi-account, 056). external_order_id NOT NULL = synced, not manual.
      const { error: salesError } = await client
        .from("sales")
        .delete()
        .in("connection_id", ids)
        .not("external_order_id", "is", null);
      if (salesError) {
        // Keep the connection rows: deleting them would orphan these sales from
        // the only key a later notification could match them by.
        console.error("[ebay-account-deletion] sales cleanup failed", schema_name, salesError.message);
        continue;
      }

      // Remove the matched connection rows (clears tokens and OAuth state)
      const { error: connError } = await client.from("platform_connections").delete().in("id", ids);
      if (connError) console.error("[ebay-account-deletion] connection cleanup failed", schema_name, connError.message);
    } catch {
      // Skip this tenant on error — continue with others
    }
  }
}
