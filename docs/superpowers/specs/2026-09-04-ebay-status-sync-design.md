# eBay order status sync (shipped + cancelled)

**Date:** 2026-09-04
**Status:** Design approved by user. Ready for an implementation plan.
**Piece:** 1 of 4 in the "eBay order fulfillment" decomposition (independent of the other 3).

## Problem

Order sync with eBay today is one-way (eBay → app, via the manual Review
Orders import). When a seller marks an order **shipped** or **cancelled**
inside this app, eBay never finds out — the buyer sees no tracking info and
the order stays open on eBay's side, even though the seller has already
acted on it locally.

## Scope

**In scope:** when a `sales` row that came from eBay (`platform === "ebay"`,
`external_order_id` set) has its `status` changed to **`shipped`** or
**`cancelled`** via the existing Edit Order flow, push that change to eBay's
Fulfillment API. Shipping to `shipped` requires a tracking number + carrier
(eBay's API requires both to create a fulfillment). This reuses the existing
manual edit flow — there is no new automatic/cron sync (matches the rest of
the Integrations feature, which is 100% manual, no push infra).

**Explicitly out of scope:** any other status transition (`processing`,
`delivered`, `returned`, `refunded`) — eBay's REST API has no equivalent for
those. Manually-created or non-eBay sales are entirely unaffected. Automatic
polling/webhooks from eBay back into the app (still one-way for reads).

## Data model

New nullable columns on `sales`, migration `supabase/migrations/040_sales_ebay_fulfillment.sql`
(`run_on_all_tenant_schemas`, per `AGENTS.md`'s tenant-DDL rule):

```sql
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS tracking_number text,
    ADD COLUMN IF NOT EXISTS shipping_carrier text,
    ADD COLUMN IF NOT EXISTS ebay_fulfillment_id text,
    ADD COLUMN IF NOT EXISTS ebay_sync_error text,
    ADD COLUMN IF NOT EXISTS ebay_synced_at timestamptz;
$$);
```

Also add the same five columns to `provision_tenant_schema()`'s `sales`
CREATE TABLE in `005_tenant_provisioning.sql` (the "2 places" rule in
`supabase/SKILL.md`).

`src/types/index.ts`'s `Sale` interface gets:

```ts
tracking_number: string | null;
shipping_carrier: string | null;
/** eBay's fulfillmentId for this order's shipment, once synced. */
ebay_fulfillment_id: string | null;
/** Last eBay push-back error, if the most recent attempt failed. Cleared on the next successful sync. */
ebay_sync_error: string | null;
ebay_synced_at: string | null;
```

All five are purely additive and `null` for every existing row.

## Carrier codes

eBay's `shippingCarrierCode` is a fixed enum, not free text. Add a small
constant list to `src/lib/integrations/ebay/carriers.ts`:

```ts
export const EBAY_CARRIER_CODES = [
  { code: "USPS", label: "USPS" },
  { code: "UPS", label: "UPS" },
  { code: "FEDEX", label: "FedEx" },
  { code: "DHL", label: "DHL" },
  { code: "OTHER", label: "Other" },
] as const;
```

(eBay accepts a longer list; this is the common subset — good enough for v1,
extend the array later if a seller needs another carrier.)

## Capture — Edit Order modal

`src/app/dashboard/sales/_components/EditSaleModal.tsx`:

- When `sale.platform === "ebay" && sale.external_order_id` **and**
  `form.status === "shipped"`, render two additional required fields inside
  the existing status `<div>` block (same pattern as the `restock` checkbox
  that already conditionally appears there): **Carrier** (`Select` from
  `EBAY_CARRIER_CODES`) and **Tracking Number** (`Input`, `required`). Both
  get the same `disabled={saving}`/`required` treatment as every other
  required field per `AGENTS.md`'s form-conventions section.
- Prefill both from `sale.tracking_number`/`sale.shipping_carrier` if
  already set (e.g. a retry after a failed sync).
- Include `tracking_number`/`shipping_carrier` in the `sales.update(...)`
  payload (`null` when not shipped/not eBay) and in the existing audit-log
  before/after diff.
- **After** the Supabase update succeeds (not before — the local write must
  never be blocked by eBay), if the status transitioned *into* `"shipped"`
  or *into* `"cancelled"` (compare `sale.status` before vs. `status` after),
  fire-and-await a call to the new sync route (below). Its result never
  blocks `onSuccess()`/`onClose()` — a failure surfaces as a toast warning,
  not a blocked save:
  ```ts
  if (sale.platform === "ebay" && sale.external_order_id &&
      sale.status !== status && (status === "shipped" || status === "cancelled")) {
    const syncRes = await fetch(`/api/integrations/ebay/orders/${sale.id}/sync-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, trackingNumber: form.trackingNumber || null, carrier: form.carrier || null }),
    });
    if (!syncRes.ok) {
      const body = await syncRes.json().catch(() => ({}));
      warning("Saved locally, eBay sync failed", body.error ?? "You can retry from the order detail page.");
    }
  }
  ```
- `AddSaleModal.tsx` is **not** touched — a sale can only be `platform ===
  "ebay"` with a real `external_order_id` via the Integrations sync/import
  pipeline, never via manual creation, so there is nothing to sync there.

## API route — `POST /api/integrations/ebay/orders/[saleId]/sync-status`

New file `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts`.
Server-only, uses `requireIntegrationAdmin()` (same guard as every other
integrations route) plus a fetch of the `sales` row by id (404 if missing or
not eBay-sourced). Body: `{ status: "shipped" | "cancelled", trackingNumber: string | null, carrier: string | null }`.

1. Look up the tenant's eBay `platform_connections` row via `getConnection`,
   `ensureValidAccessToken` for a fresh token (same helpers `review/route.ts`
   already uses).
2. Parse the eBay order id back out of `external_order_id`
   (`"${orderId}:${lineItemId}"` — split on the last `:` since eBay's own
   `orderId`/`lineItemId` never contain one, per the existing dedup-key
   convention in `mapToSale.ts`).
3. **`status === "shipped"`**: `POST {EBAY_BASE}/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`
   with body `{ lineItems: [{ lineItemId, quantity: sale.quantity }], shippedDate: new Date().toISOString(), shippingCarrierCode: carrier, trackingNumber }`.
   On success, store the returned `fulfillmentId` and clear `ebay_sync_error`.
4. **`status === "cancelled"`**: `POST {EBAY_BASE}/post-order/v2/cancellation`
   with body `{ legacyOrderId: orderId, cancelState: "CANCEL_FULL_ORDER", cancelReason: "SELLER_CANCEL_BUYER_REQUEST" }`
   (eBay's Post-Order Cancellation API — separate base path from the
   Fulfillment API, but authorized by the same `sell.fulfillment` scope
   already in `EBAY_SCOPE`). This endpoint's exact request/response shape is
   **unverified against eBay's live sandbox** at design time — the
   implementer must confirm the field names against eBay's current API
   reference before wiring this branch, and the failure path below means a
   wrong field name degrades to a visible sync error rather than a crash.
5. On any failure (network, 4xx/5xx, or an eBay error payload), catch it,
   write the message into `sales.ebay_sync_error`, and return `{ error:
   "<summarised eBay error>" }` with the upstream status code — **never
   throw past this route**, and never let a failed eBay call undo the local
   status change (the row is already saved by the time this route runs).
6. On success, update `sales` with `ebay_fulfillment_id` (shipped only),
   `ebay_sync_error: null`, `ebay_synced_at: now()`, return `{ ok: true }`.
7. New `PlatformAdapter` methods are **not** needed — this is a one-off eBay
   call, not a cross-platform sync primitive like `fetchOrders`. Add the two
   request builders as plain exported functions in `src/lib/integrations/ebay.ts`
   (`createShippingFulfillment(accessToken, orderId, body)`,
   `cancelOrder(accessToken, orderId, body)`) rather than extending
   `PlatformAdapter` — Amazon has no equivalent call, so this stays eBay-only
   plumbing the route imports directly, same shape as `ebay/messages.ts`'s
   Trading-API-only functions.

## Display — retry a failed sync

`src/app/dashboard/sales/[id]/page.tsx` Details card: when
`sale.ebay_sync_error` is set, show a small warning row ("eBay sync failed:
`<message>` — [Retry]"). The Retry button re-POSTs the same sync route with
the sale's current `status`/`tracking_number`/`shipping_carrier` (no modal
needed — nothing to re-enter). On success it dispatches `updateSale` and
clears the row.

## Blast radius

Purely additive: five nullable columns, two new conditional fields in one
existing modal, one new API route, one new display row. No existing eBay
scope change (`sell.fulfillment` already covers both endpoints), no RLS
change (route uses the same auth as every other integrations route, not
direct client DB access). A tenant that has never connected eBay, or has no
eBay-sourced sales, sees zero UI change.

## Testing

Per `AGENTS.md`: no dev server, no live eBay calls from tests. Add:

- `src/lib/integrations/ebay.test.ts` (extend, or new colocated test) for
  `createShippingFulfillment`/`cancelOrder`'s request-body construction
  (mock `fetch`, assert the URL/method/body shape) — pure request builders,
  easy to unit test without a network call.
- Manual verification (ask the user to exercise in browser, per working
  agreement): connect an eBay sandbox account, import a sandbox order via
  Review Orders, mark it Shipped with a tracking number → confirm the eBay
  sandbox Seller Hub shows the fulfillment; mark another Cancelled → confirm
  it shows cancelled on eBay's side; then intentionally break the tracking
  number format to confirm the failure path shows the warning toast and the
  Retry row without corrupting the local save.

## Docs to update alongside implementation

- `src/app/dashboard/sales/CLAUDE.md` — new subsection documenting
  `tracking_number`/`shipping_carrier`/`ebay_fulfillment_id`/
  `ebay_sync_error`/`ebay_synced_at` as additive fields, same style as the
  existing "Platform-synced orders" section.
- `src/lib/integrations/SKILL.md` — new "eBay status push-back" section
  documenting the sync route and its best-effort/non-blocking failure model.
- `supabase/SKILL.md` — apply-status row for migration `040`.
- `supabase/CLAUDE.md` — file-list bullet for `040_sales_ebay_fulfillment.sql`.
