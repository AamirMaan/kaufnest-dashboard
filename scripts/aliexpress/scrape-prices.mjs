#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Local AliExpress price/stock scraper (run on YOUR machine, not on Vercel).
//
// Why local: AliExpress renders the product detail page client-side (isCSR),
// so the price is NOT in the server HTML — a plain fetch can never parse it.
// A real browser is required to run the page JS. Running it locally also uses
// your residential IP, which sidesteps the datacenter bot wall that blocks
// serverless scraping. See src/app/dashboard/dropshipping/SKILL.md.
//
// The price renders into the visible page text (e.g. "9,49€"); AliExpress
// obfuscates/randomizes the price element's CSS classes, so we read it from the
// rendered body text rather than a brittle selector.
//
// Anti-throttle: AliExpress rate-limits a burst of requests from one IP — the
// first few work, then it serves price-less pages (soft block) and eventually
// captchas (hard block). So this script paces slowly with long jittered delays,
// retries a soft-blocked page with backoff, skips listings checked recently
// (so re-runs only mop up stragglers), supports a --limit batch cap, and stops
// early if it hits a run of hard blocks (your IP needs to cool off).
//
// Usage (service-role key + project URL come from .env.local):
//   node --env-file=.env.local scripts/aliexpress/scrape-prices.mjs [flags]
//   npm run scrape:aliexpress -- [flags]
//
// Flags:
//   --limit=N          process at most N listings this run (batch cap)
//   --id=<uuid>        only this listing (ignores the age filter)
//   --max-age-hours=N  skip listings checked within the last N hours (default 12)
//   --force            ignore --max-age-hours (re-check everything)
//   --min-delay=SEC    min delay between listings (default 10)
//   --max-delay=SEC    max delay between listings (default 25)
//   --dry-run          scrape + print, do NOT write to the DB
//   --headful          show the browser window (debugging)
//   --schema=NAME      tenant schema (default: tenant_kaufnest)
// ---------------------------------------------------------------------------

import pw from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { parsePriceString, parseStock, resolveSupplierUrl } from "./parsePrice.mjs";

const { chromium } = pw;

// ── args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const DRY_RUN = !!args["dry-run"];
const HEADFUL = !!args.headful;
const FORCE = !!args.force;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const ONLY_ID = typeof args.id === "string" ? args.id : null;
const MAX_AGE_HOURS = args["max-age-hours"] ? parseFloat(args["max-age-hours"]) : 12;
const MIN_DELAY_MS = (args["min-delay"] ? parseFloat(args["min-delay"]) : 10) * 1000;
const MAX_DELAY_MS = (args["max-delay"] ? parseFloat(args["max-delay"]) : 25) * 1000;
const SCHEMA =
  typeof args.schema === "string" ? args.schema : process.env.TENANT_SCHEMA ?? "tenant_kaufnest";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: node --env-file=.env.local scripts/aliexpress/scrape-prices.mjs"
  );
  process.exit(1);
}

// ── pacing / retry knobs ────────────────────────────────────────────────────
const NAV_TIMEOUT_MS = 45000;
const PRICE_WAIT_MS = 12000; // how long to wait for the CSR price on one attempt
const SOFT_BLOCK_ATTEMPTS = 3; // reloads for a price-less (soft-blocked) page
const SOFT_BACKOFF_MS = 15000; // grows per attempt
const HARD_BLOCK_COOLDOWN_MS = 60000; // pause after a captcha/punish page
const HARD_BLOCK_ABORT = 3; // stop the run after this many hard blocks in a row

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.round(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: SCHEMA } });

// Waits for the client-side price to render, returns the matched price text or null.
async function waitForPriceText(page) {
  try {
    await page.waitForFunction(
      () => /(?:€|EUR|US\s?\$|\$|£)\s?[\d.,]+|[\d.,]+\s?(?:€|EUR|\$|£)/.test(document.body.innerText),
      { timeout: PRICE_WAIT_MS }
    );
  } catch {
    return null; // price never appeared within the window
  }
  return page.evaluate(() => {
    const m = document.body.innerText.match(
      /(?:€|EUR|US\s?\$|\$|£)\s?[\d.,]+|[\d.,]+\s?(?:€|EUR|\$|£)/
    );
    return m ? m[0] : null;
  });
}

async function isHardBlocked(page) {
  if (/punish|_____tmd_____|nc_1/i.test(page.url())) return true;
  const content = await page.content().catch(() => "");
  return /slidecaptcha|x5secdata|punish|baxia-dialog|nc_wrapper/i.test(content);
}

async function readStock(page) {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/[^.\n]*(?:available|verfügbar|übrig|left)[^.\n]*/i);
    return m ? m[0].trim().slice(0, 120) : null;
  });
}

// Returns { status: "ok"|"soft_block"|"hard_block"|"no_price"|"error", ... }
async function scrapeOne(context, listing) {
  const url = resolveSupplierUrl(listing.source_url, listing.source_platform, listing.sku);
  if (!url) return { id: listing.id, status: "error", error: "no resolvable AliExpress URL" };

  for (let attempt = 1; attempt <= SOFT_BLOCK_ATTEMPTS; attempt++) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      if (await isHardBlocked(page)) {
        return { id: listing.id, status: "hard_block", url };
      }

      const priceText = await waitForPriceText(page);
      if (!priceText) {
        // Rendered but no price → likely a soft block. Re-check for a late captcha.
        if (await isHardBlocked(page)) return { id: listing.id, status: "hard_block", url };
        if (attempt < SOFT_BLOCK_ATTEMPTS) {
          await page.close();
          await sleep(SOFT_BACKOFF_MS * attempt);
          continue;
        }
        return { id: listing.id, status: "soft_block", url };
      }

      const parsed = parsePriceString(priceText);
      if (!parsed) {
        return { id: listing.id, status: "no_price", url, error: `unparseable: ${priceText}` };
      }

      const stockText = await readStock(page);
      return {
        id: listing.id,
        status: "ok",
        url,
        derived: !listing.source_url,
        price: parsed.price,
        currency: parsed.currency,
        stock: parseStock(stockText),
        rawPrice: priceText,
      };
    } catch (err) {
      if (attempt >= SOFT_BLOCK_ATTEMPTS) {
        return { id: listing.id, status: "error", url, error: err?.message ?? "navigation failed" };
      }
      await sleep(SOFT_BACKOFF_MS * attempt);
    } finally {
      await page.close().catch(() => {});
    }
  }
  return { id: listing.id, status: "soft_block", url };
}

async function persist(r) {
  // customs_tax_amount is a flat, independently-set fee — a price refresh
  // must not touch it.
  const patch = {
    supplier_price: r.price,
    supplier_currency: r.currency,
    supplier_price_checked_at: new Date().toISOString(),
    ...(r.derived ? { source_url: r.url, source_platform: "aliexpress" } : {}),
  };
  const { error } = await supabase.from("dropship_listings").update(patch).eq("id", r.id);
  if (error) throw new Error(error.message);
}

function isStale(listing) {
  if (FORCE || ONLY_ID) return true;
  if (!listing.supplier_price_checked_at) return true;
  const ageMs = Date.now() - new Date(listing.supplier_price_checked_at).getTime();
  return ageMs >= MAX_AGE_HOURS * 3600_000;
}

async function main() {
  let query = supabase
    .from("dropship_listings")
    .select("id, title, sku, source_url, source_platform, currency, supplier_price_checked_at")
    .order("supplier_price_checked_at", { ascending: true, nullsFirst: true });
  if (ONLY_ID) query = query.eq("id", ONLY_ID);

  const { data: rows, error } = await query;
  if (error) {
    console.error(`DB read failed: ${error.message}`);
    process.exit(1);
  }

  const resolvable = rows.filter((l) =>
    resolveSupplierUrl(l.source_url, l.source_platform, l.sku)
  );
  const stale = resolvable.filter(isStale);
  const checkable = stale.slice(0, LIMIT);
  const skippedFresh = resolvable.length - stale.length;
  const cappedOut = stale.length - checkable.length;

  console.log(
    `Schema: ${SCHEMA} | ${rows.length} listings, ${resolvable.length} resolvable, ` +
      `${checkable.length} to process` +
      (skippedFresh > 0 ? ` (${skippedFresh} skipped: checked <${MAX_AGE_HOURS}h ago)` : "") +
      (cappedOut > 0 ? ` (${cappedOut} deferred by --limit=${LIMIT})` : "") +
      `\nDelay ${MIN_DELAY_MS / 1000}-${MAX_DELAY_MS / 1000}s between listings${DRY_RUN ? " | DRY RUN" : ""}`
  );
  if (checkable.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({
    locale: "de-DE",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  const tally = { ok: 0, soft_block: 0, hard_block: 0, no_price: 0, error: 0, wrote: 0 };
  let consecutiveHardBlocks = 0;
  let aborted = false;

  for (let i = 0; i < checkable.length; i++) {
    const listing = checkable[i];
    const label = `[${i + 1}/${checkable.length}] ${String(listing.title ?? "").slice(0, 46)}`;
    const r = await scrapeOne(context, listing);
    tally[r.status]++;

    if (r.status === "ok") {
      consecutiveHardBlocks = 0;
      const stock = r.stock != null ? `, stock ~${r.stock}` : "";
      console.log(`✓ ${label} → ${r.price} ${r.currency}${stock}`);
      if (!DRY_RUN) {
        try {
          await persist(r);
          tally.wrote++;
        } catch (e) {
          console.log(`  ⚠ write failed: ${e.message}`);
        }
      }
    } else if (r.status === "hard_block") {
      consecutiveHardBlocks++;
      console.log(`⛔ ${label} → hard block (captcha). Cooling down ${HARD_BLOCK_COOLDOWN_MS / 1000}s…`);
      if (consecutiveHardBlocks >= HARD_BLOCK_ABORT) {
        console.log(
          `\nStopping early: ${consecutiveHardBlocks} captchas in a row — your IP needs to cool off. ` +
            `Wait ~15–30 min, then re-run (already-checked listings are skipped).`
        );
        aborted = true;
        break;
      }
      await sleep(HARD_BLOCK_COOLDOWN_MS);
      continue; // don't add the normal delay on top of the cooldown
    } else if (r.status === "soft_block") {
      consecutiveHardBlocks = 0;
      console.log(`~ ${label} → soft block (price didn't render after ${SOFT_BLOCK_ATTEMPTS} tries)`);
    } else if (r.status === "no_price") {
      consecutiveHardBlocks = 0;
      console.log(`✗ ${label} → ${r.error}`);
    } else {
      consecutiveHardBlocks = 0;
      console.log(`✗ ${label} → ${r.error}`);
    }

    if (i < checkable.length - 1) await sleep(jitter());
  }

  await browser.close();

  const failed = tally.soft_block + tally.hard_block + tally.no_price + tally.error;
  console.log(
    `\nDone${aborted ? " (stopped early)" : ""}. ${tally.ok} ok` +
      `${DRY_RUN ? "" : ` (${tally.wrote} written)`}, ${failed} failed` +
      ` [soft ${tally.soft_block}, hard ${tally.hard_block}, no-price ${tally.no_price}, error ${tally.error}].`
  );
  if (tally.soft_block + tally.hard_block > 0) {
    console.log("Re-run later to retry the blocked ones — recently-checked listings are skipped automatically.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
