import { matchDeletedEbayConnections } from "./deletionMatch";

const rows = [
  { id: "c1", external_account_id: "u-1", external_username: "store_one" },
  { id: "c2", external_account_id: "u-2", external_username: "store_two" },
  { id: "legacy", external_account_id: null, external_username: null },
];

describe("matchDeletedEbayConnections", () => {
  it("matches by eBay userId", () => {
    expect(matchDeletedEbayConnections(rows, "u-2", undefined)).toEqual(["c2"]);
  });
  it("matches by username", () => {
    expect(matchDeletedEbayConnections(rows, undefined, "store_one")).toEqual(["c1"]);
  });
  it("never matches on missing identifiers", () => {
    expect(matchDeletedEbayConnections(rows, undefined, undefined)).toEqual([]);
  });
  it("leaves other accounts alone", () => {
    expect(matchDeletedEbayConnections(rows, "u-1", "store_one")).toEqual(["c1"]);
  });
  it("matches a legacy row whose external_account_id holds the username", () => {
    const legacyRows = [
      { id: "old", external_account_id: "store_old", external_username: null },
      { id: "new", external_account_id: "u-9", external_username: "store_new" },
    ];
    expect(matchDeletedEbayConnections(legacyRows, undefined, "store_old")).toEqual(["old"]);
  });
  it("returns every matching row when several connections share the identifier", () => {
    const dup = [
      { id: "a", external_account_id: "u-1", external_username: "x" },
      { id: "b", external_account_id: "u-1", external_username: "y" },
    ];
    expect(matchDeletedEbayConnections(dup, "u-1", undefined)).toEqual(["a", "b"]);
  });
});
