# Integrations feature

Route: `/dashboard/integrations`. Lets a tenant connect their eBay and/or
Amazon seller accounts via OAuth; orders from connected platforms are pulled
in automatically (manual "Sync now" button + a 6-hourly cron) and stored as
`sales` ("Orders") rows. Available only on the **Pro**/**Business** plans
(`hasPlatformIntegrations`) and manageable only by `admin`/`super_admin`
(`manage_integrations` permission).

## Files in this folder

- `page.tsx` — `"use client"`. Default export wraps `IntegrationsContent` in
  `<Suspense fallback={null}>` (required because it reads `useSearchParams()`
  for the `connected=`/`error=` query params set by the OAuth callback route
  and shows a `Toast` for each). Reads `role`/`tenantPlan` from
  `state.currentUser` and `connections` from `state.integrations.connections`.
  Three render branches, in order:
  1. `!tenantPlan || !hasPlatformIntegrations(tenantPlan)` → upgrade-prompt
     card linking to `/dashboard/settings`.
  2. `!hasPermission(role, "manage_integrations")` → "contact your admin"
     message.
  3. Otherwise → a `sm:grid-cols-2` grid of `<ConnectionCard>`, one per
     `IntegrationPlatform` (`["ebay", "amazon"]`).
- `_components/ConnectionCard.tsx` — per-platform card: status `Badge`
  (`connected`/`disconnected`/`error`), `external_account_id` (if set), "Last
  synced" (`formatDateTime` or "Never"), `last_sync_error` (if present). When
  `canManage`: "Sync now" (`POST /api/integrations/{platform}/sync`, then
  `dispatch(setConnectionStatus(...))` + toast) and "Disconnect"
  (`POST /api/integrations/{platform}/disconnect`) buttons if connected,
  otherwise a "Connect {label}" button that does
  `window.location.assign(\`/api/integrations/${platform}/connect\`)` (a full
  navigation, not `fetch` — the connect route 302s to the platform's OAuth
  consent screen).
- `_store/integrationsSlice.ts` — `state.integrations.connections:
  PlatformConnection[]`. Actions: `hydrateConnections`, `upsertConnection`
  (replace-or-append by `platform`), `setConnectionStatus` (no-op if no
  connection exists for that platform yet).
- `_store/integrationsSlice.test.ts` — reducer tests for all three actions.

## Data flow (different from other features)

This folder **never talks to Supabase directly** — there's no
create/update/delete here. State is read-only Redux, hydrated once by
`dashboard/layout.tsx` from `platform_connections` (safe columns only, no
tokens — see that folder's `CLAUDE.md`). All mutations go through the four
API routes in `src/app/api/integrations/[platform]/` (`connect`, `callback`,
`disconnect`, `sync`) plus `src/app/api/cron/sync-integrations/`, which own
`platform_connections` and write synced orders into `sales`. See
`src/lib/integrations/SKILL.md` for the OAuth + sync pipeline those routes
call into.

The **order review flow** (manual import of selected orders) uses two additional
routes that sit outside the `[platform]` path:
- `GET /api/integrations/review` — fetches the last 90 days of orders from all
  connected platforms and marks each as `imported: boolean`.
- `POST /api/integrations/review/import` — receives `{ items: { platform, order
  }[] }`, upserts them into `sales` (idempotent on `platform,
  external_order_id`), and updates `last_synced_at`/`last_sync_status` for each
  involved platform.

## Plan gating

`tenantPlan` (`TenantPlan | null`) is hydrated into
`state.currentUser.tenantPlan` by `dashboard/layout.tsx` (fetched from
`control.tenants` via `createControlClient()`). `hasPlatformIntegrations(plan)`
(`src/lib/utils/planGating.ts`) returns `true` only for `pro`/`business`.

## Shared dependencies

- `src/lib/integrations/` — server-only OAuth adapters + sync pipeline (not
  imported here directly, only via the API routes)
- `src/lib/utils/planGating` — `hasPlatformIntegrations`
- `src/lib/utils/permissions` — `hasPermission`, `manage_integrations`
- `src/lib/utils/date` — `formatDateTime`
- `components/layout/PageHeader`, `components/ui/{Badge,Button,Toast}`
- `store/slices/currentUserSlice` — `profile.role`, `tenantPlan`
- `types` — `IntegrationPlatform`, `PlatformConnection`,
  `PlatformConnectionStatus`

## Tests

`npx jest dashboard/integrations` runs `_store/integrationsSlice.test.ts`.
