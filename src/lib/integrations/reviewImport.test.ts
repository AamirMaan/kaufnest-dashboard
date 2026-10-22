import { invalidImportItems, unknownProductIds } from "./reviewImport";

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

describe("unknownProductIds", () => {
  it("returns distinct ids missing from the known set", () => {
    expect(
      unknownProductIds({ a: "p1", b: "p2", c: "p2", d: "p3" }, new Set(["p1"]))
    ).toEqual(["p2", "p3"]);
  });
  it("returns [] when every id is known or there are no links", () => {
    expect(unknownProductIds({ a: "p1" }, new Set(["p1"]))).toEqual([]);
    expect(unknownProductIds({}, new Set())).toEqual([]);
  });
});
