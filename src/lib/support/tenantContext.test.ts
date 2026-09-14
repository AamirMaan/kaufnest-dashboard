import { tenantContextFrom } from "./tenantContext";

describe("tenantContextFrom", () => {
  it("maps a control tenant row to a context", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: "kaufnest", plan: "pro" }, "tenant_kaufnest") // verifier:allow hardcoded-tenant-schema
    ).toEqual({ tenantId: "t-1", slug: "kaufnest", plan: "pro", schema: "tenant_kaufnest" }); // verifier:allow hardcoded-tenant-schema
  });

  it("falls back to the schema name when the tenant has no slug", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: null, plan: "starter" }, "tenant_acme").slug // verifier:allow hardcoded-tenant-schema
    ).toBe("tenant_acme"); // verifier:allow hardcoded-tenant-schema
  });

  it("defaults an absent plan to 'trial' rather than printing 'null' on the card", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: "acme", plan: null }, "tenant_acme").plan // verifier:allow hardcoded-tenant-schema
    ).toBe("trial");
  });
});
