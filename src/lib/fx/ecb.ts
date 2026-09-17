/**
 * Server-only wrapper over the ECB's public daily reference rate CSV
 * endpoint (https://data-api.ecb.europa.eu, no API key). Never import this
 * from a Client Component — the project verifier's guard_edit.py denies
 * that at write time.
 *
 * The ECB publishes the value of ONE EURO in the foreign currency (e.g. the
 * D.SEK.EUR.SP00.A series gives ~11.4, meaning 1 EUR = 11.4 SEK). This
 * module stores and returns that raw published figure ("quote") in the
 * cache, and computes the actual base-currency conversion rate on read:
 *
 *   rate(X -> base) = quote(base) / quote(X)
 *
 * quote(EUR) = 1 by definition. Getting this inverted is the easiest
 * mistake here and it fails silently — a rate 100x too large or small
 * looks like a data problem, not a formula bug. See
 * docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
 * section 1 for the full rationale.
 */
import { createControlClient } from "@/lib/supabase/control";
import type { Currency } from "@/types";

const ECB_BASE_URL = "https://data-api.ecb.europa.eu/service/data/EXR";
const WALK_BACK_DAYS = 7;

function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads a cached quote for (date, currency) from control.fx_rates, or
 * fetches it from the ECB and caches it if missing. Returns null if the
 * ECB has no publication for that exact date (weekends/holidays) — the
 * caller (getRate) does the walk-back across multiple dates.
 */
async function getQuoteForDate(currency: string, date: string): Promise<number | null> {
  if (currency === "EUR") return 1;

  const control = createControlClient();
  const { data: cached } = await control
    .schema("control")
    .from("fx_rates")
    .select("quote")
    .eq("rate_date", date)
    .eq("currency", currency)
    .maybeSingle();
  if (cached) return cached.quote as number;

  const url = `${ECB_BASE_URL}/D.${currency}.EUR.SP00.A?startPeriod=${date}&endPeriod=${date}&format=csvdata`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null; // no publication for this date
    throw new Error(`ECB rate fetch failed: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  const quote = parseEcbCsv(csv, date);
  if (quote === null) return null;

  await control.schema("control").from("fx_rates").insert({ rate_date: date, currency, quote });
  return quote;
}

/**
 * Parses the ECB's CSV response for a single-date, single-series request.
 * Exported for testing against real fixture CSV without a network call.
 */
export function parseEcbCsv(csv: string, expectedDate: string): number | null {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null; // header only, no data row = no publication
  const header = lines[0].split(",");
  const dateCol = header.indexOf("TIME_PERIOD");
  const valueCol = header.indexOf("OBS_VALUE");
  if (dateCol === -1 || valueCol === -1) {
    throw new Error("ECB CSV response missing expected columns");
  }
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[dateCol] === expectedDate) {
      const value = Number(cols[valueCol]);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Resolves a conversion rate for `currency -> baseCurrency` as of `date`,
 * walking back up to 7 calendar days if the ECB has no publication for the
 * exact date (weekends, TARGET holidays). Returns null if unresolved after
 * the walk-back window — the caller must fall to manual rate entry.
 */
export async function getRate(
  currency: string,
  date: string,
  baseCurrency: Currency
): Promise<{ rate: number; rateDate: string } | null> {
  const normalizedCurrency = currency.toUpperCase();
  for (let offset = 0; offset <= WALK_BACK_DAYS; offset++) {
    const tryDate = isoDateMinusDays(date, offset);
    const [quoteForCurrency, quoteForBase] = await Promise.all([
      getQuoteForDate(normalizedCurrency, tryDate),
      getQuoteForDate(baseCurrency, tryDate),
    ]);
    if (quoteForCurrency !== null && quoteForBase !== null) {
      return { rate: quoteForBase / quoteForCurrency, rateDate: tryDate };
    }
  }
  return null;
}
