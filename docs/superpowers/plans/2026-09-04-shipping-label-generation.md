# Shipping Label Generation (EasyPost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller buy a real, carrier-priced shipping label (via EasyPost) from inside an order's detail page — fetch live rates, pick one, purchase it, and store the tracking number/label link against the order.

**Architecture:** One new tenant-schema table (`shipments`, one row per purchased label), a new server-only module (`src/lib/shipping/`) wrapping EasyPost's REST API and mapping `CompanyProfile`/`Sale` rows to EasyPost addresses, two new API routes (`POST /api/shipping/rates`, `POST /api/shipping/buy`) that call it, and a new "Shipping" card + `GenerateLabelModal` on the order detail page. No Redux slice — a sale has at most one shipment in v1, fetched on-demand the same way the order detail page already fetches its linked `Purchase`.

**Tech Stack:** Next.js App Router (route handlers), Supabase (Postgres + RLS, tenant-schema pattern), Redux Toolkit (read-only here — `currentUser`/`companyProfile` slices, no new slice added), EasyPost REST API (`https://api.easypost.com/v2`, HTTP Basic auth), Jest for unit tests.

## Global Constraints

**1. Hard prerequisite — DO NOT START without confirming this first.** This
piece reads two sets of fields that do not exist in this codebase yet unless
two sibling plans have already been implemented and merged:
- `Sale.shipping_address_line1` / `shipping_address_line2` / `shipping_city`
  / `shipping_state` / `shipping_postal_code` / `shipping_country` /
  `buyer_name` / `buyer_phone` / `buyer_email` — added by
  `docs/superpowers/specs/2026-09-04-buyer-shipping-address-design.md`
  ("Piece 2").
- `CompanyProfile.ship_from_street1` / `ship_from_street2` /
  `ship_from_city` / `ship_from_state` / `ship_from_postal_code` /
  `ship_from_country` — added by
  `docs/superpowers/specs/2026-09-04-company-shipfrom-address-design.md`
  ("Piece 3").

**Before starting Task 3 of this plan (`addressMappers.ts`), open
`src/types/index.ts` and confirm the `Sale` interface has the nine
`shipping_*`/`buyer_*` fields above and the `CompanyProfile` interface has
the six `ship_from_*` fields above.** If either is missing: **stop
immediately** and tell the user those two sibling plans must be implemented
and merged first. Do not invent placeholder fields, do not add the missing
columns yourself as a "helper," and do not write code that compiles against
a narrower shape — that would silently diverge from the two approved specs
this plan depends on. If you proceed anyway, `npx tsc --noEmit` (run
automatically by the `.husky/pre-commit` hook on your first commit) will
fail with "Property 'shipping_address_line1' does not exist on type
'Sale'" — treat that as confirmation you should have stopped at this
paragraph instead of pushing through.

**2. Never query `public.*`.** Every table this plan touches
(`sales`, `company_profile`, `shipments`) lives in a per-tenant
`tenant_<slug>` schema. Every server-side read/write in this plan goes
through the tenant-scoped client returned by `createClient()`
(`src/lib/supabase/server.ts`, server-side) or `createTenantClient()`
(`src/lib/supabase/client.ts`, client-side) — never hardcode a schema name,
never reference `public.sales`/`public.company_profile`/`public.shipments`.

**3. Tenant-schema DDL always goes through `run_on_all_tenant_schemas` AND
`provision_tenant_schema()` — the "2 places" rule.** The new `shipments`
table must be created via `SELECT public.run_on_all_tenant_schemas($$ ... $$)`
in the new migration (applies to every *existing* tenant schema) **and**
added to `provision_tenant_schema()` in
`supabase/migrations/005_tenant_provisioning.sql` (so every *future* tenant
gets it from schema creation). Never write `ALTER TABLE tenant_kaufnest.*`
or `CREATE TABLE tenant_kaufnest.*` directly in a migration — there are
multiple live tenants (see `supabase/SKILL.md`'s intro for the current named
list), and hardcoding one schema name leaves the rest stale.

**4. Mutating-button form convention (from this repo's `AGENTS.md` — copied
verbatim, applies to `GenerateLabelModal.tsx`):** A mutating button must
never look clickable when it can't succeed, and must never look idle while
its request is in flight.
- Wrap the fields in a real `<form id="..." onSubmit={handleSubmit}>` —
  never a bare `<div>` with the submit button's `onClick` calling the
  handler directly.
- Every field marked `required` on its `<Field required>` label must ALSO
  carry the `required` attribute on the underlying `<Input>`.
- The submit button is `type="submit" form="<id>"`, not `type="button"
  onClick={...}`, so it can live in the modal's footer (outside the
  `<form>`) while still participating in native validation/submit.
- The submit button is `disabled` both while a request is in flight AND
  while the form is known-invalid — compute a plain boolean from current
  field state and use `disabled={loading || !isFormValid}`.
- While a mutation is in flight, swap the button's label to a busy verb
  ("Fetching rates…", "Buying…") and keep it disabled.

**5. No dev server, no `curl`, no `npm test`/`npx tsc --noEmit`/`npm run
lint` run mid-task.** Per this repo's working agreement (`AGENTS.md`): do
not start `next dev`, do not `curl` a route, and do not run the whole test
suite/typecheck/lint yourself to "check your work" as you go. Where a task
below has you write a test, **ask the user to run the exact `npx jest
<path>` command shown and paste the output back to you** — do not run it
yourself, and do not mark that task's steps complete until the user confirms
it passed. (The `.husky/pre-commit` hook still runs `tsc --noEmit`, `eslint`,
and the project verifier automatically on every `git commit` in this plan —
that's expected and not something to work around.)

**6. Never call the real EasyPost API from a test.** Every EasyPost-touching
test in this plan mocks `global.fetch` — see Task 2's test for the pattern
(modeled on `src/lib/integrations/ebay/tradingApi.test.ts`). A test that
hits `https://api.easypost.com` for real is a bug in the test, even with a
sandbox key.

---

## Task 1: `shipments` table (migration + provisioning) + `Shipment`/`AuditEntity` types

**Files:**
- Create: `supabase/migrations/043_shipments.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (add `shipments` to section 1 tables, section 5 RLS + the `FOREACH tbl` array, section 6 indexes)
- Modify: `src/types/index.ts` (add `Shipment` interface, extend `AuditEntity`)
- Modify: `supabase/SKILL.md` (file-map row for migration 043)
- Modify: `supabase/CLAUDE.md` (file-list bullet for migration 043)

**Interfaces:**
- Produces: `Shipment` type (`src/types/index.ts`) — consumed by Tasks 5, 6, 7.
  ```ts
  export interface Shipment {
    id: string;
    sale_id: string;
    carrier: string;
    service: string;
    tracking_number: string;
    label_url: string;
    label_format: string;
    cost: number | null;
    cost_currency: string | null;
    weight_oz: number;
    easypost_shipment_id: string;
    created_by: string;
    created_at: string;
  }
  ```
- Produces: `shipments` table (columns exactly matching `Shipment` above, snake_case, plus RLS: SELECT for any authenticated tenant member, INSERT for `admin`/`super_admin` only, no UPDATE/DELETE policy) — consumed by Tasks 5 (insert) and 7 (select).
- Produces: `AuditEntity` gains `"shipment"` — consumed by Task 5's `writeAuditLog` call.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/043_shipments.sql`:

```sql
-- ============================================================
-- Shipments — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- Backs the shipping-label-generation feature (src/lib/shipping/,
-- src/app/api/shipping/*, src/app/dashboard/sales/[id]/page.tsx's Shipping
-- card) — one row per purchased EasyPost label. A sale has at most one
-- shipment in v1 (no re-generate/refund/void flow — see the design spec's
-- explicit scope note), but this is NOT enforced by a unique constraint on
-- sale_id: nothing in the app needs one today, and baking in an unenforced
-- assumption as a DB constraint would only block a future re-generate
-- feature for no benefit now.
--
-- RLS mirrors platform_payouts' shape (008_platform_integrations.sql /
-- 005_tenant_provisioning.sql): every tenant member can read (a shipment's
-- tracking number/cost is order information, not a secret like an OAuth
-- token — unlike platform_connections), but only admin/super_admin can
-- write — same role bar as the "Generate Shipping Label" button and the
-- requireIntegrationAdmin() guard on both API routes. No UPDATE/DELETE
-- policy: v1 has no edit/void/refund flow for a purchased label, so there
-- is nothing for either policy to protect yet.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets this table from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.shipments (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id              uuid NOT NULL REFERENCES {{schema}}.sales(id) ON DELETE CASCADE,
    carrier              text NOT NULL,
    service              text NOT NULL,
    tracking_number      text NOT NULL,
    label_url            text NOT NULL,
    label_format         text NOT NULL DEFAULT 'PDF',
    cost                 numeric(10,2),
    cost_currency        text,
    weight_oz            numeric(10,2) NOT NULL,
    easypost_shipment_id text NOT NULL,
    created_by           uuid NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at           timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_shipments_sale_id ON {{schema}}.shipments(sale_id);

  ALTER TABLE {{schema}}.shipments ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "shipments_select" ON {{schema}}.shipments;
  CREATE POLICY "shipments_select" ON {{schema}}.shipments
    FOR SELECT USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "shipments_insert" ON {{schema}}.shipments;
  CREATE POLICY "shipments_insert" ON {{schema}}.shipments
    FOR INSERT WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));
$$);
```

- [ ] **Step 2: Add `shipments` to `provision_tenant_schema()` — table (section 1)**

In `supabase/migrations/005_tenant_provisioning.sql`, find this exact block
(the `ebay_messages` `CREATE TABLE`, immediately followed by the section 2
comment):

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_messages (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      external_message_id   text,
      item_id                text NOT NULL,
      buyer_username         text NOT NULL,
      direction              text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      subject                text,
      body                   text NOT NULL,
      question_type          text,
      is_read                boolean NOT NULL DEFAULT false,
      ebay_created_at        timestamptz NOT NULL,
      -- Item title/price/link — see 034_ebay_messages_item_details.sql.
      item_title             text,
      item_price             numeric(12,2),
      item_currency          text,
      item_url               text,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- ── 2. updated_at triggers (reuse schema-agnostic public.set_updated_at) ──
```

Replace it with (adds the `shipments` table right after `ebay_messages`,
before the section-2 comment):

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_messages (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      external_message_id   text,
      item_id                text NOT NULL,
      buyer_username         text NOT NULL,
      direction              text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      subject                text,
      body                   text NOT NULL,
      question_type          text,
      is_read                boolean NOT NULL DEFAULT false,
      ebay_created_at        timestamptz NOT NULL,
      -- Item title/price/link — see 034_ebay_messages_item_details.sql.
      item_title             text,
      item_price             numeric(12,2),
      item_currency          text,
      item_url               text,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- shipments: one row per purchased EasyPost label. See
  -- 043_shipments.sql for the full rationale (RLS mirrors platform_payouts,
  -- no unique constraint on sale_id, no UPDATE/DELETE policy in v1).
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.shipments (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id              uuid NOT NULL REFERENCES %1$I.sales(id) ON DELETE CASCADE,
      carrier              text NOT NULL,
      service              text NOT NULL,
      tracking_number      text NOT NULL,
      label_url            text NOT NULL,
      label_format         text NOT NULL DEFAULT 'PDF',
      cost                 numeric(10,2),
      cost_currency        text,
      weight_oz            numeric(10,2) NOT NULL,
      easypost_shipment_id text NOT NULL,
      created_by           uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at           timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- ── 2. updated_at triggers (reuse schema-agnostic public.set_updated_at) ──
```

- [ ] **Step 3: Enable RLS on `shipments` — the `FOREACH tbl` array (section 5)**

In the same file, find:

```sql
  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections', 'platform_payouts', 'ebay_listing_drafts', 'ebay_messages', 'notifications', 'notification_reads']
```

Replace with:

```sql
  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections', 'platform_payouts', 'ebay_listing_drafts', 'ebay_messages', 'notifications', 'notification_reads', 'shipments']
```

- [ ] **Step 4: Add `shipments` RLS policies (section 5)**

Find this exact block (the `ebay_messages_all_admin` policy, immediately
followed by the notifications-section comment):

```sql
  -- ebay_messages — admin/super_admin, or a user granted the manage_messages
  -- override (030 — without this branch, a user granted the override can see
  -- the message.received notification (029) but not the row it points to).
  EXECUTE format('CREATE POLICY "ebay_messages_all_admin" ON %1$I.ebay_messages FOR ALL USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages''))) WITH CHECK (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages'')))', schema_name);

  -- notifications — read-only: tenant members see rows their role allows,
```

Replace with:

```sql
  -- ebay_messages — admin/super_admin, or a user granted the manage_messages
  -- override (030 — without this branch, a user granted the override can see
  -- the message.received notification (029) but not the row it points to).
  EXECUTE format('CREATE POLICY "ebay_messages_all_admin" ON %1$I.ebay_messages FOR ALL USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages''))) WITH CHECK (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages'')))', schema_name);

  -- shipments — mirrors platform_payouts: every tenant member can read (a
  -- tracking number/cost is order info, not a secret), write restricted to
  -- admin/super_admin (same bar as the "Generate Shipping Label" UI gate and
  -- requireIntegrationAdmin()). No UPDATE/DELETE policy — v1 has no
  -- edit/void/refund flow.
  EXECUTE format('CREATE POLICY "shipments_select" ON %1$I.shipments FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "shipments_insert" ON %1$I.shipments FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- notifications — read-only: tenant members see rows their role allows,
```

- [ ] **Step 5: Add the `shipments` index (section 6)**

Find:

```sql
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_messages_thread ON %1$I.ebay_messages (buyer_username, item_id, ebay_created_at)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_created ON %1$I.notifications (created_at DESC)', schema_name);
```

Replace with:

```sql
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_messages_thread ON %1$I.ebay_messages (buyer_username, item_id, ebay_created_at)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_shipments_sale_id ON %1$I.shipments (sale_id)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_created ON %1$I.notifications (created_at DESC)', schema_name);
```

- [ ] **Step 6: Add the `Shipment` type and extend `AuditEntity` in `src/types/index.ts`**

Find (near the top of the Audit Log section):

```ts
export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product" | "message";
```

Replace with:

```ts
export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product" | "message" | "shipment";
```

Then, at the end of the file (after the `EbayMessage` interface, which is
the last thing in the file), append a new section:

```ts

// ─── Shipments ────────────────────────────────────────────────────────────

export interface Shipment {
  id: string;
  sale_id: string;
  carrier: string;
  service: string;
  tracking_number: string;
  label_url: string;
  label_format: string;
  cost: number | null;
  cost_currency: string | null;
  weight_oz: number;
  easypost_shipment_id: string;
  created_by: string;
  created_at: string;
}
```

- [ ] **Step 7: Update `supabase/SKILL.md`'s file-map table**

In `supabase/SKILL.md`, find the row for migration 039 (the last row before
the `control-plane/001_schema.sql` row):

```
| `migrations/039_ebay_listing_drafts_inactive_status.sql` | all `tenant_%` schemas | ⏳ **pending — needs manual apply**, this session's `supabase-data` MCP connection is read-only for DDL (`ALTER TABLE` in a read-only transaction errored out; apply via the Supabase SQL editor or CLI instead). Drops and recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Backs `src/app/dashboard/listings/`'s switch from hard-deleting a local row once a listing ends on eBay to marking it `inactive` instead (end/sync/ebay-detail routes) — see its `SKILL.md` gotcha for the full story. |
| `control-plane/001_schema.sql` | `control` (Project A) | ✅ applied |
```

Replace with (adds the new 043 row between them):

```
| `migrations/039_ebay_listing_drafts_inactive_status.sql` | all `tenant_%` schemas | ⏳ **pending — needs manual apply**, this session's `supabase-data` MCP connection is read-only for DDL (`ALTER TABLE` in a read-only transaction errored out; apply via the Supabase SQL editor or CLI instead). Drops and recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Backs `src/app/dashboard/listings/`'s switch from hard-deleting a local row once a listing ends on eBay to marking it `inactive` instead (end/sync/ebay-detail routes) — see its `SKILL.md` gotcha for the full story. |
| `migrations/043_shipments.sql` | all `tenant_%` schemas | ⏳ **pending** — creates `shipments` table (one row per purchased EasyPost label) via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. RLS mirrors `platform_payouts`: SELECT for all tenant members, INSERT admin/super_admin only, no UPDATE/DELETE policy (v1 has no edit/void/refund flow). Depends on migrations `041`/`042` (buyer shipping address on `sales`, ship-from address on `company_profile`) existing for the *application code* that reads/writes it — the `shipments` table itself has no FK/column dependency on either. Backs `src/app/dashboard/sales/[id]/page.tsx`'s Shipping card and `src/lib/shipping/` — see its `SKILL.md`. |
| `control-plane/001_schema.sql` | `control` (Project A) | ✅ applied |
```

- [ ] **Step 8: Update `supabase/CLAUDE.md`'s file list**

In `supabase/CLAUDE.md`, find this exact block (the end of the 039 bullet,
immediately followed by the `## Related code` heading):

```
- `migrations/039_ebay_listing_drafts_inactive_status.sql` — drops and
  recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the
  allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored
  into `provision_tenant_schema()` in the same commit. Backs the switch
  (2026-09-01) from hard-deleting a local `ebay_listing_drafts` row once a
  listing ends on eBay to marking it `inactive` instead — a tenant deleting
  a listing, or eBay ending one behind their back, now stays visible as
  history under the Listings page's "Inactive" filter. Backs the Listings
  feature (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for
  the full story.

## Related code
```

Replace with:

```
- `migrations/039_ebay_listing_drafts_inactive_status.sql` — drops and
  recreates `ebay_listing_drafts_status_check` to add `'inactive'` to the
  allowed `status` values, via `run_on_all_tenant_schemas`; also mirrored
  into `provision_tenant_schema()` in the same commit. Backs the switch
  (2026-09-01) from hard-deleting a local `ebay_listing_drafts` row once a
  listing ends on eBay to marking it `inactive` instead — a tenant deleting
  a listing, or eBay ending one behind their back, now stays visible as
  history under the Listings page's "Inactive" filter. Backs the Listings
  feature (`src/app/dashboard/listings/`) — see its `SKILL.md` gotcha for
  the full story.
- `migrations/043_shipments.sql` — creates `shipments` (one row per
  purchased EasyPost label) in every tenant schema via
  `run_on_all_tenant_schemas`; also mirrored into
  `provision_tenant_schema()` in the same commit. RLS mirrors
  `platform_payouts`: SELECT for all tenant members, INSERT admin/
  super_admin only, no UPDATE/DELETE policy (v1 has no edit/void/refund
  flow). Backs the shipping-label-generation feature
  (`src/lib/shipping/`, `src/app/api/shipping/`,
  `src/app/dashboard/sales/[id]/page.tsx`'s Shipping card).

## Related code
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/043_shipments.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(shipping): add shipments table, provisioning, and Shipment type"
```

---

## Task 2: `src/lib/shipping/easypost.ts` (EasyPost REST wrapper) + test + env var doc

**Files:**
- Create: `src/lib/shipping/easypost.ts`
- Test: `src/lib/shipping/easypost.test.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `process.env.EASYPOST_API_KEY` (string, HTTP Basic username, empty password).
- Produces (consumed by Task 3's mapper return type, Task 4, Task 5, Task 6):
  ```ts
  export interface EasyPostAddress {
    name: string | null;
    street1: string;
    street2: string | null;
    city: string;
    state: string | null;
    zip: string;
    country: string;
    phone: string | null;
    email: string | null;
  }
  export interface EasyPostParcel {
    weightOz: number;
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
  }
  export interface EasyPostRate {
    id: string;
    carrier: string;
    service: string;
    rate: string;
    currency: string;
    deliveryDays: number | null;
  }
  export interface EasyPostRatesResult {
    easypostShipmentId: string;
    rates: EasyPostRate[];
  }
  export interface EasyPostLabel {
    trackingNumber: string;
    labelUrl: string;
    labelFormat: string;
  }
  export async function getRates(fromAddress: EasyPostAddress, toAddress: EasyPostAddress, parcel: EasyPostParcel): Promise<EasyPostRatesResult>
  export async function buyLabel(shipmentId: string, rateId: string): Promise<EasyPostLabel>
  ```
  Both throw a plain `Error` (EasyPost's own `error.message` when present, a
  generic status-code message otherwise) on any non-2xx response.

- [ ] **Step 1: Write the module**

Create `src/lib/shipping/easypost.ts`:

```ts
/**
 * Thin, server-only wrapper over EasyPost's REST API
 * (https://api.easypost.com/v2). Auth is HTTP Basic with EASYPOST_API_KEY
 * as the username and an empty password — EasyPost's own convention, not
 * this app's. Never import this from a Client Component (same rule as
 * everything under src/lib/integrations/).
 */

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

export interface EasyPostAddress {
  name: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string | null;
  zip: string;
  country: string;
  phone: string | null;
  email: string | null;
}

export interface EasyPostParcel {
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  /** EasyPost returns this as a decimal string, e.g. "7.50" — not a number. */
  rate: string;
  currency: string;
  deliveryDays: number | null;
}

export interface EasyPostRatesResult {
  easypostShipmentId: string;
  rates: EasyPostRate[];
}

export interface EasyPostLabel {
  trackingNumber: string;
  labelUrl: string;
  labelFormat: string;
}

function authHeader(): string {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    throw new Error("EASYPOST_API_KEY is not configured.");
  }
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function easypostFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${EASYPOST_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errorField = json.error as { message?: string } | undefined;
    const message = errorField?.message ?? `EasyPost request failed with status ${res.status}`;
    throw new Error(message);
  }

  return json;
}

function toEasyPostAddressPayload(address: EasyPostAddress) {
  return {
    name: address.name,
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone,
    email: address.email,
  };
}

/**
 * Fetches live carrier rates for a shipment. Returns the EasyPost shipment
 * id (needed by `buyLabel`) alongside the array of rates EasyPost returned.
 */
export async function getRates(
  fromAddress: EasyPostAddress,
  toAddress: EasyPostAddress,
  parcel: EasyPostParcel
): Promise<EasyPostRatesResult> {
  const json = await easypostFetch("/shipments", {
    shipment: {
      from_address: toEasyPostAddressPayload(fromAddress),
      to_address: toEasyPostAddressPayload(toAddress),
      parcel: {
        weight: parcel.weightOz,
        length: parcel.lengthIn,
        width: parcel.widthIn,
        height: parcel.heightIn,
      },
    },
  });

  const rawRates = (json.rates as Array<Record<string, unknown>> | undefined) ?? [];

  return {
    easypostShipmentId: json.id as string,
    rates: rawRates.map((r) => ({
      id: r.id as string,
      carrier: r.carrier as string,
      service: r.service as string,
      rate: r.rate as string,
      currency: r.currency as string,
      deliveryDays: (r.delivery_days as number | null | undefined) ?? null,
    })),
  };
}

/**
 * Purchases a label for the given EasyPost shipment + chosen rate.
 */
export async function buyLabel(shipmentId: string, rateId: string): Promise<EasyPostLabel> {
  const json = await easypostFetch(`/shipments/${shipmentId}/buy`, {
    rate: { id: rateId },
  });

  const postageLabel = json.postage_label as Record<string, unknown> | undefined;

  return {
    trackingNumber: json.tracking_code as string,
    labelUrl: postageLabel?.label_url as string,
    labelFormat: (postageLabel?.label_file_type as string | undefined) ?? "PDF",
  };
}
```

- [ ] **Step 2: Write the test**

Create `src/lib/shipping/easypost.test.ts` (fetch-mocking pattern modeled on
`src/lib/integrations/ebay/tradingApi.test.ts`):

```ts
import { getRates, buyLabel } from "./easypost";

const originalFetch = global.fetch;
const originalApiKey = process.env.EASYPOST_API_KEY;

beforeEach(() => {
  process.env.EASYPOST_API_KEY = "EZTKtest123";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.EASYPOST_API_KEY = originalApiKey;
});

function mockJsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

const fromAddress = {
  name: "KaufNest GmbH",
  street1: "Hauptstr 1",
  street2: null,
  city: "Berlin",
  state: null,
  zip: "10115",
  country: "DE",
  phone: null,
  email: null,
};

const toAddress = {
  name: "Jane Buyer",
  street1: "5th Ave 1",
  street2: null,
  city: "New York",
  state: "NY",
  zip: "10001",
  country: "US",
  phone: null,
  email: null,
};

describe("getRates", () => {
  it("posts to /shipments with from/to/parcel and Basic auth, parsing rates + shipment id", async () => {
    mockJsonResponse({
      id: "shp_123",
      rates: [
        { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.50", currency: "USD", delivery_days: 2 },
      ],
    });

    const result = await getRates(fromAddress, toAddress, { weightOz: 16 });

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.easypost.com/v2/shipments");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from("EZTKtest123:").toString("base64")}`
    );

    const body = JSON.parse(options.body);
    expect(body.shipment.from_address.street1).toBe("Hauptstr 1");
    expect(body.shipment.to_address.city).toBe("New York");
    expect(body.shipment.parcel.weight).toBe(16);

    expect(result.easypostShipmentId).toBe("shp_123");
    expect(result.rates).toEqual([
      { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.50", currency: "USD", deliveryDays: 2 },
    ]);
  });

  it("throws with EasyPost's own error message on a non-2xx response", async () => {
    mockJsonResponse({ error: { message: "Invalid to_address: zip is required" } }, false, 422);

    await expect(getRates(fromAddress, toAddress, { weightOz: 16 })).rejects.toThrow(
      "Invalid to_address: zip is required"
    );
  });

  it("throws a generic message when the error response has no error.message", async () => {
    mockJsonResponse({}, false, 500);

    await expect(getRates(fromAddress, toAddress, { weightOz: 16 })).rejects.toThrow(
      "EasyPost request failed with status 500"
    );
  });
});

describe("buyLabel", () => {
  it("posts to /shipments/{id}/buy with the chosen rate id, parsing the label response", async () => {
    mockJsonResponse({
      tracking_code: "9400111899223197428490",
      postage_label: { label_url: "https://easypost-files.example/label.pdf", label_file_type: "PDF" },
    });

    const label = await buyLabel("shp_123", "rate_1");

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.easypost.com/v2/shipments/shp_123/buy");
    expect(JSON.parse(options.body)).toEqual({ rate: { id: "rate_1" } });

    expect(label).toEqual({
      trackingNumber: "9400111899223197428490",
      labelUrl: "https://easypost-files.example/label.pdf",
      labelFormat: "PDF",
    });
  });

  it("defaults labelFormat to PDF when EasyPost omits label_file_type", async () => {
    mockJsonResponse({
      tracking_code: "TRACK123",
      postage_label: { label_url: "https://easypost-files.example/label.pdf" },
    });

    const label = await buyLabel("shp_123", "rate_1");
    expect(label.labelFormat).toBe("PDF");
  });

  it("throws with EasyPost's own error message on a non-2xx response", async () => {
    mockJsonResponse({ error: { message: "Rate has expired" } }, false, 422);

    await expect(buyLabel("shp_123", "rate_1")).rejects.toThrow("Rate has expired");
  });
});
```

- [ ] **Step 3: Ask the user to run the test**

Per Global Constraint 5, do not run this yourself. Ask the user to run:

```bash
npx jest src/lib/shipping/easypost.test.ts
```

and paste back the output. Do not proceed to Step 4 until they confirm all
tests pass.

- [ ] **Step 4: Document `EASYPOST_API_KEY` in `.env.local.example`**

In `.env.local.example`, find:

```
# Anthropic API key for AI listing assistance (server-only — never NEXT_PUBLIC_)
ANTHROPIC_API_KEY=

# ─── Playwright E2E (e2e/) ───────────────────────────────────────────────────
```

Replace with:

```
# Anthropic API key for AI listing assistance (server-only — never NEXT_PUBLIC_)
ANTHROPIC_API_KEY=

# ─── Shipping labels (src/lib/shipping/) ─────────────────────────────────────

# EasyPost API key (https://www.easypost.com/) — server-only, HTTP Basic auth
# username with an empty password (EasyPost's own convention). EasyPost
# provides an "EZTK..." test-mode key that returns realistic fake rates
# without charging anything — use one for local dev; use a real production
# key only in production env vars.
EASYPOST_API_KEY=EZTK...

# ─── Playwright E2E (e2e/) ───────────────────────────────────────────────────
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/shipping/easypost.ts src/lib/shipping/easypost.test.ts .env.local.example
git commit -m "feat(shipping): add EasyPost REST wrapper (getRates/buyLabel)"
```

---

## Task 3: `src/lib/shipping/addressMappers.ts` + test

**Files:**
- Create: `src/lib/shipping/addressMappers.ts`
- Test: `src/lib/shipping/addressMappers.test.ts`

**Interfaces:**
- Consumes: `EasyPostAddress` (Task 2), `CompanyProfile`/`Sale` from `@/types`
  (their `ship_from_*`/`shipping_*`/`buyer_*` fields — **see Global
  Constraint 1: confirm these fields exist on the types before starting this
  task**).
- Produces (consumed by Tasks 4, 5):
  ```ts
  export function addressFromCompanyProfile(profile: CompanyProfile): EasyPostAddress
  export function addressFromSale(sale: Sale): EasyPostAddress
  ```
  Both throw a plain `Error` naming the specific missing field when a
  required field (`street1`/`city`/`postal_code`/`country` — under each
  type's own field-name prefix) is null.

- [ ] **Step 0: Confirm the prerequisite fields exist**

Open `src/types/index.ts` and confirm:
- `Sale` has `buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
  `shipping_city`, `shipping_state`, `shipping_postal_code`,
  `shipping_country`, `buyer_phone`, `buyer_email` (all `string | null`).
- `CompanyProfile` has `ship_from_street1`, `ship_from_street2`,
  `ship_from_city`, `ship_from_state`, `ship_from_postal_code`,
  `ship_from_country` (all `string | null`).

If either is missing, **stop** per Global Constraint 1 — do not proceed with
this task.

- [ ] **Step 1: Write the module**

Create `src/lib/shipping/addressMappers.ts`:

```ts
import type { CompanyProfile, Sale } from "@/types";
import type { EasyPostAddress } from "./easypost";

/**
 * Maps the tenant's ship-from address (CompanyProfile.ship_from_*) to an
 * EasyPost address. Throws a descriptive error naming the missing field
 * when a required one is null — this is the "sender address not
 * configured" guard the two shipping API routes rely on. The UI
 * additionally hides the "Generate Shipping Label" button when this would
 * throw (checked client-side from already-loaded state) so a seller
 * doesn't click a button guaranteed to fail — both checks guard the same
 * thing on purpose, belt and suspenders.
 */
export function addressFromCompanyProfile(profile: CompanyProfile): EasyPostAddress {
  if (!profile.ship_from_street1) {
    throw new Error("Sender address is missing a street address — add one in Settings.");
  }
  if (!profile.ship_from_city) {
    throw new Error("Sender address is missing a city — add one in Settings.");
  }
  if (!profile.ship_from_postal_code) {
    throw new Error("Sender address is missing a postal code — add one in Settings.");
  }
  if (!profile.ship_from_country) {
    throw new Error("Sender address is missing a country — add one in Settings.");
  }

  return {
    name: profile.name || null,
    street1: profile.ship_from_street1,
    street2: profile.ship_from_street2,
    city: profile.ship_from_city,
    state: profile.ship_from_state,
    zip: profile.ship_from_postal_code,
    country: profile.ship_from_country,
    phone: profile.phone,
    email: profile.email,
  };
}

/**
 * Maps a sale's buyer shipping address (Sale.shipping_*/buyer_*) to an
 * EasyPost address. Throws a descriptive error naming the missing field
 * when a required one is null — the "buyer address not captured" guard.
 */
export function addressFromSale(sale: Sale): EasyPostAddress {
  if (!sale.shipping_address_line1) {
    throw new Error("Buyer address is missing a street address.");
  }
  if (!sale.shipping_city) {
    throw new Error("Buyer address is missing a city.");
  }
  if (!sale.shipping_postal_code) {
    throw new Error("Buyer address is missing a postal code.");
  }
  if (!sale.shipping_country) {
    throw new Error("Buyer address is missing a country.");
  }

  return {
    name: sale.buyer_name,
    street1: sale.shipping_address_line1,
    street2: sale.shipping_address_line2,
    city: sale.shipping_city,
    state: sale.shipping_state,
    zip: sale.shipping_postal_code,
    country: sale.shipping_country,
    phone: sale.buyer_phone,
    email: sale.buyer_email,
  };
}
```

- [ ] **Step 2: Write the test**

Create `src/lib/shipping/addressMappers.test.ts`:

```ts
import { addressFromCompanyProfile, addressFromSale } from "./addressMappers";
import type { CompanyProfile, Sale } from "@/types";

const completeProfile: CompanyProfile = {
  id: "cp1",
  name: "KaufNest GmbH",
  logo_url: null,
  vat_number: null,
  tax_id: null,
  address: null,
  phone: "+49123456",
  email: "shop@kaufnest.example",
  currency: "EUR",
  timezone: "Europe/Berlin",
  vat_rate: 19,
  bank_name: null,
  iban: null,
  bic: null,
  invoice_prefix: "INV-",
  payment_terms: "30 days",
  footer_notes: null,
  updated_at: "2026-09-04T00:00:00Z",
  ship_from_street1: "Hauptstr 1",
  ship_from_street2: null,
  ship_from_city: "Berlin",
  ship_from_state: null,
  ship_from_postal_code: "10115",
  ship_from_country: "DE",
};

describe("addressFromCompanyProfile", () => {
  it("maps a complete ship-from address", () => {
    expect(addressFromCompanyProfile(completeProfile)).toEqual({
      name: "KaufNest GmbH",
      street1: "Hauptstr 1",
      street2: null,
      city: "Berlin",
      state: null,
      zip: "10115",
      country: "DE",
      phone: "+49123456",
      email: "shop@kaufnest.example",
    });
  });

  it("throws naming the missing field when ship_from_street1 is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_street1: null })
    ).toThrow(/street address/);
  });

  it("throws naming the missing field when ship_from_city is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_city: null })
    ).toThrow(/city/);
  });

  it("throws naming the missing field when ship_from_postal_code is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_postal_code: null })
    ).toThrow(/postal code/);
  });

  it("throws naming the missing field when ship_from_country is null", () => {
    expect(() =>
      addressFromCompanyProfile({ ...completeProfile, ship_from_country: null })
    ).toThrow(/country/);
  });
});

const completeSale: Sale = {
  id: "s1",
  platform: "ebay",
  product_name: "Widget",
  product_id: null,
  quantity: 1,
  unit_price: 10,
  total_amount: 10,
  currency: "EUR",
  date: "2026-09-01",
  description: null,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
  vat_rate: null,
  vat_amount: null,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: null,
  buyer_name: "Jane Buyer",
  shipping_address_line1: "5th Ave 1",
  shipping_address_line2: null,
  shipping_city: "New York",
  shipping_state: "NY",
  shipping_postal_code: "10001",
  shipping_country: "US",
  buyer_phone: null,
  buyer_email: "jane@example.com",
};

describe("addressFromSale", () => {
  it("maps a complete buyer shipping address", () => {
    expect(addressFromSale(completeSale)).toEqual({
      name: "Jane Buyer",
      street1: "5th Ave 1",
      street2: null,
      city: "New York",
      state: "NY",
      zip: "10001",
      country: "US",
      phone: null,
      email: "jane@example.com",
    });
  });

  it("throws naming the missing field when shipping_address_line1 is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_address_line1: null })).toThrow(
      /street address/
    );
  });

  it("throws naming the missing field when shipping_city is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_city: null })).toThrow(/city/);
  });

  it("throws naming the missing field when shipping_postal_code is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_postal_code: null })).toThrow(
      /postal code/
    );
  });

  it("throws naming the missing field when shipping_country is null", () => {
    expect(() => addressFromSale({ ...completeSale, shipping_country: null })).toThrow(/country/);
  });
});
```

- [ ] **Step 3: Ask the user to run the test**

```bash
npx jest src/lib/shipping/addressMappers.test.ts
```

Do not proceed to Step 4 until the user confirms all tests pass. If it fails
with a type error about a missing property on `Sale`/`CompanyProfile`, that
confirms Global Constraint 1 — stop and report it rather than patching
around it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/shipping/addressMappers.ts src/lib/shipping/addressMappers.test.ts
git commit -m "feat(shipping): add CompanyProfile/Sale to EasyPost address mappers"
```

---

## Task 4: `POST /api/shipping/rates` route

**Files:**
- Create: `src/app/api/shipping/rates/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin()` (`@/lib/integrations/authGuard`),
  `getRates` (Task 2), `addressFromCompanyProfile`/`addressFromSale` (Task 3).
- Produces: `POST /api/shipping/rates` — request body
  `{ saleId: string, weightOz: number, lengthIn?: number, widthIn?: number, heightIn?: number }`,
  success response `{ easypostShipmentId: string, rates: EasyPostRate[] }`
  (200), error response `{ error: string }` (400/401/403/404) — consumed by
  Task 6's `GenerateLabelModal`.

- [ ] **Step 1: Write the route**

Create `src/app/api/shipping/rates/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getRates } from "@/lib/shipping/easypost";
import { addressFromCompanyProfile, addressFromSale } from "@/lib/shipping/addressMappers";
import type { CompanyProfile, Sale } from "@/types";

interface RatesRequestBody {
  saleId: string;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const body = (await req.json()) as Partial<RatesRequestBody>;
  if (!body.saleId || typeof body.weightOz !== "number" || body.weightOz <= 0) {
    return NextResponse.json(
      { error: "saleId and a positive weightOz are required." },
      { status: 400 }
    );
  }

  const { data: sale, error: saleError } = await client
    .from("sales")
    .select("*")
    .eq("id", body.saleId)
    .single<Sale>();

  if (saleError || !sale) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { data: companyProfile, error: profileError } = await client
    .from("company_profile")
    .select("*")
    .single<CompanyProfile>();

  if (profileError || !companyProfile) {
    return NextResponse.json({ error: "Company profile not found." }, { status: 404 });
  }

  try {
    const fromAddress = addressFromCompanyProfile(companyProfile);
    const toAddress = addressFromSale(sale);

    const { easypostShipmentId, rates } = await getRates(fromAddress, toAddress, {
      weightOz: body.weightOz,
      lengthIn: body.lengthIn,
      widthIn: body.widthIn,
      heightIn: body.heightIn,
    });

    return NextResponse.json({ easypostShipmentId, rates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch shipping rates.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

Note: `requireIntegrationAdmin()` already 401s with no session, 400s with no
`tenant_schema`, and 403s if the caller's role isn't `admin`/`super_admin` —
this route adds no extra role check on top, per the design spec ("Guarded by
a role check equivalent to `requireIntegrationAdmin()` ... import it
directly rather than duplicating it").

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shipping/rates/route.ts
git commit -m "feat(shipping): add POST /api/shipping/rates route"
```

---

## Task 5: `POST /api/shipping/buy` route

**Files:**
- Create: `src/app/api/shipping/buy/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationAdmin()`, `buyLabel` (Task 2), `writeAuditLog`
  (`@/lib/utils/audit`), `Shipment`/`Profile` types (`@/types`).
- Produces: `POST /api/shipping/buy` — request body
  `{ saleId: string, easypostShipmentId: string, rateId: string, weightOz: number, carrier: string, service: string, cost: number | null, costCurrency: string | null }`,
  success response: the inserted `Shipment` row (200), error response
  `{ error: string }` — consumed by Task 6's `GenerateLabelModal`.

- [ ] **Step 1: Write the route**

Create `src/app/api/shipping/buy/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { buyLabel } from "@/lib/shipping/easypost";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Profile, Shipment } from "@/types";

interface BuyRequestBody {
  saleId: string;
  easypostShipmentId: string;
  rateId: string;
  weightOz: number;
  carrier: string;
  service: string;
  cost: number | null;
  costCurrency: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const body = (await req.json()) as Partial<BuyRequestBody>;
  if (
    !body.saleId ||
    !body.easypostShipmentId ||
    !body.rateId ||
    typeof body.weightOz !== "number" ||
    !body.carrier ||
    !body.service
  ) {
    return NextResponse.json(
      {
        error:
          "saleId, easypostShipmentId, rateId, weightOz, carrier and service are required.",
      },
      { status: 400 }
    );
  }

  // Buy the label first. cost/costCurrency/carrier/service are trusted from
  // the client here because they only affect what's DISPLAYED — rateId
  // alone determines what EasyPost actually charges, and rateId was already
  // shown to and chosen by the user against the route's own /rates
  // response in the previous step. The route is not re-fetching rates here
  // on purpose: the rate was already validated once.
  let label;
  try {
    label = await buyLabel(body.easypostShipmentId, body.rateId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to purchase the shipping label.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { data: shipment, error: insertError } = await client
    .from("shipments")
    .insert({
      sale_id: body.saleId,
      carrier: body.carrier,
      service: body.service,
      tracking_number: label.trackingNumber,
      label_url: label.labelUrl,
      label_format: label.labelFormat,
      cost: body.cost ?? null,
      cost_currency: body.costCurrency ?? null,
      weight_oz: body.weightOz,
      easypost_shipment_id: body.easypostShipmentId,
      created_by: userId,
    })
    .select()
    .single<Shipment>();

  if (insertError || !shipment) {
    // The label WAS purchased at this point — a failure here is our own bug
    // (a 500), not a rejection from EasyPost. Surface the tracking number so
    // the seller isn't left with a paid label the app has no record of.
    console.error("[shipping/buy] label purchased but could not be saved:", insertError);
    return NextResponse.json(
      {
        error: `Label was purchased (tracking number ${label.trackingNumber}) but could not be saved. Contact support with this tracking number.`,
      },
      { status: 500 }
    );
  }

  const { data: profile } = await client
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single<Pick<Profile, "email">>();

  await writeAuditLog(client, {
    userId,
    userEmail: profile?.email ?? "",
    action: "create",
    entityType: "shipment",
    entityId: shipment.id,
    metadata: {
      sale_id: body.saleId,
      carrier: shipment.carrier,
      service: shipment.service,
      tracking_number: shipment.tracking_number,
      cost: shipment.cost,
      cost_currency: shipment.cost_currency,
    },
  });

  return NextResponse.json(shipment);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shipping/buy/route.ts
git commit -m "feat(shipping): add POST /api/shipping/buy route"
```

---

## Task 6: `GenerateLabelModal.tsx`

**Files:**
- Create: `src/app/dashboard/sales/_components/GenerateLabelModal.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `Field`/`Input`/`Row` (`@/components/ui/`),
  `formatCurrency` (`@/lib/utils/currency`), `EasyPostRate` type (Task 2),
  `Sale`/`Shipment`/`Currency` types (`@/types`). Calls `POST
  /api/shipping/rates` and `POST /api/shipping/buy` (Tasks 4, 5) via `fetch`.
- Produces:
  ```ts
  interface Props {
    sale: Sale | null; // non-null = modal open
    onClose: () => void;
    onSuccess: (shipment: Shipment) => void;
  }
  export function GenerateLabelModal({ sale, onClose, onSuccess }: Props): JSX.Element
  ```
  — consumed by Task 7's order detail page.

- [ ] **Step 1: Write the component**

Create `src/app/dashboard/sales/_components/GenerateLabelModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Row } from "@/components/ui/FormFields";
import { formatCurrency } from "@/lib/utils/currency";
import type { Sale, Shipment, Currency } from "@/types";
import type { EasyPostRate } from "@/lib/shipping/easypost";

interface Props {
  sale: Sale | null; // non-null = modal open
  onClose: () => void;
  onSuccess: (shipment: Shipment) => void;
}

type Step = "form" | "rates";

export function GenerateLabelModal({ sale, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [weightOz, setWeightOz] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [easypostShipmentId, setEasypostShipmentId] = useState<string | null>(null);
  const [rates, setRates] = useState<EasyPostRate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weight = parseFloat(weightOz);
  const isWeightValid = !isNaN(weight) && weight > 0;

  function reset() {
    setStep("form");
    setWeightOz("");
    setLengthIn("");
    setWidthIn("");
    setHeightIn("");
    setEasypostShipmentId(null);
    setRates([]);
    setSelectedRateId(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleGetRates(e: React.FormEvent) {
    e.preventDefault();
    if (!sale || !isWeightValid) return;
    setError(null);
    setLoadingRates(true);

    try {
      const res = await fetch("/api/shipping/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: sale.id,
          weightOz: weight,
          lengthIn: lengthIn ? parseFloat(lengthIn) : undefined,
          widthIn: widthIn ? parseFloat(widthIn) : undefined,
          heightIn: heightIn ? parseFloat(heightIn) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to fetch shipping rates.");
        return;
      }
      setEasypostShipmentId(json.easypostShipmentId);
      setRates(json.rates);
      setStep("rates");
    } catch {
      setError("Failed to fetch shipping rates. Check your connection and try again.");
    } finally {
      setLoadingRates(false);
    }
  }

  async function handleBuy() {
    if (!sale || !easypostShipmentId || !selectedRateId) return;
    const rate = rates.find((r) => r.id === selectedRateId);
    if (!rate) return;

    setError(null);
    setBuying(true);

    try {
      const res = await fetch("/api/shipping/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: sale.id,
          easypostShipmentId,
          rateId: rate.id,
          weightOz: weight,
          carrier: rate.carrier,
          service: rate.service,
          cost: rate.rate ? parseFloat(rate.rate) : null,
          costCurrency: rate.currency ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to purchase the shipping label.");
        return;
      }
      onSuccess(json as Shipment);
      reset();
    } catch {
      setError("Failed to purchase the shipping label. Check your connection and try again.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <Modal
      title="Generate Shipping Label"
      open={!!sale}
      onClose={handleClose}
      footer={
        step === "form" ? (
          <>
            <Button variant="secondary" type="button" onClick={handleClose} disabled={loadingRates}>
              Cancel
            </Button>
            <Button type="submit" form="generate-label-form" disabled={loadingRates || !isWeightValid}>
              {loadingRates ? "Fetching rates…" : "Get Rates"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" type="button" onClick={handleClose} disabled={buying}>
              Cancel
            </Button>
            <Button type="button" onClick={handleBuy} disabled={buying || !selectedRateId}>
              {buying ? "Buying…" : "Buy Label"}
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      {step === "form" && (
        <form id="generate-label-form" onSubmit={handleGetRates} className="space-y-4">
          <Field label="Weight (oz)" required>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={weightOz}
              onChange={(e) => setWeightOz(e.target.value)}
              required
            />
          </Field>
          <Row>
            <Field label="Length (in)">
              <Input
                type="number"
                min="0"
                step="0.1"
                value={lengthIn}
                onChange={(e) => setLengthIn(e.target.value)}
              />
            </Field>
            <Field label="Width (in)">
              <Input
                type="number"
                min="0"
                step="0.1"
                value={widthIn}
                onChange={(e) => setWidthIn(e.target.value)}
              />
            </Field>
          </Row>
          <Field label="Height (in)">
            <Input
              type="number"
              min="0"
              step="0.1"
              value={heightIn}
              onChange={(e) => setHeightIn(e.target.value)}
            />
          </Field>
        </form>
      )}

      {step === "rates" && (
        <div className="space-y-2">
          {rates.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              No rates were returned for this package.
            </p>
          )}
          {rates.map((rate) => (
            <label
              key={rate.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm cursor-pointer has-[:checked]:border-[var(--color-primary)]"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="rate"
                  value={rate.id}
                  checked={selectedRateId === rate.id}
                  onChange={() => setSelectedRateId(rate.id)}
                />
                {rate.carrier} — {rate.service}
                {rate.deliveryDays != null ? ` (${rate.deliveryDays}d)` : ""}
              </span>
              <span className="font-semibold">
                {formatCurrency(parseFloat(rate.rate), rate.currency as Currency)}
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/sales/_components/GenerateLabelModal.tsx
git commit -m "feat(shipping): add GenerateLabelModal (rates -> pick -> buy)"
```

---

## Task 7: Order detail page — Shipping card + wiring + `sales/CLAUDE.md` update

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md`

**Interfaces:**
- Consumes: `GenerateLabelModal` (Task 6), `Shipment` type (Task 1),
  `formatCurrency` (already imported in this file).
- Produces: nothing new consumed elsewhere — this is the final UI task.

- [ ] **Step 1: Add imports**

In `src/app/dashboard/sales/[id]/page.tsx`, find:

```tsx
import { EditSaleModal } from "../_components/EditSaleModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
```

Replace with:

```tsx
import { EditSaleModal } from "../_components/EditSaleModal";
import { GenerateLabelModal } from "../_components/GenerateLabelModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
```

Then find:

```tsx
import type { Sale, Purchase, Product } from "@/types";
```

Replace with:

```tsx
import type { Sale, Purchase, Product, Shipment, Currency } from "@/types";
```

- [ ] **Step 2: Add the role-check selector (before the early returns — hooks must run unconditionally)**

Find:

```tsx
  const hasDeleteOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("delete_sale") ?? false
  );
  const canDelete = isSuperAdmin || hasDeleteOverride;
```

Replace with:

```tsx
  const hasDeleteOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("delete_sale") ?? false
  );
  const canDelete = isSuperAdmin || hasDeleteOverride;
  // "Generate Shipping Label" role gate — admin/super_admin only, same bar
  // as requireIntegrationAdmin() on the two API routes this button calls.
  // Must be selected here (before the loading/not-found early returns
  // below), not inside the Derived Values section — calling a new
  // useAppSelector after a conditional return would change the number of
  // hooks called between renders.
  const currentRole = useAppSelector((s) => s.currentUser.profile?.role);
  const canGenerateLabel = currentRole === "admin" || currentRole === "super_admin";
```

- [ ] **Step 3: Add shipment state + fetch effect**

Find the end of the linked-purchase fetch effect:

```tsx
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);
  // ^ omit purchases/dispatch — we only want this to fire once per sale id;
  //   Redux updates flow through linkedPurchase without re-triggering the fetch

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
```

Replace with:

```tsx
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);
  // ^ omit purchases/dispatch — we only want this to fire once per sale id;
  //   Redux updates flow through linkedPurchase without re-triggering the fetch

  // Shipment (shipping-label feature) — same fetch-on-load pattern as the
  // linked purchase above. No Redux slice: a sale has at most one shipment
  // in v1, so it's fetched on-demand rather than hydrated globally.
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState(true);
  const [generateLabelOpen, setGenerateLabelOpen] = useState(false);

  useEffect(() => {
    if (!sale?.id) return;
    let cancelled = false;

    (async () => {
      setShipmentLoading(true);
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("shipments")
        .select("*")
        .eq("sale_id", sale.id)
        .maybeSingle();
      if (!cancelled) {
        setShipment((data as Shipment) ?? null);
        setShipmentLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);
  // ^ same reasoning as the linked-purchase effect above — fire once per
  //   sale id, not on every render.

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
```

- [ ] **Step 4: Add the address-completeness derived values (after the existing Derived Values, where `sale` is guaranteed non-null)**

Find:

```tsx
  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
```

Replace with:

```tsx
  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;

  // Shipping card gating — mirrors the throw-on-missing checks in
  // src/lib/shipping/addressMappers.ts, checked here client-side so the
  // "Generate Shipping Label" button never appears when it's guaranteed to
  // fail server-side.
  const hasSenderAddress = !!(
    companyProfile?.ship_from_street1 &&
    companyProfile?.ship_from_city &&
    companyProfile?.ship_from_postal_code &&
    companyProfile?.ship_from_country
  );
  const hasBuyerAddress = !!(
    sale.shipping_address_line1 &&
    sale.shipping_city &&
    sale.shipping_postal_code &&
    sale.shipping_country
  );
  const addressesComplete = hasSenderAddress && hasBuyerAddress;

  // ── Render ────────────────────────────────────────────────────────────────
```

- [ ] **Step 5: Add the Shipping card**

Find:

```tsx
        </section>
      </div>

      {/* Actions */}
```

Replace with:

```tsx
        </section>
      </div>

      {/* Shipping card — own card per design, rendered for every sale */}
      <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
        <h2 className="text-base font-semibold text-(--color-text-strong)">
          Shipping
        </h2>

        {shipmentLoading ? (
          <p className="text-sm text-(--color-text-muted)">Loading…</p>
        ) : shipment ? (
          <dl className="space-y-2">
            <FinRow label="Carrier" value={`${shipment.carrier} — ${shipment.service}`} />
            <FinRow label="Tracking Number" value={shipment.tracking_number} />
            {shipment.cost != null && (
              <FinRow
                label="Label Cost"
                value={formatCurrency(
                  shipment.cost,
                  (shipment.cost_currency ?? sale.currency) as Currency
                )}
              />
            )}
            <div className="pt-2">
              <a
                href={shipment.label_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
              >
                <Download size={14} />
                Download Label
              </a>
            </div>
          </dl>
        ) : !addressesComplete ? (
          <p className="text-sm text-(--color-text-muted)">
            Add a sender address in{" "}
            <Link href="/dashboard/settings" className="text-(--color-primary) hover:underline">
              Settings
            </Link>{" "}
            and a buyer address on this order to generate a shipping label.
          </p>
        ) : (
          canGenerateLabel && (
            <Button variant="secondary" onClick={() => setGenerateLabelOpen(true)}>
              Generate Shipping Label
            </Button>
          )
        )}
      </section>

      {/* Actions */}
```

- [ ] **Step 6: Wire up the modal**

Find:

```tsx
      <DeleteConfirmModal
        open={deleteOpen}
        title="Delete Order"
        description={`This will permanently delete "${sale.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
```

Replace with:

```tsx
      <DeleteConfirmModal
        open={deleteOpen}
        title="Delete Order"
        description={`This will permanently delete "${sale.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
      <GenerateLabelModal
        sale={generateLabelOpen ? sale : null}
        onClose={() => setGenerateLabelOpen(false)}
        onSuccess={(newShipment) => {
          setShipment(newShipment);
          setGenerateLabelOpen(false);
          success("Shipping label generated", `Tracking number ${newShipment.tracking_number}`);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Update `src/app/dashboard/sales/CLAUDE.md`**

Find (the end of the file):

```
## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
```

Replace with:

```
## Shipping labels (`src/lib/shipping/`)

`[id]/page.tsx` has a third card, **Shipping**, below Financials/Details,
rendered for every sale in one of three states: (1) no shipment yet and
either the tenant's `CompanyProfile.ship_from_*` fields or the sale's
`shipping_*`/`buyer_*` fields are incomplete — a muted message + link to
Settings, no button; (2) no shipment yet, both addresses complete — a
"Generate Shipping Label" `Button` (admin/super_admin only, gated by a
`currentRole` selector defined **before** the page's early
loading/not-found returns, alongside `isSuperAdmin`/`hasDeleteOverride` —
see the gotcha in this feature's `SKILL.md` for why) opens
`_components/GenerateLabelModal.tsx`; (3) a shipment exists — read-only
carrier/service/tracking number/cost + a "Download Label" link. Like the
linked purchase, the shipment is fetched on-demand
(`.from("shipments").select("*").eq("sale_id", sale.id).maybeSingle()`) on
mount, not hydrated globally — no Redux slice, since a sale has at most one
shipment in v1. The address-completeness check duplicates
`src/lib/shipping/addressMappers.ts`'s throw-on-missing checks client-side
so the button never appears when it's guaranteed to fail server-side. See
`src/lib/shipping/SKILL.md` for the EasyPost wrapper, the address mappers,
and the two `/api/shipping/*` routes this card and modal call.

## Tests

`npx jest dashboard/sales` runs `_store/salesSlice.test.ts`.
```

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/sales/[id]/page.tsx src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(shipping): add Shipping card + GenerateLabelModal wiring to order detail page"
```

- [ ] **Step 9: Ask the user to manually verify**

This is the last code task — the feature is now complete end-to-end. Ask the
user to manually verify (per this repo's working agreement — no dev server/
curl from you):

1. With a test-mode `EASYPOST_API_KEY` in `.env.local`, on an order that has
   both a complete sender address (Settings) and a complete buyer address,
   open the order detail page, click "Generate Shipping Label", enter a
   weight, confirm rates appear, pick one, click "Buy Label".
2. Confirm the Shipping card now shows the carrier/service, tracking number,
   and a working "Download Label" link.
3. Confirm a `shipments` row exists in Supabase for that `sale_id`, and an
   `audit_logs` row exists with `entity_type = 'shipment'`.
4. Open an order missing a buyer address and confirm the Shipping card shows
   the "Add a sender address... " message with no button instead.
5. As a non-admin (`accountant`) role, open an order with both addresses
   complete and confirm no "Generate Shipping Label" button appears.

---

## Task 8: `src/lib/shipping/SKILL.md`

**Files:**
- Create: `src/lib/shipping/SKILL.md`

This is its own task (not folded into an earlier one) because it documents
the whole new module — `easypost.ts`, `addressMappers.ts`, and the two API
routes that call them — rather than a single task's code, per the
Task Right-Sizing guidance for a file that spans multiple tasks' output.

- [ ] **Step 1: Write the SKILL.md**

Create `src/lib/shipping/SKILL.md` (modeled on
`src/lib/integrations/SKILL.md`'s structure):

```markdown
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
  Same guard. Calls `buyLabel`, then inserts a `shipments` row. **Does not
  re-fetch the rate from EasyPost** — `carrier`/`service`/`cost`/
  `costCurrency` are trusted from the client because they only affect what's
  *displayed*; `rateId` alone determines what EasyPost actually charges, and
  it was already shown to and chosen by the user against this same route's
  own `/rates` response in the previous step. Writes an audit log entry
  (`entityType: "shipment"`, `action: "create"`) after a successful insert.
  If the insert fails after a successful EasyPost purchase, returns a 500
  naming the tracking number (the label WAS bought at that point — the
  seller needs a way to find it manually) rather than a generic error.

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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/shipping/SKILL.md
git commit -m "docs(shipping): add src/lib/shipping/SKILL.md"
```

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage**: data model (Task 1), server module (Task 2, 3), both
  API routes (Task 4, 5), UI three-state card + modal (Task 6, 7), docs
  (folded into Tasks 1/2/7 + standalone Task 8) — every section of the
  design spec maps to a task above. The spec's "Testing" section's unit
  tests are in Tasks 2/3; its manual-verification checklist is reproduced
  verbatim as Task 7 Step 9.
- **Placeholder scan**: no task contains "TBD"/"handle it"/"similar to
  Task N" — every step has literal, complete code.
- **Type consistency checked**: `Shipment` (Task 1) fields match the
  `shipments` table columns (Task 1) match the insert payload (Task 5)
  match the read in Task 7 exactly. `EasyPostAddress`/`EasyPostRate`
  (Task 2) are the exact same shape consumed by Task 3's mappers, Task 4's
  route, and Task 6's modal. `addressFromCompanyProfile`/`addressFromSale`
  (Task 3) function names/signatures match their only call site (Task 4).
