---
name: integrations-library
description: Reference for the platform-integration library at src/lib/integrations (eBay/Amazon OAuth adapters, token storage, order-review/import) — use when adding a platform, debugging OAuth/token refresh, or changing how orders map to sales rows.
---

# Platform integrations library (`src/lib/integrations/`)

Server-only shared code (never imported from a Client Component — it handles
OAuth tokens). Consumed by `src/app/api/integrations/[platform]/*` and
`src/app/api/integrations/review/*`. The dashboard feature
(`src/app/dashboard/integrations/`) never imports this directly; see its
`SKILL.md`.

## Files

- `types.ts` — `NormalizedOrder` (platform-agnostic order shape), `TokenSet`,
  `ExchangeCodeResult` (`TokenSet` + optional `externalAccountId`/
  `marketplaceId`), `PlatformAdapter` interface, `SyncResult`.
- `registry.ts` — `getAdapter(platform)` → `PlatformAdapter`,
  `isIntegrationPlatform(value)` type guard used by every API route to
  validate the `[platform]` URL segment.
- `ebay.ts` / `amazon.ts` — one `PlatformAdapter` implementation each.
  `ebay.ts` also exports `createShippingFulfillment`/`cancelOrder` — plain
  functions (not part of `PlatformAdapter`) backing the order status
  push-back route, see "eBay order status push-back" below.
- `ebay/carriers.ts` — `EBAY_CARRIER_CODES`, the fixed carrier enum eBay's
  Fulfillment API requires (`shippingCarrierCode`); used by
  `EditSaleModal.tsx`'s carrier `Select` and passed through to
  `createShippingFulfillment` by the sync-status route.
- `mapToSale.ts` — pure `normalizedOrderToSaleRow(order, platform,
  connectedBy, fees?)`. `shipping_cost`/`shipping_charged` always come out
  `null` — editable later via the Edit Sale modal, no earlier entry point
  exists for them. `advertising_fee`/`platform_fee` default to `null` too
  when `fees` is omitted, but the Review Orders page
  (`dashboard/integrations/review/page.tsx`) can supply them via the
  optional `ReviewOrderFees` 4th argument — per-order manual entry or a
  bulk percent-of-total apply, since neither eBay's nor Amazon's
  order-listing API returns a fee breakdown at that granularity (added
  2026-08-27). Has a colocated `mapToSale.test.ts`.
- `tokenStore.ts` — `getConnection`, `upsertConnection`,
  `ensureValidAccessToken` (refresh-on-demand). `getConnection` decrypts,
  `upsertConnection` encrypts — see "Token encryption at rest" below.
- `tokenCrypto.ts` — `encryptToken`/`decryptToken`/`isEncryptedToken`, AES-256-GCM
  helpers used exclusively by `tokenStore.ts`. Colocated `tokenCrypto.test.ts`.
- `authGuard.ts` — `requireIntegrationAdmin()`, the shared
  session+role+tenant-schema check for the connect/callback/disconnect/review
  routes.
- `ebay/publicKey.ts`, `ebay/verifyNotificationSignature.ts` — support the
  `/api/notifications/ebay-account-deletion` webhook's signature check, not
  the main OAuth/sync flow — see "eBay account-deletion webhook" below.
- `ebay/appToken.ts` — `getApplicationToken()`, an eBay *application*
  access token (client_credentials grant, cached in-process). For calls
  against global/public eBay data rather than a specific seller's account —
  currently `publish.ts`'s `searchCategories` (Taxonomy API) and
  `publicKey.ts` (notification signing key). A per-tenant user token 403s
  on these (errorId 1100) since it's only authorized with
  `sell.fulfillment`/`sell.inventory`, not the base
  `https://api.ebay.com/oauth/api_scope` these endpoints check for.
- `ebay/tradingApi.ts` — shared eBay Trading API (legacy XML) helper:
  `tradingApiCall()`, `tagText()`/`decodeXml()`/`escapeXml()`. Extracted from
  `ebay/listings.ts` when `ebay/messages.ts` needed the same auth/
  error-handling — both files import from here now, neither defines its own
  copy. `tradingApiCall()` logs the raw response XML (truncated to 1000
  chars, no token — the token is never in the response body) via
  `console.error` on any `Ack=Failure`, so a caller's thrown message no
  longer has to be manually surfaced from the client to diagnose a real
  failure (added 2026-08-26 after a `GetMemberMessages` 502 took hours to
  diagnose with nothing in server logs — see `dashboard/messages/SKILL.md`).
  See "eBay messages (Trading API)" below.
- `ebay/messages.ts` — `fetchMemberMessages()`/`replyToMessage()`, backs the
  Messages feature (`src/app/dashboard/messages/`). See "eBay messages
  (Trading API)" below.

## The `PlatformAdapter` interface

```ts
interface PlatformAdapter {
  platform: IntegrationPlatform;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<ExchangeCodeResult>;
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  fetchOrders(accessToken: string, sinceISO: string, marketplaceId: string | null): Promise<NormalizedOrder[]>;
}
```

## Adding a third platform

1. Add the platform to `IntegrationPlatform` (`src/types/index.ts`) and the
   `platform` CHECK constraints on `platform_connections`/`sales` (one-off
   migration + `provision_tenant_schema()`, see `supabase/SKILL.md`'s "3
   places" rule).
2. Write `<platform>.ts` implementing `PlatformAdapter` — model it on
   `ebay.ts` (simpler, one token endpoint, no marketplace concept) or
   `amazon.ts` (LWA + marketplace id) depending on the new platform's OAuth
   shape.
3. Register it in `registry.ts`'s `ADAPTERS` map and `isIntegrationPlatform`.
4. Add the platform to `PLATFORMS`/`PLATFORM_LABELS` in
   `src/app/dashboard/integrations/page.tsx` and
   `_components/ConnectionCard.tsx`.
5. Document new env vars in `.env.local.example`.

Nothing else changes — the API routes and the dashboard feature are all
platform-agnostic via `getAdapter`.

## Token refresh flow

`ensureValidAccessToken(client, connection, adapter)`:
- If `connection.token_expires_at` is more than `REFRESH_MARGIN_MS` (5 min) in
  the future, returns the stored `access_token` unchanged.
- Otherwise calls `adapter.refreshAccessToken(connection.refresh_token)`,
  persists the new `access_token`/`refresh_token`/`token_expires_at` via
  `upsertConnection`, and returns the new token.
- Throws if `connection.refresh_token` is null (connection was never
  completed, or was disconnected).

The review route (`GET /api/integrations/review`) calls `ensureValidAccessToken`
before `fetchOrders` — adapters' `fetchOrders` always receive a fresh token and
never refresh themselves.

## Token encryption at rest

`platform_connections.access_token`/`refresh_token` are encrypted (AES-256-GCM,
`tokenCrypto.ts`) before every write and decrypted on every read — entirely
inside `tokenStore.ts`'s `getConnection`/`upsertConnection`, so every other
file in the codebase (adapters, API routes) only ever sees plaintext tokens
in memory and never needs to know encryption exists. **Never** call
`.from("platform_connections")` directly for these columns — always go
through `getConnection`/`upsertConnection`.

- Requires `TOKEN_ENCRYPTION_KEY` (base64, 32 bytes — `openssl rand -base64 32`)
  in every environment that reads/writes this table. Missing/wrong-length key
  throws immediately (`tokenCrypto.ts`'s `getKey()`), it does not fail silently.
- **Rollout is non-breaking by design**: `decryptToken()` checks for the
  `v1:` prefix and returns legacy (pre-encryption) plaintext values
  unchanged rather than throwing — so tokens stored before this change keep
  working. They get re-encrypted automatically the next time
  `ensureValidAccessToken` refreshes them (writes go through
  `upsertConnection`, which always encrypts) or the user reconnects the
  platform. To close that window immediately instead of waiting, run
  `npm run encrypt-existing-tokens` (optionally `-- --dry-run` first) — see
  `scripts/encrypt-existing-tokens.mjs`.
- Losing `TOKEN_ENCRYPTION_KEY` makes every already-encrypted token
  unrecoverable (not just unreadable by this app — genuinely gone). Back it
  up like any other production secret; rotating it requires decrypting with
  the old key and re-encrypting with the new one (no rotation tooling exists
  yet — this is a v1 implementation, single static key).

## eBay account-deletion webhook (`/api/notifications/ebay-account-deletion`)

Not part of the OAuth/sync flow above — this is eBay's required
"Marketplace Account Deletion/Closure" notification endpoint, which **deletes
data** (a tenant's synced eBay sales + connection row) when a seller closes
their eBay account, so it authenticates the caller before doing anything:

- `GET` — eBay's endpoint-registration challenge/response, using
  `EBAY_VERIFICATION_TOKEN` (document this in `.env.local.example` — it's
  unrelated to the OAuth `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`).
- `POST` — the actual notification. Verified via eBay's `X-EBAY-SIGNATURE`
  header (`ebay/verifyNotificationSignature.ts` parses it and checks the
  signature over the raw body; `ebay/publicKey.ts` fetches — and caches —
  eBay's signing public key by `kid`, using an eBay *application* token,
  client_credentials grant, reusing `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`).
  A missing/invalid signature returns **401 and skips cleanup** — this is
  intentionally not a silent 200, so a broken signature check is visible as
  failed deliveries in eBay's Developer Portal instead of failing open.
- Gotcha: signature verification needs the **raw request body bytes**
  (`req.text()`), not the parsed JSON — `JSON.parse` happens only after the
  signature check passes.

## eBay messages (Trading API)

There's no REST endpoint for general buyer<->seller messaging — eBay's
Post-Order API only covers returns/INR-dispute messages. General "question
about an item" messages live in the legacy **Trading API**
(`GetMemberMessages` to read, `AddMemberMessageRTQ` to reply), the same API
`ebay/listings.ts` already uses for `GetMyeBaySelling`. `ebay/tradingApi.ts`
now holds the shared `tradingApiCall()`/XML-entity helpers both files use.

- **Reuses the existing `sell.inventory` scope** — no new scope was added to
  `EBAY_SCOPE` in `ebay.ts`. This is unverified against a live eBay account
  (no sandbox test message data was available at implementation time); if
  Trading API messaging calls turn out to need a scope `sell.inventory`
  doesn't cover, `tradingApiCall()`'s existing token-error handling
  (`21916984`/`21917053`/`931`/`932` → "disconnect and reconnect" message)
  will surface it, but reconnecting alone won't fix it — see
  `src/app/dashboard/messages/SKILL.md`'s gotchas for the full explanation.
- **Reply-only in v1** — `replyToMessage()` wraps `AddMemberMessageRTQ`
  (respond to an existing message, needs its `ParentMessageID`). Starting a
  new conversation (`AddMemberMessageAAQToPartner`) isn't implemented.
- **No push sync** — same manual-only model as order review (no cron infra
  in this codebase). A user must click "Sync messages" in the Messages
  feature to pull new buyer messages in.
- User-supplied reply text is escaped via `escapeXml()`
  (`ebay/tradingApi.ts`) before being interpolated into the request XML —
  required since it's free text that could contain `&`/`<`/`>`.

## eBay order status push-back (shipped/cancelled)

`POST /api/integrations/ebay/orders/[saleId]/sync-status` (server-only,
uses `requireIntegrationAdmin()`) pushes a local `sales.status` change on an
eBay-sourced order out to
eBay's Fulfillment API — the reverse direction of `fetchOrders`/Review
Orders, which only reads from eBay. Triggered from `EditSaleModal.tsx`'s
save handler (see `dashboard/sales/CLAUDE.md`), never automatically — same
100%-manual model as the rest of this library, no cron/push infra.

- `status: "shipped"` → `createShippingFulfillment(accessToken, orderId,
  body)` in `ebay.ts` — `POST /sell/fulfillment/v1/order/{orderId}/
  shipping_fulfillment`. Requires a carrier (`shippingCarrierCode`, from the
  fixed enum in `ebay/carriers.ts`'s `EBAY_CARRIER_CODES`) and
  `trackingNumber` — both captured in `EditSaleModal`.
- `status: "cancelled"` → `cancelOrder(accessToken, orderId, body?)` in
  `ebay.ts` — `POST /post-order/v2/cancellation` (separate base path from
  the Fulfillment API, but covered by the existing `sell.fulfillment`
  scope). **This endpoint's exact request/response shape is unverified
  against eBay's live sandbox** — confirm field names against eBay's
  current API reference before relying on this in production.
- **Eligibility is one shared predicate**: `isEbayIntegrationSyncedSale(sale)`
  in **`src/lib/utils/filters.ts`** (next to `isRevenueSale`) — `platform ===
  "ebay" && external_order_id?.includes(":")`. The route 404s when it fails,
  and `EditSaleModal` uses the same call to decide whether to render the
  Carrier/Tracking fields and fire the sync. It lives in `lib/utils/` rather
  than here because `EditSaleModal` is a Client Component and the project
  verifier blocks `@/lib/integrations/*` imports from `"use client"` files.
  The `":"` check is the whole point: a **CSV-imported** eBay row
  (`sales/_components/importFormats.ts`) has `platform === "ebay"` and a
  non-null `external_order_id` copied straight from the sheet's `order_id`
  column, with no line-item suffix — the split below would then use the whole
  string as BOTH ids and eBay would reject every attempt forever.
- `external_order_id` is parsed back into eBay's `orderId`/`lineItemId` by
  splitting on the **last** `:` (`"${orderId}:${lineItemId}"`, same
  dedup-key convention as `mapToSale.ts` — see "`external_order_id` dedup
  contract" above). The predicate above guarantees the `:` is there, so there
  is no whole-string fallback.
- **Idempotent re-ship**: before any eBay call, `status === "shipped"` with a
  non-null `sale.ebay_fulfillment_id` short-circuits to *only* re-running the
  local write (clear `ebay_sync_error`, stamp `ebay_synced_at`) and returns
  `{ ok: true }`. eBay allows several fulfillments per order (partial
  shipments), so a second `createShippingFulfillment` succeeds silently and
  double-ships the order — which is exactly what a retry after an "eBay
  succeeded, local write failed" attempt used to do. **The `cancelled` branch
  has no equivalent guard** — cancellation stores no idempotency key on the
  row; don't add one without a design for it.
- **Best-effort, non-blocking**: the route never throws past itself — any
  failure (token refresh, the eBay call, or the DB write) is caught, written
  into `sales.ebay_sync_error`, and returned as `{ error }` with the
  upstream status code. The local `sales.status` change that triggered the
  sync is never undone — it was already committed by `EditSaleModal` before
  this route runs. On success, `ebay_sync_error` is cleared and
  `ebay_synced_at` (both transitions) / `ebay_fulfillment_id` (shipped only)
  are set.
- **A 403 from this route writes nothing** — `requireIntegrationAdmin()` runs
  before the row is ever touched, and `manage_integrations` is
  admin/super_admin only while `update_sale` (which opens `EditSaleModal`)
  also covers `accountant`. So `EditSaleModal` writes `ebay_sync_error` from
  the *client* on any sync failure, using the tenant client it already used
  for the sale update. Without that, an accountant's status change would
  silently never reach eBay with no trace for an admin to retry.
- No new `PlatformAdapter` methods — `createShippingFulfillment`/
  `cancelOrder` are plain exported functions in `ebay.ts` that the route
  imports directly, same shape as `ebay/messages.ts`'s Trading-API-only
  functions. Amazon has no equivalent call, so this stays eBay-only
  plumbing.
- Retry: the order detail page (`dashboard/sales/[id]/page.tsx`) shows a
  warning row when `sale.ebay_sync_error` is set, with a Retry button that
  re-POSTs this same route using the sale's current
  `status`/`tracking_number`/`shipping_carrier` — no modal, nothing to
  re-enter. The button only renders when the sale's status is `shipped` or
  `cancelled` (the two this route handles); the error text still renders for
  any other status so the failure never silently disappears.
- **Redux must be reconciled after every attempt.** This route writes the
  `ebay_*` columns *after* the client's own `sales.update(...)` has returned,
  and the order detail page renders from Redux whenever a store version
  exists (it never re-fetches). Both callers therefore run
  `fetchSaleById(sale.id)` (`dashboard/sales/_store/salesSlice.ts`) +
  `dispatch(updateSale(fresh))` once the fetch settles — success *and*
  failure. Skipping it means the Retry row never appears, and a stale error
  from an earlier attempt never clears, until a hard page reload.

## Merge rule (re-import field ownership)

`mergeImportedSale(existing, incoming)` in `mergeImportedSale.ts` is the single
source of truth for which fields a re-import is allowed to overwrite:

- **Platform-owned** (overwritten on every re-import): `status`, `total_amount`,
  `unit_price`, `quantity`, `product_name`, `date`, `description`.
- **User-owned** (preserved from the existing DB row): `vat_rate`, `vat_amount`,
  `product_id`, `shipping_cost`, `shipping_charged`, `advertising_fee`, `restock`.

When `existing` is `undefined` (first import of a new order) the function returns
`incoming` unchanged — no merge needed.

The import route (`POST /api/integrations/review/import`) fetches all existing rows
matching the incoming `external_order_id`s in a single `.in()` query, builds a
`Map<string, Sale>`, then calls `mergeImportedSale` on each row before upserting.
The upsert conflict key stays `(platform, external_order_id)` — unchanged.

Test: `npx jest mergeImportedSale`

## `external_order_id` dedup contract

`mapToSale.ts` carries `NormalizedOrder.external_order_id` straight onto
`Sale.external_order_id`. The import route (`POST /api/integrations/review/import`)
upserts with `{ onConflict: "platform,external_order_id" }` against the
non-partial unique index on `tenant_<slug>.sales(platform, external_order_id)` —
re-importing the same order **updates** the existing row (e.g. status changes
from `pending` → `shipped`) instead of duplicating it. Manually-created `sales`
rows have `external_order_id = NULL`, and Postgres treats multiple `NULL`s in a
unique index as distinct, so they're never affected.

**One `NormalizedOrder` per line item.** A platform order with multiple line
items must produce multiple `NormalizedOrder`s, each with a distinct
`external_order_id` derived from `${orderId}:${lineItemId}` (eBay) or
`${AmazonOrderId}:${OrderItemId}` (Amazon) — keeps the unique index
one-row-per-line-item and lets `mapToSale` stay a 1:1 mapping.

## Review window

`GET /api/integrations/review` fetches orders from the last 90 days
(`REVIEW_LOOKBACK_MS` in that route). `last_synced_at` is updated per platform
by `POST /api/integrations/review/import` on successful import. The review page
marks already-imported orders as `imported: true` via an `external_order_id`
lookup against existing `sales` rows.

## Gotchas

- **eBay account deletion endpoint** lives at
  `src/app/api/notifications/ebay-account-deletion/route.ts`. GET handles the
  eBay challenge verification (SHA256 of `challengeCode + EBAY_VERIFICATION_TOKEN
  + endpointUrl`). POST acknowledges deletions and best-effort removes the
  matching tenant's eBay connection + synced sales. Register the URL
  `${NEXT_PUBLIC_SITE_URL}/api/notifications/ebay-account-deletion` in the
  eBay developer portal under Application → Notifications, then copy the
  generated Verification Token into `EBAY_VERIFICATION_TOKEN` (also add to
  Vercel env vars).
- **eBay sandbox vs production URLs**: set `EBAY_SANDBOX=true` in env to route
  all eBay requests to `auth.sandbox.ebay.com` / `api.sandbox.ebay.com`.
  Sandbox credentials (`SBX` in the client ID) will 500 against production
  endpoints. Remove `EBAY_SANDBOX` (or set to `false`) when switching to prod
  credentials. Also add `EBAY_SANDBOX=true` to Vercel env vars for preview
  deployments during testing.
- **eBay OAuth uses `EBAY_RU_NAME`, not a redirect URL.** `getAuthUrl`/
  `exchangeCode` pass `redirect_uri=process.env.EBAY_RU_NAME` (eBay's "RuName"
  identifier from the developer portal) — don't swap in
  `NEXT_PUBLIC_APP_URL`-based URLs for eBay.
- **`EBAY_SCOPE` (`ebay.ts`) has grown twice already** — started with just
  `sell.fulfillment` (order sync), then `sell.inventory` (Trading API calls
  in `listings.ts`), then `sell.account` (Business Policies in
  `publish.ts`). Each addition invalidates every already-connected tenant's
  eBay connection — a code deploy doesn't retroactively grant a new scope to
  an existing token/refresh-token pair, the tenant must disconnect and
  reconnect eBay in Integrations. If a REST call starts 403ing with
  `errorId 1100`/`"Insufficient permissions"` after adding a new eBay
  feature, check whether it needs a scope not yet in `EBAY_SCOPE` before
  assuming the bug is elsewhere.
- **Amazon OAuth uses two different ids**: `AMAZON_APP_ID` (SP-API application
  id, `amzn1.sellerapps.app…`) goes on the consent URL's `application_id`
  param; `AMAZON_LWA_CLIENT_ID`/`_SECRET` (`amzn1.application-oa2-client…`)
  are only for the token endpoint. Don't reuse one for the other — the consent
  page rejects LWA client ids. Draft apps additionally need `version=beta` on
  the consent URL (`AMAZON_APP_IS_DRAFT=true`).
- **Amazon returns the auth code as `spapi_oauth_code`**, not `code` — the
  shared callback route reads `code ?? spapi_oauth_code`. It also picks up
  `selling_partner_id` from the same redirect. The redirect URI
  (`${NEXT_PUBLIC_APP_URL}/api/integrations/amazon/callback`) must be HTTPS
  and registered on the SP-API app in Seller Central.
- **Amazon `fetchOrders` has no `NextToken` pagination or 429 handling** —
  more than 100 orders in the review window get truncated, and large syncs
  can hit SP-API rate limits on the per-order `orderItems` calls. Known v1
  limitation.
- **Amazon SP-API auth is bearer-only here** — `fetchOrders` sends
  `x-amz-access-token: <accessToken>` with no AWS SigV4 signing. If a future
  SP-API endpoint requires SigV4, that's a bigger change to `amazon.ts`, not
  a one-line tweak.
- **Amazon `marketplace_id` defaults** to `AMAZON_DEFAULT_MARKETPLACE_ID`
  (default `A1PA6795UKMFR9`, Amazon.de) when `connection.marketplace_id` is
  null — the OAuth callback doesn't reliably return one. There's no
  marketplace-selection UI; if a tenant sells in multiple marketplaces this
  only syncs one.
- **`authGuard.requireIntegrationAdmin()`** is the only auth check in
  connect/callback/disconnect/sync — it 401s with no session, 400s with no
  `tenant_schema`, 403s if the profile role isn't `admin`/`super_admin`. The
  `connect` route additionally checks `hasPlatformIntegrations(tenantPlan)`
  (403 if the plan doesn't include integrations) — that check is plan-based,
  not role-based, so it's not in the shared guard.
- **OAuth CSRF**: `connect` sets a short-lived httpOnly `kn_oauth_state`
  cookie (`maxAge: 600`) containing a random UUID; `callback` verifies the
  `state` query param matches before calling `exchangeCode`, and deletes the
  cookie either way.
