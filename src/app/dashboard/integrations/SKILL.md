---
name: integrations-feature
description: Work on the Integrations dashboard feature (connect eBay/Amazon, sync orders) at src/app/dashboard/integrations — use when the task mentions integrations, eBay, Amazon, platform connections, or the /dashboard/integrations route.
---

# Working on the Integrations feature

This feature is colocated under `src/app/dashboard/integrations/`. Read
`CLAUDE.md` in this folder first — it explains the file map, the read-only
Redux data flow, and plan/permission gating. For the OAuth + sync pipeline
the API routes call into, read `src/lib/integrations/SKILL.md`.

## Minimal file set for common changes

- **Add a third platform** (e.g. Etsy): mostly outside this folder — new
  adapter in `src/lib/integrations/`, add to `IntegrationPlatform` in
  `src/types/index.ts`, register in `src/lib/integrations/registry.ts`. In
  *this* folder: add the platform to the `PLATFORMS` array and
  `PLATFORM_LABELS` map in `page.tsx`, and to `PLATFORM_LABELS` /
  `STATUS_VARIANTS` (if a new status) in `_components/ConnectionCard.tsx`.
  Also add the table row to `008_platform_integrations.sql` /
  `provision_tenant_schema()`'s `platform` CHECK constraint
  (`supabase/SKILL.md`).
- **Change the connection card UI** (badges, buttons, layout): edit
  `_components/ConnectionCard.tsx` only.
- **Change the upgrade-prompt or no-permission messaging**: edit the relevant
  branch in `page.tsx`'s `IntegrationsContent` only.
- **Change reducer logic**: `_store/integrationsSlice.ts` + its colocated
  test.
- **Change what `dashboard/layout.tsx` hydrates** (e.g. add a column to the
  `platform_connections` select): edit `src/app/dashboard/layout.tsx` and the
  `PlatformConnection` type in `src/types/index.ts` together — keep the
  select list and the type in sync, and remember tokens must never be
  selected for the client.

## Test command

`npx jest dashboard/integrations`

## Gotchas

- **No Supabase calls in this folder.** All reads come from Redux
  (hydrated by `dashboard/layout.tsx`); all writes go through
  `src/app/api/integrations/[platform]/*` routes. Don't add a
  `createTenantClient()` call here — it would need RLS that this folder's
  components don't have a session-appropriate reason to use directly.
- **`page.tsx` must stay wrapped in `<Suspense>`** — `useSearchParams()` (used
  to read the `connected=`/`error=` query params from the OAuth callback
  redirect) opts the page out of static rendering without it.
- **"Connect" is a full navigation, not `fetch`** —
  `window.location.assign(\`/api/integrations/${platform}/connect\`)` because
  that route 302-redirects to the platform's OAuth consent screen; a `fetch`
  would just receive the redirect response without navigating the browser.
- **`setConnectionStatus` is a no-op if the platform has no connection row
  yet** — after a fresh "Connect" + OAuth round-trip, the page does a full
  reload (browser navigation back from the callback redirect), so
  `dashboard/layout.tsx` re-hydrates `platform_connections` with the new row;
  the slice doesn't need to synthesize one.
- `STATUS_VARIANTS` in `ConnectionCard.tsx` maps `PlatformConnectionStatus` →
  `Badge` variant (`connected: "success"`, `disconnected: "default"`,
  `error: "danger"`) — keep in sync if `PlatformConnectionStatus` gains a
  value.
