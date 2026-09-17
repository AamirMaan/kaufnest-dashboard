import { renderCardDescription, renderCardTitle, parseCustomerReply } from "./cardContent";

describe("renderCardTitle", () => {
  it("prefixes the tenant slug so the board is scannable", () => {
    expect(renderCardTitle("kaufnest", "Invoice PDF is blank")).toBe(
      "[kaufnest] Invoice PDF is blank"
    );
  });
});

describe("renderCardDescription", () => {
  const input = {
    description: "The PDF downloads but every page is empty.",
    type: "bug" as const,
    severity: "high" as const,
    tenantSlug: "kaufnest",
    plan: "pro",
    reporterEmail: "ana@example.com",
    pageUrl: "https://app.example.com/dashboard/sales/42",
    userAgent: "Mozilla/5.0 (Macintosh)",
  };

  it("leads with the user's own words", () => {
    expect(renderCardDescription(input)).toMatch(
      /^The PDF downloads but every page is empty\./
    );
  });

  it("includes every context field the triager needs", () => {
    const out = renderCardDescription(input);
    expect(out).toContain("**Tenant:** kaufnest (pro)");
    expect(out).toContain("**Reporter:** ana@example.com");
    expect(out).toContain("**Type:** bug / **Severity:** high");
    expect(out).toContain("https://app.example.com/dashboard/sales/42");
    expect(out).toContain("Mozilla/5.0 (Macintosh)");
  });

  it("omits the page line when no URL was captured", () => {
    const out = renderCardDescription({ ...input, pageUrl: null });
    expect(out).not.toContain("**Page:**");
  });
});

describe("parseCustomerReply", () => {
  it("strips the marker and surrounding whitespace", () => {
    expect(parseCustomerReply("@customer Fixed in today's release.")).toBe(
      "Fixed in today's release."
    );
  });

  it("is case-insensitive about the marker", () => {
    expect(parseCustomerReply("@Customer  thanks for the report")).toBe(
      "thanks for the report"
    );
  });

  it("returns null for internal chatter", () => {
    expect(parseCustomerReply("looks like a caching bug, assigning to Sam")).toBeNull();
  });

  it("returns null for a marker with no body", () => {
    expect(parseCustomerReply("@customer   ")).toBeNull();
  });
});
