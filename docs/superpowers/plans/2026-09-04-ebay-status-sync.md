# eBay Order Status Sync (Shipped + Cancelled) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `sales` row sourced from eBay (`platform === "ebay"`,
`external_order_id` set) has its `status` changed to `"shipped"` or
`"cancelled"` via the existing Edit Order flow, push that change to eBay's
Fulfillment API so the buyer sees tracking info / the order closes on eBay's
side too — order sync is one-way (eBay → app) today.

**Architecture:** Five new nullable columns on `sales` (migration 040, plus
the matching `provision_tenant_schema()` update). Two plain exported
functions in `src/lib/integrations/ebay.ts` (`createShippingFulfillment`,
`cancelOrder`) — not new `PlatformAdapter` methods, this is one-off eBay
plumbing, Amazon has no equivalent. One new server route,
`POST /api/integrations/ebay/orders/[saleId]/sync-status`, that the existing
`EditSaleModal` fire-and-awaits **after** its own Supabase update succeeds —
the local save is never blocked by eBay, and a sync failure surfaces as a
toast + a retry row on the order detail page, never as a rolled-back local
edit. No new automatic/cron sync — matches the rest of the Integrations
feature (100% manual, no push infra).

**Tech Stack:** Next.js App Router (route handler), Supabase (tenant-schema
Postgres via `run_on_all_tenant_schemas`), Redux Toolkit (`salesSlice`),
Jest for the pure request-builder unit tests.

## Global Constraints

These apply to every task below; they are copied verbatim (or paraphrased
only where the source names an unrelated example) from this repo's
`AGENTS.md` and are enforced automatically by `.claude/verifiers/` — a
PreToolUse hook **denies** an edit that violates one, it does not just warn.

- **Never query `public.*` in a tenant-schema route.** Every Supabase call
  in the new route must go through the tenant-scoped client returned by
  `requireIntegrationAdmin()` (`auth.context.client`), never a hardcoded
  `public` schema reference.
- **Tenant-schema DDL always goes through `run_on_all_tenant_schemas`, plus
  the matching `provision_tenant_schema()` update — the "2 places" rule.**
  Never write `ALTER TABLE tenant_kaufnest.*` (or any other single schema)
  directly in a new migration.
- **A mutating button must never look clickable when it can't succeed, and
  must never look idle while its request is in flight.** Every
  create/edit form: real `<form onSubmit>`, `required` on both the `<Field
  required>` label AND the underlying `<Input>`/`<Select>`, submit button
  `type="submit" form="<id>"`, disabled while saving, busy-verb label while
  saving.
- **No dev server, no `curl`, no `npm test`/`tsc`/`lint` run mid-task.** Add
  or extend unit tests instead; ask the human to run the test command and
  paste output back, and to manually exercise anything that needs a browser.
- **`.claude/verifiers/guard_edit.py` blocks any import from
  `@/lib/supabase/{server,control}`, `@/lib/integrations/*`, or `stripe` in
  a file starting `"use client"`** (rule id `server-module-in-client`) —
  this fires on `src/lib/integrations/ebay/carriers.ts`'s import into
  `EditSaleModal.tsx` in Task 4 even though `carriers.ts` is a plain data
  constant with no OAuth/server secrets in it. Task 4 tells you the exact
  suppression comment to add (`// verifier:allow server-module-in-client`)
  — this is the sanctioned "rule is wrong for your case" escape hatch
  documented in `AGENTS.md`, not a workaround to avoid.

---

### Task 1: Migration `040_sales_ebay_fulfillment.sql` + `Sale` type + `provision_tenant_schema()`

**Files:**
- Create: `supabase/migrations/040_sales_ebay_fulfillment.sql`
- Modify: `src/types/index.ts:120-121` (the `Sale` interface)
- Modify: `supabase/migrations/005_tenant_provisioning.sql:156-157` (the `sales` `CREATE TABLE` inside `provision_tenant_schema()`)
- Modify: `supabase/SKILL.md` (file-map table — add the `040` row)
- Modify: `supabase/CLAUDE.md` (file-list — add the `040` bullet)

**Interfaces:**
- Produces: `Sale.tracking_number: string | null`, `Sale.shipping_carrier: string | null`, `Sale.ebay_fulfillment_id: string | null`, `Sale.ebay_sync_error: string | null`, `Sale.ebay_synced_at: string | null` on the `Sale` type (`src/types/index.ts`) — consumed by every later task. All five columns exist (as `NULL`) on every tenant schema once this migration is applied, and on every future tenant via `provision_tenant_schema()`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/040_sales_ebay_fulfillment.sql`:

```sql
-- ============================================================
-- 040 — eBay order status push-back: tracking/carrier + sync state on sales
--
-- Piece 1 of 4 in the "eBay order fulfillment" decomposition. Backs pushing
-- a local sales.status change ("shipped"/"cancelled") on an eBay-sourced
-- order out to eBay's Fulfillment API
-- (POST /api/integrations/ebay/orders/[saleId]/sync-status). Five nullable
-- columns, purely additive — every existing row gets NULL for all five, no
-- backfill needed.
--
-- tracking_number / shipping_carrier: captured in EditSaleModal when a
--   sale's status is set to "shipped" on an eBay-sourced order; eBay's
--   createShippingFulfillment call requires both.
-- ebay_fulfillment_id: eBay's returned fulfillmentId once a "shipped" sync
--   succeeds.
-- ebay_sync_error: the last push-back failure message, if the most recent
--   sync attempt failed; cleared on the next successful sync. Drives the
--   retry row on the order detail page.
-- ebay_synced_at: timestamp of the last successful sync.
--
-- Also mirrored into provision_tenant_schema() (005) in the same commit —
-- the "2 places" rule, see supabase/SKILL.md.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.sales
    add column if not exists tracking_number text,
    add column if not exists shipping_carrier text,
    add column if not exists ebay_fulfillment_id text,
    add column if not exists ebay_sync_error text,
    add column if not exists ebay_synced_at timestamptz;
$$);
```

- [ ] **Step 2: Add the five fields to the `Sale` type**

In `src/types/index.ts`, the `Sale` interface currently ends:

```ts
  refunded_amount: number | null;
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
}
```

Change the closing to:

```ts
  refunded_amount: number | null;
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
  /**
   * Carrier + tracking number captured when an eBay-sourced order's status
   * is set to "shipped" — required by eBay's Fulfillment API. Null for
   * every non-eBay sale, and for an eBay sale not currently "shipped".
   */
  tracking_number: string | null;
  shipping_carrier: string | null;
  /** eBay's fulfillmentId for this order's shipment, once synced. */
  ebay_fulfillment_id: string | null;
  /** Last eBay push-back error, if the most recent attempt failed. Cleared on the next successful sync. */
  ebay_sync_error: string | null;
  ebay_synced_at: string | null;
}
```

- [ ] **Step 3: Mirror the columns into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, the `sales` `CREATE
TABLE` currently ends:

```sql
      shipping_cost    numeric(12,2) CHECK (shipping_cost    >= 0),
      shipping_charged numeric(12,2) CHECK (shipping_charged >= 0),
      advertising_fee  numeric(12,2) CHECK (advertising_fee  >= 0),
      platform_fee     numeric(12,2) CHECK (platform_fee     >= 0)
    )
  $sql$, schema_name);
```

Change it to:

```sql
      shipping_cost    numeric(12,2) CHECK (shipping_cost    >= 0),
      shipping_charged numeric(12,2) CHECK (shipping_charged >= 0),
      advertising_fee  numeric(12,2) CHECK (advertising_fee  >= 0),
      platform_fee     numeric(12,2) CHECK (platform_fee     >= 0),
      -- eBay order status push-back — see 040_sales_ebay_fulfillment.sql.
      tracking_number     text,
      shipping_carrier    text,
      ebay_fulfillment_id text,
      ebay_sync_error     text,
      ebay_synced_at      timestamptz
    )
  $sql$, schema_name);
```

- [ ] **Step 4: Update `supabase/SKILL.md`'s file-map table**

Immediately after the `039_ebay_listing_drafts_inactive_status.sql` row (the
row ending `... — see its \`SKILL.md\` gotcha for the full story. |`) and
before the `control-plane/001_schema.sql` row, insert a new row:

```markdown
| `migrations/040_sales_ebay_fulfillment.sql` | all `tenant_%` schemas | ⏳ **pending** — adds nullable `tracking_number`, `shipping_carrier`, `ebay_fulfillment_id`, `ebay_sync_error`, `ebay_synced_at` to `sales` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Backs the eBay order status push-back (piece 1/4 of the "eBay order fulfillment" decomposition): `POST /api/integrations/ebay/orders/[saleId]/sync-status` pushes a local "shipped"/"cancelled" status change on an eBay-sourced order out to eBay's Fulfillment API. Backs `src/app/dashboard/sales/` — see its `SKILL.md`. |
```

- [ ] **Step 5: Update `supabase/CLAUDE.md`'s file list**

At the end of the `migrations/039_ebay_listing_drafts_inactive_status.sql`
bullet (the one ending "... see its `SKILL.md` gotcha for the full story."),
add a new bullet immediately after it, before the `## Related code` section:

```markdown
- `migrations/040_sales_ebay_fulfillment.sql` — adds nullable
  `tracking_number`, `shipping_carrier`, `ebay_fulfillment_id`,
  `ebay_sync_error`, `ebay_synced_at` to `sales` in every tenant schema via
  `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()`
  in the same commit. Backs the eBay order status push-back (piece 1/4 of
  the "eBay order fulfillment" decomposition) — pushing a local
  "shipped"/"cancelled" `sales.status` change on an eBay-sourced order out
  to eBay's Fulfillment API via
  `POST /api/integrations/ebay/orders/[saleId]/sync-status`. Backs the Sales
  feature (`src/app/dashboard/sales/`).
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/040_sales_ebay_fulfillment.sql src/types/index.ts supabase/migrations/005_tenant_provisioning.sql supabase/SKILL.md supabase/CLAUDE.md
git commit -m "feat(sales): add eBay fulfillment sync columns to sales (migration 040)"
```

---

### Task 2: `EBAY_CARRIER_CODES` + `createShippingFulfillment`/`cancelOrder` in `ebay.ts`

**Files:**
- Create: `src/lib/integrations/ebay/carriers.ts`
- Modify: `src/lib/integrations/ebay.ts` (append after the `ebayAdapter` export, which currently ends at line 167 with `};`)
- Test: Create `src/lib/integrations/ebay.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — these are plain HTTP request builders, no dependency on the `Sale` type.
- Produces: `EBAY_CARRIER_CODES: readonly { code: string; label: string }[]` (`src/lib/integrations/ebay/carriers.ts`) — consumed by `EditSaleModal.tsx` in Task 4. `createShippingFulfillment(accessToken: string, orderId: string, body: CreateShippingFulfillmentBody): Promise<{ fulfillmentId: string }>` and `cancelOrder(accessToken: string, orderId: string, body?: { cancelReason?: string }): Promise<{ cancelId?: string }>`, both exported from `src/lib/integrations/ebay.ts` — consumed by the route in Task 3.

- [ ] **Step 1: Create the carrier-code constant**

Create `src/lib/integrations/ebay/carriers.ts`:

```ts
/**
 * eBay's `shippingCarrierCode` is a fixed enum, not free text. This is the
 * common subset good enough for v1 — extend the array later if a seller
 * needs another carrier eBay supports.
 */
export const EBAY_CARRIER_CODES = [
  { code: "USPS", label: "USPS" },
  { code: "UPS", label: "UPS" },
  { code: "FEDEX", label: "FedEx" },
  { code: "DHL", label: "DHL" },
  { code: "OTHER", label: "Other" },
] as const;

export type EbayCarrierCode = (typeof EBAY_CARRIER_CODES)[number]["code"];
```

- [ ] **Step 2: Write the failing tests for the two request builders**

Create `src/lib/integrations/ebay.test.ts`:

```ts
import { createShippingFulfillment, cancelOrder } from "./ebay";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("createShippingFulfillment", () => {
  it("POSTs the shipping_fulfillment endpoint with the exact eBay request shape, and returns the fulfillmentId", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ fulfillmentId: "abc-123" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createShippingFulfillment("token-1", "order-1", {
      lineItems: [{ lineItemId: "line-1", quantity: 2 }],
      shippedDate: "2026-09-04T00:00:00.000Z",
      shippingCarrierCode: "UPS",
      trackingNumber: "1Z999AA10123456784",
    });

    expect(result).toEqual({ fulfillmentId: "abc-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sell/fulfillment/v1/order/order-1/shipping_fulfillment");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({
      lineItems: [{ lineItemId: "line-1", quantity: 2 }],
      shippedDate: "2026-09-04T00:00:00.000Z",
      shippingCarrierCode: "UPS",
      trackingNumber: "1Z999AA10123456784",
    });
  });

  it("throws when eBay responds with a non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"errors":[{"message":"Invalid carrier"}]}'),
    }) as unknown as typeof fetch;

    await expect(
      createShippingFulfillment("token-1", "order-1", {
        lineItems: [{ lineItemId: "line-1", quantity: 1 }],
        shippedDate: "2026-09-04T00:00:00.000Z",
        shippingCarrierCode: "BOGUS",
        trackingNumber: "123",
      })
    ).rejects.toThrow(/400/);
  });

  it("throws when eBay returns 200 with no fulfillmentId", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(
      createShippingFulfillment("token-1", "order-1", {
        lineItems: [{ lineItemId: "line-1", quantity: 1 }],
        shippedDate: "2026-09-04T00:00:00.000Z",
        shippingCarrierCode: "UPS",
        trackingNumber: "123",
      })
    ).rejects.toThrow(/no fulfillmentId/);
  });
});

describe("cancelOrder", () => {
  it("POSTs the post-order cancellation endpoint with the fixed cancelState/cancelReason shape", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ cancelId: "cancel-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await cancelOrder("token-1", "order-1");

    expect(result).toEqual({ cancelId: "cancel-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/post-order/v2/cancellation");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      legacyOrderId: "order-1",
      cancelState: "CANCEL_FULL_ORDER",
      cancelReason: "SELLER_CANCEL_BUYER_REQUEST",
    });
  });

  it("allows overriding cancelReason", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await cancelOrder("token-1", "order-1", { cancelReason: "OUT_OF_STOCK" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelReason).toBe("OUT_OF_STOCK");
  });

  it("throws when eBay responds with a non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    }) as unknown as typeof fetch;

    await expect(cancelOrder("token-1", "order-1")).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/lib/integrations/ebay.test.ts`
Expected: FAIL — `createShippingFulfillment`/`cancelOrder` are not exported from `./ebay` yet.

- [ ] **Step 4: Implement the two functions in `ebay.ts`**

`src/lib/integrations/ebay.ts` currently ends (line 167) with the closing
`};` of the `ebayAdapter` export:

```ts
    return orders;
  },
};
```

Append after that closing `};` (end of file):

```ts

export interface CreateShippingFulfillmentBody {
  lineItems: { lineItemId: string; quantity: number }[];
  shippedDate: string;
  shippingCarrierCode: string;
  trackingNumber: string;
}

export interface CreateShippingFulfillmentResult {
  fulfillmentId: string;
}

/**
 * POSTs a shipping fulfillment for an eBay order — marks it shipped on
 * eBay's side. `orderId` is the eBay order id parsed out of
 * `sales.external_order_id` by the sync-status route. Throws on any
 * non-OK response or a 2xx response with no `fulfillmentId`.
 */
export async function createShippingFulfillment(
  accessToken: string,
  orderId: string,
  body: CreateShippingFulfillmentBody
): Promise<CreateShippingFulfillmentResult> {
  const res = await fetch(`${EBAY_ORDERS_URL}/${orderId}/shipping_fulfillment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`eBay createShippingFulfillment failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { fulfillmentId?: string };
  if (!json.fulfillmentId) {
    throw new Error("eBay createShippingFulfillment succeeded but returned no fulfillmentId");
  }
  return { fulfillmentId: json.fulfillmentId };
}

export interface CancelOrderBody {
  cancelReason?: string;
}

export interface CancelOrderResult {
  cancelId?: string;
}

/**
 * POSTs an order cancellation via eBay's Post-Order Cancellation API
 * (separate base path from the Fulfillment API above, authorized by the
 * same `sell.fulfillment` scope already in `EBAY_SCOPE`). `orderId` is the
 * eBay order id parsed out of `sales.external_order_id`, sent as
 * `legacyOrderId`.
 *
 * UNVERIFIED against eBay's live sandbox at design time — confirm the
 * `legacyOrderId`/`cancelState`/`cancelReason` field names against eBay's
 * current Post-Order API reference before relying on this in production. A
 * wrong field name surfaces as a caught error in the sync-status route
 * (writes `sales.ebay_sync_error`, returns 502), not a crash.
 */
export async function cancelOrder(
  accessToken: string,
  orderId: string,
  body?: CancelOrderBody
): Promise<CancelOrderResult> {
  const res = await fetch(`${EBAY_BASE}/post-order/v2/cancellation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      legacyOrderId: orderId,
      cancelState: "CANCEL_FULL_ORDER",
      cancelReason: body?.cancelReason ?? "SELLER_CANCEL_BUYER_REQUEST",
    }),
  });

  if (!res.ok) {
    throw new Error(`eBay cancelOrder failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json().catch(() => ({}))) as { cancelId?: string };
  return { cancelId: json.cancelId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/lib/integrations/ebay.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/ebay/carriers.ts src/lib/integrations/ebay.ts src/lib/integrations/ebay.test.ts
git commit -m "feat(integrations): add eBay createShippingFulfillment/cancelOrder + carrier codes"
```

---

### Task 3: `POST /api/integrations/ebay/orders/[saleId]/sync-status` route

**Files:**
- Create: `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts`
- Modify: `src/lib/integrations/SKILL.md` (Files list bullet + new "eBay order status push-back" section)

**Interfaces:**
- Consumes: `requireIntegrationAdmin()` (`src/lib/integrations/authGuard.ts`), `getConnection`/`ensureValidAccessToken` (`src/lib/integrations/tokenStore.ts`), `ebayAdapter`/`createShippingFulfillment`/`cancelOrder` (Task 2, `src/lib/integrations/ebay.ts`), `Sale` type (Task 1, `src/types/index.ts`).
- Produces: `POST /api/integrations/ebay/orders/[saleId]/sync-status`, body `{ status: "shipped" | "cancelled", trackingNumber: string | null, carrier: string | null }`, response `{ ok: true }` (200) on success or `{ error: string }` (400/404/500/502) on failure — consumed by `EditSaleModal.tsx` (Task 4) and the order detail page's retry button (Task 5).

- [ ] **Step 1: Write the route**

Create `src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter, createShippingFulfillment, cancelOrder } from "@/lib/integrations/ebay";
import type { Sale } from "@/types";

interface SyncStatusBody {
  status: "shipped" | "cancelled";
  trackingNumber: string | null;
  carrier: string | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ saleId: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const { saleId } = await params;
  const { status, trackingNumber, carrier } = (await req.json()) as SyncStatusBody;

  if (status !== "shipped" && status !== "cancelled") {
    return NextResponse.json(
      { error: 'status must be "shipped" or "cancelled"' },
      { status: 400 }
    );
  }

  const { data: sale, error: fetchError } = await client
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .single<Sale>();

  if (fetchError || !sale || sale.platform !== "ebay" || !sale.external_order_id) {
    return NextResponse.json(
      { error: "Order not found or not an eBay-sourced sale" },
      { status: 404 }
    );
  }

  if (status === "shipped" && (!trackingNumber || !carrier)) {
    return NextResponse.json(
      { error: "Tracking number and carrier are required to mark an eBay order shipped" },
      { status: 400 }
    );
  }

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[ebay/sync-status] token refresh failed:", message);
    await client.from("sales").update({ ebay_sync_error: message }).eq("id", saleId);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // external_order_id is "${orderId}:${lineItemId}" (mapToSale.ts) — split
  // on the LAST ":" since eBay's own orderId/lineItemId never contain one,
  // per the existing dedup-key convention (see src/lib/integrations/
  // SKILL.md's "external_order_id dedup contract").
  const separatorIndex = sale.external_order_id.lastIndexOf(":");
  const orderId =
    separatorIndex === -1 ? sale.external_order_id : sale.external_order_id.slice(0, separatorIndex);
  const lineItemId =
    separatorIndex === -1 ? sale.external_order_id : sale.external_order_id.slice(separatorIndex + 1);

  try {
    if (status === "shipped") {
      const { fulfillmentId } = await createShippingFulfillment(accessToken, orderId, {
        lineItems: [{ lineItemId, quantity: sale.quantity }],
        shippedDate: new Date().toISOString(),
        shippingCarrierCode: carrier!,
        trackingNumber: trackingNumber!,
      });

      const { error: updateError } = await client
        .from("sales")
        .update({
          ebay_fulfillment_id: fulfillmentId,
          ebay_sync_error: null,
          ebay_synced_at: new Date().toISOString(),
        })
        .eq("id", saleId);
      if (updateError) throw updateError;
    } else {
      // status === "cancelled". See cancelOrder's own doc comment (ebay.ts)
      // for the "unverified against eBay's live sandbox" caveat.
      await cancelOrder(accessToken, orderId);

      const { error: updateError } = await client
        .from("sales")
        .update({
          ebay_sync_error: null,
          ebay_synced_at: new Date().toISOString(),
        })
        .eq("id", saleId);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "eBay sync failed";
    console.error("[ebay/sync-status] eBay call failed:", message);
    await client.from("sales").update({ ebay_sync_error: message }).eq("id", saleId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

This never throws past itself: the token-refresh failure and the eBay-call
failure are each caught, written into `sales.ebay_sync_error`, and returned
as `{ error }` with the matching status code. The `sales.status` change that
triggered this route was already committed by the caller before this route
runs, so a failure here never rolls it back.

- [ ] **Step 2: Update `src/lib/integrations/SKILL.md`'s Files list**

The Files list currently has:

```markdown
- `ebay.ts` / `amazon.ts` — one `PlatformAdapter` implementation each.
```

Change it to:

```markdown
- `ebay.ts` / `amazon.ts` — one `PlatformAdapter` implementation each.
  `ebay.ts` also exports `createShippingFulfillment`/`cancelOrder` — plain
  functions (not part of `PlatformAdapter`) backing the order status
  push-back route, see "eBay order status push-back" below.
- `ebay/carriers.ts` — `EBAY_CARRIER_CODES`, the fixed carrier enum eBay's
  Fulfillment API requires (`shippingCarrierCode`); used by
  `EditSaleModal.tsx`'s carrier `Select` and passed through to
  `createShippingFulfillment` by the sync-status route.
```

- [ ] **Step 3: Add the new section to `src/lib/integrations/SKILL.md`**

Immediately after the "## eBay messages (Trading API)" section (the section
that ends with the bullet "User-supplied reply text is escaped via
`escapeXml()` ... before being interpolated into the request XML —
required since it's free text that could contain `&`/`<`/`>`.") and before
"## Merge rule (re-import field ownership)", insert:

```markdown
## eBay order status push-back (shipped/cancelled)

`POST /api/integrations/ebay/orders/[saleId]/sync-status` (server-only,
uses `requireIntegrationAdmin()`) pushes a local `sales.status` change on an
eBay-sourced order (`platform === "ebay"`, `external_order_id` set) out to
eBay's Fulfillment API — the reverse direction of `fetchOrders`/Review
Orders, which only reads from eBay. Triggered from `EditSaleModal.tsx`'s
save handler (see `dashboard/sales/CLAUDE.md`), never automatically — same
100%-manual model as the rest of this library, no cron/push infra.

- `status: "shipped"` → `createShippingFulfillment(accessToken, orderId,
  body)` in `ebay.ts` — `POST /sell/fulfillment/v1/order/{orderId}/
  shipping_fulfillment`. Requires a carrier (`shippingCarrierCode`, from the
  fixed enum in `ebay/carriers.ts`'s `EBAY_CARRIER_CODES`) and
  `trackingNumber` — both captured in `EditSaleModal`.
- `status: "cancelled"` → `cancelOrder(accessToken, orderId, body?)` in
  `ebay.ts` — `POST /post-order/v2/cancellation` (separate base path from
  the Fulfillment API, but covered by the existing `sell.fulfillment`
  scope). **This endpoint's exact request/response shape is unverified
  against eBay's live sandbox** — confirm field names against eBay's
  current API reference before relying on this in production.
- `external_order_id` is parsed back into eBay's `orderId`/`lineItemId` by
  splitting on the **last** `:` (`"${orderId}:${lineItemId}"`, same
  dedup-key convention as `mapToSale.ts` — see "`external_order_id` dedup
  contract" above).
- **Best-effort, non-blocking**: the route never throws past itself — any
  failure (token refresh, the eBay call, or the DB write) is caught, written
  into `sales.ebay_sync_error`, and returned as `{ error }` with the
  upstream status code. The local `sales.status` change that triggered the
  sync is never undone — it was already committed by `EditSaleModal` before
  this route runs. On success, `ebay_sync_error` is cleared and
  `ebay_synced_at` (both transitions) / `ebay_fulfillment_id` (shipped only)
  are set.
- No new `PlatformAdapter` methods — `createShippingFulfillment`/
  `cancelOrder` are plain exported functions in `ebay.ts` that the route
  imports directly, same shape as `ebay/messages.ts`'s Trading-API-only
  functions. Amazon has no equivalent call, so this stays eBay-only
  plumbing.
- Retry: the order detail page (`dashboard/sales/[id]/page.tsx`) shows a
  warning row when `sale.ebay_sync_error` is set, with a Retry button that
  re-POSTs this same route using the sale's current
  `status`/`tracking_number`/`shipping_carrier` — no modal, nothing to
  re-enter.
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/integrations/ebay/orders/[saleId]/sync-status/route.ts" src/lib/integrations/SKILL.md
git commit -m "feat(integrations): add eBay order status sync route"
```

---

### Task 4: `EditSaleModal.tsx` — capture carrier/tracking, fire the sync on save

**Files:**
- Modify: `src/app/dashboard/sales/_components/EditSaleModal.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md` (new subsection)

**Interfaces:**
- Consumes: `Sale.tracking_number`/`Sale.shipping_carrier` (Task 1), `EBAY_CARRIER_CODES` (Task 2, `src/lib/integrations/ebay/carriers.ts`), `POST /api/integrations/ebay/orders/[saleId]/sync-status` (Task 3).
- Produces: no new exports — this is the UI capture point later tasks don't depend on.

**Gotcha before you start:** `src/lib/integrations/ebay/carriers.ts` lives
under `src/lib/integrations/`, and `.claude/verifiers/guard_edit.py` blocks
*any* import from `@/lib/integrations/*` in a `"use client"` file (rule id
`server-module-in-client`) — a blanket, path-based rule, since that
directory normally handles OAuth tokens. `carriers.ts` itself is just a
plain data array with no server secrets, so this is a legitimate false
positive: add the import with an inline suppression comment (Step 3 below
shows the exact line). This is the sanctioned escape hatch documented in
`AGENTS.md` ("if the rule is wrong for your case, suppress that one line
with `// verifier:allow <rule-id>`"), not a workaround to avoid.

- [ ] **Step 1: Add the two form fields to `FormState` and its initializers**

In `src/app/dashboard/sales/_components/EditSaleModal.tsx`, the `FormState`
interface currently ends:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
}
```

Change to:

```ts
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
  trackingNumber: string;
  carrier: string;
}
```

`saleToForm()` currently ends:

```ts
    advertising_fee: sale.advertising_fee != null ? String(sale.advertising_fee) : "",
    platform_fee: sale.platform_fee != null ? String(sale.platform_fee) : "",
  };
}
```

Change to:

```ts
    advertising_fee: sale.advertising_fee != null ? String(sale.advertising_fee) : "",
    platform_fee: sale.platform_fee != null ? String(sale.platform_fee) : "",
    trackingNumber: sale.tracking_number ?? "",
    carrier: sale.shipping_carrier ?? "",
  };
}
```

`blankForm` currently ends:

```ts
  shipping_cost: "", shipping_charged: "", advertising_fee: "", platform_fee: "",
};
```

Change to:

```ts
  shipping_cost: "", shipping_charged: "", advertising_fee: "", platform_fee: "",
  trackingNumber: "", carrier: "",
};
```

- [ ] **Step 2: Destructure `warning` from `useToast`**

Currently:

```ts
  const { error: toastError } = useToast();
```

Change to:

```ts
  const { error: toastError, warning } = useToast();
```

- [ ] **Step 3: Import `EBAY_CARRIER_CODES`**

Add this import alongside the other `@/lib/...` imports near the top of the
file (after the `import { FeeAmountOrPercentField } from "./FeeAmountOrPercentField";` line):

```ts
// verifier:allow server-module-in-client — plain data constant (carrier
// codes), no OAuth/server secrets; needed for the Carrier <Select> below.
import { EBAY_CARRIER_CODES } from "@/lib/integrations/ebay/carriers";
```

- [ ] **Step 4: Compute the tracking/carrier values to persist, in `handleSubmit`**

Currently:

```ts
    const status = form.status === "other" ? form.customStatus.trim() : form.status;
    const restock = status === "returned" ? form.restock : false;

    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
```

Change to:

```ts
    const status = form.status === "other" ? form.customStatus.trim() : form.status;
    const restock = status === "returned" ? form.restock : false;

    const isEbayOrder = sale.platform === "ebay" && !!sale.external_order_id;
    const trackingNumber = isEbayOrder && status === "shipped" ? form.trackingNumber.trim() || null : null;
    const shippingCarrier = isEbayOrder && status === "shipped" ? form.carrier || null : null;

    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
```

- [ ] **Step 5: Include the two fields in the `sales.update(...)` payload**

Currently:

```ts
        platform_fee: platformFee,
        status,
        restock,
      })
      .eq("id", sale.id)
```

Change to:

```ts
        platform_fee: platformFee,
        status,
        restock,
        tracking_number: trackingNumber,
        shipping_carrier: shippingCarrier,
      })
      .eq("id", sale.id)
```

- [ ] **Step 6: Include the two fields in the audit-log before/after diff**

Currently:

```ts
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount, shipping_cost: sale.shipping_cost, shipping_charged: sale.shipping_charged, advertising_fee: sale.advertising_fee, platform_fee: sale.platform_fee, status: sale.status, restock: sale.restock },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount, shipping_cost: data.shipping_cost, shipping_charged: data.shipping_charged, advertising_fee: data.advertising_fee, platform_fee: data.platform_fee, status: data.status, restock: data.restock },
```

Change to:

```ts
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount, shipping_cost: sale.shipping_cost, shipping_charged: sale.shipping_charged, advertising_fee: sale.advertising_fee, platform_fee: sale.platform_fee, status: sale.status, restock: sale.restock, tracking_number: sale.tracking_number, shipping_carrier: sale.shipping_carrier },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount, shipping_cost: data.shipping_cost, shipping_charged: data.shipping_charged, advertising_fee: data.advertising_fee, platform_fee: data.platform_fee, status: data.status, restock: data.restock, tracking_number: data.tracking_number, shipping_carrier: data.shipping_carrier },
```

- [ ] **Step 7: Fire the sync call after the audit log write, before the linked-purchase section**

Currently:

```ts
    if (log) dispatch(addAuditLog(log));

    // Create linked purchase if user filled one in and no purchase is linked yet
```

Change to:

```ts
    if (log) dispatch(addAuditLog(log));

    // Push the status change to eBay — best-effort, never blocks the save.
    // The local sales row is already committed above; a sync failure here
    // must never look like the edit itself failed.
    if (isEbayOrder && sale.status !== status && (status === "shipped" || status === "cancelled")) {
      try {
        const syncRes = await fetch(`/api/integrations/ebay/orders/${sale.id}/sync-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, trackingNumber, carrier: shippingCarrier }),
        });
        if (!syncRes.ok) {
          const body = await syncRes.json().catch(() => ({}));
          warning("Saved locally, eBay sync failed", body.error ?? "You can retry from the order detail page.");
        }
      } catch {
        warning("Saved locally, eBay sync failed", "You can retry from the order detail page.");
      }
    }

    // Create linked purchase if user filled one in and no purchase is linked yet
```

(The `try`/`catch` around the whole `fetch` — not just the `!syncRes.ok`
branch shown in the design spec's illustrative snippet — is required: a
network failure throws from `fetch` itself, and an uncaught throw here would
skip the `setSaving(false); onSuccess?.(); onClose();` calls at the end of
`handleSubmit`, which is exactly the "blocks the save" outcome this feature
must not have.)

- [ ] **Step 8: Render the Carrier + Tracking Number fields**

In the status `<div>` block, currently:

```tsx
          {form.status === "returned" && (
            <Checkbox
              label="Item can be resold (restock inventory)"
              checked={form.restock}
              onChange={(e) => set("restock", e.target.checked)}
            />
          )}
        </div>
```

Change to:

```tsx
          {form.status === "returned" && (
            <Checkbox
              label="Item can be resold (restock inventory)"
              checked={form.restock}
              onChange={(e) => set("restock", e.target.checked)}
            />
          )}
          {sale?.platform === "ebay" && sale?.external_order_id && form.status === "shipped" && (
            <Row>
              <Field label="Carrier" required>
                <Select
                  value={form.carrier}
                  onChange={(e) => set("carrier", e.target.value)}
                  required
                >
                  <option value="">— Select carrier —</option>
                  {EBAY_CARRIER_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tracking Number" required>
                <Input
                  value={form.trackingNumber}
                  onChange={(e) => set("trackingNumber", e.target.value)}
                  placeholder="e.g. 1Z999AA10123456784"
                  required
                />
              </Field>
            </Row>
          )}
        </div>
```

(No `disabled={saving}` on these two fields — matching the existing
"Custom Status" `Input` a few lines above in this same file, which is also
conditionally required and also has no `disabled={saving}`. This file's
buttons carry the busy-state gating; its conditional fields don't, and the
new fields follow that same local pattern rather than the design spec's
paraphrase of it.)

- [ ] **Step 9: Add the sales feature doc subsection**

In `src/app/dashboard/sales/CLAUDE.md`, immediately after the "## Platform-synced orders (additive field on `Sale`)" section (ends with the bullet
"...don't add UI that lets a user edit it.") and before "## Shared
dependencies (live outside this folder on purpose)", insert:

```markdown
## eBay order status push-back (additive fields on `Sale`)

- `tracking_number`/`shipping_carrier: string | null` — captured in
  `EditSaleModal.tsx` only when `sale.platform === "ebay" &&
  sale.external_order_id` is set and the Status field is set to
  `"shipped"`: two additional required fields (Carrier — a `Select` from
  `EBAY_CARRIER_CODES`, `src/lib/integrations/ebay/carriers.ts`; Tracking
  Number — a required `Input`), prefilled from the sale's existing values
  (e.g. a retry after a failed sync). `null` for every non-eBay sale and for
  an eBay sale not currently `"shipped"`.
- `ebay_fulfillment_id`/`ebay_sync_error`/`ebay_synced_at: string | null` —
  written only by the server route below, never by the client directly.
- **After** the `sales.update(...)` succeeds (not before — the local save
  must never be blocked by eBay), if `status` transitioned *into*
  `"shipped"` or `"cancelled"` on an eBay-sourced sale, `EditSaleModal`
  fire-and-awaits `POST /api/integrations/ebay/orders/[saleId]/sync-status`
  (`src/lib/integrations/SKILL.md`'s "eBay order status push-back" section
  has the full route contract). A non-OK response or a thrown `fetch`
  (both caught) shows a `warning()` toast — "Saved locally, eBay sync
  failed" — it never blocks `onSuccess()`/`onClose()`. `AddSaleModal` is
  untouched: a sale can only be `platform === "ebay"` with a real
  `external_order_id` via the Integrations sync/import pipeline, never via
  manual creation.
- Included in the same before/after audit-log diff as every other editable
  field.
```

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/sales/_components/EditSaleModal.tsx src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): capture carrier/tracking and push eBay status sync on save"
```

---

### Task 5: Order detail page — retry a failed sync

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`
- Modify: `src/app/dashboard/sales/CLAUDE.md` (append to the subsection added in Task 4)

**Interfaces:**
- Consumes: `Sale.ebay_sync_error`/`tracking_number`/`shipping_carrier` (Task 1), `POST /api/integrations/ebay/orders/[saleId]/sync-status` (Task 3), `updateSale` action (`../_store/salesSlice`, already exported per Task-independent existing code).
- Produces: nothing new for later tasks — this is the last task in the plan.

- [ ] **Step 1: Import `updateSale` and add `retrying` state**

Currently:

```ts
import { addSale, removeSale } from "../_store/salesSlice";
```

Change to:

```ts
import { addSale, removeSale, updateSale } from "../_store/salesSlice";
```

Currently:

```ts
  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
```

Change to:

```ts
  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
```

- [ ] **Step 2: Add the retry handler**

Currently:

```ts
  async function handleDownloadInvoice() {
    if (!sale || !companyProfile) return;
    await generateOrderInvoice(sale, companyProfile);
  }
```

Change to:

```ts
  async function handleDownloadInvoice() {
    if (!sale || !companyProfile) return;
    await generateOrderInvoice(sale, companyProfile);
  }

  async function handleRetrySync() {
    if (!sale) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/integrations/ebay/orders/${sale.id}/sync-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: sale.status,
          trackingNumber: sale.tracking_number,
          carrier: sale.shipping_carrier,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toastError("eBay sync failed", body.error ?? "Please try again.");
        return;
      }

      const supabase = await createTenantClient();
      const { data: fresh } = await supabase
        .from("sales")
        .select("*")
        .eq("id", sale.id)
        .single<Sale>();
      if (fresh) {
        dispatch(updateSale(fresh));
        success("eBay sync succeeded", "The order status was pushed to eBay.");
      }
    } catch {
      toastError("eBay sync failed", "Please try again.");
    } finally {
      setRetrying(false);
    }
  }
```

- [ ] **Step 3: Render the retry row in the Details card**

Currently:

```tsx
            {sale.restock && (
              <div className="rounded-(--radius-btn) bg-(--color-success-bg) border border-green-200 px-3 py-2 text-xs text-(--color-success-text)">
                Item returned to stock (resellable)
              </div>
            )}

            <FinRow label="Created By" value={sale.created_by} />
```

Change to:

```tsx
            {sale.restock && (
              <div className="rounded-(--radius-btn) bg-(--color-success-bg) border border-green-200 px-3 py-2 text-xs text-(--color-success-text)">
                Item returned to stock (resellable)
              </div>
            )}

            {sale.ebay_sync_error && (
              <div className="rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-3 py-2 text-xs text-(--color-danger-text) space-y-2">
                <p>eBay sync failed: {sale.ebay_sync_error}</p>
                <Button variant="secondary" onClick={handleRetrySync} disabled={retrying}>
                  {retrying ? "Retrying…" : "Retry"}
                </Button>
              </div>
            )}

            <FinRow label="Created By" value={sale.created_by} />
```

- [ ] **Step 4: Append the retry-row doc line**

In `src/app/dashboard/sales/CLAUDE.md`, at the end of the "## eBay order
status push-back (additive fields on `Sale`)" subsection added in Task 4
(after the "Included in the same before/after audit-log diff as every other
editable field." bullet), append:

```markdown
- **Retry a failed sync**: the order detail page
  (`dashboard/sales/[id]/page.tsx`) shows a warning row when
  `sale.ebay_sync_error` is set ("eBay sync failed: `<message>`" + a Retry
  button), re-POSTing the same route with the sale's current
  `status`/`tracking_number`/`shipping_carrier` — no modal, nothing to
  re-enter. On success it re-fetches the sale and dispatches `updateSale`,
  which clears the row (a successful sync clears `ebay_sync_error`
  server-side).
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/[id]/page.tsx src/app/dashboard/sales/CLAUDE.md
git commit -m "feat(sales): add retry row for a failed eBay status sync"
```

---

## Manual verification (after all tasks — ask the human to run this)

Per `AGENTS.md`'s working agreement: no dev server/curl from the implementer.
Ask the user to, with `npm run dev` already running:

1. Connect an eBay sandbox account (Integrations page), import a sandbox
   order via Review Orders.
2. Open the order, Edit Order, set Status to "Shipped", fill in Carrier +
   Tracking Number, Save. Confirm the eBay sandbox Seller Hub shows the
   fulfillment, and no "sync failed" toast appears.
3. Edit a second order, set Status to "Cancelled", Save. Confirm it shows
   cancelled on eBay's side.
4. Edit a third order, set Status to "Shipped" with an intentionally invalid
   tracking-number format, Save. Confirm: the local edit still saves (order
   detail page reflects the new status), a "Saved locally, eBay sync
   failed" warning toast appears, and the order detail page shows the Retry
   row. Click Retry with a corrected tracking number and confirm the row
   clears.

Also ask the user to run `npx jest src/lib/integrations/ebay.test.ts` and
paste the output back.

---

## Self-review notes

- **Spec coverage:** Data model (Task 1) ✓, carrier codes (Task 2) ✓,
  `EditSaleModal` capture + post-save sync (Task 4) ✓, API route incl. both
  status branches, error handling, and the "never throw past this route"
  requirement (Task 3) ✓, retry row (Task 5) ✓, docs — all four files named
  in the spec's "Docs to update" section are covered (`supabase/SKILL.md` +
  `supabase/CLAUDE.md` in Task 1, `src/lib/integrations/SKILL.md` in Task 3,
  `src/app/dashboard/sales/CLAUDE.md` split across Tasks 4/5) ✓. Testing
  section's unit-test requirement covered in Task 2; its manual-verification
  requirement is the "Manual verification" section above, to hand to the
  user rather than run by the implementer ✓.
- **Deviations from the spec's literal illustrative snippets, and why:**
  (1) the sync-call `try`/`catch` in Task 4 Step 7 wraps the whole `fetch`,
  not just the `!syncRes.ok` branch — the spec's snippet doesn't handle a
  thrown `fetch` (network failure), which would otherwise break the "never
  blocks the save" guarantee the spec itself states. (2) The new Carrier/
  Tracking fields don't get `disabled={saving}` — the spec's prose says
  "same treatment as every other required field," and this file's actual
  other conditionally-required field (Custom Status) has no
  `disabled={saving}` either, so matching the real file (per this plan's
  brief) means omitting it too. (3) `cancelOrder`'s third parameter is an
  optional `{ cancelReason?: string }` rather than a literal duplicate of the
  whole request body — the spec names the function signature
  `cancelOrder(accessToken, orderId, body)` without pinning down `body`'s
  exact shape, and the route's actual HTTP request to eBay matches the
  spec's literal JSON exactly regardless of this choice.
- **New risk not called out in the spec, resolved here:** the
  `server-module-in-client` verifier rule blocks `EditSaleModal.tsx`
  (`"use client"`) from importing anything under `@/lib/integrations/*`,
  which includes the spec's proposed `ebay/carriers.ts` location. Flagged in
  Global Constraints and resolved with an inline `// verifier:allow`
  suppression in Task 4 Step 3, rather than relocating the file out of
  `src/lib/integrations/` — keeping it at the spec's named path was judged
  preferable to a silent deviation, since the suppression is the mechanism
  `AGENTS.md` itself prescribes for exactly this kind of false positive.
- **Placeholder scan:** no "TBD"/"handle appropriately"/"similar to Task N"
  found — every step above has literal code or an exact `git` command.
- **Type consistency:** `Sale.tracking_number`/`shipping_carrier`/
  `ebay_fulfillment_id`/`ebay_sync_error`/`ebay_synced_at` (Task 1) are used
  with identical names in Tasks 3–5. `createShippingFulfillment`/
  `cancelOrder`'s signatures (Task 2) match their call sites in Task 3
  exactly (nested `body` object, `orderId` as the eBay order id, not the
  local `sales.id`). The route's request/response shape (Task 3) matches
  both call sites in Tasks 4 and 5 (`{ status, trackingNumber, carrier }` →
  `{ ok: true }` / `{ error }`).
