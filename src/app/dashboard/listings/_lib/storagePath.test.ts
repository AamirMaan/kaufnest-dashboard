import { buildImagePath, pathFromPublicUrl, LISTING_IMAGES_BUCKET } from "./storagePath";

describe("buildImagePath", () => {
  it("puts the tenant schema first — the bucket RLS policy matches on it", () => {
    const path = buildImagePath("tenant_kaufnest", "draft-1", "photo.jpg");
    expect(path.startsWith("tenant_kaufnest/draft-1/")).toBe(true);
  });

  it("discards the user's filename, keeping only the extension", () => {
    const path = buildImagePath("tenant_kaufnest", "draft-1", "my holiday photo (2).JPG");
    expect(path).not.toContain("holiday");
    expect(path).not.toContain(" ");
    expect(path.endsWith(".jpg")).toBe(true);
  });

  it("defaults to .jpg when the filename has no extension", () => {
    expect(buildImagePath("tenant_a", "d1", "noextension").endsWith(".jpg")).toBe(true);
  });

  it("never collides for two files uploaded in the same millisecond", () => {
    const a = buildImagePath("tenant_a", "d1", "x.jpg");
    const b = buildImagePath("tenant_a", "d1", "x.jpg");
    expect(a).not.toBe(b);
  });
});

describe("pathFromPublicUrl", () => {
  const base = `https://abc.supabase.co/storage/v1/object/public/${LISTING_IMAGES_BUCKET}`;

  it("extracts the object path from one of our public URLs", () => {
    expect(pathFromPublicUrl(`${base}/tenant_kaufnest/draft-1/abc.jpg`)).toBe(
      "tenant_kaufnest/draft-1/abc.jpg"
    );
  });

  it("returns null for an eBay CDN URL — we must never delete eBay's images", () => {
    expect(pathFromPublicUrl("https://i.ebayimg.com/images/g/abc/s-l1600.jpg")).toBeNull();
  });

  it("returns null for a different Supabase bucket", () => {
    expect(
      pathFromPublicUrl("https://abc.supabase.co/storage/v1/object/public/avatars/x.png")
    ).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(pathFromPublicUrl("not a url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(pathFromPublicUrl("")).toBeNull();
  });

  it("strips a query string from a signed-looking URL", () => {
    expect(pathFromPublicUrl(`${base}/tenant_a/d1/x.jpg?token=abc`)).toBe("tenant_a/d1/x.jpg");
  });

  it("returns null for a foreign host merely containing the bucket marker in its path — must not accept any host that happens to serve a matching path", () => {
    expect(
      pathFromPublicUrl("https://evil-attacker.com/storage/v1/object/public/listing-images/tenant_kaufnest/draft-1/x.jpg")
    ).toBeNull();
  });

  it("returns null for the eBay CDN hostname even when its path contains the bucket marker as a prefix segment", () => {
    expect(
      pathFromPublicUrl("https://i.ebayimg.com/proxy/storage/v1/object/public/listing-images/tenant_kaufnest/draft-1/x.jpg")
    ).toBeNull();
  });

  it("returns null instead of throwing on malformed percent-encoding", () => {
    expect(() =>
      pathFromPublicUrl(`${base}/tenant_a/d1/%2.jpg`)
    ).not.toThrow();
    expect(pathFromPublicUrl(`${base}/tenant_a/d1/%2.jpg`)).toBeNull();
  });
});
