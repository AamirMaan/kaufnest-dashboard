import { publishListing } from "./publish";
import type { EbayListingDraft } from "@/types";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function makeDraft(overrides: Partial<EbayListingDraft> = {}): EbayListingDraft {
  return {
    id: "draft-1",
    source_type: "inventory",
    product_id: null,
    source_url: null,
    source_platform: null,
    title: "Test listing",
    description: "A test listing",
    price: 19.99,
    currency: "EUR",
    quantity: 1,
    condition: "new",
    category_id: "79720",
    category_name: "Sunglasses",
    image_urls: ["https://example.com/image.jpg"],
    fulfillment_policy_id: "fp-1",
    payment_policy_id: "pp-1",
    return_policy_id: "rp-1",
    ebay_sku: "KNtest12345678",
    status: "publishing",
    ebay_offer_id: null,
    ebay_listing_id: null,
    publish_error: null,
    created_by: "user-1",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

const OK_INVENTORY_RES = { ok: true, status: 204, text: () => Promise.resolve("") };
const OK_PUBLISH_RES = {
  ok: true,
  status: 200,
  json: () => Promise.resolve({ listingId: "listing-123" }),
};
const INDEXING_LAG_RES = {
  ok: false,
  status: 400,
  text: () =>
    Promise.resolve(
      '{"errors":[{"errorId":25751,"domain":"API_INVENTORY","message":"KNtest12345678 could not be found or is not available in the system for the marketplace EBAY_DE."}]}'
    ),
};
const OK_OFFER_RES = {
  ok: true,
  status: 201,
  json: () => Promise.resolve({ offerId: "offer-1" }),
};

describe("publishListing — createOffer indexing-lag retry", () => {
  it("succeeds without retrying when createOffer works on the first attempt", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(OK_INVENTORY_RES) // PUT inventory_item
      .mockResolvedValueOnce(OK_OFFER_RES) // POST offer
      .mockResolvedValueOnce(OK_PUBLISH_RES) as unknown as typeof fetch; // POST publish

    const result = await publishListing("token", makeDraft(), "KNtest12345678", null);

    expect(result).toEqual({ offerId: "offer-1", listingId: "listing-123" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("retries createOffer after an errorId 25751 response and succeeds on the second attempt", async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(OK_INVENTORY_RES) // PUT inventory_item
      .mockResolvedValueOnce(INDEXING_LAG_RES) // POST offer — attempt 1 (indexing lag)
      .mockResolvedValueOnce(OK_OFFER_RES) // POST offer — attempt 2 (succeeds)
      .mockResolvedValueOnce(OK_PUBLISH_RES) as unknown as typeof fetch; // POST publish

    const resultPromise = publishListing("token", makeDraft(), "KNtest12345678", null);
    // First retry waits 2000ms (OFFER_INDEXING_RETRY_DELAYS_MS[0]).
    await jest.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result).toEqual({ offerId: "offer-1", listingId: "listing-123" });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("throws after exhausting retries when every createOffer attempt hits the indexing-lag error", async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(OK_INVENTORY_RES) // PUT inventory_item
      .mockResolvedValueOnce(INDEXING_LAG_RES) // POST offer — attempt 1
      .mockResolvedValueOnce(INDEXING_LAG_RES) // POST offer — attempt 2
      .mockResolvedValueOnce(INDEXING_LAG_RES) as unknown as typeof fetch; // POST offer — attempt 3 (final)

    const resultPromise = publishListing("token", makeDraft(), "KNtest12345678", null);
    const assertion = expect(resultPromise).rejects.toThrow(/eBay createOffer failed: 400/);
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(4000);
    await assertion;

    // 1 PUT + 3 createOffer attempts (initial + 2 retries), never reaches publishOffer.
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("does not retry a createOffer failure that isn't the indexing-lag error", async () => {
    const otherErrorRes = {
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"errors":[{"errorId":25002,"message":"Invalid category ID"}]}'),
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(OK_INVENTORY_RES) // PUT inventory_item
      .mockResolvedValueOnce(otherErrorRes) as unknown as typeof fetch; // POST offer — fails, not 25751

    await expect(
      publishListing("token", makeDraft(), "KNtest12345678", null)
    ).rejects.toThrow(/eBay createOffer failed: 400/);

    // No retry attempted — only the PUT and the single failed createOffer call.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
