import { addressFromCompanyProfile, addressFromSale } from "./addressMappers";
import type { CompanyProfile, Sale } from "@/types";

const completeProfile: CompanyProfile = {
  id: "cp1",
  name: "KaufNest GmbH",
  logo_url: null,
  vat_number: null,
  tax_id: null,
  address: null,
  phone: "+49123456",
  email: "shop@kaufnest.example",
  currency: "EUR",
  timezone: "Europe/Berlin",
  vat_rate: 19,
  bank_name: null,
  iban: null,
  bic: null,
  invoice_prefix: "INV-",
  payment_terms: "30 days",
  footer_notes: null,
  updated_at: "2026-09-04T00:00:00Z",
  ship_from_street1: "Hauptstr 1",
  ship_from_street2: null,
  ship_from_city: "Berlin",
  ship_from_state: null,
  ship_from_postal_code: "10115",
  ship_from_country: "DE",
};

describe("addressFromCompanyProfile", () => {
  it("maps a complete ship-from address", () => {
    expect(addressFromCompanyProfile(completeProfile)).toEqual({
      name: "KaufNest GmbH",
      street1: "Hauptstr 1",
      street2: null,
      city: "Berlin",
      state: null,
      zip: "10115",
      country: "DE",
      phone: "+49123456",
      email: "shop@kaufnest.example",
    });
  });

  it("throws naming the missing field when ship_from_street1 is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_street1: null })
    ).toThrow(/street address/);
  });

  it("throws naming the missing field when ship_from_city is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_city: null })
    ).toThrow(/city/);
  });

  it("throws naming the missing field when ship_from_postal_code is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_postal_code: null })
    ).toThrow(/postal code/);
  });

  it("throws naming the missing field when ship_from_country is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_country: null })
    ).toThrow(/country/);
  });
});

const completeSale: Sale = {
  id: "s1",
  platform: "ebay",
  product_name: "Widget",
  product_id: null,
  quantity: 1,
  unit_price: 10,
  total_amount: 10,
  currency: "EUR",
  date: "2026-09-01",
  description: null,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
  vat_rate: null,
  vat_amount: null,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: null,
  buyer_name: "Jane Buyer",
  shipping_address_line1: "5th Ave 1",
  shipping_address_line2: null,
  shipping_city: "New York",
  shipping_state: "NY",
  shipping_postal_code: "10001",
  shipping_country: "US",
  buyer_phone: null,
  buyer_email: "jane@example.com",
  tracking_number: null,
  shipping_carrier: null,
  ebay_fulfillment_id: null,
  ebay_sync_error: null,
  ebay_synced_at: null,
};

describe("addressFromSale", () => {
  it("maps a complete buyer shipping address", () => {
    expect(addressFromSale(completeSale)).toEqual({
      name: "Jane Buyer",
      street1: "5th Ave 1",
      street2: null,
      city: "New York",
      state: "NY",
      zip: "10001",
      country: "US",
      phone: null,
      email: "jane@example.com",
    });
  });

  it("throws naming the missing field when shipping_address_line1 is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_address_line1: null })).toThrow(
      /street address/
    );
  });

  it("throws naming the missing field when shipping_city is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_city: null })).toThrow(/city/);
  });

  it("throws naming the missing field when shipping_postal_code is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_postal_code: null })).toThrow(
      /postal code/
    );
  });

  it("throws naming the missing field when shipping_country is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_country: null })).toThrow(/country/);
  });
});
