import type { EbayFinanceTransaction } from "./financesMap";
import { loadSigningConfig, signatureHeaders, type SigningConfig } from "./signature";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
// The Finances API is served from apiz.*, like the Identity API.
const FINANCES_URL = `${SANDBOX ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com"}/sell/finances/v1/transaction`;
const PAGE_LIMIT = 1000; // eBay's max page size for getTransactions
const MAX_PAGES = 50;    // 50k transactions per 90-day window — a hard stop, not an expected size

/** 403 from Finances without a signature error = the connection pre-dates the sell.finances scope; reconnect fixes it. */
export class FinancesScopeError extends Error {}
/**
 * eBay rejected the request's digital signature (errorId 215xxx). EU/UK sellers'
 * Finances calls must be signed; reconnecting does not help — the server needs
 * EBAY_SIGNING_PRIVATE_KEY / EBAY_SIGNING_JWE (see signature.ts).
 */
export class FinancesSignatureError extends Error {}

/** True when eBay's error body carries a digital-signature errorId (215000–215999). */
function isSignatureErrorBody(body: string): boolean {
  try {
    const json = JSON.parse(body) as { errors?: { errorId?: number }[] };
    return (json.errors ?? []).some((e) => typeof e.errorId === "number" && e.errorId >= 215000 && e.errorId <= 215999);
  } catch {
    return false;
  }
}

let envSigning: SigningConfig | null | undefined;
function defaultSigning(): SigningConfig | null {
  if (envSigning === undefined) envSigning = loadSigningConfig();
  return envSigning;
}

export async function fetchFinanceTransactions(
  accessToken: string,
  opts: {
    from: string; to: string; types: readonly string[]; marketplaceId?: string | null;
    /** Defaults to the env-configured key; null sends unsigned requests. */
    signing?: SigningConfig | null;
  }
): Promise<EbayFinanceTransaction[]> {
  const filter = `transactionDate:[${opts.from}..${opts.to}],transactionType:{${opts.types.join("|")}}`;
  const baseHeaders: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (opts.marketplaceId) baseHeaders["X-EBAY-C-MARKETPLACE-ID"] = opts.marketplaceId;
  const signing = opts.signing === undefined ? defaultSigning() : opts.signing;

  const out: EbayFinanceTransaction[] = [];
  for (let pageNo = 0, offset = 0; pageNo < MAX_PAGES; pageNo++) {
    const url = new URL(FINANCES_URL);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    // Signed per request: the signature's `created` timestamp must be fresh.
    const headers = signing ? { ...baseHeaders, ...signatureHeaders("GET", url.toString(), signing) } : baseHeaders;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const body = await res.text();
      // Raw upstream body stays server-side; callers only see the error type.
      console.error("[ebay finances]", res.status, body);
      if (isSignatureErrorBody(body)) throw new FinancesSignatureError(`eBay Finances API: signature rejected (${res.status})`);
      if (res.status === 403) throw new FinancesScopeError("eBay Finances API: insufficient scope");
      throw new Error(`eBay finances request failed: ${res.status}`);
    }

    const json = (await res.json()) as { transactions?: EbayFinanceTransaction[]; total?: number };
    const batch = json.transactions ?? [];
    out.push(...batch);
    offset += batch.length;
    if (batch.length === 0 || offset >= (json.total ?? 0)) break;
  }
  return out;
}

/**
 * Joins settled Finances fetches: keeps every fetch that succeeded, and reports the
 * most actionable failure — signature, then scope (both need user/admin action), then
 * any other error (`other`, for the caller to log). `error` is null when all succeeded.
 */
export function settleFinanceFetches(results: PromiseSettledResult<EbayFinanceTransaction[]>[]): {
  txns: EbayFinanceTransaction[];
  error: { kind: "signature" | "scope" | "other"; cause: unknown } | null;
} {
  const txns = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const reasons = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
  const signature = reasons.find((e) => e instanceof FinancesSignatureError);
  if (signature !== undefined) return { txns, error: { kind: "signature", cause: signature } };
  const scope = reasons.find((e) => e instanceof FinancesScopeError);
  if (scope !== undefined) return { txns, error: { kind: "scope", cause: scope } };
  return { txns, error: reasons.length ? { kind: "other", cause: reasons[0] } : null };
}
