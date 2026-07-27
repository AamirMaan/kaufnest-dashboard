import { createVerify } from "crypto";

/**
 * eBay's Notification API signs every push notification (including the
 * Marketplace Account Deletion notification) with the `X-EBAY-SIGNATURE`
 * header: base64 JSON containing the signing key's id, the digest algorithm,
 * and the base64 signature itself. See eBay's "Notification API — verify
 * notification message signature" documentation.
 */
export interface ParsedEbaySignatureHeader {
  alg: string;
  digest: string;
  signature: string;
  kid: string;
}

/** Parses and validates the shape of the `X-EBAY-SIGNATURE` header. Returns null if missing/malformed. */
export function parseSignatureHeader(header: string | null): ParsedEbaySignatureHeader | null {
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as Partial<ParsedEbaySignatureHeader>;
    if (!parsed.kid || !parsed.signature || !parsed.digest) return null;
    return parsed as ParsedEbaySignatureHeader;
  } catch {
    return null;
  }
}

/**
 * Verifies `rawBody` (the exact bytes eBay sent, before any JSON.parse) was
 * signed by the holder of the private key matching `publicKeyPem`.
 */
export function verifySignature(
  rawBody: string,
  signatureBase64: string,
  publicKeyPem: string,
  digestAlgorithm: string
): boolean {
  try {
    const verifier = createVerify(digestAlgorithm);
    verifier.update(rawBody, "utf-8");
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}
