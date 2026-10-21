// One-time setup for eBay "Digital Signatures for APIs" (needed for every
// Finances API call made for EU/UK sellers — see
// src/lib/integrations/ebay/signature.ts).
//
// Creates an Ed25519 signing keypair for this eBay app via the Key Management
// API and prints the two env vars to add to the server environment (Vercel +
// .env.local). eBay does NOT store the private key: if it is lost, run this
// again and replace both values.
//
//   npm run ebay:create-signing-key
//
// Uses EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (and EBAY_SANDBOX) from .env.local.

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const API = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const APIZ = SANDBOX ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com";

const id = process.env.EBAY_CLIENT_ID;
const secret = process.env.EBAY_CLIENT_SECRET;
if (!id || !secret) {
  console.error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set (in .env.local).");
  process.exit(1);
}

const tokenRes = await fetch(`${API}/identity/v1/oauth2/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  },
  body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
});
if (!tokenRes.ok) {
  console.error(`Application token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  process.exit(1);
}
const { access_token: token } = await tokenRes.json();

const keyRes = await fetch(`${APIZ}/developer/key_management/v1/signing_key`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ signingKeyCipher: "ED25519" }),
});
if (!keyRes.ok) {
  console.error(`createSigningKey failed: ${keyRes.status} ${await keyRes.text()}`);
  process.exit(1);
}
const key = await keyRes.json();
if (!key.privateKey || !key.jwe) {
  console.error("createSigningKey returned no privateKey/jwe.");
  process.exit(1);
}

console.log(`# eBay signing key ${key.signingKeyId} (${SANDBOX ? "sandbox" : "production"}), expires ${key.expirationTime ?? "unknown"}`);
console.log("# Add both to the server environment. Keep the private key secret — eBay can't show it again.");
console.log(`EBAY_SIGNING_PRIVATE_KEY=${key.privateKey}`);
console.log(`EBAY_SIGNING_JWE=${key.jwe}`);
