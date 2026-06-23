export type VatMode = "inclusive" | "exclusive";
export type FulfillmentMethod = "fba" | "fbm";

export interface EbayCalcInput {
  sellingPrice: number;
  vatMode: VatMode;
  vatRate: number;
  purchaseCost: number;
  fvfRate: number;
  fvfFlatFee: number;
  shippingCost: number;
  advertisingRate: number;
}

export interface AmazonCalcInput {
  sellingPrice: number;
  vatMode: VatMode;
  vatRate: number;
  purchaseCost: number;
  referralFeeRate: number;
  fulfillmentMethod: FulfillmentMethod;
  fbaFulfillmentFee: number;
  fbaStorageFee: number;
  shippingCost: number;
  advertisingRate: number;
}

export interface CalcBreakdown {
  platformFee: number;
  vatCollected: number;
  fixedCosts: number;
  advertisingCost: number;
}

export interface CalcResult {
  grossPrice: number;
  profit: number;
  profitMargin: number;
  minSellingPrice: number;
  breakdown: CalcBreakdown;
}

interface NormalizedInput {
  sellingPrice: number;
  vatMode: VatMode;
  vatRate: number;
  platformFeeRate: number;
  flatFee: number;
  purchaseCost: number;
  fixedCosts: number;
  advertisingRate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compute(input: NormalizedInput): CalcResult {
  const {
    sellingPrice,
    vatMode,
    vatRate,
    platformFeeRate,
    flatFee,
    purchaseCost,
    fixedCosts,
    advertisingRate,
  } = input;

  const grossPrice =
    vatMode === "inclusive" ? sellingPrice : sellingPrice * (1 + vatRate);

  const vatCollected = round2(grossPrice * vatRate / (1 + vatRate));
  const platformFee  = round2(grossPrice * platformFeeRate + flatFee);
  const advertisingCost = round2(grossPrice * advertisingRate);

  const profit = round2(
    grossPrice - platformFee - vatCollected - purchaseCost - fixedCosts - advertisingCost
  );
  const profitMargin = grossPrice > 0 ? round2((profit / grossPrice) * 100) : 0;

  // Algebraic break-even: solve profit = 0 for grossPrice
  const divisor = 1 - platformFeeRate - advertisingRate - vatRate / (1 + vatRate);
  const minGrossPrice = divisor > 0
    ? round2((purchaseCost + flatFee + fixedCosts) / divisor)
    : Infinity;

  const minSellingPrice =
    vatMode === "inclusive" ? minGrossPrice : round2(minGrossPrice / (1 + vatRate));

  return {
    grossPrice: round2(grossPrice),
    profit,
    profitMargin,
    minSellingPrice,
    breakdown: { platformFee, vatCollected, fixedCosts: round2(fixedCosts), advertisingCost },
  };
}

export function calcEbayResult(input: EbayCalcInput): CalcResult {
  return compute({
    sellingPrice: input.sellingPrice,
    vatMode: input.vatMode,
    vatRate: input.vatRate,
    platformFeeRate: input.fvfRate,
    flatFee: input.fvfFlatFee,
    purchaseCost: input.purchaseCost,
    fixedCosts: input.shippingCost,
    advertisingRate: input.advertisingRate,
  });
}

export function calcAmazonResult(input: AmazonCalcInput): CalcResult {
  const fixedCosts =
    input.fulfillmentMethod === "fba"
      ? input.fbaFulfillmentFee + input.fbaStorageFee
      : input.shippingCost;

  return compute({
    sellingPrice: input.sellingPrice,
    vatMode: input.vatMode,
    vatRate: input.vatRate,
    platformFeeRate: input.referralFeeRate,
    flatFee: 0,
    purchaseCost: input.purchaseCost,
    fixedCosts,
    advertisingRate: input.advertisingRate,
  });
}
