import { scoreListing } from "./listingQuality";
import type { DraftFormState } from "./wizardValidation";

const emptyDraft: DraftFormState = {
  source_type: "inventory", product_id: "", source_url: "",
  title: "", description: "", price: "0", currency: "EUR",
  quantity: "1", condition: "new", category_id: "", category_name: "",
  image_urls: [], aspects: {}, required_aspect_names: [],
  fulfillment_policy_id: "", payment_policy_id: "",
  return_policy_id: "", merchant_location_key: "",
};

const goodDraft: DraftFormState = {
  ...emptyDraft,
  title: "Logitech MX Master 3S Wireless Mouse Bluetooth USB-C Graphite Boxed",
  description: "x".repeat(400),
  price: "79.99",
  category_id: "12345",
  image_urls: Array.from({ length: 8 }, (_, i) => `https://x/${i}.jpg`),
  required_aspect_names: ["Brand"],
  aspects: { Brand: "Logitech" },
  fulfillment_policy_id: "f1", payment_policy_id: "p1",
  return_policy_id: "r1", merchant_location_key: "loc1",
};

describe("scoreListing", () => {
  it("scores an empty draft at zero", () => {
    expect(scoreListing(emptyDraft).score).toBe(0);
  });

  it("scores a complete, well-formed draft at 100", () => {
    expect(scoreListing(goodDraft).score).toBe(100);
  });

  it("never returns a score outside 0-100", () => {
    for (const draft of [emptyDraft, goodDraft]) {
      const { score } = scoreListing(draft);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("fails the title check for a short title", () => {
    const { checks } = scoreListing({ ...goodDraft, title: "Mouse" });
    expect(checks.find((c) => c.id === "title")?.passed).toBe(false);
  });

  it("passes the title check at exactly 60 characters", () => {
    const { checks } = scoreListing({ ...goodDraft, title: "x".repeat(60) });
    expect(checks.find((c) => c.id === "title")?.passed).toBe(true);
  });

  it("fails the images check below six images", () => {
    const { checks } = scoreListing({
      ...goodDraft,
      image_urls: ["a", "b", "c", "d", "e"],
    });
    expect(checks.find((c) => c.id === "images")?.passed).toBe(false);
  });

  it("fails the aspects check when a required aspect is blank", () => {
    const { checks } = scoreListing({ ...goodDraft, aspects: { Brand: "  " } });
    expect(checks.find((c) => c.id === "aspects")?.passed).toBe(false);
  });

  it("passes the aspects check when the category requires none", () => {
    const { checks } = scoreListing({
      ...goodDraft,
      required_aspect_names: [],
      aspects: {},
    });
    expect(checks.find((c) => c.id === "aspects")?.passed).toBe(true);
  });

  it("gives every failing check an actionable hint", () => {
    for (const check of scoreListing(emptyDraft).checks) {
      expect(check.hint.length).toBeGreaterThan(0);
    }
  });
});
