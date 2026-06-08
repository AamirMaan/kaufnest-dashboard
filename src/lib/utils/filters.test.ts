import { resolveDateRange, getPresetRange } from "./filters";

describe("resolveDateRange", () => {
  it("delegates non-custom presets to getPresetRange", () => {
    expect(resolveDateRange("this_month", "", "")).toEqual(getPresetRange("this_month"));
    expect(resolveDateRange("all", "", "")).toBeNull();
  });

  it("returns null for custom preset with no bounds set", () => {
    expect(resolveDateRange("custom", "", "")).toBeNull();
  });

  it("returns the exact bounds for a fully specified custom range", () => {
    expect(resolveDateRange("custom", "2026-01-01", "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("fills in an open lower bound when only 'to' is given", () => {
    expect(resolveDateRange("custom", "", "2026-03-31")).toEqual({
      from: "0000-00-00",
      to: "2026-03-31",
    });
  });

  it("fills in an open upper bound when only 'from' is given", () => {
    expect(resolveDateRange("custom", "2026-01-01", "")).toEqual({
      from: "2026-01-01",
      to: "9999-99-99",
    });
  });
});
