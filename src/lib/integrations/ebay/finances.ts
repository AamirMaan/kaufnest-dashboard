import type { EbayFinanceTransaction } from "./financesMap";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
// The Finances API is served from apiz.*, like the Identity API.
const FINANCES_URL = `${SANDBOX ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com"}/sell/finances/v1/transaction`;
const PAGE_LIMIT = 1000; // eBay's max page size for getTransactions
const MAX_PAGES = 50;    // 50k transactions per 90-day window — a hard stop, not an expected size

/** 403 from Finances = the connection pre-dates the sell.finances scope; reconnect fixes it. */
export class FinancesScopeError extends Error {}

export async function fetchFinanceTransactions(
  accessToken: string,
  opts: { from: string; to: string; types: readonly string[]; marketplaceId?: string | null }
): Promise<EbayFinanceTransaction[]> {
  const filter = `transactionDate:[${opts.from}..${opts.to}],transactionType:{${opts.types.join("|")}}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (opts.marketplaceId) headers["X-EBAY-C-MARKETPLACE-ID"] = opts.marketplaceId;

  const out: EbayFinanceTransaction[] = [];
  for (let pageNo = 0, offset = 0; pageNo < MAX_PAGES; pageNo++) {
    const url = new URL(FINANCES_URL);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), { headers });
    if (res.status === 403) throw new FinancesScopeError("eBay Finances API: insufficient scope");
    if (!res.ok) throw new Error(`eBay finances request failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as { transactions?: EbayFinanceTransaction[]; total?: number };
    const batch = json.transactions ?? [];
    out.push(...batch);
    offset += batch.length;
    if (batch.length === 0 || offset >= (json.total ?? 0)) break;
  }
  return out;
}
