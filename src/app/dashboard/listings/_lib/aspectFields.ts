/** Client copy of the aspects route's optional-aspect shape
 *  (lib/integrations/ebay/aspects.ts is server-only). */
export interface OptionalAspect {
  name: string;
  values: string[];
  mode: "SELECTION_ONLY" | "FREE_TEXT";
  recommended: boolean;
}

export type AspectControl = "select" | "combobox" | "text";

export function optionalAspectControl(aspect: OptionalAspect): AspectControl {
  if (aspect.values.length === 0) return "text";
  return aspect.mode === "SELECTION_ONLY" ? "select" : "combobox";
}

export function countFilled(values: Record<string, string>, names: string[]): number {
  return names.filter((name) => values[name]?.trim()).length;
}
