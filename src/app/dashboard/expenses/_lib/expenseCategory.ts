import type { ExpenseCategory } from "@/types";

/**
 * Guess an expense category from its description.
 *
 * A German input-tax ledger has no category column, and Amazon localises each
 * fee description to the marketplace it came from — the same fulfilment fee
 * appears in German, English, Dutch, Italian, Spanish, Swedish and French
 * within one quarterly file. Without this every row imports as "other".
 *
 * Order matters: the first matching entry wins, so put the specific before the
 * general. `shipping` is checked before the selling-fee words because
 * "Commissioni di Logistica" contains both ideas.
 *
 * Pure module — no React/Supabase/Redux. The importer shows the resulting
 * breakdown before committing, so a wrong guess is visible, not silent.
 */
const RULES: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  ["advertising", ["ads", "werbung", "advertising", "publicidad", "annonsering"]],
  ["tax", ["epr", "eco-contribution", "ecológicas", "ecologicas", "contribuciones", "rap"]],
  ["software", ["subscription", "abonnement", "sellerboard", "software", "saas"]],
  ["shipping", [
    "versand", "fulfilment", "fulfillment", "logistik", "logistica", "logística",
    "fraktas", "expédition", "expedition", "spedizione", "verzending", "shipping",
    "container packing", "logistik provider",
  ]],
  ["office", ["office", "büro", "buero", "supply", "towel", "papier"]],
];

export function categoryFor(description: string | undefined): ExpenseCategory {
  const s = description?.trim().toLowerCase();
  if (!s) return "other";
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => s.includes(k))) return category;
  }
  return "other";
}
