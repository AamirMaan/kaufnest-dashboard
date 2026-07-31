// Fetches eBay's public key used to sign push notifications (see
// verifyNotificationSignature.ts), by key id (`kid` from the
// X-EBAY-SIGNATURE header). Requires an eBay *application* access token
// (client_credentials grant) — separate from the per-tenant user tokens in
// tokenStore.ts, since this call isn't scoped to any tenant's connection.
// Token fetch/caching lives in ./appToken (shared with publish.ts's
// searchCategories, same non-seller-specific-data reasoning).

import { getApplicationToken } from "./appToken";

interface EbayPublicKeyResponse {
  key: string;
  digest: string;
  algorithm: string;
}

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const PUBLIC_KEY_URL = (keyId: string) => `${EBAY_BASE}/commerce/notification/v1/public_key/${keyId}`;

// Signing keys are long-lived and rotate infrequently — safe to cache for
// the lifetime of the server process.
const publicKeyCache = new Map<string, EbayPublicKeyResponse>();

/** Fetches (and caches) eBay's public key + signing algorithm for the given key id. */
export async function fetchEbayPublicKey(keyId: string): Promise<EbayPublicKeyResponse> {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;

  const token = await getApplicationToken();
  const res = await fetch(PUBLIC_KEY_URL(keyId), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`eBay public key request failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as EbayPublicKeyResponse;
  publicKeyCache.set(keyId, json);
  return json;
}
