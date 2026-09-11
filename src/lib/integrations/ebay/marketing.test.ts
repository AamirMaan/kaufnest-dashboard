import {
  filterManualCampaigns,
  idFromLocation,
  fetchManualCampaigns,
  runMarketingSteps,
  RECONNECT_MESSAGE,
  type MarketingApi,
  type MarketingPatch,
  type RawCampaign,
} from "./marketing";
import type { EbayListingDraft } from "@/types";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function campaign(overrides: Partial<RawCampaign> = {}): RawCampaign {
  return {
    campaignId: "c-1",
    campaignName: "Campaign 13.05.2026 17:18:00",
    campaignStatus: "RUNNING",
    marketplaceId: "EBAY_DE",
    fundingStrategy: { fundingModel: "COST_PER_SALE" },
    ...overrides,
  };
}

describe("filterManualCampaigns", () => {
  it("keeps running and scheduled cost-per-sale campaigns on the marketplace", () => {
    const result = filterManualCampaigns(
      [campaign(), campaign({ campaignId: "c-2", campaignName: "Later", campaignStatus: "SCHEDULED" })],
      "EBAY_DE"
    );
    expect(result).toEqual([
      { id: "c-1", name: "Campaign 13.05.2026 17:18:00" },
      { id: "c-2", name: "Later" },
    ]);
  });

  it("drops rules-based, ended, other-marketplace and cost-per-click campaigns", () => {
    const result = filterManualCampaigns(
      [
        campaign({ campaignId: "rules", campaignCriterion: { selectionRules: [{}] } }),
        campaign({ campaignId: "ended", campaignStatus: "ENDED" }),
        campaign({ campaignId: "gb", marketplaceId: "EBAY_GB" }),
        campaign({ campaignId: "cpc", fundingStrategy: { fundingModel: "COST_PER_CLICK" } }),
      ],
      "EBAY_DE"
    );
    expect(result).toEqual([]);
  });

  it("keeps a campaign whose criterion has no selection rules", () => {
    const result = filterManualCampaigns(
      [campaign({ campaignCriterion: { selectionRules: [] } })],
      "EBAY_DE"
    );
    expect(result).toHaveLength(1);
  });
});

describe("idFromLocation", () => {
  it("returns the last path segment", () => {
    expect(
      idFromLocation("https://api.ebay.com/sell/marketing/v1/ad_campaign/123/ad/456")
    ).toBe("456");
  });

  it("throws when eBay sends no Location header", () => {
    expect(() => idFromLocation(null)).toThrow("did not return");
  });
});

describe("fetchManualCampaigns", () => {
  it("maps a 403 to needsReconnect instead of throwing", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [],
      needsReconnect: true,
    });
  });

  it("treats 204 No Content as an empty list", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [],
      needsReconnect: false,
    });
  });

  it("returns the filtered campaigns", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ campaigns: [campaign(), campaign({ campaignId: "x", campaignStatus: "ENDED" })] }),
    }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [{ id: "c-1", name: "Campaign 13.05.2026 17:18:00" }],
      needsReconnect: false,
    });
  });
});

function draft(overrides: Partial<EbayListingDraft> = {}): EbayListingDraft {
  return {
    id: "draft-1",
    source_type: "inventory",
    product_id: "p-1",
    source_url: null,
    source_platform: null,
    title: "Wallet",
    description: null,
    price: 16.62,
    currency: "EUR",
    quantity: 5,
    condition: "new",
    category_id: "45258",
    category_name: "Wallets",
    image_urls: [],
    aspects: {},
    origin: "app",
    fulfillment_policy_id: "fp",
    payment_policy_id: "pp",
    return_policy_id: "rp",
    merchant_location_key: "loc",
    ebay_sku: "KN1",
    status: "published",
    ebay_offer_id: "o-1",
    ebay_listing_id: "110553",
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
    created_by: "u-1",
    created_at: "2026-09-11T10:00:00.000Z",
    updated_at: "2026-09-11T10:00:00.000Z",
    ...overrides,
  };
}

function fakeApi(overrides: Partial<MarketingApi> = {}): jest.Mocked<MarketingApi> {
  return {
    createCampaign: jest.fn().mockResolvedValue("new-campaign"),
    addListingToCampaign: jest.fn().mockResolvedValue("ad-1"),
    createVolumeDiscount: jest.fn().mockResolvedValue("promo-1"),
    ...overrides,
  } as jest.Mocked<MarketingApi>;
}

describe("runMarketingSteps", () => {
  it("does nothing and writes nothing when no marketing is requested", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    await expect(runMarketingSteps(draft(), "110553", api, persist)).resolves.toEqual([]);
    expect(api.addListingToCampaign).not.toHaveBeenCalled();
    expect(api.createVolumeDiscount).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("adds the ad to the chosen campaign and records the ad id", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1" }),
      "110553",
      api,
      persist
    );
    expect(warnings).toEqual([]);
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(api.addListingToCampaign).toHaveBeenCalledWith("c-1", "110553", 13);
    expect(persist).toHaveBeenCalledWith({ ebay_ad_id: "ad-1" });
  });

  it("creates a campaign when none was chosen and saves its id before adding the ad", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    await runMarketingSteps(draft({ ad_rate: 13 }), "110553", api, persist);
    expect(api.createCampaign).toHaveBeenCalledWith(13);
    expect(persist.mock.calls[0][0]).toEqual({ ad_campaign_id: "new-campaign" });
    expect(api.addListingToCampaign).toHaveBeenCalledWith("new-campaign", "110553", 13);
    expect(persist).toHaveBeenCalledWith({ ebay_ad_id: "ad-1" });
  });

  it("creates the volume discount and records the promotion id", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ multibuy_2_pct: 2, multibuy_3_pct: 4, multibuy_4_pct: 15 }),
      "110553",
      api,
      persist
    );
    expect(api.createVolumeDiscount).toHaveBeenCalledWith("110553", { buy2: 2, buy3: 4, buy4: 15 });
    expect(persist).toHaveBeenCalledWith({ ebay_promotion_id: "promo-1" });
  });

  it("skips steps whose eBay id is already stored", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", ebay_ad_id: "ad-0", multibuy_2_pct: 2, ebay_promotion_id: "promo-0" }),
      "110553",
      api,
      persist
    );
    expect(api.addListingToCampaign).not.toHaveBeenCalled();
    expect(api.createVolumeDiscount).not.toHaveBeenCalled();
  });

  it("still runs multi-buy when the ad fails, and records the failure", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error("rate too low")),
    });
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", multibuy_2_pct: 2 }),
      "110553",
      api,
      persist
    );
    expect(api.createVolumeDiscount).toHaveBeenCalled();
    expect(warnings).toEqual(["The ad couldn't be added: rate too low"]);
    expect(persist).toHaveBeenCalledWith({
      marketing_error: "The ad couldn't be added: rate too low",
    });
  });

  it("collects both failures", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error(RECONNECT_MESSAGE)),
      createVolumeDiscount: jest.fn().mockRejectedValue(new Error(RECONNECT_MESSAGE)),
    });
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", multibuy_2_pct: 2 }),
      "110553",
      api,
      persist
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toBe(`The multi-buy discount couldn't be created: ${RECONNECT_MESSAGE}`);
  });

  it("clears a previous marketing_error once everything succeeds", async () => {
    const api = fakeApi();
    const persist = jest.fn<Promise<void>, [MarketingPatch]>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", marketing_error: "old failure" }),
      "110553",
      api,
      persist
    );
    expect(persist).toHaveBeenLastCalledWith({ marketing_error: null });
  });

  it("never throws when saving the final marketing_error fails", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const persist = jest
      .fn<Promise<void>, [MarketingPatch]>()
      .mockRejectedValue(new Error("db down"));
    await expect(
      runMarketingSteps(draft({ ad_rate: 13, ad_campaign_id: "c-1" }), "110553", api, persist)
    ).resolves.toEqual(["The ad couldn't be added: boom"]);
  });
});
