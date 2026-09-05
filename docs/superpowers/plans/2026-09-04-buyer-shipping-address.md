# Buyer Shipping Address Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a buyer's shipping address automatically when an order syncs
from eBay, and let any sale (any platform) have its shipping address entered
or corrected by hand — nine new nullable columns on `sales`, wired through
the eBay adapter, the sale-mapping/merge pipeline, both Sales modals, and the
order detail page.

**Architecture:** Purely additive. A migration adds nine nullable `text`
columns to `sales` in every tenant schema (plus the `provision_tenant_schema()`
template for future tenants). `NormalizedOrder` gains an optional `shipping`
field that `ebay.ts`'s `fetchOrders` populates from eBay's order-fulfillment
response; `mapToSale.ts` spreads it onto the insert row. All nine columns are
classified **user-owned** in `mergeImportedSale.ts`'s re-import merge rule, so
a seller's manual correction survives a later re-sync. `AddSaleModal`/
`EditSaleModal` grow a collapsible "Shipping Address (optional)" section
(same chevron pattern as the existing "Fees & shipping (optional)" section)
so a non-eBay sale — or a wrong auto-captured address — can be entered/fixed
by hand. The order detail page displays the address in the Details card when
at least one field is set.

**Tech Stack:** Next.js App Router (Client Components for modals/detail
page), Supabase Postgres (tenant-schema-per-tenant), Redux Toolkit (existing
`salesSlice`, unchanged by this plan), Jest for unit tests, TypeScript.

**Source of truth:** `docs/superpowers/specs/2026-09-04-buyer-shipping-address-design.md`
— read that spec if anything here is ambiguous. Do not deviate from its field
names, file paths, or data shapes.

## Global Constraints

These apply to every task below, copied from this repo's `AGENTS.md`:

- **Never query `public.*`** in a tenant-schema route — this feature reads/
  writes `sales` exclusively via `createTenantClient()` (already schema-aware
  in every file this plan touches); don't introduce a new query that bypasses
  it.
- **Tenant-schema DDL always goes through `run_on_all_tenant_schemas`** —
  never write `ALTER TABLE tenant_kaufnest.*` (or any other single-schema
  name) directly in a migration. Every DDL change also requires the matching
  "2 places" update to `provision_tenant_schema()` in
  `supabase/migrations/005_tenant_provisioning.sql`, in the **same commit**,
  so a newly-provisioned tenant gets the columns too.
- **No dev server, `curl`, `npm test`, `tsc`, or `lint` run mid-task by the
  implementer.** This repo's working agreement (`AGENTS.md`) is explicit:
  don't shell out to `next dev`/`curl` to verify functionality, and don't run
  `npm test`/`npx tsc --noEmit`/`npm run lint` to check your own work —
  Husky's `.husky/pre-commit` hook already runs `tsc --noEmit`, `eslint`, and
  the project verifier automatically on every `git commit`, and
  `.husky/pre-push` runs `jest`/`next build` automatically on every `git
  push`. If a task needs to confirm a passing test, ask the human to run the
  specific `npx jest <path>` command and paste the output back — do not run
  it yourself. If a `git commit` fails because the pre-commit hook caught
  something, fix the reported issue and re-run the same `git commit`
  command (the failed attempt did not create a commit, so this is not an
  amend).
- **A mutating button must never look clickable when it can't succeed.**
  None of the nine new fields in this feature are `required` — do not add
  the `required` attribute (or a `<Field required>` label) to any of them in
  either modal.
- **Docs are part of the change, not a follow-up.** Each task below folds in
  the doc update(s) its code change makes stale, per this repo's Task
  Right-Sizing convention — there is no separate "update docs" task at the
  end.

---

## Task 1: Migration `041_sales_shipping_address.sql` + `Sale` type + `provision_tenant_schema()`

**Files:**
- Create: `supabase/migrations/041_sales_shipping_address.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql:147-158` (the
  `sales` `CREATE TABLE` block's tail)
- Modify: `src/types/index.ts:119-121` (end of the `Sale` interface)
- Modify: `supabase/SKILL.md` (file-map table — add a row for `041`)
- Modify: `supabase/CLAUDE.md` (file list — add a bullet for `041`, same
  style as the `039` bullet already there)

**Interfaces:**
- Produces: `Sale` interface gains nine new fields (all `string | null`):
  `buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
  `shipping_city`, `shipping_state`, `shipping_postal_code`,
  `shipping_country`, `buyer_phone`, `buyer_email`. Every later task in this
  plan reads/writes these exact field names.

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/041_sales_shipping_address.sql`:

```sql
-- ============================================================
-- 041 — buyer shipping address capture on sales
--
-- Nine new nullable columns on `sales`: buyer_name, shipping_address_line1,
-- shipping_address_line2, shipping_city, shipping_state,
-- shipping_postal_code, shipping_country, buyer_phone, buyer_email.
--
-- Captured automatically when an order is synced from eBay (Review Orders
-- import — see src/lib/integrations/ebay.ts's fetchOrders, which reads
-- fulfillmentStartInstructions[].shippingStep.shipTo), and editable/
-- enterable by hand on any sale (any platform) via a new "Shipping Address
-- (optional)" section in AddSaleModal/EditSaleModal.
--
-- All nine are USER-OWNED fields for the re-import merge rule
-- (mergeImportedSale.ts) — a seller's manual correction to a wrong or
-- incomplete address must survive a later re-sync of the same order.
--
-- shipping_country is free text on purpose (not a fixed-list Select) — eBay
-- returns a 2-letter ISO 3166-1 alpha-2 code, a manual entry might not;
-- validation is deferred to the future label-purchase feature that actually
-- needs a valid country code, same pattern as `referral`'s free-text
-- rationale (control-plane 009_tenants_referral.sql).
--
-- Amazon adapter is NOT touched — Amazon's SP-API order-address endpoint
-- needs a separate PII-access grant this app doesn't request yet; its
-- NormalizedOrders simply leave `shipping` undefined, and mapToSale.ts
-- already treats an absent field as "no data" (all nine columns null).
--
-- See docs/superpowers/specs/2026-09-04-buyer-shipping-address-design.md.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists buyer_name text,
    add column if not exists shipping_address_line1 text,
    add column if not exists shipping_address_line2 text,
    add column if not exists shipping_city text,
    add column if not exists shipping_state text,
    add column if not exists shipping_postal_code text,
    add column if not exists shipping_country text,
    add column if not exists buyer_phone text,
    add column if not exists buyer_email text;
$$);
```

- [ ] **Step 2: Update `provision_tenant_schema()`'s `sales` CREATE TABLE**

In `supabase/migrations/005_tenant_provisioning.sql`, find this exact block
(currently lines 147-158):

```sql
      external_order_id text,
      -- Fee columns — see 010_order_fees.sql / 035_sales_platform_fee.sql.
      -- Baked into this CREATE TABLE now (previously missing here despite
      -- being live on every tenant since 027_reconcile_tenant_drift.sql —
      -- a newly-provisioned tenant would have silently lacked all four
      -- until this fix).
      shipping_cost    numeric(12,2) CHECK (shipping_cost    >= 0),
      shipping_charged numeric(12,2) CHECK (shipping_charged >= 0),
      advertising_fee  numeric(12,2) CHECK (advertising_fee  >= 0),
      platform_fee     numeric(12,2) CHECK (platform_fee     >= 0)
    )
  $sql$, schema_name);
```

Replace it with:

```sql
      external_order_id text,
      -- Fee columns — see 010_order_fees.sql / 035_sales_platform_fee.sql.
      -- Baked into this CREATE TABLE now (previously missing here despite
      -- being live on every tenant since 027_reconcile_tenant_drift.sql —
      -- a newly-provisioned tenant would have silently lacked all four
      -- until this fix).
      shipping_cost    numeric(12,2) CHECK (shipping_cost    >= 0),
      shipping_charged numeric(12,2) CHECK (shipping_charged >= 0),
      advertising_fee  numeric(12,2) CHECK (advertising_fee  >= 0),
      platform_fee     numeric(12,2) CHECK (platform_fee     >= 0),
      -- Buyer shipping address — see 041_sales_shipping_address.sql.
      buyer_name             text,
      shipping_address_line1 text,
      shipping_address_line2 text,
      shipping_city          text,
      shipping_state         text,
      shipping_postal_code   text,
      shipping_country       text,
      buyer_phone            text,
      buyer_email            text
    )
  $sql$, schema_name);
```

- [ ] **Step 3: Add the nine fields to the `Sale` type**

In `src/types/index.ts`, find this exact block (currently lines 119-121, the
tail of the `Sale` interface):

```ts
  refunded_amount: number | null;
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
}
```

Replace it with:

```ts
  refunded_amount: number | null;
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
  // ─── Buyer shipping address (migration 041) ──────────────────────────────
  // Captured automatically on eBay sync (ebay.ts's fetchOrders), or entered/
  // corrected by hand via AddSaleModal/EditSaleModal's "Shipping Address
  // (optional)" section, on any platform. All nine are user-owned in the
  // re-import merge rule (mergeImportedSale.ts) — a manual correction
  // survives a later re-sync of the same order.
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
}
```

- [ ] **Step 4: Add the migration's row to `supabase/SKILL.md`'s file-map table**

In `supabase/SKILL.md`, find the table row for
`migrations/039_ebay_listing_drafts_inactive_status.sql` (the last row in
the `| File | Targets | Status |` table, immediately before the
`| control-plane/001_schema.sql | ... |` row). Add this new row directly
after it:

```
| `migrations/041_sales_shipping_address.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nine nullable columns to `sales` (`buyer_name`, `shipping_address_line1`, `shipping_address_line2`, `shipping_city`, `shipping_state`, `shipping_postal_code`, `shipping_country`, `buyer_phone`, `buyer_email`) via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Captures the buyer's shipping address automatically on eBay order sync (`fulfillmentStartInstructions[].shippingStep.shipTo`) and via a manual/editable "Shipping Address (optional)" section on every sale. All nine are user-owned (preserved on re-import) — see `mergeImportedSale.ts`. Amazon adapter untouched (`shipping` stays `undefined`). Backs `src/app/dashboard/sales/` and `src/lib/integrations/`. |
```

- [ ] **Step 5: Add the migration's bullet to `supabase/CLAUDE.md`**

In `supabase/CLAUDE.md`, find the bullet for
`migrations/039_ebay_listing_drafts_inactive_status.sql` (the last bullet
under `## Files`, immediately before the `## Related code` heading). Add
this new bullet directly after it:

```markdown
- `migrations/041_sales_shipping_address.sql` — adds nine nullable columns to
  `sales` (`buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
  `shipping_city`, `shipping_state`, `shipping_postal_code`,
  `shipping_country`, `buyer_phone`, `buyer_email`) via
  `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()`
  in the same commit. Captures the buyer's shipping address automatically
  when an order is synced from eBay (`fulfillmentStartInstructions[].shippingStep.shipTo`
  in `src/lib/integrations/ebay.ts`), plus a manual/editable field set on
  every sale (any platform) via a new "Shipping Address (optional)" section
  in `AddSaleModal`/`EditSaleModal`. All nine columns are user-owned
  (preserved on re-import — see `mergeImportedSale.ts`'s doc comment and
  `src/lib/integrations/SKILL.md`'s Merge rule section). The Amazon adapter
  is untouched — its `NormalizedOrder`s leave `shipping` `undefined`,
  degrading gracefully. Backs `src/app/dashboard/sales/`.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/041_sales_shipping_address.sql \
  supabase/migrations/005_tenant_provisioning.sql \
  src/types/index.ts \
  supabase/SKILL.md \
  supabase/CLAUDE.md
git commit -m "feat(sales): add buyer shipping address columns to sales schema"
```

---

## Task 2: `ShippingAddress`/`NormalizedOrder` type + `ebay.ts` address extraction + its test

**Files:**
- Modify: `src/lib/integrations/types.ts:21-31` (`NormalizedOrder` interface)
- Modify: `src/lib/integrations/ebay.ts` (whole file — new interfaces,
  `EbayOrder`, `fetchOrders`)
- Create: `src/lib/integrations/ebay.test.ts`
- Modify: `src/lib/integrations/SKILL.md` (`types.ts` and `ebay.ts` doc
  entries under `## Files`)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task only touches
  integrations code; it doesn't read/write `sales` rows).
- Produces: `ShippingAddress` interface (`src/lib/integrations/types.ts`):

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
```

  `NormalizedOrder.shipping?: ShippingAddress | null` — `undefined` when an
  adapter doesn't support address capture (Amazon), `null` when the platform
  returned no address, a populated object otherwise. Task 3
  (`mapToSale.ts`) consumes this field.

- [ ] **Step 1: Add `ShippingAddress` and the `shipping` field to `NormalizedOrder`**

In `src/lib/integrations/types.ts`, find this exact block (currently lines
21-31):

```ts
export interface NormalizedOrder {
  external_order_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  date: string; // ISO date (YYYY-MM-DD)
  status: string;
  description: string | null;
}
```

Replace it with:

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
  external_order_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  date: string; // ISO date (YYYY-MM-DD)
  status: string;
  description: string | null;
  /**
   * Buyer shipping address, when the platform's order API returns one.
   * `undefined` (not set) when the adapter doesn't support it (Amazon) —
   * distinct from `null`, which means "asked and the platform had none".
   */
  shipping?: ShippingAddress | null;
}
```

- [ ] **Step 2: Add eBay address-shape interfaces and extend `EbayOrder`**

In `src/lib/integrations/ebay.ts`, find this exact block (currently the
import line and the `EbayOrder` interface):

```ts
import type { NormalizedOrder, PlatformAdapter, TokenSet } from "./types";
```

Replace it with:

```ts
import type { NormalizedOrder, PlatformAdapter, ShippingAddress, TokenSet } from "./types";
```

Then find this exact block (currently the `EbayOrder` interface):

```ts
interface EbayOrder {
  orderId: string;
  creationDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  lineItems?: EbayLineItem[];
}
```

Replace it with:

```ts
interface EbayContactAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
}

interface EbayShipTo {
  fullName?: string;
  contactAddress?: EbayContactAddress;
  primaryPhone?: { phoneNumber?: string };
  email?: string;
}

interface EbayFulfillmentStartInstruction {
  shippingStep?: {
    shipTo?: EbayShipTo;
  };
}

interface EbayOrder {
  orderId: string;
  creationDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  lineItems?: EbayLineItem[];
  fulfillmentStartInstructions?: EbayFulfillmentStartInstruction[];
}
```

- [ ] **Step 3: Add `extractShippingAddress` and wire it into `fetchOrders`**

In `src/lib/integrations/ebay.ts`, find this exact block (the `mapStatus`
function):

```ts
/** Maps eBay's fulfillment/payment status pair onto the Sales feature's status vocabulary. */
function mapStatus(fulfillmentStatus: string | undefined, paymentStatus: string | undefined): string {
  if (paymentStatus === "FULLY_REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED") return "returned";
  switch (fulfillmentStatus) {
    case "FULFILLED":
      return "delivered";
    case "IN_PROGRESS":
      return "processing";
    default:
      return "pending";
  }
}
```

Add this new function directly after it:

```ts
/**
 * eBay orders in this app's flow are single-shipment — there is no
 * per-line-item address, so this reads the FIRST fulfillmentStartInstruction's
 * shipTo and the caller attaches the result to every line item's
 * NormalizedOrder (same as date/description). Returns null (not undefined)
 * when eBay's response has no fulfillmentStartInstructions/shipTo, per the
 * NormalizedOrder.shipping contract: null means "asked, platform had none".
 */
function extractShippingAddress(order: EbayOrder): ShippingAddress | null {
  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  if (!shipTo) return null;

  const address = shipTo.contactAddress;
  return {
    buyerName: shipTo.fullName ?? null,
    addressLine1: address?.addressLine1 ?? null,
    addressLine2: address?.addressLine2 ?? null,
    city: address?.city ?? null,
    state: address?.stateOrProvince ?? null,
    postalCode: address?.postalCode ?? null,
    country: address?.countryCode ?? null,
    phone: shipTo.primaryPhone?.phoneNumber ?? null,
    email: shipTo.email ?? null,
  };
}
```

Then find this exact block (inside `fetchOrders`):

```ts
    for (const order of json.orders ?? []) {
      const status = mapStatus(order.orderFulfillmentStatus, order.orderPaymentStatus);
      const date = (order.creationDate ?? new Date().toISOString()).slice(0, 10);

      for (const item of order.lineItems ?? []) {
        const quantity = Number(item.quantity) || 1;
        const totalAmount = Number(item.total?.value ?? 0);

        orders.push({
          external_order_id: `${order.orderId}:${item.lineItemId}`,
          product_name: item.title ?? "eBay order",
          quantity,
          unit_price: Math.round((totalAmount / quantity) * 100) / 100,
          total_amount: totalAmount,
          currency: item.total?.currency ?? "EUR",
          date,
          status,
          description: `eBay order ${order.orderId}`,
        });
      }
    }
```

Replace it with:

```ts
    for (const order of json.orders ?? []) {
      const status = mapStatus(order.orderFulfillmentStatus, order.orderPaymentStatus);
      const date = (order.creationDate ?? new Date().toISOString()).slice(0, 10);
      const shipping = extractShippingAddress(order);

      for (const item of order.lineItems ?? []) {
        const quantity = Number(item.quantity) || 1;
        const totalAmount = Number(item.total?.value ?? 0);

        orders.push({
          external_order_id: `${order.orderId}:${item.lineItemId}`,
          product_name: item.title ?? "eBay order",
          quantity,
          unit_price: Math.round((totalAmount / quantity) * 100) / 100,
          total_amount: totalAmount,
          currency: item.total?.currency ?? "EUR",
          date,
          status,
          description: `eBay order ${order.orderId}`,
          shipping,
        });
      }
    }
```

- [ ] **Step 4: Write `ebay.test.ts`**

Create `src/lib/integrations/ebay.test.ts`:

```ts
import { ebayAdapter } from "./ebay";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockJsonResponse(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("ebayAdapter.fetchOrders — shipping address extraction", () => {
  it("maps fulfillmentStartInstructions' shipTo onto every line item's NormalizedOrder.shipping", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89012",
          creationDate: "2026-06-01T10:00:00.000Z",
          orderFulfillmentStatus: "FULFILLED",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Wireless Mouse",
              quantity: "2",
              total: { value: "19.98", currency: "EUR" },
            },
            {
              lineItemId: "002",
              title: "USB-C Cable",
              quantity: "1",
              total: { value: "5.50", currency: "EUR" },
            },
          ],
          fulfillmentStartInstructions: [
            {
              shippingStep: {
                shipTo: {
                  fullName: "Jane Buyer",
                  contactAddress: {
                    addressLine1: "123 Main St",
                    addressLine2: "Apt 4",
                    city: "Berlin",
                    stateOrProvince: "BE",
                    postalCode: "10115",
                    countryCode: "DE",
                  },
                  primaryPhone: { phoneNumber: "+49 30 1234567" },
                  email: "jane@example.com",
                },
              },
            },
          ],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders).toHaveLength(2);
    const expectedShipping = {
      buyerName: "Jane Buyer",
      addressLine1: "123 Main St",
      addressLine2: "Apt 4",
      city: "Berlin",
      state: "BE",
      postalCode: "10115",
      country: "DE",
      phone: "+49 30 1234567",
      email: "jane@example.com",
    };
    expect(orders[0].shipping).toEqual(expectedShipping);
    expect(orders[1].shipping).toEqual(expectedShipping);
  });

  it("sets shipping to null (not undefined) when fulfillmentStartInstructions is missing", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89099",
          creationDate: "2026-06-02T10:00:00.000Z",
          orderFulfillmentStatus: "IN_PROGRESS",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Phone Case",
              quantity: "1",
              total: { value: "9.99", currency: "EUR" },
            },
          ],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders).toHaveLength(1);
    expect(orders[0].shipping).toBeNull();
  });

  it("sets shipping to null when fulfillmentStartInstructions is an empty array", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89100",
          creationDate: "2026-06-03T10:00:00.000Z",
          orderFulfillmentStatus: "IN_PROGRESS",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Phone Case",
              quantity: "1",
              total: { value: "9.99", currency: "EUR" },
            },
          ],
          fulfillmentStartInstructions: [],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders[0].shipping).toBeNull();
  });
});
```

- [ ] **Step 5: Ask the human to run the new test**

Ask the user to run `npx jest src/lib/integrations/ebay.test.ts` and paste
the output back. All three tests must pass before committing. Do not run
this command yourself.

- [ ] **Step 6: Update `src/lib/integrations/SKILL.md`'s `types.ts`/`ebay.ts` doc entries**

In `src/lib/integrations/SKILL.md`, find this exact line under `## Files`:

```markdown
- `types.ts` — `NormalizedOrder` (platform-agnostic order shape), `TokenSet`,
  `ExchangeCodeResult` (`TokenSet` + optional `externalAccountId`/
  `marketplaceId`), `PlatformAdapter` interface, `SyncResult`.
```

Replace it with:

```markdown
- `types.ts` — `NormalizedOrder` (platform-agnostic order shape — its
  optional `shipping?: ShippingAddress | null` field, added for buyer
  shipping address capture, is `undefined` when an adapter doesn't support
  address capture (Amazon) and `null` when the platform returned no address;
  `ShippingAddress` is also defined here), `TokenSet`, `ExchangeCodeResult`
  (`TokenSet` + optional `externalAccountId`/`marketplaceId`),
  `PlatformAdapter` interface, `SyncResult`.
```

Then find this exact line:

```markdown
- `ebay.ts` / `amazon.ts` — one `PlatformAdapter` implementation each.
```

Replace it with:

```markdown
- `ebay.ts` / `amazon.ts` — one `PlatformAdapter` implementation each.
  `ebay.ts`'s `fetchOrders` also extracts the buyer's shipping address from
  `fulfillmentStartInstructions[].shippingStep.shipTo` (order-level,
  duplicated onto every line item's `NormalizedOrder.shipping`, same as
  `date`/`description`); `amazon.ts` is untouched, leaving `shipping`
  `undefined` (SP-API's order-address endpoint needs a separate PII-access
  grant this app doesn't request).
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/integrations/types.ts \
  src/lib/integrations/ebay.ts \
  src/lib/integrations/ebay.test.ts \
  src/lib/integrations/SKILL.md
git commit -m "feat(integrations): extract buyer shipping address from eBay order sync"
```

---

## Task 3: `mapToSale.ts` field mapping + its test

**Files:**
- Modify: `src/lib/integrations/mapToSale.ts` (whole file — `normalizedOrderToSaleRow`)
- Modify: `src/lib/integrations/mapToSale.test.ts` (whole file — replaced below)

**Interfaces:**
- Consumes: `NormalizedOrder.shipping` (Task 2), `Sale`'s nine new fields
  (Task 1).
- Produces: `SaleInsert` (= `Omit<Sale, "id" | "created_at">`) now always
  carries all nine shipping fields, `null` when `order.shipping` is
  missing/`null`. Task 4 (`mergeImportedSale.ts`) and Task 5 (both modals'
  fixture/payload shapes) rely on `Sale` already carrying these fields from
  Task 1 — this task doesn't change their types, only `mapToSale.ts`'s
  runtime output.

- [ ] **Step 1: Update `normalizedOrderToSaleRow`**

In `src/lib/integrations/mapToSale.ts`, find this exact block:

```ts
export function normalizedOrderToSaleRow(
  order: NormalizedOrder,
  platform: IntegrationPlatform,
  connectedBy: string,
  fees?: ReviewOrderFees
): SaleInsert {
  return {
    platform,
    product_name: order.product_name,
    product_id: null,
    quantity: order.quantity,
    unit_price: order.unit_price,
    total_amount: order.total_amount,
    currency: normalizeCurrency(order.currency),
    date: order.date,
    description: order.description,
    created_by: connectedBy,
    vat_rate: null,
    vat_amount: null,
    shipping_cost: null,
    shipping_charged: null,
    advertising_fee: fees?.advertisingFee ?? null,
    platform_fee: fees?.platformFee ?? null,
    status: order.status,
    restock: false,
    refunded_amount: null,
    external_order_id: order.external_order_id,
  };
}
```

Replace it with:

```ts
export function normalizedOrderToSaleRow(
  order: NormalizedOrder,
  platform: IntegrationPlatform,
  connectedBy: string,
  fees?: ReviewOrderFees
): SaleInsert {
  return {
    platform,
    product_name: order.product_name,
    product_id: null,
    quantity: order.quantity,
    unit_price: order.unit_price,
    total_amount: order.total_amount,
    currency: normalizeCurrency(order.currency),
    date: order.date,
    description: order.description,
    created_by: connectedBy,
    vat_rate: null,
    vat_amount: null,
    shipping_cost: null,
    shipping_charged: null,
    advertising_fee: fees?.advertisingFee ?? null,
    platform_fee: fees?.platformFee ?? null,
    status: order.status,
    restock: false,
    refunded_amount: null,
    external_order_id: order.external_order_id,
    // Buyer shipping address — all null when order.shipping is missing or
    // null (Amazon orders leave it undefined; an eBay order eBay returned
    // no address for carries null). See migration 041.
    buyer_name: order.shipping?.buyerName ?? null,
    shipping_address_line1: order.shipping?.addressLine1 ?? null,
    shipping_address_line2: order.shipping?.addressLine2 ?? null,
    shipping_city: order.shipping?.city ?? null,
    shipping_state: order.shipping?.state ?? null,
    shipping_postal_code: order.shipping?.postalCode ?? null,
    shipping_country: order.shipping?.country ?? null,
    buyer_phone: order.shipping?.phone ?? null,
    buyer_email: order.shipping?.email ?? null,
  };
}
```

- [ ] **Step 2: Replace `mapToSale.test.ts` with the extended version**

Write `src/lib/integrations/mapToSale.test.ts` (full replacement — every
existing `.toEqual` assertion needs the nine new `null` fields added, since
`toEqual` requires an exact match):

```ts
import { normalizedOrderToSaleRow } from "./mapToSale";
import type { NormalizedOrder, ShippingAddress } from "./types";

describe("normalizedOrderToSaleRow", () => {
  const ebayOrder: NormalizedOrder = {
    external_order_id: "12-34567-89012:001",
    product_name: "Wireless Mouse",
    quantity: 2,
    unit_price: 9.99,
    total_amount: 19.98,
    currency: "EUR",
    date: "2026-06-01",
    status: "delivered",
    description: "eBay order 12-34567-89012",
  };

  const amazonOrder: NormalizedOrder = {
    external_order_id: "112-1234567-1234567:00000001",
    product_name: "USB-C Cable",
    quantity: 1,
    unit_price: 5.5,
    total_amount: 5.5,
    currency: "USD",
    date: "2026-06-02",
    status: "shipped",
    description: "Amazon order 112-1234567-1234567",
  };

  const shippingFixture: ShippingAddress = {
    buyerName: "Jane Buyer",
    addressLine1: "123 Main St",
    addressLine2: "Apt 4",
    city: "Berlin",
    state: "BE",
    postalCode: "10115",
    country: "DE",
    phone: "+49 30 1234567",
    email: "jane@example.com",
  };

  it("maps an eBay order to a sales insert row", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123");

    expect(row).toEqual({
      platform: "ebay",
      product_name: "Wireless Mouse",
      product_id: null,
      quantity: 2,
      unit_price: 9.99,
      total_amount: 19.98,
      currency: "EUR",
      date: "2026-06-01",
      description: "eBay order 12-34567-89012",
      created_by: "user-123",
      vat_rate: null,
      vat_amount: null,
      shipping_cost: null,
      shipping_charged: null,
      advertising_fee: null,
      platform_fee: null,
      status: "delivered",
      restock: false,
      refunded_amount: null,
      external_order_id: "12-34567-89012:001",
      buyer_name: null,
      shipping_address_line1: null,
      shipping_address_line2: null,
      shipping_city: null,
      shipping_state: null,
      shipping_postal_code: null,
      shipping_country: null,
      buyer_phone: null,
      buyer_email: null,
    });
  });

  it("maps an Amazon order to a sales insert row", () => {
    const row = normalizedOrderToSaleRow(amazonOrder, "amazon", "user-456");

    expect(row).toEqual({
      platform: "amazon",
      product_name: "USB-C Cable",
      product_id: null,
      quantity: 1,
      unit_price: 5.5,
      total_amount: 5.5,
      currency: "USD",
      date: "2026-06-02",
      description: "Amazon order 112-1234567-1234567",
      created_by: "user-456",
      vat_rate: null,
      vat_amount: null,
      shipping_cost: null,
      shipping_charged: null,
      advertising_fee: null,
      platform_fee: null,
      status: "shipped",
      restock: false,
      refunded_amount: null,
      external_order_id: "112-1234567-1234567:00000001",
      buyer_name: null,
      shipping_address_line1: null,
      shipping_address_line2: null,
      shipping_city: null,
      shipping_state: null,
      shipping_postal_code: null,
      shipping_country: null,
      buyer_phone: null,
      buyer_email: null,
    });
  });

  it("sets shipping_cost, shipping_charged, advertising_fee, and platform_fee to null when fees is omitted (entered manually or via Review Orders later)", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123");

    expect(row.shipping_cost).toBeNull();
    expect(row.shipping_charged).toBeNull();
    expect(row.advertising_fee).toBeNull();
    expect(row.platform_fee).toBeNull();
  });

  it("uses advertisingFee/platformFee from the fees argument when provided (Review Orders per-order or bulk-percent entry)", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123", {
      advertisingFee: 1.5,
      platformFee: 2.4,
    });

    expect(row.advertising_fee).toBe(1.5);
    expect(row.platform_fee).toBe(2.4);
    // shipping stays null even when fees are supplied — that's still a
    // manual Edit Sale step, unrelated to Review Orders' fee entry.
    expect(row.shipping_cost).toBeNull();
    expect(row.shipping_charged).toBeNull();
  });

  it("falls back to null for either fee individually when only one is provided", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123", {
      advertisingFee: 1.5,
      platformFee: null,
    });

    expect(row.advertising_fee).toBe(1.5);
    expect(row.platform_fee).toBeNull();
  });

  it("falls back to EUR for an unrecognized currency code", () => {
    const row = normalizedOrderToSaleRow({ ...ebayOrder, currency: "JPY" }, "ebay", "user-123");

    expect(row.currency).toBe("EUR");
  });

  it("maps all nine shipping fields onto the sales row when order.shipping is set", () => {
    const row = normalizedOrderToSaleRow(
      { ...ebayOrder, shipping: shippingFixture },
      "ebay",
      "user-123"
    );

    expect(row.buyer_name).toBe("Jane Buyer");
    expect(row.shipping_address_line1).toBe("123 Main St");
    expect(row.shipping_address_line2).toBe("Apt 4");
    expect(row.shipping_city).toBe("Berlin");
    expect(row.shipping_state).toBe("BE");
    expect(row.shipping_postal_code).toBe("10115");
    expect(row.shipping_country).toBe("DE");
    expect(row.buyer_phone).toBe("+49 30 1234567");
    expect(row.buyer_email).toBe("jane@example.com");
  });

  it("maps all nine shipping fields to null when order.shipping is omitted", () => {
    const row = normalizedOrderToSaleRow(ebayOrder, "ebay", "user-123");

    expect(row.buyer_name).toBeNull();
    expect(row.shipping_address_line1).toBeNull();
    expect(row.shipping_address_line2).toBeNull();
    expect(row.shipping_city).toBeNull();
    expect(row.shipping_state).toBeNull();
    expect(row.shipping_postal_code).toBeNull();
    expect(row.shipping_country).toBeNull();
    expect(row.buyer_phone).toBeNull();
    expect(row.buyer_email).toBeNull();
  });

  it("maps all nine shipping fields to null when order.shipping is explicitly null (eBay had no fulfillment address)", () => {
    const row = normalizedOrderToSaleRow(
      { ...ebayOrder, shipping: null },
      "ebay",
      "user-123"
    );

    expect(row.buyer_name).toBeNull();
    expect(row.shipping_address_line1).toBeNull();
  });
});
```

- [ ] **Step 3: Ask the human to run the updated test**

Ask the user to run `npx jest src/lib/integrations/mapToSale.test.ts` and
paste the output back. All eleven tests must pass before committing. Do not
run this command yourself.

- [ ] **Step 4: Commit**

```bash
git add src/lib/integrations/mapToSale.ts src/lib/integrations/mapToSale.test.ts
git commit -m "feat(integrations): map buyer shipping address onto sales insert rows"
```

---

## Task 4: `mergeImportedSale.ts` user-owned classification + its test + SKILL.md merge rule

**Files:**
- Modify: `src/lib/integrations/mergeImportedSale.ts:1-12` (doc comment only
  — `PLATFORM_OWNED` itself does not change)
- Modify: `src/lib/integrations/mergeImportedSale.test.ts` (whole file —
  replaced below)
- Modify: `src/lib/integrations/SKILL.md` (Merge rule section's user-owned
  list)

**Interfaces:**
- Consumes: `Sale`'s nine new fields (Task 1).
- Produces: no new runtime behavior — `mergeImportedSale(existing, incoming)`
  already preserves any `Sale` field not listed in `PLATFORM_OWNED` from
  `existing`, so the nine shipping fields are user-owned automatically. This
  task documents that explicitly and pins it with a test.

**Note for the implementer:** `mergeImportedSale`'s logic
(`{ ...existing, ...Object.fromEntries(PLATFORM_OWNED.map(...)) }`) already
preserves every field not in `PLATFORM_OWNED` from `existing` — the nine new
shipping fields do not need to be added to any array in the code. Do not add
them to `PLATFORM_OWNED` (that would make them platform-owned, the opposite
of the spec). This task only updates the doc comment, the test fixtures
(both `Sale`-typed fixtures now require all `Sale` fields, including the new
nine, or the file won't type-check), and a new test that pins the
preserve-on-re-import behavior.

- [ ] **Step 1: Update the doc comment above `PLATFORM_OWNED`**

In `src/lib/integrations/mergeImportedSale.ts`, find this exact block:

```ts
/** Fields that only the platform (sync) can update. */
const PLATFORM_OWNED: (keyof Sale)[] = [
  "status",
  "total_amount",
  "unit_price",
  "quantity",
  "product_name",
  "date",
  "description",
];
```

Replace it with:

```ts
/**
 * Fields that only the platform (sync) can update. Everything else on
 * `Sale` is user-owned — preserved from `existing` on a re-import —
 * including the nine buyer-shipping-address fields added by migration 041
 * (`buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
 * `shipping_city`, `shipping_state`, `shipping_postal_code`,
 * `shipping_country`, `buyer_phone`, `buyer_email`): a seller's manual
 * correction to a wrong or incomplete auto-captured address must survive a
 * later re-sync of the same order.
 */
const PLATFORM_OWNED: (keyof Sale)[] = [
  "status",
  "total_amount",
  "unit_price",
  "quantity",
  "product_name",
  "date",
  "description",
];
```

- [ ] **Step 2: Replace `mergeImportedSale.test.ts` with the extended version**

Write `src/lib/integrations/mergeImportedSale.test.ts` (full replacement —
both `Sale`-typed fixtures need the nine new fields, plus a new preservation
test):

```ts
import { mergeImportedSale } from "./mergeImportedSale";
import type { Sale } from "@/types";

// A fully-populated existing sale (with user-owned fields filled in)
const existingSale: Sale = {
  id: "sale-001",
  platform: "ebay",
  product_name: "Wireless Mouse",
  product_id: "prod-abc",
  quantity: 2,
  unit_price: 9.99,
  total_amount: 19.98,
  currency: "EUR",
  date: "2026-06-01",
  description: "eBay order 12-34567-89012",
  created_by: "user-123",
  created_at: "2026-06-01T10:00:00Z",
  vat_rate: 19,
  vat_amount: 3.19,
  shipping_cost: 2.5,
  shipping_charged: 4.99,
  advertising_fee: 1.2,
  platform_fee: 0.8,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: "12-34567-89012:001",
  buyer_name: "Jane Buyer",
  shipping_address_line1: "123 Main St",
  shipping_address_line2: "Apt 4",
  shipping_city: "Berlin",
  shipping_state: "BE",
  shipping_postal_code: "10115",
  shipping_country: "DE",
  buyer_phone: "+49 30 1234567",
  buyer_email: "jane@example.com",
};

// An incoming sync row for the same order (with different platform-owned fields,
// and nulls/different values for user-owned fields — as a re-sync might carry)
const incomingSale: Sale = {
  id: "sale-001", // same id (would be overwritten by merge, but existing wins for non-platform fields)
  platform: "ebay",
  product_name: "Wireless Mouse v2",
  product_id: null,
  quantity: 3,
  unit_price: 8.5,
  total_amount: 25.5,
  currency: "EUR",
  date: "2026-06-15",
  description: "eBay order updated",
  created_by: "user-123",
  created_at: "2026-06-01T10:00:00Z",
  vat_rate: null,
  vat_amount: null,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "shipped",
  restock: true,
  refunded_amount: null,
  external_order_id: "12-34567-89012:001",
  buyer_name: null,
  shipping_address_line1: null,
  shipping_address_line2: null,
  shipping_city: "Munich",
  shipping_state: null,
  shipping_postal_code: null,
  shipping_country: null,
  buyer_phone: null,
  buyer_email: null,
};

describe("mergeImportedSale", () => {
  // Test 1: New order (existing=undefined) — returns incoming unchanged
  it("returns incoming unchanged when existing is undefined (new order)", () => {
    const result = mergeImportedSale(undefined, incomingSale);
    expect(result).toBe(incomingSale);
    expect(result.vat_rate).toBe(incomingSale.vat_rate);
    expect(result.product_id).toBe(incomingSale.product_id);
    expect(result.shipping_cost).toBe(incomingSale.shipping_cost);
    expect(result.shipping_charged).toBe(incomingSale.shipping_charged);
    expect(result.advertising_fee).toBe(incomingSale.advertising_fee);
    expect(result.restock).toBe(incomingSale.restock);
  });

  // Test 2: Existing order — platform-owned fields come from incoming
  it("overwrites platform-owned fields (status, total_amount, unit_price, quantity, product_name, date, description) from incoming", () => {
    const result = mergeImportedSale(existingSale, incomingSale);

    expect(result.status).toBe(incomingSale.status);           // "shipped"
    expect(result.total_amount).toBe(incomingSale.total_amount); // 25.5
    expect(result.unit_price).toBe(incomingSale.unit_price);   // 8.5
    expect(result.quantity).toBe(incomingSale.quantity);       // 3
    expect(result.product_name).toBe(incomingSale.product_name); // "Wireless Mouse v2"
    expect(result.date).toBe(incomingSale.date);               // "2026-06-15"
    expect(result.description).toBe(incomingSale.description); // "eBay order updated"
  });

  // Test 3: Existing order — user-owned fields preserved from existing
  it("preserves user-owned fields (vat_rate, vat_amount, product_id, fee fields, restock) from existing", () => {
    const result = mergeImportedSale(existingSale, incomingSale);

    expect(result.vat_rate).toBe(existingSale.vat_rate);               // 19
    expect(result.vat_amount).toBe(existingSale.vat_amount);           // 3.19
    expect(result.product_id).toBe(existingSale.product_id);           // "prod-abc"
    expect(result.shipping_cost).toBe(existingSale.shipping_cost);     // 2.5
    expect(result.shipping_charged).toBe(existingSale.shipping_charged); // 4.99
    expect(result.advertising_fee).toBe(existingSale.advertising_fee); // 1.2
    expect(result.platform_fee).toBe(existingSale.platform_fee);       // 0.8
    expect(result.restock).toBe(existingSale.restock);                 // false
  });

  // Test 4: Partial incoming — null platform field wins over existing value
  it("takes null from incoming for a platform-owned field (platform null update wins)", () => {
    const incomingWithNullDesc: Sale = { ...incomingSale, description: null };
    const result = mergeImportedSale(existingSale, incomingWithNullDesc);

    // description is platform-owned, so null from incoming must win
    expect(result.description).toBeNull();
    // user-owned fields still preserved
    expect(result.vat_rate).toBe(existingSale.vat_rate);
    expect(result.product_id).toBe(existingSale.product_id);
  });

  // Test 5: Status "returned" from incoming overwrites existing "completed"
  it("overwrites status with 'returned' when incoming.status is 'returned'", () => {
    const existingCompleted: Sale = { ...existingSale, status: "completed" };
    const incomingReturned: Sale = { ...incomingSale, status: "returned" };

    const result = mergeImportedSale(existingCompleted, incomingReturned);

    expect(result.status).toBe("returned");
    // user-owned fields still preserved from existing
    expect(result.vat_rate).toBe(existingSale.vat_rate);
    expect(result.product_id).toBe(existingSale.product_id);
  });

  // Test 6: shipping-address fields (nine new fields) preserved from
  // existing on a re-import — proves a seller's hand-corrected address
  // survives a later status-change sync of the same order.
  it("preserves all nine shipping-address fields from existing when incoming carries different values", () => {
    const result = mergeImportedSale(existingSale, incomingSale);

    expect(result.buyer_name).toBe(existingSale.buyer_name);
    expect(result.shipping_address_line1).toBe(existingSale.shipping_address_line1);
    expect(result.shipping_address_line2).toBe(existingSale.shipping_address_line2);
    // incomingSale.shipping_city ("Munich") differs from existingSale's
    // ("Berlin") — existing must win, proving the field is user-owned.
    expect(result.shipping_city).toBe(existingSale.shipping_city);
    expect(result.shipping_city).not.toBe(incomingSale.shipping_city);
    expect(result.shipping_state).toBe(existingSale.shipping_state);
    expect(result.shipping_postal_code).toBe(existingSale.shipping_postal_code);
    expect(result.shipping_country).toBe(existingSale.shipping_country);
    expect(result.buyer_phone).toBe(existingSale.buyer_phone);
    expect(result.buyer_email).toBe(existingSale.buyer_email);
  });
});
```

- [ ] **Step 3: Ask the human to run the updated test**

Ask the user to run `npx jest src/lib/integrations/mergeImportedSale.test.ts`
and paste the output back. All six tests must pass before committing (they
should pass with zero runtime code changes, since the preservation behavior
is already implicit in `mergeImportedSale`'s existing logic — if test 6
fails, something else changed `PLATFORM_OWNED` unexpectedly). Do not run
this command yourself.

- [ ] **Step 4: Update the Merge rule section in `src/lib/integrations/SKILL.md`**

In `src/lib/integrations/SKILL.md`, find this exact block (under
`## Merge rule (re-import field ownership)`):

```markdown
- **User-owned** (preserved from the existing DB row): `vat_rate`, `vat_amount`,
  `product_id`, `shipping_cost`, `shipping_charged`, `advertising_fee`, `restock`.
```

Replace it with:

```markdown
- **User-owned** (preserved from the existing DB row): `vat_rate`, `vat_amount`,
  `product_id`, `shipping_cost`, `shipping_charged`, `advertising_fee`, `restock`,
  and the nine buyer-shipping-address fields added by migration 041
  (`buyer_name`, `shipping_address_line1`, `shipping_address_line2`,
  `shipping_city`, `shipping_state`, `shipping_postal_code`,
  `shipping_country`, `buyer_phone`, `buyer_email`) — a seller's manual
  correction to a wrong or incomplete auto-captured address must survive a
  later re-sync of the same order.
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/mergeImportedSale.ts \
  src/lib/integrations/mergeImportedSale.test.ts \
  src/lib/integrations/SKILL.md
git commit -m "docs(integrations): classify buyer shipping address as user-owned on re-import"
```

---

## Task 5: `EditSaleModal.tsx` + `AddSaleModal.tsx` — "Shipping Address (optional)" section

**Files:**
- Modify: `src/app/dashboard/sales/_components/EditSaleModal.tsx` (whole
  file — `FormState`, `saleToForm`, `blankForm`, state, `handleSubmit`, JSX)
- Modify: `src/app/dashboard/sales/_components/AddSaleModal.tsx` (whole file
  — `FormState`, `makeDefaults`, state, `handleSubmit`, `handleClose`, JSX)

**Interfaces:**
- Consumes: `Sale`'s nine new fields (Task 1).
- Produces: no new exported interfaces — both modals now write the nine
  fields into their `sales.update(...)`/`sales.insert(...)` payloads.

**Note:** None of the nine new fields get the `required` attribute or a
`<Field required>` label anywhere in this task — per this repo's form
conventions, `required` is reserved for fields that block submission, and
these are all optional.

### Part A — `EditSaleModal.tsx`

- [ ] **Step 1: Add the nine fields to `FormState`**

Find this exact block:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
}
```

Replace it with:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
  buyer_name: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
  buyer_phone: string;
  buyer_email: string;
}
```

- [ ] **Step 2: Map the nine fields in `saleToForm`**

Find this exact block:

```ts
    shipping_cost: sale.shipping_cost != null ? String(sale.shipping_cost) : "",
    shipping_charged: sale.shipping_charged != null ? String(sale.shipping_charged) : "",
    advertising_fee: sale.advertising_fee != null ? String(sale.advertising_fee) : "",
    platform_fee: sale.platform_fee != null ? String(sale.platform_fee) : "",
  };
}
```

Replace it with:

```ts
    shipping_cost: sale.shipping_cost != null ? String(sale.shipping_cost) : "",
    shipping_charged: sale.shipping_charged != null ? String(sale.shipping_charged) : "",
    advertising_fee: sale.advertising_fee != null ? String(sale.advertising_fee) : "",
    platform_fee: sale.platform_fee != null ? String(sale.platform_fee) : "",
    buyer_name: sale.buyer_name ?? "",
    shipping_address_line1: sale.shipping_address_line1 ?? "",
    shipping_address_line2: sale.shipping_address_line2 ?? "",
    shipping_city: sale.shipping_city ?? "",
    shipping_state: sale.shipping_state ?? "",
    shipping_postal_code: sale.shipping_postal_code ?? "",
    shipping_country: sale.shipping_country ?? "",
    buyer_phone: sale.buyer_phone ?? "",
    buyer_email: sale.buyer_email ?? "",
  };
}
```

- [ ] **Step 3: Add empty defaults to `blankForm`**

Find this exact block:

```ts
const blankForm: FormState = {
  platform: "amazon", product_name: "", product_id: "", quantity: "1", unit_price: "", currency: "EUR",
  date: "", description: "", vat_included: false, vat_rate: "0",
  status: "pending", customStatus: "", restock: false, reason: "",
  shipping_cost: "", shipping_charged: "", advertising_fee: "", platform_fee: "",
};
```

Replace it with:

```ts
const blankForm: FormState = {
  platform: "amazon", product_name: "", product_id: "", quantity: "1", unit_price: "", currency: "EUR",
  date: "", description: "", vat_included: false, vat_rate: "0",
  status: "pending", customStatus: "", restock: false, reason: "",
  shipping_cost: "", shipping_charged: "", advertising_fee: "", platform_fee: "",
  buyer_name: "", shipping_address_line1: "", shipping_address_line2: "",
  shipping_city: "", shipping_state: "", shipping_postal_code: "",
  shipping_country: "", buyer_phone: "", buyer_email: "",
};
```

- [ ] **Step 4: Add `showShipping` state with the auto-open rule**

Find this exact block:

```ts
  const [showFees, setShowFees] = useState(() => {
    if (!sale) return false;
    return (
      sale.shipping_cost != null ||
      sale.shipping_charged != null ||
      sale.advertising_fee != null ||
      sale.platform_fee != null
    );
  });
  const [showAddPurchase, setShowAddPurchase] = useState(false);
```

Replace it with:

```ts
  const [showFees, setShowFees] = useState(() => {
    if (!sale) return false;
    return (
      sale.shipping_cost != null ||
      sale.shipping_charged != null ||
      sale.advertising_fee != null ||
      sale.platform_fee != null
    );
  });
  const [showShipping, setShowShipping] = useState(() => {
    if (!sale) return false;
    return (
      sale.buyer_name != null ||
      sale.shipping_address_line1 != null ||
      sale.shipping_address_line2 != null ||
      sale.shipping_city != null ||
      sale.shipping_state != null ||
      sale.shipping_postal_code != null ||
      sale.shipping_country != null ||
      sale.buyer_phone != null ||
      sale.buyer_email != null
    );
  });
  const [showAddPurchase, setShowAddPurchase] = useState(false);
```

- [ ] **Step 5: Compute the nine trimmed-or-null values and include them in the update payload + audit diff**

Find this exact block:

```ts
    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;

    const supabase = await createTenantClient();
```

Replace it with:

```ts
    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;
    const buyerName = form.buyer_name.trim() || null;
    const shippingAddressLine1 = form.shipping_address_line1.trim() || null;
    const shippingAddressLine2 = form.shipping_address_line2.trim() || null;
    const shippingCity = form.shipping_city.trim() || null;
    const shippingState = form.shipping_state.trim() || null;
    const shippingPostalCode = form.shipping_postal_code.trim() || null;
    const shippingCountry = form.shipping_country.trim() || null;
    const buyerPhone = form.buyer_phone.trim() || null;
    const buyerEmail = form.buyer_email.trim() || null;

    const supabase = await createTenantClient();
```

Find this exact block (the `.update({...})` call):

```ts
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
      })
      .eq("id", sale.id)
```

Replace it with:

```ts
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
        buyer_name: buyerName,
        shipping_address_line1: shippingAddressLine1,
        shipping_address_line2: shippingAddressLine2,
        shipping_city: shippingCity,
        shipping_state: shippingState,
        shipping_postal_code: shippingPostalCode,
        shipping_country: shippingCountry,
        buyer_phone: buyerPhone,
        buyer_email: buyerEmail,
      })
      .eq("id", sale.id)
```

Find this exact block (the audit-log before/after metadata):

```ts
      metadata: {
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount, shipping_cost: sale.shipping_cost, shipping_charged: sale.shipping_charged, advertising_fee: sale.advertising_fee, platform_fee: sale.platform_fee, status: sale.status, restock: sale.restock },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount, shipping_cost: data.shipping_cost, shipping_charged: data.shipping_charged, advertising_fee: data.advertising_fee, platform_fee: data.platform_fee, status: data.status, restock: data.restock },
        reason: form.reason.trim(),
      },
```

Replace it with:

```ts
      metadata: {
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount, shipping_cost: sale.shipping_cost, shipping_charged: sale.shipping_charged, advertising_fee: sale.advertising_fee, platform_fee: sale.platform_fee, status: sale.status, restock: sale.restock, buyer_name: sale.buyer_name, shipping_address_line1: sale.shipping_address_line1, shipping_address_line2: sale.shipping_address_line2, shipping_city: sale.shipping_city, shipping_state: sale.shipping_state, shipping_postal_code: sale.shipping_postal_code, shipping_country: sale.shipping_country, buyer_phone: sale.buyer_phone, buyer_email: sale.buyer_email },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount, shipping_cost: data.shipping_cost, shipping_charged: data.shipping_charged, advertising_fee: data.advertising_fee, platform_fee: data.platform_fee, status: data.status, restock: data.restock, buyer_name: data.buyer_name, shipping_address_line1: data.shipping_address_line1, shipping_address_line2: data.shipping_address_line2, shipping_city: data.shipping_city, shipping_state: data.shipping_state, shipping_postal_code: data.shipping_postal_code, shipping_country: data.shipping_country, buyer_phone: data.buyer_phone, buyer_email: data.buyer_email },
        reason: form.reason.trim(),
      },
```

- [ ] **Step 6: Render the collapsible "Shipping Address (optional)" section**

Find this exact block (the closing of the Fees & shipping section,
immediately followed by the Reason for Edit field):

```tsx
        </div>

        <Field label="Reason for Edit" required>
```

Replace it with:

```tsx
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowShipping((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-text-strong)] hover:bg-[var(--color-surface-raised)] transition-colors rounded-[var(--radius-card)]"
          >
            <span>Shipping Address (optional)</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform text-[var(--color-text-muted)] ${showShipping ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showShipping && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
              <Field label="Buyer Name">
                <Input
                  value={form.buyer_name}
                  onChange={(e) => set("buyer_name", e.target.value)}
                  placeholder="e.g. Jane Buyer"
                />
              </Field>
              <Row>
                <Field label="Address Line 1">
                  <Input
                    value={form.shipping_address_line1}
                    onChange={(e) => set("shipping_address_line1", e.target.value)}
                  />
                </Field>
                <Field label="Address Line 2">
                  <Input
                    value={form.shipping_address_line2}
                    onChange={(e) => set("shipping_address_line2", e.target.value)}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="City">
                  <Input
                    value={form.shipping_city}
                    onChange={(e) => set("shipping_city", e.target.value)}
                  />
                </Field>
                <Field label="State">
                  <Input
                    value={form.shipping_state}
                    onChange={(e) => set("shipping_state", e.target.value)}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Postal Code">
                  <Input
                    value={form.shipping_postal_code}
                    onChange={(e) => set("shipping_postal_code", e.target.value)}
                  />
                </Field>
                <Field label="Country">
                  <Input
                    value={form.shipping_country}
                    onChange={(e) => set("shipping_country", e.target.value)}
                    placeholder="e.g. DE"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={form.buyer_phone}
                    onChange={(e) => set("buyer_phone", e.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={form.buyer_email}
                    onChange={(e) => set("buyer_email", e.target.value)}
                  />
                </Field>
              </Row>
            </div>
          )}
        </div>

        <Field label="Reason for Edit" required>
```

### Part B — `AddSaleModal.tsx`

- [ ] **Step 7: Add the nine fields to `FormState`**

Find this exact block:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
}
```

Replace it with:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
  buyer_name: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
  buyer_phone: string;
  buyer_email: string;
}
```

- [ ] **Step 8: Add empty defaults to `makeDefaults`**

Find this exact block:

```ts
function makeDefaults(defaultVatRate: number): FormState {
  return {
    platform: "amazon",
    product_name: "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    currency: "EUR",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    status: "pending",
    customStatus: "",
    restock: false,
    shipping_cost: "",
    shipping_charged: "",
    advertising_fee: "",
    platform_fee: "",
  };
}
```

Replace it with:

```ts
function makeDefaults(defaultVatRate: number): FormState {
  return {
    platform: "amazon",
    product_name: "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    currency: "EUR",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    status: "pending",
    customStatus: "",
    restock: false,
    shipping_cost: "",
    shipping_charged: "",
    advertising_fee: "",
    platform_fee: "",
    buyer_name: "",
    shipping_address_line1: "",
    shipping_address_line2: "",
    shipping_city: "",
    shipping_state: "",
    shipping_postal_code: "",
    shipping_country: "",
    buyer_phone: "",
    buyer_email: "",
  };
}
```

- [ ] **Step 9: Add `showShipping` state and reset it alongside `showFees`**

Find this exact block:

```ts
  const [showFees, setShowFees] = useState(false);
  const [showLinkedPurchase, setShowLinkedPurchase] = useState(false);
```

Replace it with:

```ts
  const [showFees, setShowFees] = useState(false);
  const [showShipping, setShowShipping] = useState(false);
  const [showLinkedPurchase, setShowLinkedPurchase] = useState(false);
```

Find this exact block (inside `handleSubmit`, the post-save reset):

```ts
    setForm(makeDefaults(defaultVatRate));
    setShowFees(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setSaving(false);
    onSuccess?.(data.product_name);
    onClose();
  }

  function handleClose() {
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    setShowFees(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    onClose();
  }
```

Replace it with:

```ts
    setForm(makeDefaults(defaultVatRate));
    setShowFees(false);
    setShowShipping(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setSaving(false);
    onSuccess?.(data.product_name);
    onClose();
  }

  function handleClose() {
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    setShowFees(false);
    setShowShipping(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    onClose();
  }
```

- [ ] **Step 10: Compute the nine trimmed-or-null values and include them in the insert payload**

Find this exact block:

```ts
    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;

    const { data, error: dbError } = await supabase
```

Replace it with:

```ts
    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;
    const buyerName = form.buyer_name.trim() || null;
    const shippingAddressLine1 = form.shipping_address_line1.trim() || null;
    const shippingAddressLine2 = form.shipping_address_line2.trim() || null;
    const shippingCity = form.shipping_city.trim() || null;
    const shippingState = form.shipping_state.trim() || null;
    const shippingPostalCode = form.shipping_postal_code.trim() || null;
    const shippingCountry = form.shipping_country.trim() || null;
    const buyerPhone = form.buyer_phone.trim() || null;
    const buyerEmail = form.buyer_email.trim() || null;

    const { data, error: dbError } = await supabase
```

Find this exact block (the `.insert({...})` call):

```ts
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
      })
      .select()
      .single<Sale>();
```

Replace it with:

```ts
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
        buyer_name: buyerName,
        shipping_address_line1: shippingAddressLine1,
        shipping_address_line2: shippingAddressLine2,
        shipping_city: shippingCity,
        shipping_state: shippingState,
        shipping_postal_code: shippingPostalCode,
        shipping_country: shippingCountry,
        buyer_phone: buyerPhone,
        buyer_email: buyerEmail,
      })
      .select()
      .single<Sale>();
```

- [ ] **Step 11: Render the collapsible "Shipping Address (optional)" section**

Find this exact block (the closing of the Fees & shipping section,
immediately followed by the Purchase cost section's comment marker):

```tsx
        </div>

        {/* ── Purchase cost (optional) ── */}
```

Replace it with:

```tsx
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowShipping((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-text-strong)] hover:bg-[var(--color-surface-raised)] transition-colors rounded-[var(--radius-card)]"
          >
            <span>Shipping Address (optional)</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform text-[var(--color-text-muted)] ${showShipping ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showShipping && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
              <Field label="Buyer Name">
                <Input
                  value={form.buyer_name}
                  onChange={(e) => set("buyer_name", e.target.value)}
                  placeholder="e.g. Jane Buyer"
                />
              </Field>
              <Row>
                <Field label="Address Line 1">
                  <Input
                    value={form.shipping_address_line1}
                    onChange={(e) => set("shipping_address_line1", e.target.value)}
                  />
                </Field>
                <Field label="Address Line 2">
                  <Input
                    value={form.shipping_address_line2}
                    onChange={(e) => set("shipping_address_line2", e.target.value)}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="City">
                  <Input
                    value={form.shipping_city}
                    onChange={(e) => set("shipping_city", e.target.value)}
                  />
                </Field>
                <Field label="State">
                  <Input
                    value={form.shipping_state}
                    onChange={(e) => set("shipping_state", e.target.value)}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Postal Code">
                  <Input
                    value={form.shipping_postal_code}
                    onChange={(e) => set("shipping_postal_code", e.target.value)}
                  />
                </Field>
                <Field label="Country">
                  <Input
                    value={form.shipping_country}
                    onChange={(e) => set("shipping_country", e.target.value)}
                    placeholder="e.g. DE"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={form.buyer_phone}
                    onChange={(e) => set("buyer_phone", e.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={form.buyer_email}
                    onChange={(e) => set("buyer_email", e.target.value)}
                  />
                </Field>
              </Row>
            </div>
          )}
        </div>

        {/* ── Purchase cost (optional) ── */}
```

- [ ] **Step 12: Commit**

```bash
git add src/app/dashboard/sales/_components/EditSaleModal.tsx \
  src/app/dashboard/sales/_components/AddSaleModal.tsx
git commit -m "feat(sales): add Shipping Address (optional) section to Add/Edit Order modals"
```

---

## Task 6: Order detail page display + `sales/CLAUDE.md` feature doc

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx` (Details card)
- Modify: `src/app/dashboard/sales/CLAUDE.md` (new subsection)

**Interfaces:**
- Consumes: `Sale`'s nine new fields (Task 1). This is the last task in the
  plan — no later task depends on anything it produces.

- [ ] **Step 1: Add the `hasShippingAddress` derived value**

In `src/app/dashboard/sales/[id]/page.tsx`, find this exact block:

```ts
  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;
```

Replace it with:

```ts
  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;

  const hasShippingAddress =
    sale.buyer_name != null ||
    sale.shipping_address_line1 != null ||
    sale.shipping_address_line2 != null ||
    sale.shipping_city != null ||
    sale.shipping_state != null ||
    sale.shipping_postal_code != null ||
    sale.shipping_country != null ||
    sale.buyer_phone != null ||
    sale.buyer_email != null;
```

- [ ] **Step 2: Render the Shipping Address block in the Details card**

Find this exact block (the restock note, immediately followed by the
Created By/Created At rows):

```tsx
            {sale.restock && (
              <div className="rounded-(--radius-btn) bg-(--color-success-bg) border border-green-200 px-3 py-2 text-xs text-(--color-success-text)">
                Item returned to stock (resellable)
              </div>
            )}

            <FinRow label="Created By" value={sale.created_by} />
```

Replace it with:

```tsx
            {sale.restock && (
              <div className="rounded-(--radius-btn) bg-(--color-success-bg) border border-green-200 px-3 py-2 text-xs text-(--color-success-text)">
                Item returned to stock (resellable)
              </div>
            )}

            {hasShippingAddress && (
              <div>
                <dt className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider mb-1">
                  Shipping Address
                </dt>
                <dd className="text-sm text-(--color-text-base) space-y-0.5">
                  {sale.buyer_name && (
                    <p className="font-semibold">{sale.buyer_name}</p>
                  )}
                  {sale.shipping_address_line1 && <p>{sale.shipping_address_line1}</p>}
                  {sale.shipping_address_line2 && <p>{sale.shipping_address_line2}</p>}
                  {(sale.shipping_city || sale.shipping_state || sale.shipping_postal_code) && (
                    <p>
                      {[
                        sale.shipping_city,
                        [sale.shipping_state, sale.shipping_postal_code].filter(Boolean).join(" "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {sale.shipping_country && <p>{sale.shipping_country}</p>}
                  {sale.buyer_phone && (
                    <p className="text-xs text-(--color-text-muted) pt-1">{sale.buyer_phone}</p>
                  )}
                  {sale.buyer_email && (
                    <p className="text-xs text-(--color-text-muted)">{sale.buyer_email}</p>
                  )}
                </dd>
              </div>
            )}

            <FinRow label="Created By" value={sale.created_by} />
```

- [ ] **Step 3: Add the "Buyer shipping address" subsection to `sales/CLAUDE.md`**

In `src/app/dashboard/sales/CLAUDE.md`, find the `## Platform-synced orders
(additive field on `Sale`)` section's final paragraph:

```markdown
- Synced rows always have `product_id: null`, `vat_rate: null`,
  `vat_amount: null`, and `restock: false` — they're never linked to
  inventory or VAT accounting. Both modals and `page.tsx` should treat a
  non-null `external_order_id` as informational only; don't add UI that lets
  a user edit it.

## Shared dependencies (live outside this folder on purpose)
```

Replace it with:

```markdown
- Synced rows always have `product_id: null`, `vat_rate: null`,
  `vat_amount: null`, and `restock: false` — they're never linked to
  inventory or VAT accounting. Both modals and `page.tsx` should treat a
  non-null `external_order_id` as informational only; don't add UI that lets
  a user edit it.

## Buyer shipping address (additive fields on `Sale`)

Nine nullable columns (migration `041_sales_shipping_address.sql`, see
`supabase/SKILL.md`): `buyer_name`, `shipping_address_line1`,
`shipping_address_line2`, `shipping_city`, `shipping_state`,
`shipping_postal_code`, `shipping_country`, `buyer_phone`, `buyer_email`.

- **Automatic capture (eBay only)**: `src/lib/integrations/ebay.ts`'s
  `fetchOrders` extracts `fulfillmentStartInstructions[].shippingStep.shipTo`
  per order (order-level, duplicated onto every line item's
  `NormalizedOrder.shipping`, same as `date`/`description`) and
  `mapToSale.ts`'s `normalizedOrderToSaleRow` spreads it onto the insert row,
  all nine `null` when `order.shipping` is missing/null. Amazon's adapter is
  untouched — its `NormalizedOrder`s leave `shipping` `undefined`
  (SP-API's order-address endpoint needs a separate PII-access grant this
  app doesn't request), and `mapToSale.ts` already treats an absent field as
  "no data".
- **Manual capture/edit (any platform)**: `AddSaleModal`/`EditSaleModal` both
  have a collapsible "Shipping Address (optional)" section (same
  chevron/collapse pattern as "Fees & shipping (optional)" —
  `showShipping` boolean). None of the nine fields are `required`.
  `EditSaleModal`'s section auto-opens when the sale being edited already
  has at least one of the nine fields set, same rule as the Fees section.
  Included in the `sales.update(...)` payload and the before/after audit-log
  diff, same as every other editable field group.
- **User-owned on re-import**: all nine are preserved from the existing row
  on a re-sync (`mergeImportedSale.ts` — see
  `src/lib/integrations/SKILL.md`'s Merge rule section) — a seller's manual
  correction to a wrong or incomplete auto-captured address survives a later
  status-change re-import of the same order.
- **Display**: `[id]/page.tsx`'s Details card renders a "Shipping Address"
  block (bold `buyer_name` line, address lines, `city, state postal_code`,
  `country`, then phone/email as small muted lines) only when at least one
  of the nine fields is non-null — same visual weight as the card's other
  rows, not a separate card.
- `shipping_country` is free text on purpose (not a fixed-list `Select`) —
  eBay returns a 2-letter code, a manual entry might not; validation is
  deferred to the future label-purchase feature that actually needs a valid
  country code.

## Shared dependencies (live outside this folder on purpose)
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/sales/[id]/page.tsx src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): display buyer shipping address on order detail page"
```

---

## Manual verification (after all tasks, human-driven)

Ask the human to verify in the browser (per this repo's working agreement —
the implementer does not start a dev server or drive a browser itself unless
Playwright MCP is already connected to an already-running `npm run dev`):

1. Import a sandbox eBay order via Review Orders — confirm the order detail
   page shows the buyer's address.
2. Manually add/edit a non-eBay sale's shipping address via `AddSaleModal`/
   `EditSaleModal` — confirm it saves and displays correctly, and that the
   Save/Add button never looked disabled-but-clickable or vice versa for an
   all-optional section.
3. Re-run Review Orders import on the same eBay order after hand-editing its
   address in the app — confirm the manual correction survives (is not
   overwritten by the re-sync).

## Self-review notes (completed during plan authoring)

- **Spec coverage**: Data model (Task 1) ✓, eBay capture (Task 2) ✓, mapping
  (Task 3) ✓, merge rule (Task 4) ✓, manual capture/edit in both modals
  (Task 5) ✓, display (Task 6) ✓, all three "Testing" bullets from the spec
  have a corresponding task (`mapToSale.test.ts` → Task 3,
  `mergeImportedSale.test.ts` → Task 4, `ebay.test.ts` → Task 2), all three
  "Docs to update" bullets are folded into the task that made the doc stale
  (`sales/CLAUDE.md` → Task 6, `integrations/SKILL.md` → Tasks 2 and 4,
  `supabase/SKILL.md`/`CLAUDE.md` → Task 1). Amazon out-of-scope handling is
  explicitly called out in Task 2 (adapter untouched) and Task 3's tests
  (omitted `shipping` maps to null).
- **Placeholder scan**: no "TBD"/"handle appropriately"/"similar to Task N"
  language; every code step has the literal code to write, every test step
  has the literal assertions.
- **Type consistency**: `Sale`'s nine field names (Task 1) are used verbatim
  and consistently in `mapToSale.ts` (Task 3), `mergeImportedSale.ts`'s
  fixtures (Task 4), both modals' `FormState`/payloads (Task 5), and the
  detail page (Task 6) — `buyer_name`, `shipping_address_line1`,
  `shipping_address_line2`, `shipping_city`, `shipping_state`,
  `shipping_postal_code`, `shipping_country`, `buyer_phone`, `buyer_email`.
  `ShippingAddress`'s camelCase field names (`buyerName`, `addressLine1`,
  `addressLine2`, `city`, `state`, `postalCode`, `country`, `phone`,
  `email`, Task 2) are mapped 1:1 onto the snake_case `Sale` fields only in
  `mapToSale.ts` (Task 3) — no other file needs to know both naming schemes.
