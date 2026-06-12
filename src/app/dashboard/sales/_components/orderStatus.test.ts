import { ORDER_STATUSES, isPresetStatus, statusLabel } from "./orderStatus";

describe("isPresetStatus", () => {
  it("returns true for every preset status", () => {
    for (const status of ORDER_STATUSES) {
      expect(isPresetStatus(status)).toBe(true);
    }
  });

  it("returns false for a custom status", () => {
    expect(isPresetStatus("awaiting customs")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isPresetStatus("")).toBe(false);
  });
});

describe("statusLabel", () => {
  it("capitalizes the first letter", () => {
    expect(statusLabel("delivered")).toBe("Delivered");
    expect(statusLabel("returned")).toBe("Returned");
  });

  it("capitalizes custom status strings the same way", () => {
    expect(statusLabel("awaiting customs")).toBe("Awaiting customs");
  });

  it("returns an empty string unchanged", () => {
    expect(statusLabel("")).toBe("");
  });
});
