import { parseConnectionPatch } from "./connectionPatch";

describe("parseConnectionPatch", () => {
  it("accepts a trimmed display name", () => {
    expect(parseConnectionPatch({ display_name: "  Main store " })).toEqual({ ok: true, patch: { display_name: "Main store" } });
  });
  it("rejects an empty or over-long display name", () => {
    expect(parseConnectionPatch({ display_name: "   " }).ok).toBe(false);
    expect(parseConnectionPatch({ display_name: "x".repeat(61) }).ok).toBe(false);
  });
  it("accepts is_active booleans only", () => {
    expect(parseConnectionPatch({ is_active: false })).toEqual({ ok: true, patch: { is_active: false } });
    expect(parseConnectionPatch({ is_active: "no" }).ok).toBe(false);
  });
  it("rejects an empty patch and unknown shapes", () => {
    expect(parseConnectionPatch({}).ok).toBe(false);
    expect(parseConnectionPatch(null).ok).toBe(false);
  });
});
