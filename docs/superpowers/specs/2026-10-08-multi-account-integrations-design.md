# Multiple eBay/Amazon accounts per tenant — design

**Date:** 2026-10-08
**Status:** Sub-project 1 designed; sub-projects 2–4 roadmap only
**Branch:** `feat/multi-account-integrations`

## Problem

A tenant can connect exactly one eBay account and one Amazon account. Many
sellers run several stores per marketplace. The single-account assumption is
structural:

- `platform_connections` has `unique (platform)` (`008_platform_integrations.sql`).
- `tokenStore.getConnection(client, platform)` resolves *the* token for a
  platform; 17 route handlers (order review, listings, messages, dropshipping)
  call it.
- The eBay adapter never stores an account identifier — `ebay.ts` does not set
  `externalAccountId`, so live eBay rows have `external_account_id = null`.
- The eBay Marketplace Account Deletion webhook
  (`api/notifications/ebay-account-deletion`) deletes **every** synced eBay sale
  in the tenant, which would destroy other accounts' data once there are
  several.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Everything account-aware: connections + orders, listings, messages, payouts, shipments, analytics — delivered as 4 sub-projects |
| Plan caps | Per platform: Starter 0, Pro 2, Business unlimited, Trial unlimited (mirrors Business) |
| Downgrade over cap | Extras are **paused**, not disconnected — data stays visible, no sync/publish/reply; admin picks which stay active, default oldest first; upgrading reactivates instantly |
| Manual / CSV-imported orders | Account is **optional** — picker shown only when the platform has 2+ accounts; blank = "Unassigned" |

## Roadmap

1. **Foundation — connections + order sync** (this spec).
2. **Listings per account** — `ebay_listing_drafts.connection_id`, account picker
   in the wizard, publish/revise/end use the draft's account.
3. **Messages per account** — `ebay_messages.connection_id`, per-account sync,
   replies via the right account, account filter.
4. **Payouts, shipments, analytics** — `connection_id` on `platform_payouts`
   and `shipments`, account choice in the record-payout modal, per-account
   breakdowns on Analytics and Home stat cards. Depends on payout history
   (PR #123) being merged.

Each sub-project gets its own spec → plan → PR. Sub-projects 2 and 3 remove
callers of the `getConnection(platform)` compatibility shim (below); once the
last caller is gone the shim is deleted.

---

## Sub-project 1: Foundation

### 1. Data model — `supabase/migrations/056_multi_account_connections.sql`

All tenant DDL runs through `public.run_on_all_tenant_schemas`; the same
changes are added to `provision_tenant_schema()` in
`005_tenant_provisioning.sql` for new tenants.

**`platform_connections`**

- Drop `unique (platform)`; add `unique (platform, external_account_id)`.
  Reconnecting the same account refreshes its row instead of duplicating it.
  (Postgres treats NULLs as distinct, so legacy eBay rows with a null id do not
  conflict with each other — the callback never writes a null id for new
  connections; see §2.)
- Add `display_name text` — defaulted from the eBay username / Amazon seller id,
  editable by admins.
- Add `external_username text` — eBay username, used by the deletion webhook to
  match legacy rows that predate the account-id fetch.
- Add `is_active boolean not null default true` — the admin's choice of which
  accounts stay active when over the plan cap. It is an input to the cap rule,
  not a guarantee: `is_active` rows can still be paused by the cap.
- Add index `(platform, created_at)` — "oldest first" ordering.

**`sales`**

- Add `connection_id uuid null references platform_connections(id) on delete set null`.
- Index `connection_id`.
- Backfill: for each of `ebay`/`amazon`, if the tenant has exactly one
  connection for that platform, set `connection_id` on that platform's sales
  where `external_order_id is not null` (synced orders). Manual and imported
  rows stay null (Unassigned).
- The dedup index `(platform, external_order_id)` is unchanged — order ids are
  globally unique per marketplace, so two accounts cannot collide.
- `on delete set null`: removing a connection row leaves its orders in place
  as Unassigned, consistent with today's disconnect keeping synced sales.

**RLS** — unchanged. `platform_connections` stays admin/super_admin-only;
`sales.connection_id` is covered by the existing `sales` policies.

**Types** (`src/types/index.ts`) — `PlatformConnection` gains `display_name`,
`external_username`, `is_active`; `Sale` gains `connection_id`.

### 2. Server

**eBay account identity** (`lib/integrations/ebay.ts`)

- Add scope `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly`.
- After `exchangeCode`, call `GET /commerce/identity/v1/user/` and return
  `externalAccountId = userId`, `externalUsername = username`. A failure here
  fails the connect with a readable error — a connection without an id cannot
  be distinguished from other accounts, so it is never stored.
- `TokenSet` (`lib/integrations/types.ts`) gains optional `externalUsername`.
- Amazon keeps using `selling_partner_id`; default `display_name` is
  `Amazon – <last 6 chars of seller id>`.
- **Legacy eBay rows** (null `external_account_id`) keep working through the
  shim. Their id is filled the next time the admin reconnects; the Integrations
  page shows a "Reconnect to enable multiple eBay accounts" banner while any
  such row exists. Reconnecting when a legacy null-id row exists **adopts** that
  row (update in place) rather than inserting a new one, so its existing
  `sales.connection_id` links survive.

**Active-account rule** — new pure module `lib/integrations/activeAccounts.ts`

```ts
resolveActiveAccounts(connections, plan) => { active, paused }
```

Per platform: take `status = 'connected'` rows; order by `is_active desc,
created_at asc`; the first `maxAccountsPerPlatform(plan)` are active, the rest
paused. Effects: admin choices win; unused slots fall back to oldest; Starter
yields zero active. Used by both server and client so they cannot disagree.

**`planGating.ts`** — `PlanLimits.maxAccountsPerPlatform: number`
(starter 0, pro 2, business/trial `Infinity`), plus
`getMaxAccountsPerPlatform(plan)` and `canAddAccount(plan, connectedCount)`.

**`tokenStore.ts`**

- `listConnections(client, platform?)` and `getConnectionById(client, id)`.
- `upsertConnection` conflicts on `(platform, external_account_id)`.
- `requireActiveConnection(client, connectionId, plan)` — throws
  `INTEGRATION_ACCOUNT_PAUSED` when the account is outside the active set.
  Every sync/import path calls it.
- **Compatibility shim:** `getConnection(client, platform)` keeps its signature
  and now returns the platform's first *active* account (per
  `resolveActiveAccounts`). Listings, messages and dropshipping keep working
  unchanged until sub-projects 2/3. It needs the tenant plan, so it reads it
  via the existing control-client lookup pattern used in `connect`.

**Routes**

- `[platform]/connect` — after the existing integrations gate, count connected
  accounts; if `!canAddAccount` return 403 `INTEGRATION_ACCOUNT_LIMIT`
  ("Your plan allows N eBay accounts — upgrade to add more").
- `[platform]/callback` — upsert keyed on the account. If the account id is
  new and the cap is already reached (possible: the cap check in `connect`
  could not know the account was a reconnect), redirect with the limit error
  and store nothing. Reconnecting an existing account always succeeds.
  Redirects with `?connected=<platform>&account=<id>`.
- `[platform]/disconnect` — body `{ connectionId }`; clears that row's tokens
  and sets `status = 'disconnected'`. Other accounts untouched.
- **New** `PATCH /api/integrations/connections/[id]` — gated by
  `requireIntegrationAdmin()`; accepts `{ display_name?, is_active? }`.
  Activating is refused (`INTEGRATION_ACCOUNT_LIMIT`) if it would put more
  `is_active` connected rows than the cap on that platform. `display_name`
  trimmed, 1–60 chars.
- `review` / `review/import` — iterate the **active accounts** instead of
  platforms; stamp `connection_id` on every imported sale; dedup stays per
  platform. The review payload groups orders by account with `display_name`.
- `ebay/orders/[saleId]/sync-status` — use the sale's `connection_id` when set,
  falling back to the shim when null.

**eBay deletion webhook** — matching extracted to a pure, tested helper:
match a connection where `external_account_id = userId` **or**
`external_username = username`. Delete only sales with
`connection_id = <matched id>` and only that connection row. Legacy sales with
null `connection_id` are not touched by a deletion for a specific account
(documented limitation; the backfill in §1 links them for single-account
tenants, which is every tenant today).

**Errors** — new codes `INTEGRATION_ACCOUNT_LIMIT` and
`INTEGRATION_ACCOUNT_PAUSED` with user-facing copy, following the existing
`INV_*` pattern. No raw Postgres errors reach the client.

### 3. UI

**Integrations page** (`dashboard/integrations/`)

- One section per platform, headed "eBay — 2 of 2 accounts" ("2 accounts" on
  unlimited plans).
- One `ConnectionCard` per account: inline-editable `display_name`, status
  `Badge` (Connected / Paused — plan limit / Error), last synced, row actions
  **Set active / Pause** and **Disconnect** (via `DeleteConfirmModal`, copy
  states orders are kept as Unassigned).
- "Add <platform> account" — `secondary` button; disabled at the cap with an
  upgrade hint linking to Billing. "Review Orders" remains the single primary
  action.
- Downgrade banner when any account is paused: "Your plan includes 2 eBay
  accounts. 2 are paused — choose which stay active, or upgrade."
- Legacy-eBay reconnect banner (§2).
- `integrationsSlice` holds a list of connections; the active/paused split is
  derived with `resolveActiveAccounts`.
- Every mutation: busy label ("Saving…", "Disconnecting…"), disabled while in
  flight, success and failure toasts.

**Review Orders** (`integrations/review/`) — grouped by platform → account;
account header shows `display_name` and new-order count; paused accounts are
omitted with an explanatory note.

**Orders** (`dashboard/sales/`)

- `FilterBar` **Account** filter, shown only when the tenant has 2+
  connections on any platform: All accounts / each account / Unassigned. Sent
  to the paginated thunk as a connection id or the `"unassigned"` sentinel
  (`is null`). Persisted with the other filters.
- Account column (`Badge` with `display_name`), same visibility rule.
- Order detail (`sales/[id]`) shows the account name when set.

**Add/Edit Order modals** — optional **Account** `Select`, shown only when the
selected platform has 2+ connections; blank allowed; reset when the platform
changes.

**Import Sales modal** — optional "Assign all rows to account" `Select` on the
review step (same visibility rule); applied only to rows whose platform matches
the chosen account's platform.

Home and Analytics are unchanged in this sub-project.

### 4. Testing

Colocated unit tests:

- `lib/integrations/activeAccounts.test.ts` — under/at/over cap, admin choices
  vs oldest-first fallback, unlimited plans, Starter = 0, disconnected rows
  ignored, platforms independent.
- `lib/utils/planGating.test.ts` — `maxAccountsPerPlatform`, `canAddAccount`.
- `lib/integrations/ebay.test.ts` — identity response → `externalAccountId` /
  `externalUsername`; identity failure → readable error.
- tokenStore — conflict key, shim returns first active account,
  `requireActiveConnection` throws for paused.
- `mapToSale` / `mergeImportedSale` — `connection_id` stamped.
- Deletion-webhook matcher — id or username match; scoped delete target.
- `integrationsSlice` — list shape; rename / toggle / disconnect.
- Sales slice — account filter params including `"unassigned"`.
- `ImportSalesModal` — account assignment only on matching-platform rows.

### 5. Docs (same commits as code)

- `lib/integrations/SKILL.md` — multi-account model, shim and its planned
  removal, legacy null-id gotcha, Identity API scope.
- `dashboard/integrations/{CLAUDE,SKILL}.md` — new files/routes, slice shape.
- `dashboard/sales/{CLAUDE,SKILL}.md` — account filter/column, modal pickers.
- `supabase/SKILL.md` — file-map row for `056`.
- `AGENTS.md` — pointer to this spec.

### 6. Rollout

1. **Before deploy:** add `commerce.identity.readonly` to the eBay app's OAuth
   scopes in the eBay developer portal; otherwise new connects fail at the
   identity call.
2. Merge, then apply `056` live. It is additive and backward compatible:
   existing rows get `is_active = true`; synced sales are backfilled to their
   single connection.
3. Existing eBay tenants reconnect eBay once (prompted by the banner) to fill
   in their account id.

### Out of scope (sub-projects 2–4)

Listing account picker, per-account messages, payouts/shipments account
links, Analytics/Home per-account breakdowns, and a verifier rule flagging new
calls to the `getConnection(platform)` shim (added in sub-project 2).
