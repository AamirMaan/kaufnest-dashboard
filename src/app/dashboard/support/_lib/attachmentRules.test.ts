import {
  validateAttachments,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "./attachmentRules";

const png = (name: string, size: number) => ({ name, size, type: "image/png" });

describe("validateAttachments", () => {
  it("accepts no files at all — a screenshot is optional", () => {
    expect(validateAttachments([])).toBeNull();
  });

  it("accepts up to the file limit", () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => png(`s${i}.png`, 1000));
    expect(validateAttachments(files)).toBeNull();
  });

  it("rejects more than the file limit", () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => png(`s${i}.png`, 1000));
    expect(validateAttachments(files)).toBe("You can attach at most 3 screenshots.");
  });

  it("rejects a non-image file by name", () => {
    expect(
      validateAttachments([{ name: "notes.pdf", size: 100, type: "application/pdf" }])
    ).toBe("notes.pdf is not an image. Attach a PNG, JPEG, WebP or GIF.");
  });

  it("rejects a set whose total exceeds the request-body cap", () => {
    expect(validateAttachments([png("big.png", MAX_TOTAL_BYTES + 1)])).toBe(
      "Screenshots total more than 4 MB. Attach fewer or smaller images."
    );
  });

  it("measures the total across files, not each file alone", () => {
    const half = Math.ceil(MAX_TOTAL_BYTES / 2) + 1;
    expect(validateAttachments([png("a.png", half), png("b.png", half)])).toContain(
      "total more than 4 MB"
    );
  });
});
