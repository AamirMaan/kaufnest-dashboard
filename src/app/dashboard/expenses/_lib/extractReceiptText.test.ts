import { MIN_PDF_TEXT_CHARS, hasUsablePdfText } from "./extractReceiptText";

describe("hasUsablePdfText", () => {
  it("treats a PDF with a real text layer as usable", () => {
    expect(hasUsablePdfText("Rechnung RE-1\nGesamtbetrag 44,63 €\nUSt-IdNr DE123456789")).toBe(true);
  });

  it("treats a scanned PDF (almost no text) as unusable", () => {
    expect(hasUsablePdfText("  \n \n 1 ")).toBe(false);
    expect(hasUsablePdfText("")).toBe(false);
  });

  it("counts non-whitespace characters against the threshold", () => {
    expect(hasUsablePdfText("x".repeat(MIN_PDF_TEXT_CHARS - 1) + "   ")).toBe(false);
    expect(hasUsablePdfText("x ".repeat(MIN_PDF_TEXT_CHARS))).toBe(true);
  });
});
