// eBay *application* access token (client_credentials grant) — for calls
// that read public/global eBay data rather than a specific seller's account,
// which don't need (and won't accept) a per-tenant user token. The app's
// user tokens are only authorized with sell.fulfillment/sell.inventory (see
// EBAY_SCOPE in ebay.ts), which doesn't include the base
// https://api.ebay.com/oauth/api_scope these calls check for — passing a
// user token here gets a 403 (errorId 1100, "Insufficient permissions").
//
// Used by publish.ts's searchCategories (Taxonomy API — category trees are
// global, not seller-specific) and publicKey.ts (notification signing key
// fetch, also not tenant-scoped).

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const TOKEN_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;

let appTokenCache: { token: string; expiresAt: number } | null = null;

export async function getApplicationToken(): Promise<string> {
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
