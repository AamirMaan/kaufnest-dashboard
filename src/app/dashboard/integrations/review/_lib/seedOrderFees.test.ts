import { seedOrderFees } from "./seedOrderFees";
import type { ReviewResponse } from "@/app/api/integrations/review/route";

const order = (id: string, extra: object) => ({
  external_order_id: id, product_name: "x", quantity: 1, unit_price: 1, total_amount: 1, currency: "EUR",
  date: "2026-10-01", status: "pending", description: null, imported: false, connection_id: "c1", account_name: "Shop",
  ...extra,
});

describe("seedOrderFees", () => {
  it("prefills fees for not-yet-imported orders as strings, leaving nulls blank", () => {
    const data = { ebay: { orders: [order("O1:L1", { fees: { platformFee: 1.2, advertisingFee: null } })] } } as ReviewResponse;
    expect(seedOrderFees(data, {})).toEqual({ "O1:L1": { platformFee: "1.2", advertisingFee: "" } });
  });

  it("skips imported orders and orders without fees, and never overwrites existing state", () => {
    const data = {
      ebay: { orders: [
        order("A", { imported: true, fees: { platformFee: 1, advertisingFee: 1 } }),
        order("B", {}),
        order("C", { fees: { platformFee: 9, advertisingFee: 9 } }),
      ] },
    } as ReviewResponse;
    const prev = { C: { platformFee: "2", advertisingFee: "" } };
    expect(seedOrderFees(data, prev)).toEqual(prev);
  });
});
