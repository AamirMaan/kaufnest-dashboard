// Pure helpers for the AliExpress scrape session (no network, unit-tested).
// The goal is to make a batch of price checks look like one human browsing
// session instead of N stateless bot requests: one warm-up cookie jar, one
// consistent browser identity, and human-ish randomized pacing.

export interface BrowserIdentity {
  userAgent: string;
  /** Client-hint headers — only present for Chrome identities (Firefox/Safari don't send them). */
  clientHints?: Record<string, string>;
}

export interface ScrapeSession {
  /** `Cookie` header value collected from the warm-up request ("" when warm-up failed). */
  cookie: string;
  identity: BrowserIdentity;
}

function chromeIdentity(major: number, platform: "Windows" | "macOS"): BrowserIdentity {
  const os =
    platform === "Windows"
      ? "(Windows NT 10.0; Win64; x64)"
      : "(Macintosh; Intel Mac OS X 10_15_7)";
  return {
    userAgent:
      `Mozilla/5.0 ${os} AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    clientHints: {
      "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="99"`,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": `"${platform}"`,
    },
  };
}

export const BROWSER_IDENTITIES: BrowserIdentity[] = [
  chromeIdentity(131, "Windows"),
  chromeIdentity(130, "macOS"),
  chromeIdentity(129, "Windows"),
  {
    // Firefox on Windows
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  },
  {
    // Safari on macOS
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  },
];

/** Picks one identity for the whole session — mixing UAs on one cookie jar looks MORE suspicious. */
export function pickBrowserIdentity(seed: number = Math.random()): BrowserIdentity {
  const clamped = Math.min(Math.max(seed, 0), 0.999999);
  return BROWSER_IDENTITIES[Math.floor(clamped * BROWSER_IDENTITIES.length)];
}

/**
 * Turns raw `Set-Cookie` header values into a `Cookie` request-header value,
 * dropping attributes (Path/Expires/HttpOnly/…) and deleted cookies.
 */
export function buildCookieHeader(setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const raw of setCookies) {
    const pair = raw.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name || value === "" || value === '""') continue;
    jar.set(name, value);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export const MIN_DELAY_MS = 2500;
export const MAX_DELAY_MS = 5000;

/** Human-ish randomized delay between item-page requests (2.5–5s). */
export function jitterDelayMs(seed: number = Math.random()): number {
  const clamped = Math.min(Math.max(seed, 0), 1);
  return Math.round(MIN_DELAY_MS + clamped * (MAX_DELAY_MS - MIN_DELAY_MS));
}

/**
 * Rewrites an aliexpress.com product URL onto the mobile host, whose bot
 * protection is often less strict. Returns null for non-AliExpress URLs or
 * URLs already on the mobile host (nothing new to retry).
 */
export function toMobileUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  if (!host.endsWith("aliexpress.com") || host === "m.aliexpress.com") return null;
  parsed.hostname = "m.aliexpress.com";
  return parsed.toString();
}

/** Request headers for one item-page fetch within a session. */
export function sessionHeaders(session: ScrapeSession): Record<string, string> {
  return {
    "User-Agent": session.identity.userAgent,
    ...(session.identity.clientHints ?? {}),
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
    Referer: "https://de.aliexpress.com/",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    ...(session.cookie ? { Cookie: session.cookie } : {}),
  };
}
