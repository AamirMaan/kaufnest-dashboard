---
name: integrations-library
description: Reference for the platform-integration library at src/lib/integrations (eBay/Amazon OAuth adapters, token storage, order sync) — use when adding a platform, debugging OAuth/token refresh, or changing how synced orders map to sales rows.
---

# Platform integrations library (`src/lib/integrations/`)

Server-only shared code (never imported from a Client Component — it handles
OAuth tokens). Consumed by `src/app/api/integrations/[platform]/*` and
`src/app/api/cron/sync-integrations/`. The dashboard feature
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
  connectedBy)`. Has a colocated `mapToSale.test.ts`.
- `tokenStore.ts` — `getConnection`, `upsertConnection`,
  `ensureValidAccessToken` (refresh-on-demand).
- `sync.ts` — `syncPlatformOrders(client, platform, connectedBy)`, the one
  function both the manual-sync route and the cron route call.
- `authGuard.ts` — `requireIntegrationAdmin()`, the shared
  session+role+tenant-schema check for the connect/callback/disconnect/sync
  routes.

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

Nothing else changes — `sync.ts`, the API routes, and the dashboard feature
are all platform-agnostic via `getAdapter`.

## Token refresh flow

`ensureValidAccessToken(client, connection, adapter)`:
- If `connection.token_expires_at` is more than `REFRESH_MARGIN_MS` (5 min) in
  the future, returns the stored `access_token` unchanged.
- Otherwise calls `adapter.refreshAccessToken(connection.refresh_token)`,
  persists the new `access_token`/`refresh_token`/`token_expires_at` via
  `upsertConnection`, and returns the new token.
- Throws if `connection.refresh_token` is null (connection was never
  completed, or was disconnected).

`syncPlatformOrders` calls this before `fetchOrders` — adapters' `fetchOrders`
always receive a fresh token and never refresh themselves.

## `external_order_id` dedup contract

`mapToSale.ts` carries `NormalizedOrder.external_order_id` straight onto
`Sale.external_order_id`. `sync.ts` upserts with
`{ onConflict: "platform,external_order_id" }` against the non-partial unique
index on `tenant_<slug>.sales(platform, external_order_id)` — re-syncing the
same order **updates** the existing row (e.g. status changes from `pending` →
`shipped`) instead of duplicating it. Manually-created/imported `sales` rows
have `external_order_id = NULL`, and Postgres treats multiple `NULL`s in a
unique index as distinct, so they're never affected.

**One `NormalizedOrder` per line item.** A platform order with multiple line
items must produce multiple `NormalizedOrder`s, each with a distinct
`external_order_id` derived from `${orderId}:${lineItemId}` (eBay) or
`${AmazonOrderId}:${OrderItemId}` (Amazon) — keeps the unique index
one-row-per-line-item and lets `mapToSale` stay a 1:1 mapping.

## Sync window

`syncPlatformOrders` fetches orders created/updated since
`connection.last_synced_at ?? (now - 30 days)` (`DEFAULT_LOOKBACK_MS` in
`sync.ts`). On success it sets `last_synced_at = now()`, so subsequent syncs
are incremental. On error, `last_synced_at` is left unchanged (so the next
sync retries the same window) and `last_sync_status`/`last_sync_error` are
recorded on the connection row.

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
- **Cron route skips connections with `connected_by = null`** (shouldn't
  happen in practice — `callback` always sets it) rather than crashing the
  whole tenant's sync loop; that connection's result records an error.
