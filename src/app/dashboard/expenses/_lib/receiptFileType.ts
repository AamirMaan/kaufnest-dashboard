/** File-picker `accept` for expense receipts. */
export const RECEIPT_ACCEPT = "image/*,application/pdf";

/** Receipts may be any image or a PDF — nothing else (15 MB cap is checked separately). */
export function isAcceptedReceiptType(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

/** A stored receipt is a PDF (rendered as a file tile, opened in a new tab). */
export function isPdfReceipt(receipt: { mime: string }): boolean {
  return receipt.mime === "application/pdf";
}
