import {
  validateSourceStep,
  validateDetailsStep,
  validateCategoryStep,
  validateImagesStep,
  validatePoliciesStep,
  type DraftFormState,
} from "./wizardValidation";

function makeDraft(overrides: Partial<DraftFormState> = {}): DraftFormState {
  return {
    source_type: "inventory",
    product_id: "product-1",
    source_url: "",
    title: "Wireless Mouse",
    description: "",
    price: "19.99",
    currency: "EUR",
    quantity: "5",
    condition: "new",
    category_id: "9355",
    category_name: "Cell Phones",
    image_urls: ["https://example.com/img.jpg"],
    fulfillment_policy_id: "fp-1",
    payment_policy_id: "pp-1",
    return_policy_id: "rp-1",
    merchant_location_key: "loc-1",
    ...overrides,
  };
}

describe("validateSourceStep", () => {
  it("passes when source_type is inventory and product_id is set", () => {
    expect(validateSourceStep(makeDraft())).toBeNull();
  });

  it("fails when source_type is inventory and product_id is empty", () => {
    expect(validateSourceStep(makeDraft({ product_id: "" }))).toBe(
      "Select an Inventory product."
    );
  });

  it("passes when source_type is dropship and source_url is a valid URL", () => {
    const draft = makeDraft({
      source_type: "dropship",
      product_id: "",
      source_url: "https://de.aliexpress.com/item/123.html",
    });
    expect(validateSourceStep(draft)).toBeNull();
  });

  it("fails when source_type is dropship and source_url is empty", () => {
    const draft = makeDraft({ source_type: "dropship", product_id: "", source_url: "" });
    expect(validateSourceStep(draft)).toBe("Enter a supplier URL.");
  });

  it("fails when source_type is dropship and source_url is not a valid URL", () => {
    const draft = makeDraft({ source_type: "dropship", product_id: "", source_url: "not-a-url" });
    expect(validateSourceStep(draft)).toBe("Enter a valid URL.");
  });
});

describe("validateDetailsStep", () => {
  it("passes with valid title/price/quantity", () => {
    expect(validateDetailsStep(makeDraft())).toBeNull();
  });

  it("fails when title is blank", () => {
    expect(validateDetailsStep(makeDraft({ title: "  " }))).toBe("Title is required.");
  });

  it("fails when price is not a positive number", () => {
    expect(validateDetailsStep(makeDraft({ price: "0" }))).toBe("Price must be greater than 0.");
    expect(validateDetailsStep(makeDraft({ price: "abc" }))).toBe("Price must be greater than 0.");
  });

  it("fails when quantity is not a positive integer", () => {
    expect(validateDetailsStep(makeDraft({ quantity: "0" }))).toBe(
      "Quantity must be at least 1."
    );
    expect(validateDetailsStep(makeDraft({ quantity: "1.5" }))).toBe(
      "Quantity must be at least 1."
    );
  });
});

describe("validateCategoryStep", () => {
  it("passes when category_id is set", () => {
    expect(validateCategoryStep(makeDraft())).toBeNull();
  });

  it("fails when category_id is empty", () => {
    expect(validateCategoryStep(makeDraft({ category_id: "" }))).toBe(
      "Select a category."
    );
  });
});

describe("validateImagesStep", () => {
  it("passes with at least one image", () => {
    expect(validateImagesStep(makeDraft())).toBeNull();
  });

  it("fails with no images", () => {
    expect(validateImagesStep(makeDraft({ image_urls: [] }))).toBe(
      "Add at least one image."
    );
  });
});

describe("validatePoliciesStep", () => {
  it("passes when all three policies are set", () => {
    expect(validatePoliciesStep(makeDraft())).toBeNull();
  });

  it("fails when fulfillment_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ fulfillment_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });

  it("fails when payment_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ payment_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });

  it("fails when return_policy_id is missing", () => {
    expect(validatePoliciesStep(makeDraft({ return_policy_id: "" }))).toBe(
      "Select a fulfillment, payment, and return policy."
    );
  });

  it("fails when merchant_location_key is missing", () => {
    expect(validatePoliciesStep(makeDraft({ merchant_location_key: "" }))).toBe(
      "Select an inventory location."
    );
  });
});
