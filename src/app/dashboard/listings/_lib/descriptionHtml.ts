/**
 * Adapter for `ebay_listing_drafts.description` on its way into the TipTap
 * editor.
 *
 * The column has held plain text since long before the rich editor existed,
 * and there are real rows in the live database that still do. TipTap parses
 * whatever it is handed as HTML, so a plain-text description arrives as one
 * whitespace-normalized paragraph and every line break the seller typed is
 * lost the moment they open the draft.
 *
 * Wrapping legacy text in markup on load was the design's deliberate choice
 * over a fan-out migration ("a four-line adapter beats a five-schema
 * fan-out") — it just never made it into a task's requirements, so it was
 * never built until the whole-branch review found the gap.
 */

/** Anything that looks like an opening tag. Deliberately crude: this only has
 * to separate "wrote by this feature" from "typed into the old textarea", and
 * a legacy description containing a literal `<` is escaped by the branch
 * below, not misrouted by a cleverer parser. */
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i;

/** Escape before wrapping — a legacy description containing `<`, `>` or `&`
 * must render as those characters, not be re-interpreted as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns editor-ready HTML for a stored description.
 *
 * - Already HTML (anything this feature saved): returned untouched.
 * - Plain text: blank-line-separated blocks become `<p>`, single newlines
 *   inside a block become `<br>`.
 * - Empty/whitespace-only: `""`, matching how `DescriptionEditor` normalizes
 *   an empty document so `draft.description` stays falsy for the preview's
 *   empty state, `scoreListing`, and `toPayload()`'s `|| null`.
 */
export function toEditorHtml(description: string | null | undefined): string {
  const raw = description ?? "";
  if (!raw.trim()) return "";
  if (LOOKS_LIKE_HTML.test(raw)) return raw;

  return raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
