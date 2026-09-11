// Pure classification of eBay Taxonomy API item aspects. No I/O — the fetch
// lives in publish.ts (fetchCategoryAspects).

export interface TaxonomyAspect {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string };
  aspectValues?: { localizedValue: string }[];
}

export interface RequiredAspect {
  name: string;
  values: string[];
  isProductIdentifier: boolean;
}

export interface OptionalAspect {
  name: string;
  values: string[];
  mode: "SELECTION_ONLY" | "FREE_TEXT";
  /** eBay marks it RECOMMENDED — buyers filter by it; shown first. */
  recommended: boolean;
}

// Product identifiers (GTIN family: EAN/UPC/ISBN, plus MPN) are a
// documented eBay concept distinct from ordinary category aspects — many
// categories require at least one of them (a GTIN, OR a Brand+MPN pair),
// per eBay's own publishing-offers docs. The trap: eBay's Taxonomy API
// commonly reports these as aspectUsage "RECOMMENDED" rather than
// aspectRequired: true, even when publishOffer treats them as mandatory —
// confirmed live 2026-08-31: "Brand" was correctly caught by
// `aspectRequired === true`, but "EAN" was NOT, and still made
// publishOffer 400 with errorId 25002 once Brand was fixed. Recognizing
// this named, finite set by name (rather than loosening the required-filter
// to "anything not explicitly OPTIONAL", which would flood every category's
// step with cosmetic aspects like Color/Style/Material) closes this whole
// class of failure going forward, not just for EAN.
const PRODUCT_IDENTIFIER_NAMES = new Set(["ean", "upc", "isbn", "gtin", "mpn"]);

export function isProductIdentifierAspect(name: string): boolean {
  return PRODUCT_IDENTIFIER_NAMES.has(name.trim().toLowerCase());
}

export function splitCategoryAspects(aspects: TaxonomyAspect[]): {
  required: RequiredAspect[];
  optional: OptionalAspect[];
} {
  const required: RequiredAspect[] = [];
  const recommended: OptionalAspect[] = [];
  const rest: OptionalAspect[] = [];

  for (const a of aspects) {
    const name = a.localizedAspectName;
    const values = (a.aspectValues ?? []).map((v) => v.localizedValue);
    const isProductIdentifier = isProductIdentifierAspect(name);

    if (a.aspectConstraint?.aspectRequired === true || isProductIdentifier) {
      required.push({ name, values, isProductIdentifier });
      continue;
    }

    const isRecommended = a.aspectConstraint?.aspectUsage === "RECOMMENDED";
    const entry: OptionalAspect = {
      name,
      values,
      mode: a.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
      recommended: isRecommended,
    };
    (isRecommended ? recommended : rest).push(entry);
  }

  return { required, optional: [...recommended, ...rest] };
}
