import { computeMarginPct, marginBadgeVariant } from "./marginMath";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Test Listing",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 25.99,
  currency: "EUR",
  sku: "SKU-001",
  source_url: null,
  source_platform: null,
  supplier_price: null,
  supplier_currency: null,
  supplier_price_checked_at: null,
  customs_tax_rate: null,
  customs_tax_amount: null,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});

describe("computeMarginPct", () => {
  it("returns null when supplier_price is not set", () => {
    const listing = makeListing({ supplier_price: null });
    expect(computeMarginPct(listing)).toBeNull();
  });

  it("returns null when currencies do not match", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 10,
      supplier_currency: "USD",
    });
    expect(computeMarginPct(listing)).toBeNull();
  });

  it("computes gross margin percentage without customs tax", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_rate: null,
      customs_tax_amount: null,
    });
    // (20 - 16) / 20 * 100 = 20
    expect(computeMarginPct(listing)).toBeCloseTo(20);
  });

  it("factors customs_tax_amount into effective cost", () => {
    const listing = makeListing({
      current_price: 20,
      currency: "EUR",
      supplier_price: 16,
      supplier_currency: "EUR",
      customs_tax_rate: 12.5,
      customs_tax_amount: 2, // 16 * 12.5 / 100 = 2
    });
    // effective_cost = 16 + 2 = 18; (20 - 18) / 20 * 100 = 10
    expect(computeMarginPct(listing)).toBeCloseTo(10);
  });

  it("allows a negative margin when cost exceeds selling price", () => {
    const listing = makeListing({
      current_price: 10,
      currency: "EUR",
      supplier_price: 9,
      supplier_currency: "EUR",
      customs_tax_rate: 20,
      customs_tax_amount: 1.8,
    });
    // effective_cost = 9 + 1.8 = 10.8; (10 - 10.8) / 10 * 100 = -8
    expect(computeMarginPct(listing)).toBeCloseTo(-8);
  });
});

describe("marginBadgeVariant", () => {
  it("returns danger below 10%", () => {
    expect(marginBadgeVariant(9.99)).toBe("danger");
    expect(marginBadgeVariant(-5)).toBe("danger");
  });

  it("returns warning at exactly 10% and below 25%", () => {
    expect(marginBadgeVariant(10)).toBe("warning");
    expect(marginBadgeVariant(24.99)).toBe("warning");
  });

  it("returns success at exactly 25% and above", () => {
    expect(marginBadgeVariant(25)).toBe("success");
    expect(marginBadgeVariant(50)).toBe("success");
  });
});
