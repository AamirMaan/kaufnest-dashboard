import { normalizedOrderToSaleRow } from "./mapToSale";
import type { NormalizedOrder } from "./types";

describe("normalizedOrderToSaleRow", () => {
  const ebayOrder: NormalizedOrder = {
    external_order_id: "12-34567-89012:001",
    product_name: "Wireless Mouse",
    quantity: 2,
    unit_price: 9.99,
    total_amount: 19.98,
    currency: "EUR",
    date: "2026-06-01",
    status: "delivered",
    description: "eBay order 12-34567-89012",
  };

  const amazonOrder: NormalizedOrder = {
    external_order_id: "112-1234567-1234567:00000001",
    product_name: "USB-C Cable",
    quantity: 1,
    unit_price: 5.5,
    total_amount: 5.5,
    currency: "USD",
    date: "2026-06-02",
    status: "shipped",
    description: "Amazon order 112-1234567-1234567",
  };

  it("maps an eBay order to a sales insert row", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123");

    expect(row).toEqual({
      platform: "ebay",
      product_name: "Wireless Mouse",
      product_id: null,
      quantity: 2,
      unit_price: 9.99,
      total_amount: 19.98,
      currency: "EUR",
      date: "2026-06-01",
      description: "eBay order 12-34567-89012",
      created_by: "user-123",
      vat_rate: null,
      vat_amount: null,
      shipping_cost: null,
      shipping_charged: null,
      advertising_fee: null,
      platform_fee: null,
      status: "delivered",
      restock: false,
      refunded_amount: null,
      external_order_id: "12-34567-89012:001",
      // eBay status push-back columns — a freshly synced order has never been
      // pushed back, so all five start null and are only written by the
      // sync-status route / EditSaleModal.
      tracking_number: null,
      shipping_carrier: null,
      ebay_fulfillment_id: null,
      ebay_sync_error: null,
      ebay_synced_at: null,
    });
  });

  it("maps an Amazon order to a sales insert row", () => {
    const row = normalizedOrderToSaleRow(amazonOrder, "amazon", "user-456");

    expect(row).toEqual({
      platform: "amazon",
      product_name: "USB-C Cable",
      product_id: null,
      quantity: 1,
      unit_price: 5.5,
      total_amount: 5.5,
      currency: "USD",
      date: "2026-06-02",
      description: "Amazon order 112-1234567-1234567",
      created_by: "user-456",
      vat_rate: null,
      vat_amount: null,
      shipping_cost: null,
      shipping_charged: null,
      advertising_fee: null,
      platform_fee: null,
      status: "shipped",
      restock: false,
      refunded_amount: null,
      external_order_id: "112-1234567-1234567:00000001",
      tracking_number: null,
      shipping_carrier: null,
      ebay_fulfillment_id: null,
      ebay_sync_error: null,
      ebay_synced_at: null,
    });
  });

  it("sets shipping_cost, shipping_charged, advertising_fee, and platform_fee to null when fees is omitted (entered manually or via Review Orders later)", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123");

    expect(row.shipping_cost).toBeNull();
    expect(row.shipping_charged).toBeNull();
    expect(row.advertising_fee).toBeNull();
    expect(row.platform_fee).toBeNull();
  });

  it("uses advertisingFee/platformFee from the fees argument when provided (Review Orders per-order or bulk-percent entry)", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123", {
      advertisingFee: 1.5,
      platformFee: 2.4,
    });

    expect(row.advertising_fee).toBe(1.5);
    expect(row.platform_fee).toBe(2.4);
    // shipping stays null even when fees are supplied — that's still a
    // manual Edit Sale step, unrelated to Review Orders' fee entry.
    expect(row.shipping_cost).toBeNull();
    expect(row.shipping_charged).toBeNull();
  });

  it("falls back to null for either fee individually when only one is provided", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123", {
      advertisingFee: 1.5,
      platformFee: null,
    });

    expect(row.advertising_fee).toBe(1.5);
    expect(row.platform_fee).toBeNull();
  });

  it("falls back to EUR for an unrecognized currency code", () => {
    const row = normalizedOrderToSaleRow({ ...ebayOrder, currency: "JPY" }, "ebay", "user-123");

    expect(row.currency).toBe("EUR");
  });
});
