---
name: shipping-labels
description: Reference for the shipping-label-generation library at src/lib/shipping (EasyPost REST wrapper, CompanyProfile/Sale address mappers) — use when touching label purchase, carrier rates, or the two /api/shipping/* routes.
---

# Shipping label library (`src/lib/shipping/`)

Server-only shared code (never imported from a Client Component — it calls
EasyPost with a server-side API key). Consumed by
`src/app/api/shipping/rates/route.ts` and
`src/app/api/shipping/buy/route.ts`. The dashboard feature
(`src/app/dashboard/sales/[id]/page.tsx`'s Shipping card +
`_components/GenerateLabelModal.tsx`) never imports this directly — it only
calls the two API routes over `fetch`.

## Files

- `easypost.ts` — thin wrapper over EasyPost's REST API
  (`https://api.easypost.com/v2`), auth via HTTP Basic with
  `EASYPOST_API_KEY` as the username (empty password — EasyPost's own
  convention). Two functions:
  - `getRates(fromAddress, toAddress, parcel) → Promise<EasyPostRatesResult>`
    (`{ easypostShipmentId, rates: EasyPostRate[] }`) — `POST /shipments`.
  - `buyLabel(shipmentId, rateId) → Promise<EasyPostLabel>`
    (`{ trackingNumber, labelUrl, labelFormat }`) — `POST
    /shipments/{id}/buy`.
  - Both throw a plain `Error` with EasyPost's own `error.message` on a
    non-2xx response (a generic status-code message when EasyPost's
    response has no `error.message`) — the API routes catch and surface
    this, never letting a raw EasyPost payload reach the client.
  - `EasyPostRate.rate` is a **decimal string** (e.g. `"7.50"`), not a
    number — `parseFloat()` it before formatting/arithmetic (see
    `GenerateLabelModal.tsx` and the `/api/shipping/buy` route for the
    pattern).
- `addressMappers.ts` — `addressFromCompanyProfile(profile)` /
  `addressFromSale(sale)`, both pure, both throw a descriptive `Error`
  naming the specific missing field when a required one
  (street1/city/postal_code/country, under each type's own prefix —
  `ship_from_*` for `CompanyProfile`, `shipping_*` for `Sale`) is null.
  These are the "sender address not configured" / "buyer address not
  captured" guards the two API routes rely on to fail with a clean 400
  instead of a confusing EasyPost validation error. The order detail page
  duplicates the same completeness check client-side (see
  `dashboard/sales/CLAUDE.md`) so the "Generate Shipping Label" button
  never appears when it's guaranteed to fail — belt and suspenders,
  deliberately not deduplicated since each check is cheap and lives at a
  different layer.

## The two API routes

- **`POST /api/shipping/rates`** (`src/app/api/shipping/rates/route.ts`) —
  body `{ saleId, weightOz, lengthIn?, widthIn?, heightIn? }`. Guarded by
  `requireIntegrationAdmin()` (`src/lib/integrations/authGuard.ts` — reused
  as-is, it has no eBay-specific logic despite living in that folder).
  Loads the `sale` and `company_profile` rows via the tenant-scoped
  `createClient()`, builds both addresses via the mappers above, calls
  `getRates`, returns `{ easypostShipmentId, rates }`. A thrown
  address-completeness error becomes `400 { error: message }`.
- **`POST /api/shipping/buy`** (`src/app/api/shipping/buy/route.ts`) — body
  `{ saleId, easypostShipmentId, rateId, weightOz, carrier, service, cost, costCurrency }`.
  Same guard, plus body validation now also rejects a `cost` that is present
  but not a `number` (final-review fix — it used to reach the insert
  untyped and could only fail as a confusing Postgres error after a label
  was already purchased). **Before calling `buyLabel()`**, queries
  `shipments` for an existing row with this `saleId` and 400s
  ("This order already has a shipping label…") without ever hitting
  EasyPost if one exists — this is the real guard against buying two real
  labels for one order (`shipments.sale_id` has no unique constraint, and
  the order-detail page's shipment fetch could otherwise silently show
  "Generate Shipping Label" again if a duplicate ever existed — see
  `dashboard/sales/CLAUDE.md`'s Shipping labels section). Then calls
  `buyLabel`, then inserts a `shipments` row. **Does not re-fetch the rate
  from EasyPost** — `carrier`/`service`/`cost`/`costCurrency` are trusted
  from the client because they only affect what's *displayed*; `rateId`
  alone determines what EasyPost actually charges, and it was already shown
  to and chosen by the user against this same route's own `/rates` response
  in the previous step. Writes an audit log entry (`entityType: "shipment"`,
  `action: "create"`) after a successful insert. If the insert fails after a
  successful EasyPost purchase, returns a 500 naming the tracking number
  (the label WAS bought at that point — the seller needs a way to find it
  manually) rather than a generic error.

Both routes are real API routes (not client-direct Supabase calls)
specifically because they call out to EasyPost with a server-side API key —
same "server-only, never client-side" rule as every other file under
`src/lib/integrations/`/`src/lib/shipping/`.

## `shipments` table

One row per purchased label (`supabase/migrations/043_shipments.sql`, see
`supabase/SKILL.md`). RLS: any authenticated tenant member can `SELECT`,
only `admin`/`super_admin` can `INSERT` — mirrors `platform_payouts`. No
`UPDATE`/`DELETE` policy — v1 has no edit/void/refund flow (EasyPost
supports refunding a label; not wired up here, see the design spec's scope
note). No unique constraint on `sale_id` — the app enforces "one shipment
per order" only at the UI level (the Shipping card's state 3 has no
"generate another" button), not in the schema.

## Gotchas

- **`EASYPOST_API_KEY` test-mode keys start with `EZTK`** and return
  realistic fake rates without charging anything — use one for local dev
  (`.env.local.example`). A production key is required to actually purchase
  a real label.
- **Never call the real EasyPost API from a test.** Both `easypost.test.ts`
  and any future test in this module must mock `global.fetch` — see
  `easypost.test.ts` for the pattern (modeled on
  `src/lib/integrations/ebay/tradingApi.test.ts`).
- **This module has a hard dependency on two sibling features**:
  `Sale.shipping_*`/`buyer_*` fields (buyer address capture) and
  `CompanyProfile.ship_from_*` fields (structured sender address). If
  either is missing from `src/types/index.ts`, this whole module fails to
  type-check — that's intentional, not a bug to work around (see
  `docs/superpowers/plans/2026-09-04-shipping-label-generation.md`'s Global
  Constraints for the full story).
- **Shared platform EasyPost account (known limitation, accepted for now):**
  all tenants currently purchase labels against a single
  `EASYPOST_API_KEY` — there is no per-tenant EasyPost credential, and
  neither `/api/shipping/rates` nor `/api/shipping/buy` has a plan gate
  (unlike `/api/integrations/*` routes, which check
  `hasPlatformIntegrations(plan)`). This was a deliberate scope decision to
  ship label purchasing now; per-tenant EasyPost accounts and/or a plan
  gate are accepted future work, not an oversight — do not silently "fix"
  this without a product decision, see
  `docs/superpowers/plans/2026-09-04-shipping-label-generation.md`'s Global
  Constraints for context.
- **Two separate tracking-number stores, deliberately unlinked:**
  `sales.tracking_number`/`shipping_carrier` (written by the eBay
  order-status push-back feature) and `shipments.tracking_number` (written
  by this feature, when a label is purchased in-app) are NOT automatically
  synced. A seller who buys a label here must still manually copy the
  tracking number into "Edit Order" if they want it pushed to eBay. This is
  an explicit scope decision (see the design spec's "Explicitly out of
  scope" section), not a bug.
