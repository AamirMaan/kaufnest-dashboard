import {
  BROWSER_IDENTITIES,
  buildCookieHeader,
  jitterDelayMs,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  pickBrowserIdentity,
  sessionHeaders,
  toMobileUrl,
} from "./session";

describe("pickBrowserIdentity", () => {
  it("is deterministic for a given seed", () => {
    expect(pickBrowserIdentity(0)).toBe(BROWSER_IDENTITIES[0]);
    expect(pickBrowserIdentity(0.999999)).toBe(
      BROWSER_IDENTITIES[BROWSER_IDENTITIES.length - 1]
    );
  });

  it("never runs off the end of the pool for out-of-range seeds", () => {
    expect(BROWSER_IDENTITIES).toContain(pickBrowserIdentity(1));
    expect(BROWSER_IDENTITIES).toContain(pickBrowserIdentity(1.5));
    expect(BROWSER_IDENTITIES).toContain(pickBrowserIdentity(-1));
  });

  it("only Chrome identities carry client hints", () => {
    for (const identity of BROWSER_IDENTITIES) {
      if (identity.userAgent.includes("Chrome/")) {
        expect(identity.clientHints).toBeDefined();
      } else {
        expect(identity.clientHints).toBeUndefined();
      }
    }
  });
});

describe("buildCookieHeader", () => {
  it("keeps name=value and drops cookie attributes", () => {
    expect(
      buildCookieHeader([
        "aep_usuc_f=site=deu&region=DE; Path=/; Expires=Wed, 01 Jan 2027 00:00:00 GMT",
        "xman_f=abc123; Domain=.aliexpress.com; Secure; HttpOnly",
      ])
    ).toBe("aep_usuc_f=site=deu&region=DE; xman_f=abc123");
  });

  it("later cookies with the same name win", () => {
    expect(buildCookieHeader(["a=1", "a=2"])).toBe("a=2");
  });

  it("skips empty/deleted and malformed cookies", () => {
    expect(buildCookieHeader(["deleted=; Max-Age=0", 'gone=""', "noequalsign", "=bare"])).toBe("");
  });

  it("returns empty string for no cookies", () => {
    expect(buildCookieHeader([])).toBe("");
  });
});

describe("jitterDelayMs", () => {
  it("spans MIN_DELAY_MS..MAX_DELAY_MS across the seed range", () => {
    expect(jitterDelayMs(0)).toBe(MIN_DELAY_MS);
    expect(jitterDelayMs(1)).toBe(MAX_DELAY_MS);
    const mid = jitterDelayMs(0.5);
    expect(mid).toBeGreaterThan(MIN_DELAY_MS);
    expect(mid).toBeLessThan(MAX_DELAY_MS);
  });

  it("clamps out-of-range seeds instead of exceeding the bounds", () => {
    expect(jitterDelayMs(-1)).toBe(MIN_DELAY_MS);
    expect(jitterDelayMs(2)).toBe(MAX_DELAY_MS);
  });
});

describe("toMobileUrl", () => {
  it("rewrites the desktop host to m.aliexpress.com, keeping the path", () => {
    expect(toMobileUrl("https://de.aliexpress.com/item/1005006994518770.html")).toBe(
      "https://m.aliexpress.com/item/1005006994518770.html"
    );
    expect(toMobileUrl("https://www.aliexpress.com/item/123456.html")).toBe(
      "https://m.aliexpress.com/item/123456.html"
    );
  });

  it("returns null when already on the mobile host", () => {
    expect(toMobileUrl("https://m.aliexpress.com/item/123456.html")).toBeNull();
  });

  it("returns null for non-AliExpress or malformed URLs", () => {
    expect(toMobileUrl("https://www.amazon.de/dp/B08N5WRWNW")).toBeNull();
    expect(toMobileUrl("not-a-url")).toBeNull();
  });
});

describe("sessionHeaders", () => {
  const identity = BROWSER_IDENTITIES[0];

  it("includes the cookie only when the session has one", () => {
    const withCookie = sessionHeaders({ cookie: "a=1", identity });
    expect(withCookie.Cookie).toBe("a=1");

    const withoutCookie = sessionHeaders({ cookie: "", identity });
    expect(withoutCookie.Cookie).toBeUndefined();
  });

  it("sends the identity's UA, client hints, and browsing-context headers", () => {
    const headers = sessionHeaders({ cookie: "", identity });
    expect(headers["User-Agent"]).toBe(identity.userAgent);
    expect(headers["sec-ch-ua"]).toBe(identity.clientHints?.["sec-ch-ua"]);
    expect(headers.Referer).toBe("https://de.aliexpress.com/");
    expect(headers["Sec-Fetch-Mode"]).toBe("navigate");
  });
});
