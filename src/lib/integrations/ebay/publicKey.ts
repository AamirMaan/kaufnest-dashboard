// Fetches eBay's public key used to sign push notifications (see
// verifyNotificationSignature.ts), by key id (`kid` from the
// X-EBAY-SIGNATURE header). Requires an eBay *application* access token
// (client_credentials grant) — separate from the per-tenant user tokens in
// tokenStore.ts, since this call isn't scoped to any tenant's connection.

interface EbayPublicKeyResponse {
  key: string;
  digest: string;
  algorithm: string;
}

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const TOKEN_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;
const PUBLIC_KEY_URL = (keyId: string) => `${EBAY_BASE}/commerce/notification/v1/public_key/${keyId}`;

let appTokenCache: { token: string; expiresAt: number } | null = null;
// Signing keys are long-lived and rotate infrequently — safe to cache for
// the lifetime of the server process.
const publicKeyCache = new Map<string, EbayPublicKeyResponse>();

async function getApplicationToken(): Promise<string> {
  if (appTokenCache && appTokenCache.expiresAt > Date.now()) return appTokenCache.token;

  const credentials = `${process.env.EBAY_CLIENT_ID ?? ""}:${process.env.EBAY_CLIENT_SECRET ?? ""}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!res.ok) {
    throw new Error(`eBay application token request failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  appTokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

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
