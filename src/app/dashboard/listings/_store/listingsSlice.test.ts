import {
  listingsSlice,
  hydrateListingDrafts,
  addListingDraft,
  updateListingDraft,
  removeListingDraft,
  fetchListingsPage,
} from "./listingsSlice";
import type { EbayListingDraft } from "@/types";

const makeDraft = (overrides: Partial<EbayListingDraft> = {}): EbayListingDraft => ({
  id: "draft-1",
  source_type: "inventory",
  product_id: "product-1",
  source_url: null,
  source_platform: null,
  title: "Wireless Mouse",
  description: null,
  price: 19.99,
  currency: "EUR",
  quantity: 5,
  condition: "new",
  category_id: null,
  category_name: null,
  image_urls: [],
  fulfillment_policy_id: null,
  payment_policy_id: null,
  return_policy_id: null,
  merchant_location_key: null,
  ebay_sku: null,
  status: "draft",
  ebay_offer_id: null,
  ebay_listing_id: null,
  publish_error: null,
  created_by: "user-1",
  created_at: "2026-07-20T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
  ...overrides,
});

describe("listingsSlice", () => {
  const { reducer } = listingsSlice;

  it("starts empty with loaded=false and pagination defaults", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
  });

  it("hydrates listings via hydrateListingDrafts (hydratePage alias)", () => {
    const state = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(1);
  });

  it("prepends a new draft via addListingDraft and increments total", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(base, addListingDraft(makeDraft({ id: "draft-new" })));
    expect(state.items[0].id).toBe("draft-new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("updates an existing draft", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({ data: [makeDraft()], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(base, updateListingDraft(makeDraft({ status: "published" })));
    expect(state.items[0].status).toBe("published");
  });

  it("removes a draft by id and decrements total", () => {
    const base = reducer(
      undefined,
      hydrateListingDrafts({
        data: [makeDraft({ id: "d1" }), makeDraft({ id: "d2" })],
        count: 2,
        page: 1,
        pageSize: 50,
      })
    );
    const state = reducer(base, removeListingDraft("d1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("d2");
    expect(state.total).toBe(1);
  });

  it("sets isFetching=true on fetchListingsPage.pending", () => {
    const state = reducer(
      undefined,
      fetchListingsPage.pending("req-id", { page: 1, pageSize: 50 })
    );
    expect(state.isFetching).toBe(true);
  });

  it("applies page data on fetchListingsPage.fulfilled", () => {
    const payload = { data: [makeDraft({ id: "d3" })], count: 4, page: 2, pageSize: 50 };
    const state = reducer(
      undefined,
      fetchListingsPage.fulfilled(payload, "req-id", { page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(4);
    expect(state.page).toBe(2);
    expect(state.isFetching).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("clears isFetching on fetchListingsPage.rejected", () => {
    const pending = reducer(
      undefined,
      fetchListingsPage.pending("req-id", { page: 1, pageSize: 50 })
    );
    const state = reducer(
      pending,
      fetchListingsPage.rejected(new Error("fail"), "req-id", { page: 1, pageSize: 50 })
    );
    expect(state.isFetching).toBe(false);
  });
});
