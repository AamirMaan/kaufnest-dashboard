# Dropshipping — Agent Playbook

## Minimal file set per change type

| Change | Files to touch |
|---|---|
| Add a column to `dropship_listings` | new file in `supabase/migrations/` targeting `tenant_kaufnest.dropship_listings` directly (KaufNest-only feature — table exists in NO other schema, do NOT use `run_on_all_tenant_schemas` or `provision_tenant_schema()`), `src/types/index.ts` (`DropshipListing`), `_store/dropshippingSlice.ts` (if reducer needs updating), API routes that upsert |
| Change AliExpress price scraping | `src/lib/integrations/aliexpress/scrape.ts` (fetch + HTML parsing + mobile retry), `.../aliexpress/session.ts` + its test (cookie jar, UA pool, jitter, headers), `src/app/api/dropshipping/listings/check-prices/route.ts` (orchestration/storage) |
| Change source platform detection logic | `src/lib/utils/detectPlatform.ts` + its test |
| Change the numeric-SKU-\>AliExpress-URL rule | `src/lib/utils/detectPlatform.ts` (`isAliExpressSku`/`aliExpressUrlFromSku`) + its test — single shared source, consumed by `scrape.ts` (server), `ListingsTable.tsx` (`canCheckSupplierPrice` + `SourceBadge` display fallback), and `resolveInitialSourceUrl.ts` (modal prefill) |
| Add a new column to the listings table | `_components/ListingsTable.tsx` — add `TableHead` + `TableCell` |
| Change eBay listing fields fetched | `src/lib/integrations/ebay/listings.ts` → update `EbayOffer`/`EbayInventoryItem` interfaces and mapping |
| Add an action to the Redux slice | `_store/dropshippingSlice.ts` + `_store/dropshippingSlice.test.ts` |
| Change refresh logic | `src/app/api/dropshipping/listings/refresh/route.ts` |
| Change source URL editing | `_components/EditSourceModal.tsx` + PATCH route |
| Update docs | `CLAUDE.md` (file map / data flow), `SKILL.md` (this file) |
| Add a new platform-admin-only route | new route file + add `verifyPlatformAdmin` guard — also update `proxy.ts` matcher and `Sidebar.tsx` if it has a new nav entry |
| Pagination (client-side) | `_components/ListingsTable.tsx` only — `page`/`pageSize` local state, `pagedListings` useMemo slice, `<Pagination>` component |

## Gotchas

- **⚠ AliExpress detail pages are client-side-rendered — the in-app HTML scraper cannot get a
  price. USE THE LOCAL SCRIPT.** As of 2026-07, `de.aliexpress.com/item/*` returns a CSR shell
  (`window._d_c_.isCSR = true`, empty `window.runParams`, **zero price/€ text in the HTML**);
  the price is fetched afterward by page JS from AliExpress's internal `mtop` API. So
  `scrapeAliExpressPrice` (plain `fetch` + `parseJsonLd`/`parseOgMeta`/`parseRunParams`) now
  **always** fails with "Could not find a price", regardless of headers/cookies/UA/IP — the
  data it parses simply isn't in the response. This means the in-app **check-prices route and
  its `session.ts` hardening are effectively dead** (kept only until removed/replaced). The
  working replacement is `scripts/aliexpress/scrape-prices.mjs` — a **local** Playwright script
  that renders the page in a real browser (runs the JS → price appears in the DOM) from your
  **residential IP** (dodges the datacenter bot wall). Run `npm run scrape:aliexpress -- --dry-run`.
  See `scripts/aliexpress/README.md`. Pure parsing helpers + `node --test` unit tests live in
  `scripts/aliexpress/parsePrice.mjs` / `.test.mjs`. Do NOT invest more in header/cookie tricks
  on the serverless path — if you ever need it in-app, the route is a headless-browser service
  or the official affiliate API (`aliexpress.affiliate.productdetail.get`), not more `fetch`.
  Two things learned running the local script: (a) **the price element's CSS classes are
  obfuscated/randomized** — `[class*="price--current"]` etc. match nothing; read the price from
  the **rendered body text** (e.g. `9,49€`), which the script does. (b) **AliExpress rate-limits
  bursts even from a residential IP** — the first few listings scrape fine, then it serves
  price-less pages (soft block, looks like "no price found") and finally captchas (hard block).
  The script counters with long 10–25s jittered delays, soft-block retry+backoff, a captcha
  circuit-breaker (stops after 3 in a row), and a skip-checked-in-last-12h filter so
  **re-running mops up stragglers** — that re-run loop is the intended workflow for the full set,
  not a single perfect pass.

- **AliExpress scraping is best-effort (LEGACY — see the CSR gotcha above; this path no longer
  finds a price):** AliExpress serves captcha/"punish" pages to bots.
  `scrapeAliExpressPrice` tries JSON-LD → og:price meta → `runParams` regex, throws a
  user-readable error otherwise. The check-prices route runs sequentially with a randomized
  2.5–5s delay (`jitterDelayMs`) and caps at 50 listings per run — do NOT parallelize and do
  NOT go back to a fixed cadence, both trigger bot protection. The route declares
  `maxDuration = 300` (worst case ≈ 5 min on Vercel); lower the cap if the host allows less.

- **Anti-block session hardening (session.ts):** each bulk run calls
  `createScrapeSession()` once — a warm-up fetch of the AliExpress homepage that collects
  anti-bot cookies (`buildCookieHeader`) and pins one browser identity (`pickBrowserIdentity`)
  for the whole batch. Do NOT rotate the User-Agent per request: mixing UAs on one cookie jar
  looks *more* bot-like, not less. Chrome identities carry matching `sec-ch-ua*` client hints;
  Firefox/Safari deliberately don't (real ones don't send them). On a blocked response
  (`BlockedError`: punish redirect / 403 / 429 / captcha page), `scrapeAliExpressPrice`
  retries once via `m.aliexpress.com` (`toMobileUrl`) before giving up. Warm-up failure is
  non-fatal — it degrades to a cookieless session. All the pure pieces live in `session.ts`
  with colocated tests; only the two `fetch`es live in `scrape.ts`. This is best-effort
  hardening: a datacenter IP can still get blocked — the documented next step is a
  scraping-proxy API, not more header tweaking.

- **SKU = AliExpress item ID convention:** the seller stores the AliExpress item ID as the
  eBay Custom Label. A numeric SKU (6–20 digits) is treated as an AliExpress item ID and the
  supplier URL is derived from it via `isAliExpressSku`/`aliExpressUrlFromSku` in
  `src/lib/utils/detectPlatform.ts` — the single shared source of truth (previously duplicated
  across a server/client pair; now one helper used by `scrape.ts` `resolveSupplierUrl` (server),
  `ListingsTable.tsx` `canCheckSupplierPrice` + `SourceBadge`'s display-only fallback link
  (client), and `resolveInitialSourceUrl.ts` for the edit modal's prefill (client). Editing the
  pattern only requires touching `detectPlatform.ts` + its test.
  Note the display fallback in `SourceBadge` and the modal prefill in `EditSourceModal` are
  **not** the same as persistence: the derived URL is only written to `dropship_listings.source_url`
  once the admin opens the modal and clicks Save (or a price check runs — see below).

- **Supplier snapshot preservation:** like `source_url`, the `supplier_price*` columns are
  excluded from the eBay refresh upsert payload and preserved in `upsertListings` (Redux),
  so an eBay refresh never wipes scraped prices.

- **`source_url`/`source_platform` preservation on refresh:** `upsertListings` Redux action
  deliberately preserves existing `source_url`/`source_platform` from the current state when
  the same `ebay_listing_id` is re-fetched. The DB upsert does NOT include those columns in the
  upserted payload, so the DB also preserves them. Both layers independently protect supplier links.

- **eBay scope re-authorization:** The `sell.inventory.readonly` scope was added after some
  connections were created. If `fetchActiveListings` throws "eBay returned 403 Forbidden",
  the user must disconnect and reconnect eBay in `/dashboard/integrations` to get the new scope.

- **eBay errorId 25707 — missing or non-alphanumeric SKUs on `/offer`:** The Inventory API's
  `/offer?limit=200` endpoint rejects the **entire request** with errorId 25707 when any
  listing in the seller's account has a missing or non-alphanumeric SKU (Custom Label).
  This happens with listings created via the older Trading API without a Custom Label — eBay's
  Inventory API requires all listings to have a valid alphanumeric SKU. This is NOT a SKU we
  send; eBay validates the stored SKUs of all the seller's offers server-side. The `/offer`
  call is the primary data source so this error is re-thrown with a message directing the user
  to eBay Seller Hub → Active Listings → add an alphanumeric Custom Label to every listing.
  The `/inventory_item` call has the same failure mode but is non-fatal (wrapped in its own
  `try/catch`), since it only enriches title/image.

- **Button.tsx naming conflict:** macOS case-insensitive filesystem means `Button.tsx` and
  `button.tsx` resolve to the same file. **Never run `npx shadcn add button`** — it will
  overwrite the custom Button with a different variant API. Use `@/components/ui/Button`
  (variants: `"primary"/"secondary"/"danger"/"ghost"`).

- **Platform-admin-only feature (four-layer gate):** Dropshipping is not visible to any
  regular tenant. Gate is enforced at: (1) `Sidebar.tsx` — `showDropshippingLink = isPlatformAdmin`,
  rendered in the same section as Admin Panel; (2) `proxy.ts` — `/dashboard/dropshipping`
  redirects non-platform-admins to `/dashboard`; (3) all four `/api/dropshipping/*` routes —
  gated with `verifyPlatformAdmin(user.email)` from `@/lib/supabase/control`; (4)
  `dashboard/layout.tsx` — `dropshipListings` hydrated into Redux only when `isAdmin` is true.
  `verifyPlatformAdmin` is a thin wrapper around `isPlatformAdmin` that returns a `NextResponse`
  (403) or `null`. Use `const forbidden = await verifyPlatformAdmin(user.email); if (forbidden) return forbidden;`.

- **Refresh is admin/super_admin only (within platform admin):** The "Refresh from eBay"
  button is hidden from accountants via `hasPermission(role, "manage_integrations")`. The
  `POST /api/dropshipping/listings/refresh` route uses `requireIntegrationAdmin()` in addition
  to `verifyPlatformAdmin()` — both must pass.

- **Client-side pagination (Phase 2):** `ListingsTable` now paginates the passed `listings`
  array locally (default 25/page). The fetch cap is still 200 listings per refresh. If the
  cap needs lifting (server-side cursor pagination on the eBay API side), that belongs in
  `fetchActiveListings` + the refresh route, not in `ListingsTable`.

- **`formatCurrency` currency arg:** `formatCurrency(price, currency)` — always pass the
  `currency` field from the listing row (not hardcoded EUR), since sellers may list in GBP,
  USD, etc. Example: `formatCurrency(listing.current_price, listing.currency as Currency)`.

- **`PageHeader` action prop (singular):** Use `action` not `actions` when passing the refresh
  button to `PageHeader`. A single node is expected, not an array.

- **Toast API:** `useToast()` returns `{ toast, success, warning, error, info }`. Use `success(message)`
  and `error(message)` for async operations. Do not destructure as `{ addToast }` — that's from the
  old API.

- **State reset pattern:** `EditSourceModal` uses `key={editTarget?.id ?? "none"}` to remount
  the modal when the edit target changes. This resets internal state (URL input) without explicit
  `useEffect` cleanup.

- **shadcn `dark:` variants don't work:** The project uses `[data-theme="dark"]` on `<html>`,
  not a `.dark` class. Any `dark:` Tailwind variants in shadcn components will not respond
  to the theme toggle. Use `var(--color-*)` CSS variables or the mapped shadcn tokens
  (`bg-card`, `text-muted-foreground`, etc.) which cascade correctly.

- The margin badge in `SupplierPriceCell` is fed by
  `computeMarginPct`/`marginBadgeVariant` (`_components/marginMath.ts`, pure +
  unit-tested) — don't recompute margin math inline in the component; extend
  the pure helper instead so the tests stay meaningful.
- `customs_tax_amount` is always derived (`supplier_price × customs_tax_rate /
  100`) — never accept it as direct user input. Any code path that updates
  `supplier_price` (refresh, price-check route, the Playwright script) must
  also recompute `customs_tax_amount` if a rate is already set, or the two
  columns silently drift out of sync.
