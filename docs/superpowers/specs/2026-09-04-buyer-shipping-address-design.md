# Buyer shipping address capture

**Date:** 2026-09-04
**Status:** Design approved by user. Ready for an implementation plan.
**Piece:** 2 of 4 in the "eBay order fulfillment" decomposition. Independent
of Piece 1 (status sync) and Piece 3 (sender address). Piece 4 (label
generation) depends on this piece being implemented first.

## Problem

Generating a shipping label (Piece 4) needs a buyer's shipping address, and
right now `sales` has nowhere to store one. eBay's order API already returns
it on every order; the app just never reads or persists it.

## Scope

**In scope:** capture the buyer's shipping address automatically when an
order is synced from eBay (Review Orders import), plus a manual/editable
field set on every sale (any platform) so a non-eBay order or a wrong
auto-captured address can be entered or corrected by hand.

**Explicitly out of scope:** address validation/normalization against a
carrier API (that happens naturally at label-purchase time in Piece 4, which
will surface a carrier-side validation error there). Amazon address capture
— Amazon's SP-API order-address endpoint requires a separate PII-access
grant this app doesn't currently request; out of scope for this piece
(`amazon.ts`'s adapter simply leaves the new field `undefined`, degrading
gracefully — see below).

## Data model

New nullable columns on `sales`, migration
`supabase/migrations/041_sales_shipping_address.sql`
(`run_on_all_tenant_schemas`):

```sql
SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.sales
    ADD COLUMN IF NOT EXISTS buyer_name text,
    ADD COLUMN IF NOT EXISTS shipping_address_line1 text,
    ADD COLUMN IF NOT EXISTS shipping_address_line2 text,
    ADD COLUMN IF NOT EXISTS shipping_city text,
    ADD COLUMN IF NOT EXISTS shipping_state text,
    ADD COLUMN IF NOT EXISTS shipping_postal_code text,
    ADD COLUMN IF NOT EXISTS shipping_country text,
    ADD COLUMN IF NOT EXISTS buyer_phone text,
    ADD COLUMN IF NOT EXISTS buyer_email text;
$$);
```

Also add the same nine columns to `provision_tenant_schema()`'s `sales`
CREATE TABLE in `005_tenant_provisioning.sql` (the "2 places" rule).

`src/types/index.ts`'s `Sale` interface gets:

```ts
buyer_name: string | null;
shipping_address_line1: string | null;
shipping_address_line2: string | null;
shipping_city: string | null;
shipping_state: string | null;
shipping_postal_code: string | null;
/** ISO 3166-1 alpha-2, e.g. "DE". Free text — no format enforcement, matches `referral`'s precedent. */
shipping_country: string | null;
buyer_phone: string | null;
buyer_email: string | null;
```

`shipping_country` is free text on purpose (not a `Select` of a fixed list)
— eBay returns a 2-letter code, a manual entry might not; Piece 4's label
API is the actual point that needs to validate/reject a bad country code,
same "defer validation to the boundary that needs it" pattern as
`referral`'s free-text rationale.

## Capture — eBay sync (automatic)

`src/lib/integrations/types.ts`'s `NormalizedOrder` gets one new optional
field:

```ts
export interface ShippingAddress {
  buyerName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

export interface NormalizedOrder {
  // ...existing fields unchanged...
  /** Buyer shipping address, when the platform's order API returns one. `undefined` (not set) when the adapter doesn't support it — distinct from `null`, which would mean "asked and eBay had none". */
  shipping?: ShippingAddress | null;
}
```

`src/lib/integrations/ebay.ts`'s `fetchOrders`: eBay's `getOrders` response
includes `fulfillmentStartInstructions[].shippingStep.shipTo` per order
(`fullName`, `contactAddress: { addressLine1, addressLine2, city,
stateOrProvince, postalCode, countryCode }`, `primaryPhone.phoneNumber`,
`email`). Add `fulfillmentStartInstructions` to the `EbayOrder` interface,
extract the first entry's `shipTo` (eBay orders in this app's flow are
single-shipment — there is no per-line-item address), map it to a
`ShippingAddress`, and attach it to **every** `NormalizedOrder` line item
emitted for that order (the address is order-level, duplicated across line
items the same way `date`/`description` already are). When
`fulfillmentStartInstructions` is empty/missing, set `shipping: null`
(eBay had the field but returned nothing) rather than omitting it.

`src/lib/integrations/amazon.ts`: **not modified** — leaving `shipping`
`undefined` on its `NormalizedOrder`s is the deliberate out-of-scope
handling above; `mapToSale.ts` already treats an absent field as "no data".

## Capture — mapping to `sales`

`src/lib/integrations/mapToSale.ts`'s `normalizedOrderToSaleRow` spreads the
shipping fields into the insert, all `null` when `order.shipping` is
missing/null:

```ts
buyer_name: order.shipping?.buyerName ?? null,
shipping_address_line1: order.shipping?.addressLine1 ?? null,
shipping_address_line2: order.shipping?.addressLine2 ?? null,
shipping_city: order.shipping?.city ?? null,
shipping_state: order.shipping?.state ?? null,
shipping_postal_code: order.shipping?.postalCode ?? null,
shipping_country: order.shipping?.country ?? null,
buyer_phone: order.shipping?.phone ?? null,
buyer_email: order.shipping?.email ?? null,
```

`src/lib/integrations/mergeImportedSale.ts`: add all nine fields to the
**user-owned** (preserved-on-re-import) list, not the platform-owned list —
same rationale as `shipping_cost`/`vat_rate`: if a seller manually corrects
a wrong or incomplete address, a later re-sync of the same order (status
change import) must not silently overwrite that correction. Update the
"Merge rule" doc in `src/lib/integrations/SKILL.md` to list the nine new
fields under "User-owned".

## Capture/edit — manual (`AddSaleModal` / `EditSaleModal`)

Both modals get a new collapsible **"Shipping Address (optional)"** section,
same collapse/chevron pattern as the existing "Fees & shipping (optional)"
section in `EditSaleModal.tsx` (`showFees`/chevron `<svg>` — reuse that
exact markup, new `showShipping` boolean). Fields, two `Row`s of `Field`+`Input`:

- Buyer Name
- Address Line 1 / Address Line 2
- City / State
- Postal Code / Country
- Phone / Email

None are `required` — a seller may fill this in after the fact, or never,
for a manually-entered sale. `EditSaleModal`'s auto-open rule matches the
Fees section: open by default when any of the nine fields is already
non-null on the sale being edited. Include all nine in the `sales.update(...)`
payload and the audit-log before/after diff, same as every other editable
field group.

## Display

`src/app/dashboard/sales/[id]/page.tsx` Details card: new "Shipping Address"
block, rendered only when at least one of the nine fields is non-null,
formatted as a normal postal block (`buyer_name` bold line, address lines,
`city, state postal_code`, `country`, then phone/email on their own small
muted lines) — same visual weight as the existing Details card rows, not a
new card.

## Blast radius

Purely additive: nine nullable columns, one new optional `NormalizedOrder`
field (Amazon adapter untouched), one collapsible section in two existing
modals, one new Details-card block. No RLS change, no existing query
change. A tenant with no eBay connection and no manually-entered addresses
sees the new modal section (collapsed, empty) and nothing else.

## Testing

- `src/lib/integrations/mapToSale.test.ts` (extend) — a case with
  `order.shipping` set maps all nine fields; a case with it omitted maps all
  nine to `null`.
- `src/lib/integrations/mergeImportedSale.test.ts` (extend) — a re-import
  where `incoming.shipping_city` differs from `existing.shipping_city`
  preserves `existing`'s value (proves the user-owned classification).
- `src/lib/integrations/ebay.test.ts` (extend/new) — `fetchOrders` given a
  fixture eBay response with `fulfillmentStartInstructions` maps `shipTo`
  onto every line item's `NormalizedOrder.shipping`; a fixture with no
  `fulfillmentStartInstructions` yields `shipping: null`.
- Manual verification: import a sandbox eBay order via Review Orders,
  confirm the order detail page shows the buyer's address; manually edit a
  non-eBay sale to add an address and confirm it saves/displays; re-run
  Review Orders import on the same eBay order after hand-editing its address
  and confirm the correction survives.

## Docs to update alongside implementation

- `src/app/dashboard/sales/CLAUDE.md` — new subsection for the nine
  additive fields + the collapsible section, cross-referencing
  `src/lib/integrations/SKILL.md`'s merge-rule update.
- `src/lib/integrations/SKILL.md` — extend `NormalizedOrder`'s doc entry
  and the "Merge rule" section's user-owned list.
- `supabase/SKILL.md` / `supabase/CLAUDE.md` — apply-status row + file-list
  bullet for migration `041`.
