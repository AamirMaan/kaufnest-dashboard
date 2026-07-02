import {
  validateIBAN,
  validateVATId,
  validateEmail,
  validateVATRate,
} from "./validation";

// ─── validateIBAN ────────────────────────────────────────────────────────────

describe("validateIBAN", () => {
  it("returns null for a valid German IBAN", () => {
    expect(validateIBAN("DE89370400440532013000")).toBeNull();
  });

  it("returns null for a valid IBAN with spaces (stripped)", () => {
    expect(validateIBAN("DE89 3704 0044 0532 0130 00")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateIBAN("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateIBAN("   ")).toBeNull();
  });

  it("returns error for lowercase letters", () => {
    expect(validateIBAN("de89370400440532013000")).toBe("Invalid IBAN format");
  });

  it("returns error when country code missing", () => {
    expect(validateIBAN("370400440532013000")).toBe("Invalid IBAN format");
  });

  it("returns error when body is too short (< 11 chars after check digits)", () => {
    // DE + 2 digits + 10 alphanumeric = too short
    expect(validateIBAN("DE891234567890")).toBe("Invalid IBAN format");
  });

  it("returns error when body is too long (> 30 chars after country+check)", () => {
    expect(validateIBAN("DE89" + "A".repeat(31))).toBe("Invalid IBAN format");
  });

  it("returns null for IBAN body at minimum length (11 chars)", () => {
    expect(validateIBAN("GB29" + "A".repeat(11))).toBeNull();
  });

  it("returns null for IBAN body at maximum length (30 chars)", () => {
    expect(validateIBAN("GB29" + "A".repeat(30))).toBeNull();
  });
});

// ─── validateVATId ────────────────────────────────────────────────────────────

describe("validateVATId", () => {
  it("returns null for a valid German VAT ID", () => {
    expect(validateVATId("DE123456789")).toBeNull();
  });

  it("returns null for a valid VAT ID with spaces (stripped)", () => {
    expect(validateVATId("DE 123456789")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateVATId("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateVATId("   ")).toBeNull();
  });

  it("returns error for lowercase country code", () => {
    expect(validateVATId("de123456789")).toBe("Invalid VAT ID format");
  });

  it("returns error when body is too short (< 2 chars after country code)", () => {
    expect(validateVATId("DE1")).toBe("Invalid VAT ID format");
  });

  it("returns error when body is too long (> 13 chars after country code)", () => {
    expect(validateVATId("DE" + "1".repeat(14))).toBe("Invalid VAT ID format");
  });

  it("returns null for VAT ID body at minimum length (2 chars)", () => {
    expect(validateVATId("DE12")).toBeNull();
  });

  it("returns null for VAT ID body at maximum length (13 chars)", () => {
    expect(validateVATId("DE" + "1".repeat(13))).toBeNull();
  });

  it("returns error for special characters", () => {
    expect(validateVATId("DE-12345678")).toBe("Invalid VAT ID format");
  });
});

// ─── validateEmail ───────────────────────────────────────────────────────────

describe("validateEmail", () => {
  it("returns null for a valid email", () => {
    expect(validateEmail("info@company.com")).toBeNull();
  });

  it("returns null for a valid email with subdomain", () => {
    expect(validateEmail("user@mail.example.co.uk")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateEmail("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateEmail("   ")).toBeNull();
  });

  it("returns error when @ is missing", () => {
    expect(validateEmail("notanemail.com")).toBe("Invalid email address");
  });

  it("returns error when domain part is missing", () => {
    expect(validateEmail("user@")).toBe("Invalid email address");
  });

  it("returns error when TLD is missing", () => {
    expect(validateEmail("user@domain")).toBe("Invalid email address");
  });

  it("returns error for email with spaces", () => {
    expect(validateEmail("user @domain.com")).toBe("Invalid email address");
  });
});

// ─── validateVATRate ─────────────────────────────────────────────────────────

describe("validateVATRate", () => {
  it("returns null for 0 (lower boundary)", () => {
    expect(validateVATRate(0)).toBeNull();
  });

  it("returns null for 100 (upper boundary)", () => {
    expect(validateVATRate(100)).toBeNull();
  });

  it("returns null for a typical rate like 19", () => {
    expect(validateVATRate(19)).toBeNull();
  });

  it("returns null for a decimal rate like 7.5", () => {
    expect(validateVATRate(7.5)).toBeNull();
  });

  it("returns null for numeric string '19'", () => {
    expect(validateVATRate("19")).toBeNull();
  });

  it("returns null for string '0'", () => {
    expect(validateVATRate("0")).toBeNull();
  });

  it("returns null for string '100'", () => {
    expect(validateVATRate("100")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateVATRate("")).toBeNull();
  });

  it("returns error for -1 (below range)", () => {
    expect(validateVATRate(-1)).toBe("VAT rate must be between 0 and 100");
  });

  it("returns error for 101 (above range)", () => {
    expect(validateVATRate(101)).toBe("VAT rate must be between 0 and 100");
  });

  it("returns error for string '-5'", () => {
    expect(validateVATRate("-5")).toBe("VAT rate must be between 0 and 100");
  });

  it("returns error for non-numeric string", () => {
    expect(validateVATRate("abc")).toBe("VAT rate must be between 0 and 100");
  });
});
