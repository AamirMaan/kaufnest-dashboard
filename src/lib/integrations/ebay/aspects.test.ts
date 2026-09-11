import { splitCategoryAspects, type TaxonomyAspect } from "./aspects";

function aspect(
  name: string,
  constraint: TaxonomyAspect["aspectConstraint"] = {},
  values: string[] = []
): TaxonomyAspect {
  return {
    localizedAspectName: name,
    aspectConstraint: constraint,
    aspectValues: values.map((localizedValue) => ({ localizedValue })),
  };
}

describe("splitCategoryAspects", () => {
  it("puts aspectRequired aspects in required, with their values", () => {
    const { required, optional } = splitCategoryAspects([
      aspect("Marke", { aspectRequired: true, aspectUsage: "RECOMMENDED" }, ["Unbranded"]),
    ]);
    expect(required).toEqual([{ name: "Marke", values: ["Unbranded"], isProductIdentifier: false }]);
    expect(optional).toEqual([]);
  });

  it("treats product identifiers as required even when eBay says RECOMMENDED", () => {
    const { required, optional } = splitCategoryAspects([
      aspect("EAN", { aspectUsage: "RECOMMENDED" }),
    ]);
    expect(required).toEqual([{ name: "EAN", values: [], isProductIdentifier: true }]);
    expect(optional).toEqual([]);
  });

  it("lists recommended optional aspects before plain optional ones, keeping eBay's order", () => {
    const { optional } = splitCategoryAspects([
      aspect("Material", { aspectUsage: "OPTIONAL" }),
      aspect("Farbe", { aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, ["Schwarz"]),
      aspect("Stil", { aspectUsage: "OPTIONAL" }),
      aspect("Abteilung", { aspectUsage: "RECOMMENDED" }, ["Herren", "Unisex"]),
    ]);
    expect(optional.map((a) => a.name)).toEqual(["Farbe", "Abteilung", "Material", "Stil"]);
    expect(optional[0]).toEqual({
      name: "Farbe",
      values: ["Schwarz"],
      mode: "SELECTION_ONLY",
      recommended: true,
    });
  });

  it("defaults a missing aspectMode to FREE_TEXT", () => {
    const { optional } = splitCategoryAspects([aspect("Stil", { aspectUsage: "OPTIONAL" })]);
    expect(optional[0].mode).toBe("FREE_TEXT");
    expect(optional[0].recommended).toBe(false);
  });
});
