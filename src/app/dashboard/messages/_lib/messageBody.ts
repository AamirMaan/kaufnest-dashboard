/**
 * Display cleanup for eBay message bodies. eBay's Trading API returns
 * bodies with XML character references left in — most visibly `&#xd;`
 * (carriage return) on every line of a seller-template message — which
 * rendered literally in the chat. Applied at render time so rows already
 * stored in `ebay_messages` are fixed too; the stored body is untouched.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      // Out-of-range or NUL code points stay as written rather than throwing.
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * Decodes character references, normalises CRLF/CR to LF, trims each
 * line's edges, collapses runs of blank lines to one, and trims the whole.
 */
export function cleanMessageBody(body: string): string {
  return decodeEntities(body)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Single-line preview for the conversation list. */
export function messagePreview(body: string): string {
  return cleanMessageBody(body).replace(/\s+/g, " ");
}
