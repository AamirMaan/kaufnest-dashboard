# AliExpress price scraper (local)

Populates `dropship_listings.supplier_price` / `supplier_currency` /
`supplier_price_checked_at` by rendering each AliExpress product page with a
real browser and reading the price from the DOM.

## Why this runs locally, not on Vercel

AliExpress renders the product detail page **client-side** (`window._d_c_.isCSR
= true`). The price is **not in the server HTML** — it's fetched by the page's
JavaScript from AliExpress's internal `mtop` API. So the old in-app approach
(`fetch()` + regex-parse the HTML in `src/lib/integrations/aliexpress/scrape.ts`)
cannot find a price no matter how the request is dressed up.

Two problems, both solved by running here:

1. **CSR** — a real browser (Playwright) runs the page JS, so the price appears
   in the DOM where we can read it.
2. **Datacenter-IP bot wall** — serverless functions hit AliExpress from cloud
   IPs, which get captcha/"punish" pages. Your machine's residential IP mostly
   doesn't.

## Prerequisites

- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
  (already present for the app).
- Playwright's Chromium: `npx playwright install chromium` (once).

## Usage

```bash
# Dry run first — scrape + print, write nothing:
npm run scrape:aliexpress -- --dry-run --limit=5

# Real run (writes the snapshot back to the tenant schema):
npm run scrape:aliexpress

# One listing, watching the browser:
npm run scrape:aliexpress -- --id=<listing-uuid> --headful
```

Flags:

| Flag | Meaning |
|---|---|
| `--limit=N` | Process at most N listings this run (batch cap) |
| `--id=<uuid>` | Only this listing (ignores the age filter) |
| `--max-age-hours=N` | Skip listings checked within the last N hours (default 12) |
| `--force` | Re-check everything, ignoring `--max-age-hours` |
| `--min-delay=SEC` / `--max-delay=SEC` | Delay window between listings (default 10–25s) |
| `--dry-run` | Scrape + print, no DB writes |
| `--headful` | Show the browser window |
| `--schema=NAME` | Tenant schema (default `tenant_kaufnest`) |

## Beating AliExpress throttling (important)

AliExpress rate-limits a burst of requests from one IP: the first few succeed,
then it serves **price-less pages** ("soft block", reported as `~ soft block`)
and eventually **captchas** ("hard block", `⛔`). This is the main reason a big
run fails partway. The script fights it by:

- pacing slowly with a long **randomized 10–25s delay** between listings,
- **retrying a soft-blocked page** up to 3× with growing backoff,
- **skipping listings checked in the last 12h**, so you can just re-run to mop
  up the ones that were blocked — no manual tracking,
- **stopping early after 3 captchas in a row** (your IP needs to cool off).

**Recommended workflow for the full set:** run it, let it do what it can, and if
it reports soft/hard blocks, wait ~15–30 min and run it again. Each re-run only
touches listings not already checked, so it converges. For a gentler first pass
use a batch cap, e.g. `--limit=10`, a few times.

The price renders into the visible page text (e.g. `9,49€`); AliExpress
obfuscates the price element's CSS classes, so we read it from the rendered body
text, not a selector.

## Files

- `scrape-prices.mjs` — the runnable script (Playwright + Supabase service role).
- `parsePrice.mjs` — pure price/stock/URL helpers (no I/O).
- `parsePrice.test.mjs` — `node --test` unit tests (`npm run scrape:aliexpress:test`).

## Notes

- Sequential with a long 10–25s jittered delay; scale is meant for ≤~100
  listings. A full run of ~37 takes roughly 10–15 min (longer with backoffs).
- Stock is parsed and printed but **not persisted** — `dropship_listings` has no
  stock column yet. Add one (migration + `DropshipListing` type + UI) before
  wiring `parseStock`'s result into `persist()`.
- Price extraction reads the **rendered body text** and takes the first currency
  match, which is normally the sale price but could occasionally catch a
  crossed-out "was" price or a coupon. `--dry-run` prints the matched text so you
  can spot-check. To target the exact price node instead, share the price
  element's HTML (Chrome → right-click price → Inspect) and wire a selector into
  `waitForPriceText`.
