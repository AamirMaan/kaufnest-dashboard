let tenantResult: { data: unknown; error: unknown } = { data: { plan: "business" }, error: null };
const eq = jest.fn();
jest.mock("@/lib/supabase/control", () => ({
  createControlClient: () => ({
    schema: () => ({
      from: () => {
        const builder = {
          select: () => builder,
          eq: (...args: unknown[]) => {
            eq(...args);
            return builder;
          },
          maybeSingle: () => Promise.resolve(tenantResult),
        };
        return builder;
      },
    }),
  }),
}));

const getEntitlements = jest.fn();
jest.mock("@/lib/plans/catalog", () => ({
  getEntitlements: (key: string | null) => getEntitlements(key),
}));

import { NO_ENTITLEMENTS } from "./entitlements";
import { requireMessagingAndListings, requirePlanFeature } from "./requirePlanFeature";

const entitled = { ...NO_ENTITLEMENTS, messagingAndListings: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  tenantResult = { data: { plan: "business" }, error: null };
  getEntitlements.mockResolvedValue(entitled);
});

it("passes (null) when the tenant's plan includes the feature", async () => {
  expect(await requireMessagingAndListings("tenant_acme")).toBeNull();
  expect(eq).toHaveBeenCalledWith("schema_name", "tenant_acme");
  expect(getEntitlements).toHaveBeenCalledWith("business");
});

it("403s with the feature copy when the plan does not include it", async () => {
  getEntitlements.mockResolvedValue(NO_ENTITLEMENTS);
  const res = await requireMessagingAndListings("tenant_acme");
  expect(res?.status).toBe(403);
  expect(await res?.json()).toEqual({ error: "Listings and messages are not included in your plan." });
});

it("fails closed (403) when no tenant row matches the schema", async () => {
  tenantResult = { data: null, error: null };
  getEntitlements.mockResolvedValue(NO_ENTITLEMENTS);
  const res = await requireMessagingAndListings("tenant_ghost");
  expect(res?.status).toBe(403);
  expect(getEntitlements).toHaveBeenCalledWith(null);
});

it("500s with fixed copy on a tenant lookup error, never the raw error", async () => {
  tenantResult = { data: null, error: { message: "relation does not exist" } };
  const res = await requireMessagingAndListings("tenant_acme");
  expect(res?.status).toBe(500);
  expect(await res?.json()).toEqual({ error: "Could not check your plan. Please try again." });
});

it("500s with fixed copy when the catalog cannot be read", async () => {
  getEntitlements.mockRejectedValue(new Error("db down"));
  const res = await requirePlanFeature("tenant_acme", "messagingAndListings");
  expect(res?.status).toBe(500);
  expect(await res?.json()).toEqual({ error: "Could not check your plan. Please try again." });
});
