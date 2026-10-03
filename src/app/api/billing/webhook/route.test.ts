/**
 * Route-level test for the billing webhook's plan-resolution branches only.
 * Stripe, the control client and the catalog are mocked; status mapping and
 * the deleted-event branch are out of scope here.
 */
import type { NextRequest } from "next/server";

let event: unknown;
jest.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => event } }),
}));

const update = jest.fn();
jest.mock("@/lib/supabase/control", () => ({
  createControlClient: () => ({
    schema: () => ({
      from: () => {
        const builder = {
          update: (patch: unknown) => {
            update(patch);
            return builder;
          },
          eq: () => builder,
          select: () => Promise.resolve({ data: [{ id: "t1" }], error: null }),
        };
        return builder;
      },
    }),
  }),
}));

const getPlanCatalog = jest.fn();
const getPlanPriceMap = jest.fn();
const invalidatePlanCatalog = jest.fn();
jest.mock("@/lib/plans/catalog", () => ({
  getPlanCatalog: () => getPlanCatalog(),
  getPlanPriceMap: () => getPlanPriceMap(),
  invalidatePlanCatalog: () => invalidatePlanCatalog(),
}));

import { POST } from "./route";

const req = {
  text: async () => "{}",
  headers: new Headers({ "stripe-signature": "sig" }),
} as unknown as NextRequest;

function subEvent(metadataPlan: string | undefined, priceId = "price_x", status = "active") {
  return {
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status,
        metadata: metadataPlan ? { plan: metadataPlan } : {},
        items: { data: [{ price: { id: priceId } }] },
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  getPlanCatalog.mockResolvedValue([
    { key: "trial", kind: "trial" },
    { key: "pro", kind: "paid" },
  ]);
  getPlanPriceMap.mockResolvedValue(new Map([["price_p", "pro"]]));
});

it("refreshes the catalog and writes the plan from known metadata", async () => {
  event = subEvent("pro");
  const res = await POST(req);
  expect(res.status).toBe(200);
  expect(invalidatePlanCatalog).toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith({ stripe_subscription_id: "sub_1", plan: "pro", status: "active" });
});

it("returns 500 and writes nothing when an active subscription's plan is unresolved", async () => {
  event = subEvent("ghost", "price_unknown");
  const res = await POST(req);
  expect(res.status).toBe(500);
  expect(update).not.toHaveBeenCalled();
});

it("returns 500 and writes nothing when the catalog cannot be read", async () => {
  event = subEvent("pro");
  getPlanCatalog.mockRejectedValue(new Error("db down"));
  const res = await POST(req);
  expect(res.status).toBe(500);
  expect(update).not.toHaveBeenCalled();
});
