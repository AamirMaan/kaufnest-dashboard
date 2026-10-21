import type { ReviewResponse } from "@/app/api/integrations/review/route";

type FeeInputs = Record<string, { advertisingFee: string; platformFee: string }>;

/** eBay-reported fees as the page's editable fee inputs. Existing entries (user edits) win. */
export function seedOrderFees(data: ReviewResponse, prev: FeeInputs): FeeInputs {
  const next: FeeInputs = { ...prev };
  for (const bucket of [data.ebay, data.amazon]) {
    for (const o of bucket?.orders ?? []) {
      if (o.imported || !o.fees || next[o.external_order_id]) continue;
      next[o.external_order_id] = {
        platformFee: o.fees.platformFee === null ? "" : String(o.fees.platformFee),
        advertisingFee: o.fees.advertisingFee === null ? "" : String(o.fees.advertisingFee),
      };
    }
  }
  return next;
}
