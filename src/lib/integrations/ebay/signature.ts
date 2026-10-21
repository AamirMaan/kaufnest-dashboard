// eBay "Digital Signatures for APIs" (RFC 9421, Ed25519). Every Finances API
// call made for an EU/UK-domiciled seller must carry these headers, or eBay
// rejects it (errorId 215xxx) — see
// https://developer.ebay.com/develop/guides/digital-signatures-for-apis.
// eBay ignores the headers for other sellers, so we always sign when a key is
// configured. The keypair is created once per eBay app with
// `npm run ebay:create-signing-key` and stored as server env vars.
import { createPrivateKey, sign, type KeyObject } from "crypto";

export interface SigningConfig { privateKey: KeyObject; jwe: string }

const COVERED = '("x-ebay-signature-key" "@method" "@path" "@authority")';

/**
 * Reads EBAY_SIGNING_PRIVATE_KEY (PEM, PEM with escaped \n, or the bare base64
 * PKCS#8 the Key Management API returns) and EBAY_SIGNING_JWE. Null when either
 * is unset — callers then send unsigned requests. A malformed or non-Ed25519
 * key is also null (logged once, without key material): a bad env var must not
 * break Finances for sellers who don't need signing.
 */
export function loadSigningConfig(
  env: Record<string, string | undefined> = process.env
): SigningConfig | null {
  const raw = env.EBAY_SIGNING_PRIVATE_KEY?.trim();
  const jwe = env.EBAY_SIGNING_JWE?.trim();
  if (!raw || !jwe) return null;
  const pem = raw.includes("BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : `-----BEGIN PRIVATE KEY-----\n${raw.replace(/\s+/g, "")}\n-----END PRIVATE KEY-----\n`;
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    console.error("[ebay signing] EBAY_SIGNING_PRIVATE_KEY could not be parsed; sending unsigned requests");
    return null;
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    console.error(`[ebay signing] EBAY_SIGNING_PRIVATE_KEY is ${privateKey.asymmetricKeyType}, not ed25519; sending unsigned requests`);
    return null;
  }
  return { privateKey, jwe };
}

/** RFC 9421 signature base for a request without a body (no content-digest). */
export function signatureBase(method: string, url: string, jwe: string, created: number): string {
  const u = new URL(url);
  return [
    `"x-ebay-signature-key": ${jwe}`,
    `"@method": ${method.toUpperCase()}`,
    `"@path": ${u.pathname}`,
    `"@authority": ${u.host}`,
    `"@signature-params": ${COVERED};created=${created}`,
  ].join("\n");
}

/** The three headers eBay verifies, for a body-less request signed at `now`. */
export function signatureHeaders(
  method: string,
  url: string,
  cfg: SigningConfig,
  now: number = Date.now()
): Record<string, string> {
  const created = Math.floor(now / 1000);
  const sig = sign(null, Buffer.from(signatureBase(method, url, cfg.jwe, created)), cfg.privateKey);
  return {
    "x-ebay-signature-key": cfg.jwe,
    "Signature-Input": `sig1=${COVERED};created=${created}`,
    Signature: `sig1=:${sig.toString("base64")}:`,
  };
}
