import type { DraftFormState } from "./wizardValidation";

/** The multi-buy lines the preview shows under the price. */
export function multiBuyPreviewLines(draft: DraftFormState): string[] {
  if (!draft.multibuy_enabled) return [];
  const tiers: Array<[string, string]> = [
    ["Buy 2", draft.multibuy_2_pct],
    ["Buy 3", draft.multibuy_3_pct],
    ["Buy 4 or more", draft.multibuy_4_pct],
  ];
  return tiers
    .filter(([, pct]) => pct.trim())
    .map(([label, pct]) => `${label}, save ${pct}%`);
}
