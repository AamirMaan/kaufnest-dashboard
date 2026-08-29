import {
  sanitizeSlug,
  slugForCompany,
  schemaNameFor,
  nextAvailableSlug,
} from "./tenantSlug";

describe("sanitizeSlug", () => {
  // Locked to the exact behaviour /api/admin/provision-tenant has always had:
  // strip anything outside [a-z0-9-], THEN turn hyphens into underscores.
  // Spaces are removed, not replaced — "Acme GmbH" is one word afterwards.
  it("lowercases and strips characters outside [a-z0-9-]", () => {
    expect(sanitizeSlug("Acme GmbH")).toBe("acmegmbh");
    expect(sanitizeSlug("Müller & Sohn!")).toBe("mllersohn");
  });

  it("converts hyphens to underscores", () => {
    expect(sanitizeSlug("k2-textil")).toBe("k2_textil");
  });

  it("truncates to 40 characters", () => {
    expect(sanitizeSlug("a".repeat(60))).toHaveLength(40);
  });

  it("passes through 40-char input unchanged and truncates 41-char by exactly one", () => {
    const input40 = "a".repeat(40);
    expect(sanitizeSlug(input40)).toBe(input40);
    expect(sanitizeSlug("a".repeat(41))).toHaveLength(40);
  });

  it("returns an empty string when nothing survives", () => {
    expect(sanitizeSlug("株式会社")).toBe("");
  });
});

describe("slugForCompany", () => {
  it("uses the company name when it sanitises to something usable", () => {
    expect(slugForCompany("Acme GmbH", "owner@acme.de")).toBe("acmegmbh");
  });

  // Without this, "株式会社" produces the schema `tenant_` — which passes
  // provision_tenant_schema's `LIKE 'tenant_%'` check and creates a real,
  // wrongly-named schema that every later signup would collide with.
  it("falls back to the email local part when the company name is unusable", () => {
    expect(slugForCompany("株式会社", "owner@acme.de")).toBe("owner");
  });

  it("falls back to a constant when both are unusable", () => {
    expect(slugForCompany("株式会社", "!!!@example.com")).toBe("tenant");
  });

  it("never returns an empty string", () => {
    expect(slugForCompany("", "")).not.toBe("");
  });
});

describe("schemaNameFor", () => {
  it("prefixes the slug", () => {
    expect(schemaNameFor("acme")).toBe("tenant_acme");
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when it is free", () => {
    expect(nextAvailableSlug("acme", ["other"])).toBe("acme");
  });

  it("suffixes _2 on the first collision", () => {
    expect(nextAvailableSlug("acme", ["acme"])).toBe("acme_2");
  });

  it("keeps counting past consecutive collisions", () => {
    expect(nextAvailableSlug("acme", ["acme", "acme_2", "acme_3"])).toBe("acme_4");
  });

  it("throws rather than looping forever", () => {
    const taken = ["acme", ...Array.from({ length: 100 }, (_, i) => `acme_${i + 2}`)];
    expect(() => nextAvailableSlug("acme", taken)).toThrow(/no available slug/i);
  });

  it("succeeds at exactly the boundary (acme_100 is free, acme_2..acme_99 taken)", () => {
    const taken = ["acme", ...Array.from({ length: 98 }, (_, i) => `acme_${i + 2}`)];
    expect(nextAvailableSlug("acme", taken)).toBe("acme_100");
  });
});
