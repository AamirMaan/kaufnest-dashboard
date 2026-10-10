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
  `PLATFORM_LABELS` map in `page.tsx`, and to `LABELS` in
  `_components/PlatformAccountsSection.tsx` and `PLATFORM_LABELS` in
  `_components/ConnectionCard.tsx` (and `PLATFORM_LABELS` in
  `review/page.tsx`). These label maps are independent copies — no shared
  source of truth — so update all of them together.
  Also add the table row to `008_platform_integrations.sql` /
  `provision_tenant_schema()`'s `platform` CHECK constraint
  (`supabase/SKILL.md`).
- **Change the account card UI** (badges, rename, pause/resume, disconnect,
  reconnect): edit `_components/ConnectionCard.tsx` only. Per-platform section
  (heading, Add button, cap hint): `_components/PlatformAccountsSection.tsx`;
  heading/banner text rules: `_lib/accountSummary.ts` + test.
- **Change the upgrade-prompt or no-permission messaging**: edit the relevant
  branch in `page.tsx`'s `IntegrationsContent` only.
- **Change reducer logic**: `_store/integrationsSlice.ts` + its colocated
  test.
- **Change what `dashboard/layout.tsx` hydrates** (e.g. add a column to the
  `platform_connections` select): edit `src/app/dashboard/layout.tsx` and the
  `PlatformConnection` type in `src/types/index.ts` together — keep the
  select list and the type in sync, and remember tokens must never be
  selected for the client.
- **Change the review page** (table columns, selection behaviour, import
  logic): `review/page.tsx` + optionally `api/integrations/review/route.ts`
  (if changing what fields are fetched or how `imported` is determined).
- **Change the review page's account filter/column**: `review/page.tsx` +
  `review/_lib/reviewAccounts.ts` (+ test).
- **Add pagination to the review page**: `api/integrations/review/route.ts`
  (add `page`/`cursor` query param, thread through to `adapter.fetchOrders`)
  + `review/page.tsx` (add "Load more" button).

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
- **`accounts` vs `connections`**: `connections` (admin-only, RLS) drives the Integrations page; `accounts` (all members, `get_platform_accounts` RPC) drives account filters/pickers. `layout.tsx` tolerates the RPC failing (056 not applied): it `console.error`s and hydrates `[]`, same as `get_my_access`. Both are keyed by `id`, never `platform`.
- **`setConnectionStatus` is a no-op if the connection id has no row
  yet** — after a fresh "Connect" + OAuth round-trip, the page does a full
  reload (browser navigation back from the callback redirect), so
  `dashboard/layout.tsx` re-hydrates `platform_connections` with the new row;
  the slice doesn't need to synthesize one.
- `STATUS_VARIANTS` in `ConnectionCard.tsx` maps `PlatformConnectionStatus` →
  `Badge` variant (`connected: "success"`, `disconnected: "default"`,
  `error: "danger"`) — keep in sync if `PlatformConnectionStatus` gains a
  value.
- **`import type` across server/client boundary for `ReviewOrder`/`ReviewResponse`**:
  `review/page.tsx` imports these types from the API route file using
  `import type { ... } from "@/app/api/integrations/review/route"`. TypeScript
  erases `import type` at runtime — no server modules are bundled into the
  client. Do NOT change this to a value import.
- **Review page fetch gated behind `isEligible`** — the `useEffect` that fetches
  `/api/integrations/review` only fires when `isEligible` is `true` (plan + role
  check). On first render with `role === undefined` (Redux still hydrating),
  `isEligible` is `false` and no fetch fires. The loading skeleton shows until
  either the redirect fires (ineligible) or the fetch resolves (eligible).
- **Cron is removed** — `vercel.json` no longer has a `crons` key. Both eBay
  and Amazon are now manual-review only. Do not re-add auto-sync without
  updating the review flow to handle already-synced orders correctly.
- **Account state is derived, never stored.** Cards take `state`/`canResume` from `accountState`/`canResumeAccount` (`lib/utils/activeAccounts`) over ALL connections — pass the full list, not one platform's. Pause/resume/rename go through PATCH `/api/integrations/connections/[id]`; map failures with `integrationErrorMessage(json.error, json.error ?? fallback)` (409 = resume refused at cap). Reconnect uses `?reconnect=1` so the connect-time cap check is skipped.
- **Review page account filter uses `effectiveAccount`, not `accountFilter`.** After Sync Statuses re-fetches, a previously chosen account may no longer be in the tab; the page falls back to "all" rather than showing an empty table. `errors` keys are account display names (not platforms) — `PLATFORM_LABELS[k] ?? k` handles both. Never drop `connection_id` from the import payload: the route rejects items without an active account.
- **Manual pause always holds; plan-limit pause is automatic.** `is_active = false` stays paused even after an upgrade frees a slot. A `plan_limit` account has no Resume: it becomes active by itself when a slot frees (upgrade, or another account paused/disconnected); its Pause button turns it into a manual pause.
