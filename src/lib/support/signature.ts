import { createHmac, timingSafeEqual } from "crypto";

/**
 * Trello signs `requestBody + callbackURL` with HMAC-SHA1 keyed on the app
 * secret, base64-encoded, and sends it as `x-trello-webhook`. The callback URL
 * is part of the signed material, so a signature captured from one deployment
 * cannot be replayed against another.
 *
 * Server-only. `rawBody` must be the exact bytes received — parse the JSON
 * only after this returns true.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  callbackUrl: string
): boolean {
  if (!header) return false;

  const expected = createHmac("sha1", secret).update(rawBody + callbackUrl).digest();

  let received: Buffer;
  try {
    received = Buffer.from(header, "base64");
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
