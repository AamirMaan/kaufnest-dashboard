import { invalidImportItems } from "./reviewImport";

const active = new Map([
  ["ebay" as const, new Set(["e1", "e2"])],
  ["amazon" as const, new Set(["a1"])],
]);

describe("invalidImportItems", () => {
  it("accepts items whose account is active on their platform", () => {
    expect(invalidImportItems([{ platform: "ebay", order: { connection_id: "e2" } }], active)).toEqual([]);
  });
  it("rejects a missing, paused/unknown, or cross-platform account", () => {
    const items = [
      { platform: "ebay" as const, order: {} },
      { platform: "ebay" as const, order: { connection_id: "e9" } },
      { platform: "ebay" as const, order: { connection_id: "a1" } },
    ];
    expect(invalidImportItems(items, active)).toEqual([0, 1, 2]);
  });
});
