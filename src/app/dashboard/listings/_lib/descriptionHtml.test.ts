import { toEditorHtml, escapeHtml } from "./descriptionHtml";

describe("escapeHtml", () => {
  it("escapes the characters that would otherwise be read as markup", () => {
    expect(escapeHtml(`Fits 3<5" & >2"`)).toBe(
      "Fits 3&lt;5&quot; &amp; &gt;2&quot;"
    );
  });
});

describe("toEditorHtml", () => {
  it("wraps a single plain-text line in one paragraph", () => {
    expect(toEditorHtml("Brand new, never opened.")).toBe(
      "<p>Brand new, never opened.</p>"
    );
  });

  it("keeps single newlines as <br> and blank lines as paragraph breaks", () => {
    // The exact shape of a description typed into the old <textarea>, which
    // TipTap would otherwise collapse into one paragraph.
    expect(toEditorHtml("Line one\nLine two\n\nLine three")).toBe(
      "<p>Line one<br>Line two</p><p>Line three</p>"
    );
  });

  it("escapes HTML-special characters in legacy plain text", () => {
    expect(toEditorHtml('Width < 5cm & depth > 2cm')).toBe(
      "<p>Width &lt; 5cm &amp; depth &gt; 2cm</p>"
    );
  });

  it("does not treat an escaped angle bracket as an opening tag", () => {
    // `< 5` has no letter after the `<`, so it must take the plain-text
    // branch rather than being passed through as if it were markup.
    expect(toEditorHtml("Under < 5 kg")).toBe("<p>Under &lt; 5 kg</p>");
  });

  it("passes already-HTML descriptions through unchanged", () => {
    const html = "<h3>Condition</h3><p>Used &amp; boxed.</p><ul><li>Cable</li></ul>";
    expect(toEditorHtml(html)).toBe(html);
  });

  it("returns an empty string for empty, whitespace-only, null and undefined", () => {
    expect(toEditorHtml("")).toBe("");
    expect(toEditorHtml("   \n\n  ")).toBe("");
    expect(toEditorHtml(null)).toBe("");
    expect(toEditorHtml(undefined)).toBe("");
  });
});
