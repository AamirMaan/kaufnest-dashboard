import { buildReceiptPath, pathFromStoredReceipt, EXPENSE_RECEIPTS_BUCKET } from "./receiptPath";

describe("EXPENSE_RECEIPTS_BUCKET", () => {
  it("is the private bucket id", () => {
    expect(EXPENSE_RECEIPTS_BUCKET).toBe("expense-receipts");
  });
});

describe("buildReceiptPath", () => {
  it("puts the tenant schema first — the bucket RLS policy matches on it", () => {
    const path = buildReceiptPath("tenant_kaufnest", "expense-1", "receipt.jpg");
    expect(path.startsWith("tenant_kaufnest/expense-1/")).toBe(true);
  });

  it("discards the user's filename, keeping only the extension", () => {
    const path = buildReceiptPath("tenant_kaufnest", "expense-1", "DHL invoice (2).PNG");
    expect(path).not.toContain("invoice");
    expect(path).not.toContain(" ");
    expect(path.endsWith(".png")).toBe(true);
  });

  it("defaults to .jpg when the filename has no extension", () => {
    expect(buildReceiptPath("tenant_a", "e1", "noextension").endsWith(".jpg")).toBe(true);
  });

  it("never collides for two files uploaded in the same millisecond", () => {
    const a = buildReceiptPath("tenant_a", "e1", "x.jpg");
    const b = buildReceiptPath("tenant_a", "e1", "x.jpg");
    expect(a).not.toBe(b);
  });
});

describe("pathFromStoredReceipt", () => {
  it("returns the path when it belongs to the caller's own tenant", () => {
    expect(
      pathFromStoredReceipt({ path: "tenant_kaufnest/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBe("tenant_kaufnest/expense-1/abc.jpg");
  });

  it("returns null for a path under a different tenant's prefix", () => {
    expect(
      pathFromStoredReceipt({ path: "tenant_other/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBeNull();
  });

  it("returns null for a path that merely contains the tenant name mid-string, not as its prefix", () => {
    expect(
      pathFromStoredReceipt({ path: "not_tenant_kaufnest/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBeNull();
  });
});
