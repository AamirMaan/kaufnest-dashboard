/**
 * eBay's `shippingCarrierCode` is a fixed enum, not free text. This is the
 * common subset good enough for v1 — extend the array later if a seller
 * needs another carrier eBay supports.
 */
export const EBAY_CARRIER_CODES = [
  { code: "USPS", label: "USPS" },
  { code: "UPS", label: "UPS" },
  { code: "FEDEX", label: "FedEx" },
  { code: "DHL", label: "DHL" },
  { code: "OTHER", label: "Other" },
] as const;

export type EbayCarrierCode = (typeof EBAY_CARRIER_CODES)[number]["code"];
