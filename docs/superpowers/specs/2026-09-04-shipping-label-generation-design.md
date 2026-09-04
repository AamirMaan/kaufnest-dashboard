# Shipping label generation (EasyPost)

**Date:** 2026-09-04
**Status:** Design approved by user. Ready for an implementation plan.
**Piece:** 4 of 4 in the "eBay order fulfillment" decomposition.

**Hard prerequisite:** this piece reads fields introduced by Piece 2 (buyer
shipping address on `sales`) and Piece 3 (structured sender address on
`company_profile`). **Implement and merge those two specs' plans before
starting this one** — the code below references `Sale.shipping_address_line1`
etc. and `CompanyProfile.ship_from_street1` etc., which do not exist until
those plans have run. This piece does **not** depend on Piece 1 (status
sync) — it never touches `sales.tracking_number`/`shipping_carrier`,
keeping its only real dependency the two address pieces.

## Problem

Once an order's buyer address (Piece 2) and the tenant's sender address
(Piece 3) exist, a seller still has to leave the app to buy and print a
shipping label. This piece closes that gap: buy a real, carrier-priced label
from inside an order's detail page.

## Scope

**In scope:** a "Generate Shipping Label" action on the order detail page
that collects a package weight (+ optional dimensions), fetches live carrier
rates via EasyPost, lets the seller pick one, purchases the label, and
stores the result (tracking number, carrier, cost, a link to the label PDF)
against the order.

**Explicitly out of scope:** package presets/saved box sizes (v1 asks for
weight/dimensions every time — YAGNI, add presets later if sellers ask),
automatic re-use of Piece 1's `sales.tracking_number` column (this piece is
independent of Piece 1 — see prerequisite note above), refunding/voiding a
purchased label (EasyPost supports it; not needed for a v1 that only buys),
multi-package shipments (one order → one label, v1 limitation), any
non-eBay-specific carrier integration beyond what EasyPost itself offers
(EasyPost is carrier-agnostic by design, so USPS/UPS/FedEx/DHL rates all
come through the same API — no per-carrier code needed).

## Why EasyPost

Chosen (per user decision) over eBay's own label-purchase flow so this
works for orders from **any** platform, not just eBay — EasyPost is a
carrier-aggregator API (single integration, rates from multiple real
carriers) with a well-documented REST API and a free sandbox/test-mode key
for development. Cost is billed to the tenant's own EasyPost account
(pass-through — this app never marks up or absorbs label cost).

## Data model

New table, migration `supabase/migrations/043_shipments.sql`
(`run_on_all_tenant_schemas`):

```sql
SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id uuid NOT NULL REFERENCES {{schema}}.sales(id) ON DELETE CASCADE,
    carrier text NOT NULL,
    service text NOT NULL,
    tracking_number text NOT NULL,
    label_url text NOT NULL,
    label_format text NOT NULL DEFAULT 'PDF',
    cost numeric(10,2),
    cost_currency text,
    weight_oz numeric(10,2) NOT NULL,
    easypost_shipment_id text NOT NULL,
    created_by uuid NOT NULL REFERENCES {{schema}}.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_shipments_sale_id ON {{schema}}.shipments(sale_id);
$$);
```

**Before writing the plan task for this migration**, the implementer must
read `{{schema}}`'s existing RLS policy shape for a comparable table (e.g.
`purchases` or `sales` in `supabase/migrations/001_init.sql` and the
`provision_tenant_schema()` body in `005_tenant_provisioning.sql`) and
replicate the same select-all-tenant-members / insert-write-admin-only
pattern for `shipments` — don't invent a new RLS shape. Also add the
`CREATE TABLE` (with the same RLS policies) to `provision_tenant_schema()`
in `005_tenant_provisioning.sql` (the "2 places" rule).

`src/types/index.ts` gets a new interface:

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

No Redux slice — a sale has at most a handful of shipments (v1: effectively
0 or 1), fetched on-demand by the order detail page the same way the linked
`Purchase` is fetched today (`.select("*").eq("sale_id", saleId)`), not
hydrated globally.

## Server module — `src/lib/shipping/`

New, server-only (never imported client-side — same rule as
`src/lib/integrations/`), modeled on that folder's shape:

- `easypost.ts` — thin wrapper over EasyPost's REST API
  (`https://api.easypost.com/v2`), auth via HTTP Basic with
  `EASYPOST_API_KEY` as the username (empty password) — EasyPost's own
  convention, document this env var in `.env.local.example`. Two functions:
  - `getRates(fromAddress, toAddress, parcel): Promise<EasyPostRate[]>` —
    `POST /shipments` with `{ shipment: { from_address, to_address, parcel } }`,
    returns the `rates` array from the response (`id`, `carrier`, `service`,
    `rate`, `currency`, `delivery_days`) plus the EasyPost `shipment.id`
    needed for the buy step.
  - `buyLabel(shipmentId, rateId): Promise<EasyPostLabel>` —
    `POST /shipments/{shipmentId}/buy` with `{ rate: { id: rateId } }`,
    returns `{ trackingNumber, labelUrl, labelFormat }` parsed from the
    response's `tracking_code`/`postage_label.label_url`/
    `postage_label.label_file_type`.
  - Both throw a plain `Error` with EasyPost's own error message on a
    non-2xx response (EasyPost returns `{ error: { message } }`) — the API
    routes below catch and surface these, never let a raw EasyPost payload
    reach the client.
- `addressFromCompanyProfile(profile: CompanyProfile): EasyPostAddress` —
  pure mapper, throws a descriptive `Error` (caught by the route, not the
  UI) if any of `ship_from_street1`/`ship_from_city`/`ship_from_postal_code`/
  `ship_from_country` is null — this is the "sender address not configured"
  guard.
- `addressFromSale(sale: Sale): EasyPostAddress` — same shape, throws if
  `shipping_address_line1`/`shipping_city`/`shipping_postal_code`/
  `shipping_country` is null — the "buyer address not captured" guard.

Both throw-on-missing functions mean the two API routes below can call them
first and let a thrown error become a clean 400 with a human-readable
message, rather than the UI needing its own duplicate completeness check —
**but** the UI still hides the "Generate Shipping Label" button when either
address is visibly incomplete (checked client-side from already-loaded
Redux/props state), so a seller doesn't click a button that's guaranteed to
fail. Both checks independently guard the same thing on purpose — belt and
suspenders, cheap given how small each check is.

## API routes

- **`POST /api/shipping/rates`** — body `{ saleId: string, weightOz: number,
  lengthIn?: number, widthIn?: number, heightIn?: number }`. Guarded by a
  role check equivalent to `requireIntegrationAdmin()` (admin/super_admin +
  valid tenant schema — reuse that exact guard, it has no eBay-specific
  logic in it despite living in `src/lib/integrations/authGuard.ts`; import
  it directly rather than duplicating it). Loads the `sale` and
  `company_profile` row via `createClient()` (tenant-scoped server client),
  builds both addresses via the two mapper functions above, calls
  `getRates`, returns `{ easypostShipmentId, rates: EasyPostRate[] }`. A
  thrown address-completeness error becomes `400 { error: message }`.
- **`POST /api/shipping/buy`** — body `{ saleId: string, easypostShipmentId:
  string, rateId: string, weightOz: number }`. Same guard. Calls `buyLabel`,
  then inserts a `shipments` row (`carrier`/`service`/`cost`/`cost_currency`
  read off the chosen rate, which the client echoes back — **not**
  re-fetched from EasyPost, since the rate was already shown to and chosen
  by the user in step 1; the route trusts its own previous response, not
  arbitrary client input, because `rateId` alone determines what EasyPost
  actually charges — the client can't manufacture a cheaper `cost` value
  that changes what's billed, only what's *displayed* to itself). Returns
  the inserted `Shipment` row. Also writes an audit log entry
  (`writeAuditLog`, `action: "create"`, `entityType`: extend
  `AuditEntity` in `src/types/index.ts` with `"shipment"`, `entityId`: the
  new shipment id, metadata `{ sale_id, carrier, service, tracking_number,
  cost, cost_currency }`).

Both routes are server-only API routes (not client-direct Supabase calls)
specifically because they call out to EasyPost with a server-side API key —
same "server-only, never client-side" rule as every other file under
`src/lib/integrations/`/`src/lib/shipping/`.

## UI — order detail page

`src/app/dashboard/sales/[id]/page.tsx`: new **"Shipping"** card (own card,
not folded into Details/Financials), rendered for every sale, in one of
three states:

1. **No shipments yet, addresses incomplete** — the `CompanyProfile` ship-from
   fields or the sale's shipping-address fields are missing. Show a muted
   message: "Add a sender address in Settings and a buyer address on this
   order to generate a shipping label." with a `<Link>` to `/dashboard/settings`.
   No button.
2. **No shipments yet, addresses complete** — a "Generate Shipping Label"
   `Button` (admin/super_admin only — reuse the same role check the page
   already applies to "Edit Order"/"Delete") opens a new
   `_components/GenerateLabelModal.tsx`:
   - Step A (form): Weight (oz, required, `type="number" min="0.1" step="0.1"`),
     Length/Width/Height (in, optional). Submit calls `POST
     /api/shipping/rates`.
   - Step B (rate picker): radio list of returned rates (`carrier + service
     — $cost, N days`), a "Buy Label" `Button` (disabled until a rate is
     selected, label swaps to "Buying…" while in flight per the mutating-
     button convention in `AGENTS.md`).
   - On buy success: closes the modal, the page re-fetches the sale's
     shipments (or the route's response is used to update local state
     directly — either is fine, prefer the direct local-state update to
     avoid a refetch round-trip) and moves to state 3.
   - Errors from either step (e.g. EasyPost address-validation failure)
     render inline in the modal, same red-box pattern `EditSaleModal` uses
     for its top-level `error` state — the modal stays open so the user can
     correct and retry.
3. **A shipment exists** — a read-only summary row: carrier + service,
   tracking number, cost (`formatCurrency` if `cost`/`cost_currency` are
   set), and a "Download Label" link (`<a href={label_url} target="_blank"
   rel="noopener noreferrer">`, not `<a download>` — it's an external
   EasyPost-hosted URL, a same-tab/new-tab open is correct, a forced
   download attribute only makes sense for a same-origin blob). No
   "generate another" button in v1 (one shipment per order, per Scope).

## Blast radius

One new table (empty until first use), one new server-only module, two new
API routes, one new card + one new modal on the order detail page. Zero
changes to any existing table, existing API route, or existing
sales/settings/integrations code paths. A tenant that never fills in both
addresses sees state 1 (a message, no button) and nothing else breaks.

## Testing

Per `AGENTS.md`: no dev server, no live EasyPost calls from tests or dev
(EasyPost provides `EZTK...` test-mode keys that return realistic fake rates
without charging anything — use one for local `.env.local`, document it in
`.env.local.example` as `EASYPOST_API_KEY=EZTK...` "test-mode key, use a
production key only in prod env vars").

- `src/lib/shipping/easypost.test.ts` — `getRates`/`buyLabel` request-shape
  and response-parsing tests against a mocked `fetch` (assert URL, method,
  auth header, body; assert a non-2xx mocked response throws with
  EasyPost's `error.message`).
- `src/lib/shipping/addressMappers.test.ts` (or colocated with the module
  above) — `addressFromCompanyProfile`/`addressFromSale` each get a
  complete-input case (maps correctly) and a missing-field case (throws
  with a message naming which field).
- Manual verification (ask the user to exercise in browser, per working
  agreement, with a test-mode `EASYPOST_API_KEY`): on an order with both
  addresses filled in, generate a label end-to-end (rates → pick → buy),
  confirm the Shipping card shows the tracking number and a working
  "Download Label" link, confirm a `shipments` row exists in Supabase and an
  audit log entry was written; then try it on an order missing a buyer
  address and confirm the button is hidden with the correct guidance
  message.

## Docs to update alongside implementation

- New `src/lib/shipping/SKILL.md` — document `easypost.ts`'s two functions,
  the address-mapper throw-on-missing contract, and the "server-only" rule,
  modeled on `src/lib/integrations/SKILL.md`'s structure.
- `src/app/dashboard/sales/CLAUDE.md` — new subsection for the Shipping card
  + `GenerateLabelModal.tsx`, cross-referencing `src/lib/shipping/SKILL.md`.
- `.env.local.example` — add `EASYPOST_API_KEY` with the test-mode-key note
  above.
- `supabase/SKILL.md` / `supabase/CLAUDE.md` — apply-status row + file-list
  bullet for migration `043`.
