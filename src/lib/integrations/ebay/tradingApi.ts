// Shared helper for eBay's legacy Trading API (XML over HTTPS), used by
// listings.ts (GetMyeBaySelling) and messages.ts (GetMemberMessages,
// AddMemberMessageRTQ) — anywhere the REST Inventory/Fulfillment APIs don't
// cover what's needed.
//
// Auth: the same OAuth user access token, passed via the X-EBAY-API-IAF-TOKEN
// header. Requires the sell.inventory OAuth scope (readonly is NOT sufficient
// for Trading API calls) — existing connections must be re-authorised after
// the scope change in src/lib/integrations/ebay.ts.

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const TRADING_API_URL = SANDBOX
  ? "https://api.sandbox.ebay.com/ws/api.dll"
  : "https://api.ebay.com/ws/api.dll";
const COMPATIBILITY_LEVEL = "1193";

/** Extracts the text content of the first occurrence of <tag> in the given XML fragment. */
export function tagText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

/** Decodes the five predefined XML entities eBay uses in text fields. */
export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Escapes the five predefined XML entities — required before interpolating any user-supplied text into a request body. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function tradingApiCall(
  callName: string,
  requestXml: string,
  token: string
): Promise<string> {
  const res = await fetch(TRADING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: requestXml,
  });

  const xml = await res.text();

  if (!res.ok) {
    throw new Error(`eBay Trading API request failed: ${res.status} ${xml.slice(0, 500)}`);
  }

  const ack = tagText(xml, "Ack");
  if (ack === "Failure") {
    // The token never appears in eBay's response body, only in the request
    // header we sent — safe to log the raw XML (truncated) here. This is
    // what every hypothesis during the messages-sync 502 investigation
    // (2026-08-26) needed and nobody had, because only the thrown message
    // ever reached the caller, never the server logs.
    console.error(`[tradingApi] ${callName} Ack=Failure:`, xml.slice(0, 1000));

    const message = tagText(xml, "LongMessage") ?? tagText(xml, "ShortMessage") ?? "Unknown error";
    const errorCode = tagText(xml, "ErrorCode") ?? "";

    // 21916984 = token scope insufficient; 21917053 / 931 = invalid/hard-expired IAF token.
    if (["21916984", "21917053", "931", "932"].includes(errorCode)) {
      throw new Error(
        "eBay rejected the access token — your eBay connection needs re-authorization. " +
        "Go to Integrations, disconnect eBay, and reconnect to grant the required permissions."
      );
    }

    throw new Error(`eBay Trading API error ${errorCode}: ${decodeXml(message)}`);
  }

  return xml;
}
