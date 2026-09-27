import { RECEIPT_ACCEPT, isAcceptedReceiptType, isPdfReceipt } from "./receiptFileType";

describe("receiptFileType", () => {
  it("accepts images and PDFs only", () => {
    expect(isAcceptedReceiptType("image/jpeg")).toBe(true);
    expect(isAcceptedReceiptType("image/heic")).toBe(true);
    expect(isAcceptedReceiptType("application/pdf")).toBe(true);
    expect(isAcceptedReceiptType("application/zip")).toBe(false);
    expect(isAcceptedReceiptType("")).toBe(false);
  });

  it("identifies PDF receipts by stored mime", () => {
    expect(isPdfReceipt({ mime: "application/pdf" })).toBe(true);
    expect(isPdfReceipt({ mime: "image/png" })).toBe(false);
  });

  it("exposes the file-picker accept string", () => {
    expect(RECEIPT_ACCEPT).toBe("image/*,application/pdf");
  });
});
