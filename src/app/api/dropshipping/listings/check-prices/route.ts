import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyPlatformAdmin } from "@/lib/supabase/control";
import {
  createScrapeSession,
  resolveSupplierUrl,
  scrapeAliExpressPrice,
} from "@/lib/integrations/aliexpress/scrape";
import { jitterDelayMs } from "@/lib/integrations/aliexpress/session";
import type { DropshipListing } from "@/types";

// Sequential with a randomized human-ish delay (2.5–5s, `jitterDelayMs`) —
// parallel or fixed-cadence scraping trips AliExpress bot protection.
const MAX_LISTINGS_PER_RUN = 50;

// Worst case ~50 listings × ~5s+fetch ≈ 5 min. Honored on Vercel; harmless elsewhere.
export const maxDuration = 300;

export interface PriceCheckResult {
  id: string;
  ok: boolean;
  supplier_price?: number;
  supplier_currency?: string;
  supplier_price_checked_at?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forbidden = await verifyPlatformAdmin(user.email);
  if (forbidden) return forbidden;

  // Optional body: { id: "<listing uuid>" } checks a single listing; empty body checks all.
  let singleId: string | null = null;
  try {
    const body = (await req.json()) as { id?: string };
    singleId = body.id ?? null;
  } catch {
    // no body — bulk check
  }

  let query = client.from("dropship_listings").select("*");
  if (singleId) query = query.eq("id", singleId);
  const { data: listings, error } = await query.returns<DropshipListing[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const checkable = (listings ?? [])
    .map((l) => ({ listing: l, url: resolveSupplierUrl(l.source_url, l.source_platform, l.sku) }))
    .filter((c): c is { listing: DropshipListing; url: string } => c.url !== null)
    .slice(0, MAX_LISTINGS_PER_RUN);

  if (checkable.length === 0) {
    return NextResponse.json(
      { error: "No listings with an AliExpress link or numeric SKU (AliExpress item ID) found." },
      { status: 400 }
    );
  }

  // One warm-up request per run: collects anti-bot cookies + a browser
  // identity that every item-page fetch below reuses.
  const session = await createScrapeSession();

  const results: PriceCheckResult[] = [];

  for (let i = 0; i < checkable.length; i++) {
    const { listing, url } = checkable[i];

    try {
      const { price, currency } = await scrapeAliExpressPrice(url, session);
      const checkedAt = new Date().toISOString();

      const { error: updateError } = await client
        .from("dropship_listings")
        .update({
          supplier_price: price,
          supplier_currency: currency,
          supplier_price_checked_at: checkedAt,
          ...(listing.customs_tax_rate != null
            ? { customs_tax_amount: Math.round(price * listing.customs_tax_rate) / 100 }
            : {}),
          // Persist the derived URL so the Source column links the listing too.
          ...(listing.source_url
            ? {}
            : { source_url: url, source_platform: "aliexpress" }),
        })
        .eq("id", listing.id);

      if (updateError) throw new Error(updateError.message);

      results.push({
        id: listing.id,
        ok: true,
        supplier_price: price,
        supplier_currency: currency,
        supplier_price_checked_at: checkedAt,
      });
    } catch (err) {
      results.push({
        id: listing.id,
        ok: false,
        error: err instanceof Error ? err.message : "Price check failed",
      });
    }

    if (i < checkable.length - 1) await sleep(jitterDelayMs());
  }

  return NextResponse.json({
    checked: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
