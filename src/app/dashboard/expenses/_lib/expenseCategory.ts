import type { ExpenseCategory } from "@/types";

/**
 * Guess an expense category from its description.
 *
 * A German input-tax ledger has no category column, and Amazon localises each
 * fee description to the marketplace it came from — the same fulfilment fee
 * appears in German, English, Dutch, Italian, Spanish, Swedish and French
 * within one quarterly file. Without this every row imports as "other".
 *
 * Order matters: the first matching entry wins, so specific rules are checked
 * before general ones. `tax` and `software` are checked before `shipping` and
 * `office` so a specific levy (e.g. "eco-contribution") or subscription isn't
 * accidentally caught by a broader logistics or office keyword.
 *
 * Selling fees and commissions deliberately fall through to "other", because
 * `ExpenseCategory` has no `fees` member — that is a documented, deliberate gap,
 * not an oversight.
 *
 * Word boundaries are enforced so "rap" doesn't match "wrap" and "ads" doesn't
 * match "downloads". Pure module — no React/Supabase/Redux. The importer shows
 * the resulting breakdown before committing, so a wrong guess is visible, not silent.
 */
const RULES: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  ["advertising", ["ads", "werbung", "advertising", "publicidad", "annonsering"]],
  ["tax", ["epr", "eco-contribution", "ecológicas", "ecologicas", "rap"]],
  ["software", ["subscription", "abonnement", "sellerboard", "software", "saas"]],
  ["shipping", [
    "versand", "fulfilment", "fulfillment", "logistik", "logistica", "logística",
    "fraktas", "expédition", "expedition", "spedizione", "verzending", "shipping",
    "container packing",
  ]],
  ["office", ["office", "büro", "buero", "supply", "towel", "papier"]],
];

const matches = (haystack: string, keyword: string): boolean =>
  new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);

export function categoryFor(description: string | undefined): ExpenseCategory {
  const s = description?.trim().toLowerCase();
  if (!s) return "other";
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => matches(s, k))) return category;
  }
  return "other";
}
