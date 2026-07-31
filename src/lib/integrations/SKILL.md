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
- `mapToSale.ts` — pure `normalizedOrderToSaleRow(order, platform,
  connectedBy)`. Synced orders always have fee fields (`shipping_cost`,
  `shipping_charged`, `advertising_fee`) set to `null` — these are editable
  later via the Edit Sale modal. Has a colocated `mapToSale.test.ts`.
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
  copy. See "eBay messages (Trading API)" below.
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
