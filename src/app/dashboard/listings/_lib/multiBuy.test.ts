import { multiBuyPreviewLines } from "./multiBuy";
import { EMPTY_PRICING_MARKETING, type DraftFormState } from "./wizardValidation";

function draft(overrides: Partial<DraftFormState> = {}): DraftFormState {
  return {
    ...EMPTY_PRICING_MARKETING,
    source_type: "inventory",
    product_id: "",
    source_url: "",
    title: "",
    description: "",
    price: "16.62",
    currency: "EUR",
    quantity: "5",
    condition: "new",
    category_id: "",
    category_name: "",
    image_urls: [],
    aspects: {},
    required_aspect_names: [],
    fulfillment_policy_id: "",
    payment_policy_id: "",
    return_policy_id: "",
    merchant_location_key: "",
    ...overrides,
  };
}

describe("multiBuyPreviewLines", () => {
  it("is empty while multi-buy is off, even with tiers left in state", () => {
    expect(multiBuyPreviewLines(draft({ multibuy_2_pct: "2" }))).toEqual([]);
  });

  it("lists each set tier", () => {
    expect(
      multiBuyPreviewLines(
        draft({ multibuy_enabled: true, multibuy_2_pct: "2", multibuy_3_pct: "4", multibuy_4_pct: "15" })
      )
    ).toEqual(["Buy 2, save 2%", "Buy 3, save 4%", "Buy 4 or more, save 15%"]);
  });

  it("skips unset tiers", () => {
    expect(multiBuyPreviewLines(draft({ multibuy_enabled: true, multibuy_2_pct: "10" }))).toEqual([
      "Buy 2, save 10%",
    ]);
  });
});
