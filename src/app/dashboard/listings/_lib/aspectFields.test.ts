import { countFilled, optionalAspectControl, type OptionalAspect } from "./aspectFields";

function aspect(overrides: Partial<OptionalAspect> = {}): OptionalAspect {
  return { name: "Farbe", values: [], mode: "FREE_TEXT", recommended: true, ...overrides };
}

describe("optionalAspectControl", () => {
  it("uses a select for a closed value list", () => {
    expect(optionalAspectControl(aspect({ mode: "SELECTION_ONLY", values: ["Schwarz"] }))).toBe(
      "select"
    );
  });

  it("uses a type-or-pick combobox for free text with suggestions", () => {
    expect(optionalAspectControl(aspect({ values: ["Unbranded"] }))).toBe("combobox");
  });

  it("uses a plain text input when eBay offers no values", () => {
    expect(optionalAspectControl(aspect())).toBe("text");
    // SELECTION_ONLY with no values would be an empty <select> — fall back to text.
    expect(optionalAspectControl(aspect({ mode: "SELECTION_ONLY" }))).toBe("text");
  });
});

describe("countFilled", () => {
  it("counts only named aspects with a non-blank value", () => {
    expect(
      countFilled({ Farbe: "Schwarz", Stil: "  ", Marke: "Acme" }, ["Farbe", "Stil", "Material"])
    ).toBe(1);
  });
});
