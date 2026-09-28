import { cleanMessageBody, messagePreview } from "./messageBody";

describe("cleanMessageBody", () => {
  it("turns eBay's &#xd; line endings into plain line breaks", () => {
    const raw = "Vielen Dank für Ihre Bestellung &#xd;\nDie Rechnung bekommen Sie per Email &#xd;\n &#xd;\nGruß";
    expect(cleanMessageBody(raw)).toBe("Vielen Dank für Ihre Bestellung\nDie Rechnung bekommen Sie per Email\n\nGruß");
  });

  it("collapses long runs of blank lines to a single blank line", () => {
    expect(cleanMessageBody("a&#xd;\n&#xd;\n&#xd;\n&#xd;\nb")).toBe("a\n\nb");
  });

  it("decodes decimal, hex and named references", () => {
    expect(cleanMessageBody("Tom &amp; Jerry &#8364;5 &#x2764; &quot;hi&quot;")).toBe('Tom & Jerry €5 ❤ "hi"');
  });

  it("normalises CRLF and bare CR", () => {
    expect(cleanMessageBody("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("leaves unknown or invalid references as written", () => {
    expect(cleanMessageBody("&foo; &#0; &#x110000;")).toBe("&foo; &#0; &#x110000;");
  });

  it("keeps plain text unchanged", () => {
    expect(cleanMessageBody("Hallo, wo ist das Paket?")).toBe("Hallo, wo ist das Paket?");
  });
});

describe("messagePreview", () => {
  it("flattens a cleaned body onto one line", () => {
    expect(messagePreview("Hallo&#xd;\n&#xd;\nwo ist   das Paket?")).toBe("Hallo wo ist das Paket?");
  });
});
