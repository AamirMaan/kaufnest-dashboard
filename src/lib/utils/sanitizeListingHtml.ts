import DOMPurify from "isomorphic-dompurify";

/**
 * eBay accepts HTML in item descriptions but blocks active content
 * (JavaScript, forms, iframes) — listings containing it are rejected or
 * stripped. This is the enforcement point: descriptions are written straight
 * to `ebay_listing_drafts` from the browser, so the editor's own restrictions
 * are cosmetic and this must run server-side before anything reaches eBay.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u",
  "ul", "ol", "li", "h2", "h3", "a", "span",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel"];

export function sanitizeListingHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}
