import { hasMessagingAndListings } from "./planGating";

describe("hasMessagingAndListings", () => {
  it("is true only for the business plan", () => {
    expect(hasMessagingAndListings("business")).toBe(true);
    expect(hasMessagingAndListings("pro")).toBe(false);
    expect(hasMessagingAndListings("starter")).toBe(false);
    expect(hasMessagingAndListings("trial")).toBe(false);
  });
});
