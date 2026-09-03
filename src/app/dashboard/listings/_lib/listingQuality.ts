import type { DraftFormState } from "./wizardValidation";

export interface QualityCheck {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  hint: string;
}

/** eBay indexes the whole 80-character title; most sellers stop around 40
 * and lose search coverage for it. 60 is the point where that stops hurting. */
const GOOD_TITLE_MIN = 60;
const GOOD_IMAGE_COUNT = 6;
const GOOD_DESCRIPTION_CHARS = 300;

/**
 * Length of the text a buyer will actually read, with markup discounted.
 *
 * `description` holds HTML now (`editor.getHTML()` from `DescriptionEditor`),
 * not the plain text this check was written against. Measuring `.length` on
 * the raw string counted every `<p>`, `<h3>` and `<li>` toward the 300-character
 * bar, so a typical AI-generated description passed on roughly 180-230
 * characters of real content — in the feature's headline quality signal.
 *
 * A regex tag-strip is enough here: this is a length heuristic, not a
 * sanitizer (that job belongs to `sanitizeListingHtml`, server-side). Tags
 * become a space so `</p><p>` doesn't fuse two words into one, entities
 * collapse to the single character they render as, and runs of whitespace
 * count once.
 */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:[a-z]+|#\d+);/gi, "x")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Score a draft 0-100 on how well it will perform as an eBay listing —
 * distinct from `wizardValidation`, which answers whether it can be
 * published at all. Every check carries a hint saying what to do about it.
 */
export function scoreListing(draft: DraftFormState): {
  score: number;
  checks: QualityCheck[];
} {
  const requiredAspectsFilled = draft.required_aspect_names.every((name) =>
    draft.aspects[name]?.trim()
  );

  /* Weight is conditional on whether the category requires any item specifics.
   * If none are required, zeroing the weight prevents empty drafts from scoring
   * nonzero. The final score is normalized by totalWeight, so this doesn't cap
   * the max score: a draft with no required aspects can still achieve 100%. */
  const aspectsWeight = draft.required_aspect_names.length > 0 ? 20 : 0;

  const checks: QualityCheck[] = [
    {
      id: "title",
      label: "Descriptive title",
      weight: 25,
      passed: draft.title.trim().length >= GOOD_TITLE_MIN,
      hint: `Use at least ${GOOD_TITLE_MIN} of the 80 characters — eBay searches the whole title, so brand, model, size and colour all earn their place.`,
    },
    {
      id: "images",
      label: "Enough photos",
      weight: 20,
      passed: draft.image_urls.length >= GOOD_IMAGE_COUNT,
      hint: `Add at least ${GOOD_IMAGE_COUNT} photos. Buyers who cannot see an angle assume the worst about it.`,
    },
    {
      id: "aspects",
      label: "Item specifics complete",
      weight: aspectsWeight,
      passed: requiredAspectsFilled,
      hint: "Fill every required item specific — eBay filters search results on these, so a blank one hides your listing.",
    },
    {
      id: "description",
      label: "Substantial description",
      weight: 15,
      // Visible text, not raw markup — see `visibleTextLength` above.
      passed: visibleTextLength(draft.description) >= GOOD_DESCRIPTION_CHARS,
      hint: `Write at least ${GOOD_DESCRIPTION_CHARS} characters covering condition, what is included, and dimensions.`,
    },
    {
      id: "category",
      label: "Category chosen",
      weight: 10,
      passed: !!draft.category_id,
      hint: "Pick the most specific category that fits — it decides which item specifics eBay asks for.",
    },
    {
      id: "price",
      label: "Price set",
      weight: 5,
      passed: Number(draft.price) > 0,
      hint: "Set a price above zero.",
    },
    {
      id: "policies",
      label: "Policies selected",
      weight: 5,
      passed:
        !!draft.fulfillment_policy_id &&
        !!draft.payment_policy_id &&
        !!draft.return_policy_id &&
        !!draft.merchant_location_key,
      hint: "Choose a fulfillment, payment and return policy plus an inventory location — eBay rejects a publish without all four.",
    },
  ];

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight > 0 ? Math.round((100 * passedWeight) / totalWeight) : 0;
  return { score, checks };
}
