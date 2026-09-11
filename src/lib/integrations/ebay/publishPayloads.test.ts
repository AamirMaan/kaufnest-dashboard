import {
  buildInventoryItemPayload,
  buildOfferPayload,
  buildAdPayload,
  buildCampaignPayload,
  buildVolumeDiscountPayload,
  multiBuyTiersFromDraft,
} from "./publishPayloads";
import type { EbayListingDraft } from "@/types";

function makeDraft(overrides: Partial<EbayListingDraft> = {}): EbayListingDraft {
  return {
    id: "draft-1",
    source_type: "inventory",
    product_id: "product-1",
    source_url: null,
    source_platform: null,
    title: "Wireless Mouse",
    description: "A great mouse.",
    price: 19.99,
    currency: "EUR",
    quantity: 5,
    condition: "new",
    category_id: "9355",
    category_name: "Cell Phones",
    image_urls: ["https://example.com/img.jpg"],
    aspects: { Brand: "Acme" },
    origin: "app",
    fulfillment_policy_id: "fp-1",
    payment_policy_id: "pp-1",
    return_policy_id: "rp-1",
    merchant_location_key: "loc-1",
    ebay_sku: "KNabc123def456",
    status: "draft",
    ebay_offer_id: null,
    ebay_listing_id: null,
    publish_error: null,
    vat_percentage: null,
    best_offer_enabled: false,
    best_offer_auto_accept: null,
    best_offer_auto_decline: null,
    multibuy_2_pct: null,
    multibuy_3_pct: null,
    multibuy_4_pct: null,
    ad_rate: null,
    ad_campaign_id: null,
    ebay_ad_id: null,
    ebay_promotion_id: null,
    marketing_error: null,
    created_by: "user-1",
    created_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildInventoryItemPayload", () => {
  it("maps a new-condition draft to the eBay InventoryItem shape", () => {
    const payload = buildInventoryItemPayload(makeDraft());
    expect(payload).toEqual({
      availability: { shipToLocationAvailability: { quantity: 5 } },
      condition: "NEW",
      product: {
        title: "Wireless Mouse",
        description: "A great mouse.",
        imageUrls: ["https://example.com/img.jpg"],
        aspects: { Brand: ["Acme"] },
      },
    });
  });

  it("maps multiple required aspects, each wrapped in a single-element array", () => {
    const payload = buildInventoryItemPayload(
      makeDraft({ aspects: { Brand: "Acme", Type: "Wireless" } })
    );
    expect(payload.product.aspects).toEqual({ Brand: ["Acme"], Type: ["Wireless"] });
  });

  it("omits an aspect with an empty value rather than sending an empty string", () => {
    const payload = buildInventoryItemPayload(makeDraft({ aspects: { Brand: "" } }));
    expect(payload.product.aspects).toEqual({});
  });

  it("sends no aspects when the category has none required", () => {
    const payload = buildInventoryItemPayload(makeDraft({ aspects: {} }));
    expect(payload.product.aspects).toEqual({});
  });

  it("maps used and refurbished conditions to their eBay enum values", () => {
    expect(buildInventoryItemPayload(makeDraft({ condition: "used" })).condition).toBe(
      "USED_EXCELLENT"
    );
    expect(
      buildInventoryItemPayload(makeDraft({ condition: "refurbished" })).condition
    ).toBe("CERTIFIED_REFURBISHED");
  });

  it("defaults description to an empty string when null", () => {
    const payload = buildInventoryItemPayload(makeDraft({ description: null }));
    expect(payload.product.description).toBe("");
  });
});

describe("buildOfferPayload", () => {
  it("maps a draft to the eBay Offer shape", () => {
    const payload = buildOfferPayload(makeDraft(), "EBAY_DE", "LOC-1");
    expect(payload).toEqual({
      sku: "KNabc123def456",
      marketplaceId: "EBAY_DE",
      format: "FIXED_PRICE",
      availableQuantity: 5,
      categoryId: "9355",
      listingDescription: "A great mouse.",
      pricingSummary: { price: { value: "19.99", currency: "EUR" } },
      listingPolicies: {
        fulfillmentPolicyId: "fp-1",
        paymentPolicyId: "pp-1",
        returnPolicyId: "rp-1",
      },
      merchantLocationKey: "LOC-1",
    });
  });

  it("falls back to title as the listing description when description is null", () => {
    const payload = buildOfferPayload(makeDraft({ description: null }), "EBAY_DE", "LOC-1");
    expect(payload.listingDescription).toBe("Wireless Mouse");
  });

  it("formats price with exactly two decimal places", () => {
    const payload = buildOfferPayload(makeDraft({ price: 20 }), "EBAY_DE", "LOC-1");
    expect(payload.pricingSummary.price.value).toBe("20.00");
  });
});

describe("description sanitization", () => {
  it("strips active content from the inventory item description", () => {
    const draft = makeDraft({ description: '<p>Nice</p><script>evil()</script>' });
    const payload = buildInventoryItemPayload(draft);
    expect(payload.product.description).not.toContain("script");
    expect(payload.product.description).toContain("Nice");
  });

  it("strips active content from the offer listing description", () => {
    const draft = makeDraft({ description: '<p onclick="evil()">Nice</p>' });
    const payload = buildOfferPayload(draft, "EBAY_DE", "loc1");
    expect(payload.listingDescription).not.toContain("onclick");
  });

  it("still falls back to the title when the description is null", () => {
    const draft = makeDraft({ description: null });
    expect(buildOfferPayload(draft, "EBAY_DE", "loc1").listingDescription).toBe(draft.title);
  });
});

describe("buildOfferPayload — VAT and Best Offer", () => {
  it("sends neither tax nor bestOfferTerms when they are not set", () => {
    const payload = buildOfferPayload(makeDraft(), "EBAY_DE", "loc-1");
    expect(payload).not.toHaveProperty("tax");
    expect(payload.listingPolicies).not.toHaveProperty("bestOfferTerms");
  });

  it("sends VAT as tax.vatPercentage with applyTax", () => {
    const payload = buildOfferPayload(makeDraft({ vat_percentage: 19 }), "EBAY_DE", "loc-1");
    expect(payload.tax).toEqual({ vatPercentage: 19, applyTax: true });
  });

  it("sends a 0% VAT rate instead of dropping it", () => {
    const payload = buildOfferPayload(makeDraft({ vat_percentage: 0 }), "EBAY_DE", "loc-1");
    expect(payload.tax).toEqual({ vatPercentage: 0, applyTax: true });
  });

  it("enables Best Offer without thresholds", () => {
    const payload = buildOfferPayload(
      makeDraft({ best_offer_enabled: true }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies.bestOfferTerms).toEqual({ bestOfferEnabled: true });
  });

  it("formats Best Offer thresholds as two-decimal amounts in the listing currency", () => {
    const payload = buildOfferPayload(
      makeDraft({
        best_offer_enabled: true,
        best_offer_auto_accept: 18,
        best_offer_auto_decline: 15.5,
      }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies.bestOfferTerms).toEqual({
      bestOfferEnabled: true,
      autoAcceptPrice: { value: "18.00", currency: "EUR" },
      autoDeclinePrice: { value: "15.50", currency: "EUR" },
    });
  });

  it("ignores thresholds left on the row when Best Offer is off", () => {
    const payload = buildOfferPayload(
      makeDraft({ best_offer_enabled: false, best_offer_auto_accept: 18 }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies).not.toHaveProperty("bestOfferTerms");
  });
});

describe("multiBuyTiersFromDraft", () => {
  it("returns null when Buy 2 is not set", () => {
    expect(multiBuyTiersFromDraft(makeDraft())).toBeNull();
  });

  it("returns every tier, keeping unset ones null", () => {
    expect(
      multiBuyTiersFromDraft(makeDraft({ multibuy_2_pct: 2, multibuy_3_pct: 4 }))
    ).toEqual({ buy2: 2, buy3: 4, buy4: null });
  });
});

describe("buildCampaignPayload", () => {
  it("builds a cost-per-sale campaign named after its creation time", () => {
    const now = new Date("2026-09-11T14:03:22.000Z");
    expect(buildCampaignPayload("EBAY_DE", now, 13)).toEqual({
      campaignName: "Boughtopia listings 2026-09-11 14:03:22",
      marketplaceId: "EBAY_DE",
      startDate: "2026-09-11T14:03:22.000Z",
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "13.0" },
    });
  });
});

describe("buildAdPayload", () => {
  it("sends the rate as a one-decimal string", () => {
    expect(buildAdPayload("110553", 13)).toEqual({ listingId: "110553", bidPercentage: "13.0" });
    expect(buildAdPayload("110553", 16.3)).toEqual({ listingId: "110553", bidPercentage: "16.3" });
  });
});

describe("buildVolumeDiscountPayload", () => {
  const now = new Date("2026-09-11T14:03:22.000Z");

  it("prepends eBay's 0% single-item rule and orders the tiers", () => {
    const payload = buildVolumeDiscountPayload(
      "110553",
      { buy2: 2, buy3: 4, buy4: 15 },
      "EBAY_DE",
      now
    );
    expect(payload).toEqual({
      name: "Multi-buy 110553",
      description: "Buy more, save more",
      marketplaceId: "EBAY_DE",
      promotionType: "VOLUME_DISCOUNT",
      promotionStatus: "SCHEDULED",
      startDate: "2026-09-11T14:03:22.000Z",
      inventoryCriterion: {
        inventoryCriterionType: "INVENTORY_BY_VALUE",
        listingIds: ["110553"],
      },
      discountRules: [
        { ruleOrder: 1, discountSpecifier: { minQuantity: 1 }, discountBenefit: { percentageOffItem: "0" } },
        { ruleOrder: 2, discountSpecifier: { minQuantity: 2 }, discountBenefit: { percentageOffItem: "2" } },
        { ruleOrder: 3, discountSpecifier: { minQuantity: 3 }, discountBenefit: { percentageOffItem: "4" } },
        { ruleOrder: 4, discountSpecifier: { minQuantity: 4 }, discountBenefit: { percentageOffItem: "15" } },
      ],
    });
  });

  it("drops unset Buy 3 / Buy 4+ tiers", () => {
    const payload = buildVolumeDiscountPayload(
      "110553",
      { buy2: 10, buy3: null, buy4: null },
      "EBAY_DE",
      now
    );
    expect(payload.discountRules).toEqual([
      { ruleOrder: 1, discountSpecifier: { minQuantity: 1 }, discountBenefit: { percentageOffItem: "0" } },
      { ruleOrder: 2, discountSpecifier: { minQuantity: 2 }, discountBenefit: { percentageOffItem: "10" } },
    ]);
  });
});
