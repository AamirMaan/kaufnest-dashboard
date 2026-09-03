import {
  buildAspectSchema,
  buildDescribeUserPrompt,
  DESCRIBE_SYSTEM_PROMPT,
  ASPECTS_SYSTEM_PROMPT,
} from "./prompts";

describe("buildAspectSchema", () => {
  it("declares one string property per required aspect", () => {
    const schema = buildAspectSchema(["Brand", "Colour"]) as {
      properties: Record<string, { type: string }>;
    };
    expect(Object.keys(schema.properties)).toEqual(["Brand", "Colour"]);
    expect(schema.properties.Brand.type).toBe("string");
  });

  it("forbids extra properties so eBay never sees an invented aspect", () => {
    const schema = buildAspectSchema(["Brand"]) as { additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
  });

  it("requires every aspect key to be present, so blanks are explicit", () => {
    const schema = buildAspectSchema(["Brand", "Colour"]) as { required: string[] };
    expect(schema.required).toEqual(["Brand", "Colour"]);
  });

  it("handles aspect names containing spaces and slashes", () => {
    const schema = buildAspectSchema(["Model Number", "Height/Width"]) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(["Model Number", "Height/Width"]);
  });

  it("produces a valid empty schema when no aspects are required", () => {
    const schema = buildAspectSchema([]) as { properties: object; required: string[] };
    expect(schema.properties).toEqual({});
    expect(schema.required).toEqual([]);
  });
});

describe("system prompts", () => {
  // Prompt caching is a prefix match: any byte change invalidates the cache
  // and silently multiplies cost. These assert the prompts are constants,
  // not templates built per request.
  it("are non-empty constants", () => {
    expect(DESCRIBE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(ASPECTS_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("are byte-stable across reads", () => {
    expect(DESCRIBE_SYSTEM_PROMPT).toBe(DESCRIBE_SYSTEM_PROMPT);
    expect(DESCRIBE_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamp
  });

  it("tell the model which HTML tags are permitted", () => {
    expect(DESCRIBE_SYSTEM_PROMPT).toContain("<p>");
  });

  it("tell the aspect model to return empty rather than guess", () => {
    expect(ASPECTS_SYSTEM_PROMPT.toLowerCase()).toContain("empty string");
  });
});

describe("buildDescribeUserPrompt", () => {
  it("includes the title and category", () => {
    const prompt = buildDescribeUserPrompt({
      mode: "generate",
      title: "Logitech MX Master 3S",
      condition: "new",
      categoryName: "Mice & Trackballs",
      aspects: { Brand: "Logitech" },
    });
    expect(prompt).toContain("Logitech MX Master 3S");
    expect(prompt).toContain("Mice & Trackballs");
    expect(prompt).toContain("Brand: Logitech");
  });

  it("includes the current description when improving", () => {
    const prompt = buildDescribeUserPrompt({
      mode: "improve",
      title: "T", condition: "used", categoryName: "C", aspects: {},
      currentHtml: "<p>existing copy</p>",
    });
    expect(prompt).toContain("existing copy");
  });
});
