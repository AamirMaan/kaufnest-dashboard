import { mergeImportedSale } from "./mergeImportedSale";
import type { Sale } from "@/types";

// A fully-populated existing sale (with user-owned fields filled in)
const existingSale: Sale = {
  id: "sale-001",
  platform: "ebay",
  product_name: "Wireless Mouse",
  product_id: "prod-abc",
  quantity: 2,
  unit_price: 9.99,
  total_amount: 19.98,
  currency: "EUR",
  date: "2026-06-01",
  description: "eBay order 12-34567-89012",
  created_by: "user-123",
  created_at: "2026-06-01T10:00:00Z",
  vat_rate: 19,
  vat_amount: 3.19,
  shipping_cost: 2.5,
  shipping_charged: 4.99,
  advertising_fee: 1.2,
  platform_fee: 0.8,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: "12-34567-89012:001",
  tracking_number: null,
  shipping_carrier: null,
  ebay_fulfillment_id: null,
  ebay_sync_error: null,
  ebay_synced_at: null,
  buyer_name: null,
  shipping_address_line1: null,
  shipping_address_line2: null,
  shipping_city: null,
  shipping_state: null,
  shipping_postal_code: null,
  shipping_country: null,
  buyer_phone: null,
  buyer_email: null,
};

// An incoming sync row for the same order (with different platform-owned fields,
// and nulls/defaults for user-owned fields — as normalizedOrderToSaleRow produces)
const incomingSale: Sale = {
  id: "sale-001", // same id (would be overwritten by merge, but existing wins for non-platform fields)
  platform: "ebay",
  product_name: "Wireless Mouse v2",
  product_id: null,
  quantity: 3,
  unit_price: 8.5,
  total_amount: 25.5,
  currency: "EUR",
  date: "2026-06-15",
  description: "eBay order updated",
  created_by: "user-123",
  created_at: "2026-06-01T10:00:00Z",
  vat_rate: null,
  vat_amount: null,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "shipped",
  restock: true,
  refunded_amount: null,
  external_order_id: "12-34567-89012:001",
  tracking_number: null,
  shipping_carrier: null,
  ebay_fulfillment_id: null,
  ebay_sync_error: null,
  ebay_synced_at: null,
  buyer_name: null,
  shipping_address_line1: null,
  shipping_address_line2: null,
  shipping_city: null,
  shipping_state: null,
  shipping_postal_code: null,
  shipping_country: null,
  buyer_phone: null,
  buyer_email: null,
};

describe("mergeImportedSale", () => {
  // Test 1: New order (existing=undefined) — returns incoming unchanged
  it("returns incoming unchanged when existing is undefined (new order)", () => {
    const result = mergeImportedSale(undefined, incomingSale);
    expect(result).toBe(incomingSale);
    expect(result.vat_rate).toBe(incomingSale.vat_rate);
    expect(result.product_id).toBe(incomingSale.product_id);
    expect(result.shipping_cost).toBe(incomingSale.shipping_cost);
    expect(result.shipping_charged).toBe(incomingSale.shipping_charged);
    expect(result.advertising_fee).toBe(incomingSale.advertising_fee);
    expect(result.restock).toBe(incomingSale.restock);
  });

  // Test 2: Existing order — platform-owned fields come from incoming
  it("overwrites platform-owned fields (status, total_amount, unit_price, quantity, product_name, date, description) from incoming", () => {
    const result = mergeImportedSale(existingSale, incomingSale);

    expect(result.status).toBe(incomingSale.status);           // "shipped"
    expect(result.total_amount).toBe(incomingSale.total_amount); // 25.5
    expect(result.unit_price).toBe(incomingSale.unit_price);   // 8.5
    expect(result.quantity).toBe(incomingSale.quantity);       // 3
    expect(result.product_name).toBe(incomingSale.product_name); // "Wireless Mouse v2"
    expect(result.date).toBe(incomingSale.date);               // "2026-06-15"
    expect(result.description).toBe(incomingSale.description); // "eBay order updated"
  });

  // Test 3: Existing order — user-owned fields preserved from existing
  it("preserves user-owned fields (vat_rate, vat_amount, product_id, fee fields, restock) from existing", () => {
    const result = mergeImportedSale(existingSale, incomingSale);

    expect(result.vat_rate).toBe(existingSale.vat_rate);               // 19
    expect(result.vat_amount).toBe(existingSale.vat_amount);           // 3.19
    expect(result.product_id).toBe(existingSale.product_id);           // "prod-abc"
    expect(result.shipping_cost).toBe(existingSale.shipping_cost);     // 2.5
    expect(result.shipping_charged).toBe(existingSale.shipping_charged); // 4.99
    expect(result.advertising_fee).toBe(existingSale.advertising_fee); // 1.2
    expect(result.platform_fee).toBe(existingSale.platform_fee);       // 0.8
    expect(result.restock).toBe(existingSale.restock);                 // false
  });

  // Test 4: Partial incoming — null platform field wins over existing value
  it("takes null from incoming for a platform-owned field (platform null update wins)", () => {
    const incomingWithNullDesc: Sale = { ...incomingSale, description: null };
    const result = mergeImportedSale(existingSale, incomingWithNullDesc);

    // description is platform-owned, so null from incoming must win
    expect(result.description).toBeNull();
    // user-owned fields still preserved
    expect(result.vat_rate).toBe(existingSale.vat_rate);
    expect(result.product_id).toBe(existingSale.product_id);
  });

  // Test 5: Status "returned" from incoming overwrites existing "completed"
  it("overwrites status with 'returned' when incoming.status is 'returned'", () => {
    const existingCompleted: Sale = { ...existingSale, status: "completed" };
    const incomingReturned: Sale = { ...incomingSale, status: "returned" };

    const result = mergeImportedSale(existingCompleted, incomingReturned);

    expect(result.status).toBe("returned");
    // user-owned fields still preserved from existing
    expect(result.vat_rate).toBe(existingSale.vat_rate);
    expect(result.product_id).toBe(existingSale.product_id);
  });
});
