import { calcEbayResult, calcAmazonResult } from "./calculations";

describe("calcEbayResult", () => {
  const base = {
    vatMode: "inclusive" as const,
    vatRate: 0.20,
    purchaseCost: 10,
    fvfRate: 0.128,
    fvfFlatFee: 0.30,
    shippingCost: 3,
    advertisingRate: 0,
    customChargeRate: 0,
    customChargeFixed: 0,
  };

  it("computes profit correctly (VAT-inclusive)", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50 });
    // grossPrice = 50
    // vatCollected = 50 * 0.20 / 1.20 = 8.33
    // platformFee = 50 * 0.128 + 0.30 = 6.70
    // profit = 50 - 6.70 - 8.33 - 10 - 3 = 21.97
    expect(result.profit).toBeCloseTo(21.97, 1);
    expect(result.grossPrice).toBe(50);
  });

  it("computes profit correctly (VAT-exclusive)", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50, vatMode: "exclusive" });
    // grossPrice = 50 * 1.20 = 60
    // vatCollected = 50 * 0.20 = 10
    // platformFee = 60 * 0.128 + 0.30 = 7.98
    // profit = 60 - 7.98 - 10 - 10 - 3 = 29.02
    expect(result.profit).toBeCloseTo(29.02, 1);
    expect(result.grossPrice).toBeCloseTo(60, 2);
  });

  it("profit margin is profit / grossPrice * 100", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50 });
    expect(result.profitMargin).toBeCloseTo((result.profit / result.grossPrice) * 100, 2);
  });

  it("minSellingPrice yields ~0 profit when used as selling price (VAT-inclusive)", () => {
    const result = calcEbayResult({ ...base, sellingPrice: base.purchaseCost });
    const minResult = calcEbayResult({ ...base, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });

  it("minSellingPrice yields ~0 profit when used as selling price (VAT-exclusive)", () => {
    const input = { ...base, sellingPrice: 10, vatMode: "exclusive" as const };
    const result = calcEbayResult(input);
    const minResult = calcEbayResult({ ...input, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });

  it("advertising cost reduces profit", () => {
    const withAds = calcEbayResult({ ...base, sellingPrice: 50, advertisingRate: 0.05 });
    const noAds   = calcEbayResult({ ...base, sellingPrice: 50, advertisingRate: 0 });
    expect(withAds.profit).toBeLessThan(noAds.profit);
    expect(withAds.breakdown.advertisingCost).toBeCloseTo(50 * 0.05, 2);
  });

  it("breakdown sums match: grossPrice - profit = total costs", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50 });
    const totalCosts =
      result.breakdown.platformFee +
      result.breakdown.vatCollected +
      result.breakdown.fixedCosts +
      result.breakdown.advertisingCost +
      result.breakdown.customCharge +
      base.purchaseCost;
    expect(result.grossPrice - result.profit).toBeCloseTo(totalCosts, 2);
  });

  it("custom charge (%) reduces profit and appears in breakdown", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50, customChargeRate: 0.029 });
    // customCharge = 50 * 0.029 = 1.45
    expect(result.breakdown.customCharge).toBeCloseTo(1.45, 2);
    const noCustom = calcEbayResult({ ...base, sellingPrice: 50 });
    expect(result.profit).toBeCloseTo(noCustom.profit - 1.45, 1);
  });

  it("custom charge (fixed) reduces profit and appears in breakdown", () => {
    const result = calcEbayResult({ ...base, sellingPrice: 50, customChargeFixed: 2.50 });
    expect(result.breakdown.customCharge).toBeCloseTo(2.50, 2);
    const noCustom = calcEbayResult({ ...base, sellingPrice: 50 });
    expect(result.profit).toBeCloseTo(noCustom.profit - 2.50, 1);
  });

  it("minSellingPrice yields ~0 profit with custom charge (%)", () => {
    const input = { ...base, sellingPrice: 10, customChargeRate: 0.029 };
    const result = calcEbayResult(input);
    const minResult = calcEbayResult({ ...input, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });

  it("minSellingPrice yields ~0 profit with custom charge (fixed)", () => {
    const input = { ...base, sellingPrice: 10, customChargeFixed: 2.50 };
    const result = calcEbayResult(input);
    const minResult = calcEbayResult({ ...input, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });
});

describe("calcAmazonResult", () => {
  const base = {
    vatMode: "inclusive" as const,
    vatRate: 0.20,
    purchaseCost: 10,
    referralFeeRate: 0.15,
    fulfillmentMethod: "fba" as const,
    fbaFulfillmentFee: 3,
    fbaStorageFee: 0.50,
    inboundFreight: 0,
    shippingCost: 0,
    advertisingRate: 0,
    customChargeRate: 0,
    customChargeFixed: 0,
  };

  it("computes profit correctly with FBA (VAT-inclusive)", () => {
    const result = calcAmazonResult({ ...base, sellingPrice: 50 });
    // grossPrice = 50
    // vatCollected = 50 * 0.20 / 1.20 = 8.33
    // platformFee = 50 * 0.15 = 7.50
    // fixedCosts = 3 + 0.50 + 0 = 3.50
    // profit = 50 - 7.50 - 8.33 - 10 - 3.50 = 20.67
    expect(result.profit).toBeCloseTo(20.67, 1);
  });

  it("FBM uses shippingCost instead of FBA fees", () => {
    const fbm = calcAmazonResult({
      ...base,
      fulfillmentMethod: "fbm",
      fbaFulfillmentFee: 0,
      fbaStorageFee: 0,
      shippingCost: 4,
      sellingPrice: 50,
    });
    expect(fbm.breakdown.fixedCosts).toBeCloseTo(4, 2);
  });

  it("inbound freight adds to FBA fixed costs", () => {
    const withFreight = calcAmazonResult({ ...base, sellingPrice: 50, inboundFreight: 1.50 });
    const noFreight   = calcAmazonResult({ ...base, sellingPrice: 50 });
    expect(withFreight.breakdown.fixedCosts).toBeCloseTo(noFreight.breakdown.fixedCosts + 1.50, 2);
    expect(withFreight.profit).toBeCloseTo(noFreight.profit - 1.50, 1);
  });

  it("inbound freight is excluded from FBM fixed costs", () => {
    const fbm = calcAmazonResult({
      ...base,
      fulfillmentMethod: "fbm",
      shippingCost: 4,
      inboundFreight: 5,
      sellingPrice: 50,
    });
    // FBM: fixedCosts = shippingCost only
    expect(fbm.breakdown.fixedCosts).toBeCloseTo(4, 2);
  });

  it("minSellingPrice yields ~0 profit (FBA, VAT-inclusive)", () => {
    const result = calcAmazonResult({ ...base, sellingPrice: base.purchaseCost });
    const minResult = calcAmazonResult({ ...base, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });

  it("minSellingPrice yields ~0 profit (FBM, VAT-exclusive)", () => {
    const input = {
      ...base,
      fulfillmentMethod: "fbm" as const,
      fbaFulfillmentFee: 0,
      fbaStorageFee: 0,
      shippingCost: 4,
      sellingPrice: 10,
      vatMode: "exclusive" as const,
    };
    const result = calcAmazonResult(input);
    const minResult = calcAmazonResult({ ...input, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });

  it("0% VAT still produces a valid result", () => {
    const result = calcAmazonResult({ ...base, sellingPrice: 50, vatRate: 0 });
    expect(result.breakdown.vatCollected).toBe(0);
    expect(Number.isFinite(result.minSellingPrice)).toBe(true);
  });

  it("custom charge (%) reduces profit and appears in breakdown", () => {
    const result    = calcAmazonResult({ ...base, sellingPrice: 50, customChargeRate: 0.03 });
    const noCustom  = calcAmazonResult({ ...base, sellingPrice: 50 });
    expect(result.breakdown.customCharge).toBeCloseTo(50 * 0.03, 2);
    expect(result.profit).toBeCloseTo(noCustom.profit - 50 * 0.03, 1);
  });

  it("custom charge (fixed) reduces profit and appears in breakdown", () => {
    const result   = calcAmazonResult({ ...base, sellingPrice: 50, customChargeFixed: 2 });
    const noCustom = calcAmazonResult({ ...base, sellingPrice: 50 });
    expect(result.breakdown.customCharge).toBeCloseTo(2, 2);
    expect(result.profit).toBeCloseTo(noCustom.profit - 2, 1);
  });

  it("minSellingPrice yields ~0 profit with inbound freight and custom charge", () => {
    const input = { ...base, sellingPrice: 10, inboundFreight: 1.50, customChargeFixed: 1 };
    const result = calcAmazonResult(input);
    const minResult = calcAmazonResult({ ...input, sellingPrice: result.minSellingPrice });
    expect(minResult.profit).toBeCloseTo(0, 1);
  });
});
