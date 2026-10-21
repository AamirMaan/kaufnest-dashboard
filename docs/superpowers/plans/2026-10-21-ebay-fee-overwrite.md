# eBay Fee Overwrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant `super_admin` can preview which eBay orders' Platform Fee / Ad Fee differ from the eBay Finances API, untick orders to keep, and apply the rest with compare-and-set writes.

**Architecture:** A pure diff (`computeFeeOverwrites`) built on the existing `feesByLineItem` / `orderLinkedChargeFees` derivations, so it can never disagree with "Sync eBay charges". Two super_admin-only routes: `preview` (eBay fetch + diff, no writes) and `apply` (validated payload, guarded `UPDATE … WHERE field = from`, audit log). A `FeeOverwriteModal` on the eBay `ConnectionCard` drives both.

**Tech Stack:** Next.js App Router route handlers, Supabase JS (tenant client), Redux (read-only role), Jest.

Spec: `docs/superpowers/specs/2026-10-21-ebay-fee-overwrite-design.md`.

## Global Constraints

- Fields in scope: `platform_fee` and `advertising_fee` only. Never `shipping_cost`, never Expenses.
- Never clear a fee: an eBay value of `null` is never proposed.
- Only role `super_admin` (from `profiles.role`) — `admin` gets 403 / no button.
- Same 90-day window as charge sync: `LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000`.
- Never return a raw Postgres error to the client; log server-side.
- Client code never imports `src/lib/integrations/**` (server-only) — mirror types in `_lib`.
- UI: one primary button per view; busy verbs ("Checking eBay…", "Applying…"); toast on success AND failure; `DataTable` gets an `emptyMessage`; Modal closes on Escape/backdrop and has Cancel.
- Tests: `npx jest <path>` for the files you touched only. Do not run `tsc`/`lint` by hand — the pre-commit hook does.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec deviations (decided while planning — record in the spec in Task 7)

1. **No extraction from `chargeSync.ts`.** `feesByLineItem` and `orderLinkedChargeFees` are already exported from `financesMap.ts` and are exactly what charge sync uses; the diff composes them directly. Only `IN_CHUNK` and `chunks` get exported from `chargeSync.ts` for reuse.
2. **Apply does not filter writes by `connection_id`.** Legacy/pre-056 rows may have `connection_id = null`, which would make every change "stale". eBay order ids are globally unique; the write is scoped by `id` + `platform = 'ebay'` + compare-and-set on the old value. The route still checks the account is active (`requireActiveConnection`).

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/integrations/ebay/chargeSync.ts` | modify | export `IN_CHUNK`, `chunks` |
| `src/lib/integrations/ebay/feeOverwrite.ts` | create | types, pure `computeFeeOverwrites`, `loadOverwriteSales`, `applyFeeOverwrites` |
| `src/lib/integrations/ebay/feeOverwrite.test.ts` | create | tests for the three functions |
| `src/lib/integrations/ebay/feeOverwriteApply.ts` | create | pure `parseFeeOverwriteApply` validator |
| `src/lib/integrations/ebay/feeOverwriteApply.test.ts` | create | validator tests |
| `src/lib/utils/feeOverwriteAccess.ts` | create | client-safe `canOverwriteEbayFees(role)` (utils: client may not import `lib/integrations`) |
| `src/lib/utils/feeOverwriteAccess.test.ts` | create | predicate test |
| `src/lib/integrations/authGuard.ts` | modify | `requireIntegrationSuperAdmin()` |
| `src/app/api/integrations/ebay/fees/preview/route.ts` | create | POST preview |
| `src/app/api/integrations/ebay/fees/apply/route.ts` | create | POST apply |
| `src/app/dashboard/integrations/_lib/feeOverwriteSelection.ts` | create | client types, row grouping, payload, toast text |
| `src/app/dashboard/integrations/_lib/feeOverwriteSelection.test.ts` | create | tests |
| `src/app/dashboard/integrations/_components/FeeOverwriteModal.tsx` | create | modal organism |
| `src/app/dashboard/integrations/_components/ConnectionCard.tsx` | modify | button + modal mount |
| `src/app/dashboard/integrations/{CLAUDE,SKILL}.md`, `src/lib/integrations/SKILL.md`, spec | modify | docs |

---

### Task 1: Pure fee diff + sales loader + guarded apply (`feeOverwrite.ts`)

**Files:**
- Modify: `src/lib/integrations/ebay/chargeSync.ts:9` and `:57-61`
- Create: `src/lib/integrations/ebay/feeOverwrite.ts`
- Test: `src/lib/integrations/ebay/feeOverwrite.test.ts`

**Interfaces:**
- Consumes: `feesByLineItem`, `orderLinkedChargeFees`, `EbayFinanceTransaction` (`./financesMap`); `IN_CHUNK`, `chunks`, `mapLimit`, `WRITE_CONCURRENCY` (`./chargeSync`); `IntegrationsClient` (`../types`).
- Produces:
  ```ts
  export type OverwriteField = "platform_fee" | "advertising_fee";
  export const OVERWRITE_FIELDS: readonly OverwriteField[];
  export interface OverwriteSaleRow { id: string; external_order_id: string; currency: string; date: string; platform_fee: number | null; advertising_fee: number | null }
  export interface FeeChange { saleId: string; externalOrderId: string; currency: string; date: string; field: OverwriteField; from: number | null; to: number }
  export interface FeeOverwritePreview { changes: FeeChange[]; currencyMismatch: number; notImported: number }
  export interface ApplyChange { saleId: string; field: OverwriteField; from: number | null; to: number }
  export interface ApplyResult { applied: ApplyChange[]; staleSkipped: number }
  export class FeeOverwritePermissionError extends Error {}
  export function computeFeeOverwrites(sales: OverwriteSaleRow[], txns: EbayFinanceTransaction[]): FeeOverwritePreview;
  export async function loadOverwriteSales(client: IntegrationsClient, txns: EbayFinanceTransaction[]): Promise<OverwriteSaleRow[]>;
  export async function applyFeeOverwrites(client: IntegrationsClient, changes: ApplyChange[]): Promise<ApplyResult>;
  ```

- [ ] **Step 1: Export the chunk helpers from `chargeSync.ts`**

Change line 9 `const IN_CHUNK = 200;` → `export const IN_CHUNK = 200;` and `function chunks<T>(` → `export function chunks<T>(`. No behaviour change.

- [ ] **Step 2: Write the failing tests for `computeFeeOverwrites`**

Create `src/lib/integrations/ebay/feeOverwrite.test.ts`:

```ts
import { applyFeeOverwrites, computeFeeOverwrites, FeeOverwritePermissionError, loadOverwriteSales, type OverwriteSaleRow } from "./feeOverwrite";
import type { EbayFinanceTransaction } from "./financesMap";

const money = (value: string, currency = "EUR") => ({ value, currency });
const row = (external_order_id: string, o: Partial<OverwriteSaleRow> = {}): OverwriteSaleRow => ({
  id: `id-${external_order_id}`, external_order_id, currency: "EUR", date: "2026-10-01",
  platform_fee: null, advertising_fee: null, ...o,
});
const saleTxn = (orderId: string, lines: EbayFinanceTransaction["orderLineItems"]): EbayFinanceTransaction => ({
  transactionId: `s-${orderId}`, transactionType: "SALE", transactionDate: "2026-10-01T00:00:00Z", orderId, orderLineItems: lines,
});
const adCharge = (orderId: string, value: string, currency = "EUR"): EbayFinanceTransaction => ({
  transactionId: `ad-${orderId}-${value}`, transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE", bookingEntry: "DEBIT",
  transactionDate: "2026-10-02T00:00:00Z", amount: money(value, currency),
  references: [{ referenceId: orderId, referenceType: "ORDER_ID" }],
});
const fvf = (value: string, currency = "EUR") => ({ feeType: "FINAL_VALUE_FEE", amount: money(value, currency) });

describe("computeFeeOverwrites", () => {
  it("emits nothing when stored fees already match eBay (2 dp)", () => {
    const r = computeFeeOverwrites([row("O1:L1", { platform_fee: 1.2 })], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20")] }])]);
    expect(r.changes).toEqual([]);
  });

  it("emits current → eBay for a differing and an empty fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1", { platform_fee: 2 })],
      [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20"), { feeType: "AD_FEE", amount: money("0.50") }] }])]
    );
    expect(r.changes).toEqual([
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "platform_fee", from: 2, to: 1.2 },
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "advertising_fee", from: null, to: 0.5 },
    ]);
  });

  it("never proposes clearing a fee eBay has no value for", () => {
    const r = computeFeeOverwrites([row("O1:L1", { platform_fee: 1.2, advertising_fee: 3 })], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.20")] }])]);
    expect(r.changes).toEqual([]);
  });

  it("counts a currency mismatch and a mixed-currency line instead of changing them", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O2:L1")],
      [
        saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00", "GBP")] }]),
        saleTxn("O2", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00"), fvf("1.00", "GBP")] }]),
      ]
    );
    expect(r.changes).toEqual([]);
    expect(r.currencyMismatch).toBe(2);
  });

  it("puts platform fees per line item on a multi-line order", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O1:L2")],
      [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }, { lineItemId: "L2", marketplaceFees: [fvf("2.00")] }])]
    );
    expect(r.changes.map((c) => [c.externalOrderId, c.field, c.to])).toEqual([["O1:L1", "platform_fee", 1], ["O1:L2", "platform_fee", 2]]);
  });

  it("puts an order-linked ad fee on the first line item only", () => {
    const r = computeFeeOverwrites([row("O1:L2"), row("O1:L1")], [adCharge("O1", "0.70"), adCharge("O1", "0.30")]);
    expect(r.changes).toEqual([
      { saleId: "id-O1:L1", externalOrderId: "O1:L1", currency: "EUR", date: "2026-10-01", field: "advertising_fee", from: null, to: 1 },
    ]);
  });

  it("ignores the order-linked ad fee when any line has a SALE ad fee", () => {
    const r = computeFeeOverwrites(
      [row("O1:L1"), row("O1:L2", { advertising_fee: 0.4 })],
      [saleTxn("O1", [{ lineItemId: "L1" }, { lineItemId: "L2", marketplaceFees: [{ feeType: "AD_FEE", amount: money("0.40") }] }]), adCharge("O1", "9.99")]
    );
    expect(r.changes).toEqual([]);
  });

  it("counts an order-linked ad fee in another currency as a mismatch", () => {
    const r = computeFeeOverwrites([row("O1:L1")], [adCharge("O1", "1.00", "GBP")]);
    expect(r.changes).toEqual([]);
    expect(r.currencyMismatch).toBe(1);
  });

  it("counts orders with eBay fees but no imported sale as notImported", () => {
    const r = computeFeeOverwrites([], [saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]), adCharge("O2", "1.00"), saleTxn("O3", [{ lineItemId: "L1" }])]);
    expect(r.notImported).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest src/lib/integrations/ebay/feeOverwrite.test.ts`
Expected: FAIL — `Cannot find module './feeOverwrite'`.

- [ ] **Step 4: Implement `feeOverwrite.ts` (pure part + loader + apply)**

```ts
import type { IntegrationsClient } from "../types";
import { feesByLineItem, orderLinkedChargeFees, type EbayFinanceTransaction } from "./financesMap";
import { chunks, IN_CHUNK, mapLimit, WRITE_CONCURRENCY } from "./chargeSync";

export type OverwriteField = "platform_fee" | "advertising_fee";
export const OVERWRITE_FIELDS: readonly OverwriteField[] = ["platform_fee", "advertising_fee"];

export interface OverwriteSaleRow {
  id: string; external_order_id: string; currency: string; date: string;
  platform_fee: number | null; advertising_fee: number | null;
}
export interface FeeChange {
  saleId: string; externalOrderId: string; currency: string; date: string;
  field: OverwriteField; from: number | null; to: number;
}
export interface FeeOverwritePreview {
  changes: FeeChange[];
  /** SALE lines and order-linked ad-fee groups whose currency differs from the sale's (or mixes currencies). */
  currencyMismatch: number;
  /** Orders eBay has a fee for that aren't imported as sales. */
  notImported: number;
}
export interface ApplyChange { saleId: string; field: OverwriteField; from: number | null; to: number }
export interface ApplyResult { applied: ApplyChange[]; staleSkipped: number }

/** RLS refused the write (Orders below Edit). */
export class FeeOverwritePermissionError extends Error {}

const SALE_COLS = "id, external_order_id, currency, date, platform_fee, advertising_fee";

function orderOf(externalOrderId: string): string {
  const sep = externalOrderId.indexOf(":");
  return sep > 0 ? externalOrderId.slice(0, sep) : externalOrderId;
}
const cents = (n: number) => Math.round(n * 100);

/**
 * What eBay says each imported sale's Platform/Ad fee should be, where that differs
 * from what is stored. Same derivations as "Sync eBay charges" (feesByLineItem per
 * line; order-linked AD_FEE charges on the order's first line unless any line has a
 * SALE ad fee — never summed). A null from eBay is never proposed: this never clears.
 */
export function computeFeeOverwrites(sales: OverwriteSaleRow[], txns: EbayFinanceTransaction[]): FeeOverwritePreview {
  const lineFees = feesByLineItem(txns);
  const linked = orderLinkedChargeFees(txns).fees;
  const byOrder = new Map<string, OverwriteSaleRow[]>();
  for (const s of sales) {
    const id = orderOf(s.external_order_id);
    byOrder.set(id, [...(byOrder.get(id) ?? []), s]);
  }

  const changes: FeeChange[] = [];
  let currencyMismatch = 0;
  const emit = (s: OverwriteSaleRow, field: OverwriteField, to: number | null | undefined) => {
    if (to === null || to === undefined) return;
    const from = s[field];
    if (from !== null && cents(from) === cents(to)) return;
    changes.push({ saleId: s.id, externalOrderId: s.external_order_id, currency: s.currency, date: s.date, field, from, to });
  };

  for (const [orderId, lines] of byOrder) {
    // Code-unit order matches findOrderSale's Postgres ORDER BY for eBay's fixed-length line ids.
    lines.sort((a, b) => (a.external_order_id < b.external_order_id ? -1 : a.external_order_id > b.external_order_id ? 1 : 0));
    let saleAd = false;
    for (const s of lines) {
      const f = lineFees.get(s.external_order_id);
      if (!f) continue;
      if (f.mixedCurrency || (f.currency !== null && f.currency !== s.currency)) { currencyMismatch++; continue; }
      emit(s, "platform_fee", f.platformFee);
      if (f.advertisingFee !== null) { saleAd = true; emit(s, "advertising_fee", f.advertisingFee); }
    }
    if (saleAd) continue;
    const first = lines[0];
    for (const [currency, group] of linked.get(orderId) ?? []) {
      if (group.fields.advertising_fee === undefined) continue;
      if (currency !== first.currency) { currencyMismatch++; continue; }
      emit(first, "advertising_fee", group.fields.advertising_fee);
    }
  }

  const withFees = new Set<string>();
  for (const [key, f] of lineFees) if (f.platformFee !== null || f.advertisingFee !== null) withFees.add(orderOf(key));
  for (const [orderId, byCurrency] of linked) {
    for (const g of byCurrency.values()) if (g.fields.advertising_fee !== undefined) withFees.add(orderId);
  }
  let notImported = 0;
  for (const o of withFees) if (!byOrder.has(o)) notImported++;

  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.externalOrderId.localeCompare(b.externalOrderId)));
  return { changes, currencyMismatch, notImported };
}

/**
 * The imported eBay sales the transactions touch: every SALE line by external_order_id
 * (IN_CHUNK batches), plus the first line of each order that only has order-linked
 * charges in the window (one bounded lookup per order, like chargeSync's findOrderSale).
 */
export async function loadOverwriteSales(client: IntegrationsClient, txns: EbayFinanceTransaction[]): Promise<OverwriteSaleRow[]> {
  const rows = new Map<string, OverwriteSaleRow>();
  for (const ids of chunks([...feesByLineItem(txns).keys()], IN_CHUNK)) {
    const { data, error } = await client
      .from("sales") // verifier:allow unpaginated-collection-read — bounded: at most IN_CHUNK (200) ids per query, one sale per external_order_id
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .in("external_order_id", ids);
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    for (const r of (data ?? []) as OverwriteSaleRow[]) rows.set(r.id, r);
  }
  const covered = new Set([...rows.values()].map((r) => orderOf(r.external_order_id)));
  const missing = [...orderLinkedChargeFees(txns).fees.keys()].filter((o) => !covered.has(o));
  const firsts = await mapLimit(missing, WRITE_CONCURRENCY, async (orderId) => {
    const { data, error } = await client
      .from("sales")
      .select(SALE_COLS)
      .eq("platform", "ebay")
      .like("external_order_id", `${orderId}:%`)
      .order("external_order_id")
      .limit(1); // bounded: one row per order
    if (error) throw new Error(`sales lookup failed: ${error.message}`);
    return ((data ?? []) as OverwriteSaleRow[])[0];
  });
  for (const r of firsts) if (r) rows.set(r.id, r);
  return [...rows.values()];
}

/**
 * Compare-and-set: each change writes only while the field still holds `from`
 * (what the user saw in the preview). 0 rows → staleSkipped (changed meanwhile, or
 * RLS USING hid the row).
 */
export async function applyFeeOverwrites(client: IntegrationsClient, changes: ApplyChange[]): Promise<ApplyResult> {
  const outcomes = await mapLimit(changes, WRITE_CONCURRENCY, async (c) => {
    const base = client.from("sales").update({ [c.field]: c.to }).eq("id", c.saleId).eq("platform", "ebay");
    const { data, error } = await (c.from === null ? base.is(c.field, null) : base.eq(c.field, c.from)).select("id");
    if (error) {
      if (error.code === "42501") throw new FeeOverwritePermissionError(error.message);
      throw new Error(`sales fee overwrite failed: ${error.message}`);
    }
    return (data?.length ?? 0) > 0;
  });
  const applied = changes.filter((_, i) => outcomes[i]);
  return { applied, staleSkipped: changes.length - applied.length };
}
```

- [ ] **Step 5: Run the compute tests**

Run: `npx jest src/lib/integrations/ebay/feeOverwrite.test.ts`
Expected: the 9 `computeFeeOverwrites` tests PASS.

- [ ] **Step 6: Add loader + apply tests (fake client)**

Append to `feeOverwrite.test.ts`:

```ts
function fakeClient(opts: { sales?: OverwriteSaleRow[]; updateRows?: (id: string) => number; updateError?: { code?: string; message: string } }) {
  const updates: { patch: unknown; filters: [string, string, unknown][] }[] = [];
  const likes: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_c: string, ids: string[]) => Promise.resolve({ data: (opts.sales ?? []).filter((s) => ids.includes(s.external_order_id)), error: null }),
          like: (_c: string, pattern: string) => ({
            order: () => ({
              limit: async (n: number) => {
                likes.push(pattern);
                const prefix = pattern.replace(/%$/, "");
                return { data: (opts.sales ?? []).filter((s) => s.external_order_id.startsWith(prefix)).sort((a, b) => a.external_order_id.localeCompare(b.external_order_id)).slice(0, n), error: null };
              },
            }),
          }),
        }),
      }),
      update: (patch: unknown) => {
        const filters: [string, string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
          is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
          select: () => {
            updates.push({ patch, filters });
            if (opts.updateError) return Promise.resolve({ data: null, error: opts.updateError });
            const id = filters.find(([op, c]) => op === "eq" && c === "id")?.[2] as string;
            const n = opts.updateRows ? opts.updateRows(id) : 1;
            return Promise.resolve({ data: Array.from({ length: n }, () => ({ id })), error: null });
          },
        };
        return q;
      },
    }),
  };
  return { client: client as never, updates, likes };
}

describe("loadOverwriteSales", () => {
  it("reads SALE lines by id and looks up only uncovered order-linked orders", async () => {
    const sales = [row("O1:L1"), row("O2:L2"), row("O2:L1")];
    const { client, likes } = fakeClient({ sales });
    const out = await loadOverwriteSales(client, [
      saleTxn("O1", [{ lineItemId: "L1", marketplaceFees: [fvf("1.00")] }]),
      adCharge("O1", "0.50"),
      adCharge("O2", "0.50"),
    ]);
    expect(likes).toEqual(["O2:%"]);
    expect(out.map((r) => r.external_order_id).sort()).toEqual(["O1:L1", "O2:L1"]);
  });
});

describe("applyFeeOverwrites", () => {
  it("guards on the previewed value (eq) or emptiness (is null) and counts stale rows", async () => {
    const { client, updates } = fakeClient({ updateRows: (id) => (id === "s2" ? 0 : 1) });
    const r = await applyFeeOverwrites(client, [
      { saleId: "s1", field: "platform_fee", from: 2, to: 1.2 },
      { saleId: "s2", field: "advertising_fee", from: null, to: 0.5 },
    ]);
    expect(updates[0]).toEqual({ patch: { platform_fee: 1.2 }, filters: [["eq", "id", "s1"], ["eq", "platform", "ebay"], ["eq", "platform_fee", 2]] });
    expect(updates[1].filters).toContainEqual(["is", "advertising_fee", null]);
    expect(r).toEqual({ applied: [{ saleId: "s1", field: "platform_fee", from: 2, to: 1.2 }], staleSkipped: 1 });
  });

  it("maps 42501 to FeeOverwritePermissionError", async () => {
    const { client } = fakeClient({ updateError: { code: "42501", message: "denied" } });
    await expect(applyFeeOverwrites(client, [{ saleId: "s1", field: "platform_fee", from: 1, to: 2 }])).rejects.toBeInstanceOf(FeeOverwritePermissionError);
  });
});
```

- [ ] **Step 7: Run feeOverwrite + chargeSync tests**

Run: `npx jest src/lib/integrations/ebay/feeOverwrite.test.ts src/lib/integrations/ebay/chargeSync.test.ts`
Expected: all PASS (chargeSync unchanged by the export).

- [ ] **Step 8: Commit**

```bash
git add src/lib/integrations/ebay/chargeSync.ts src/lib/integrations/ebay/feeOverwrite.ts src/lib/integrations/ebay/feeOverwrite.test.ts
git commit -m "feat(integrations): pure eBay fee-overwrite diff and guarded apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Apply payload validator (`feeOverwriteApply.ts`)

**Files:**
- Create: `src/lib/integrations/ebay/feeOverwriteApply.ts`
- Test: `src/lib/integrations/ebay/feeOverwriteApply.test.ts`

**Interfaces:**
- Consumes: `ApplyChange`, `OVERWRITE_FIELDS`, `OverwriteField` from `./feeOverwrite` (type-only + the const).
- Produces:
  ```ts
  export const MAX_APPLY_CHANGES = 2000;
  export type ParsedFeeOverwriteApply = { ok: true; connectionId: string; changes: ApplyChange[] } | { ok: false; error: string };
  export function parseFeeOverwriteApply(body: unknown): ParsedFeeOverwriteApply;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { MAX_APPLY_CHANGES, parseFeeOverwriteApply } from "./feeOverwriteApply";

const SALE = "8f14e45f-ceea-467a-9b36-2f3c1c6d2e10";
const good = { connectionId: "conn-1", changes: [{ saleId: SALE, field: "platform_fee", from: 2, to: 1.2 }] };

describe("parseFeeOverwriteApply", () => {
  it("accepts a valid payload (from may be null)", () => {
    const body = { ...good, changes: [...good.changes, { saleId: SALE, field: "advertising_fee", from: null, to: 0 }] };
    expect(parseFeeOverwriteApply(body)).toEqual({ ok: true, connectionId: "conn-1", changes: body.changes });
  });

  it.each([
    ["no body", null],
    ["no connectionId", { changes: good.changes }],
    ["empty changes", { connectionId: "c", changes: [] }],
    ["bad field", { connectionId: "c", changes: [{ saleId: SALE, field: "shipping_cost", from: null, to: 1 }] }],
    ["negative to", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: null, to: -1 }] }],
    ["non-finite to", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: null, to: "1" }] }],
    ["bad from", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: "x", to: 1 }] }],
    ["bad saleId", { connectionId: "c", changes: [{ saleId: "nope", field: "platform_fee", from: null, to: 1 }] }],
    ["duplicate sale+field", { connectionId: "c", changes: [good.changes[0], good.changes[0]] }],
  ])("rejects %s", (_name, body) => {
    expect(parseFeeOverwriteApply(body).ok).toBe(false);
  });

  it("rejects more than MAX_APPLY_CHANGES", () => {
    const changes = Array.from({ length: MAX_APPLY_CHANGES + 1 }, (_, i) => ({
      saleId: `8f14e45f-ceea-467a-9b36-${String(i).padStart(12, "0")}`, field: "platform_fee", from: null, to: 1,
    }));
    expect(parseFeeOverwriteApply({ connectionId: "c", changes }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/integrations/ebay/feeOverwriteApply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { OVERWRITE_FIELDS, type ApplyChange, type OverwriteField } from "./feeOverwrite";

/** Upper bound on one apply request (≈ 90 days of a busy account, both fields). */
export const MAX_APPLY_CHANGES = 2000;

export type ParsedFeeOverwriteApply =
  | { ok: true; connectionId: string; changes: ApplyChange[] }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Validates POST /api/integrations/ebay/fees/apply's body. Pure. */
export function parseFeeOverwriteApply(body: unknown): ParsedFeeOverwriteApply {
  const b = (body ?? {}) as { connectionId?: unknown; changes?: unknown };
  if (typeof b.connectionId !== "string" || !b.connectionId) return { ok: false, error: "connectionId is required" };
  if (!Array.isArray(b.changes) || b.changes.length === 0) return { ok: false, error: "No changes to apply" };
  if (b.changes.length > MAX_APPLY_CHANGES) return { ok: false, error: `At most ${MAX_APPLY_CHANGES} changes per request` };
  const seen = new Set<string>();
  const changes: ApplyChange[] = [];
  for (const raw of b.changes) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c.saleId !== "string" || !UUID.test(c.saleId)) return { ok: false, error: "Invalid change" };
    if (!OVERWRITE_FIELDS.includes(c.field as OverwriteField)) return { ok: false, error: "Invalid change" };
    if (!isMoney(c.to) || !(c.from === null || isMoney(c.from))) return { ok: false, error: "Invalid change" };
    const key = `${c.saleId}:${c.field}`;
    if (seen.has(key)) return { ok: false, error: "Duplicate change" };
    seen.add(key);
    changes.push({ saleId: c.saleId, field: c.field as OverwriteField, from: c.from, to: c.to });
  }
  return { ok: true, connectionId: b.connectionId, changes };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/lib/integrations/ebay/feeOverwriteApply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/ebay/feeOverwriteApply.ts src/lib/integrations/ebay/feeOverwriteApply.test.ts
git commit -m "feat(integrations): validate eBay fee-overwrite apply payload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: super_admin rule + route guard

**Files:**
- Create: `src/lib/utils/feeOverwriteAccess.ts`, `src/lib/utils/feeOverwriteAccess.test.ts`
- Modify: `src/lib/integrations/authGuard.ts`

**Interfaces:**
- Consumes: `requireSectionAccess`, `IntegrationAuthContext` (`@/lib/permissions/requireSectionAccess`); `UserRole` (`@/types`).
- Produces:
  ```ts
  // feeOverwriteAccess.ts (pure, client-safe — no imports beyond types)
  export function canOverwriteEbayFees(role: UserRole | null | undefined): boolean;
  // authGuard.ts
  export type SuperAdminAuthResult =
    | { context: IntegrationAuthContext & { userEmail: string }; error?: undefined }
    | { context?: undefined; error: NextResponse };
  export async function requireIntegrationSuperAdmin(): Promise<SuperAdminAuthResult>;
  ```

`feeOverwriteAccess.ts` lives in `src/lib/utils/` because the verifier (`rules.py`, server-only import rule) blocks any `@/lib/integrations/*` import from a `"use client"` file, and `ConnectionCard` needs it. Keep it import-free apart from type-only `@/types`.

- [ ] **Step 1: Failing test**

```ts
import { canOverwriteEbayFees } from "@/lib/utils/feeOverwriteAccess";

describe("canOverwriteEbayFees", () => {
  it("allows only super_admin", () => {
    expect(canOverwriteEbayFees("super_admin")).toBe(true);
    expect(canOverwriteEbayFees("admin")).toBe(false);
    expect(canOverwriteEbayFees("accountant")).toBe(false);
    expect(canOverwriteEbayFees(null)).toBe(false);
    expect(canOverwriteEbayFees(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx jest src/lib/utils/feeOverwriteAccess.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the predicate**

```ts
import type { UserRole } from "@/types";

/** Who may replace stored order fees with eBay's (the overwrite path, unlike fill-only charge sync). Pure, client-safe. */
export function canOverwriteEbayFees(role: UserRole | null | undefined): boolean {
  return role === "super_admin";
}
```

- [ ] **Step 4: Add the guard to `authGuard.ts`**

```ts
import { NextResponse } from "next/server";
import { canOverwriteEbayFees } from "@/lib/utils/feeOverwriteAccess";
import type { IntegrationAuthContext } from "@/lib/permissions/requireSectionAccess";
import type { Profile } from "@/types";

export type SuperAdminAuthResult =
  | { context: IntegrationAuthContext & { userEmail: string }; error?: undefined }
  | { context?: undefined; error: NextResponse };

/** eBay fee overwrite: integrations at Edit AND role super_admin (profiles.role). */
export async function requireIntegrationSuperAdmin(): Promise<SuperAdminAuthResult> {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return { error: auth.error };
  const { data, error } = await auth.context.client
    .from("profiles")
    .select("role, email")
    .eq("id", auth.context.userId)
    .maybeSingle<Pick<Profile, "role" | "email">>();
  if (error) {
    console.error("[requireIntegrationSuperAdmin] profile lookup failed", { code: error.code });
    return { error: NextResponse.json({ error: "Could not verify access" }, { status: 500 }) };
  }
  if (!canOverwriteEbayFees(data?.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { context: { ...auth.context, userEmail: data?.email ?? "" } };
}
```

(Merge the imports with the file's existing two imports.)

- [ ] **Step 5: Run** `npx jest src/lib/utils/feeOverwriteAccess.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/feeOverwriteAccess.ts src/lib/utils/feeOverwriteAccess.test.ts src/lib/integrations/authGuard.ts
git commit -m "feat(integrations): super_admin-only guard for eBay fee overwrite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Preview and apply routes

**Files:**
- Create: `src/app/api/integrations/ebay/fees/preview/route.ts`
- Create: `src/app/api/integrations/ebay/fees/apply/route.ts`

**Interfaces:**
- Consumes: `requireIntegrationSuperAdmin` (Task 3); `computeFeeOverwrites`, `loadOverwriteSales`, `applyFeeOverwrites`, `FeeOverwritePermissionError` (Task 1); `parseFeeOverwriteApply` (Task 2); existing `getTenantEntitlements`, `hasPlatformIntegrations`, `requireActiveConnection`, `ensureValidAccessToken`, `getAdapter`, `fetchFinanceTransactions`, `FinancesScopeError`, `FinancesSignatureError`, `IntegrationAccountError`, `writeAuditLog`.
- Produces:
  - `POST /api/integrations/ebay/fees/preview` `{ connectionId }` → `200 FeeOverwritePreview` | `{ error }`.
  - `POST /api/integrations/ebay/fees/apply` `{ connectionId, changes }` → `200 { applied: number; staleSkipped: number }` | `{ error }`.

No unit tests (thin glue; logic is covered by Tasks 1–3). Verify in Task 6 manually.

- [ ] **Step 1: Preview route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationSuperAdmin } from "@/lib/integrations/authGuard";
import { getAdapter } from "@/lib/integrations/registry";
import { ensureValidAccessToken, IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { fetchFinanceTransactions, FinancesScopeError, FinancesSignatureError } from "@/lib/integrations/ebay/finances";
import { computeFeeOverwrites, loadOverwriteSales } from "@/lib/integrations/ebay/feeOverwrite";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // same window as Review Orders / charge sync

// Up to 50 Finances pages plus bounded sales lookups.
export const maxDuration = 60;

/** Read-only: what overwriting this account's order fees with eBay's would change. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationSuperAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/fees/preview] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const { connectionId } = (await req.json().catch(() => ({}))) as { connectionId?: string };
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });
    const token = await ensureValidAccessToken(client, conn, getAdapter("ebay"));
    const to = new Date();
    const txns = await fetchFinanceTransactions(token, {
      from: new Date(to.getTime() - LOOKBACK_MS).toISOString(),
      to: to.toISOString(),
      types: ["SALE", "NON_SALE_CHARGE"],
      marketplaceId: conn.marketplace_id,
    });
    const sales = await loadOverwriteSales(client, txns);
    return NextResponse.json(computeFeeOverwrites(sales, txns));
  } catch (err) {
    if (err instanceof IntegrationAccountError) return NextResponse.json({ error: err.code }, { status: 409 });
    if (err instanceof FinancesSignatureError) return NextResponse.json({ error: "INTEGRATION_FINANCES_SIGNATURE" }, { status: 409 });
    if (err instanceof FinancesScopeError) return NextResponse.json({ error: "INTEGRATION_FINANCES_SCOPE" }, { status: 409 });
    console.error("[ebay/fees/preview] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't load fees from eBay. Please try again." }, { status: 502 });
  }
}
```

- [ ] **Step 2: Apply route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationSuperAdmin } from "@/lib/integrations/authGuard";
import { IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { applyFeeOverwrites, FeeOverwritePermissionError } from "@/lib/integrations/ebay/feeOverwrite";
import { parseFeeOverwriteApply } from "@/lib/integrations/ebay/feeOverwriteApply";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";
import { writeAuditLog } from "@/lib/utils/audit";

export const maxDuration = 60;

/** Writes the approved preview rows, each only if the fee still holds the previewed value. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationSuperAdmin();
  if (auth.error) return auth.error;
  const { client, userId, userEmail, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/fees/apply] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const parsed = parseFeeOverwriteApply(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, parsed.connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });
    const { applied, staleSkipped } = await applyFeeOverwrites(client, parsed.changes);
    await Promise.all(applied.map((c) =>
      writeAuditLog(client, {
        userId, userEmail, action: "update", entityType: "sale", entityId: c.saleId,
        metadata: { source: "ebay_fee_overwrite", field: c.field, from: c.from, to: c.to, connectionId: conn.id },
      })
    ));
    return NextResponse.json({ applied: applied.length, staleSkipped });
  } catch (err) {
    if (err instanceof IntegrationAccountError) return NextResponse.json({ error: err.code }, { status: 409 });
    if (err instanceof FeeOverwritePermissionError) {
      return NextResponse.json({ error: "You don't have permission to edit orders." }, { status: 403 });
    }
    console.error("[ebay/fees/apply] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't update fees. Please try again." }, { status: 502 });
  }
}
```

`writeAuditLog` takes a `TenantClient`; if the server client's type doesn't match, follow `api/messages/[id]/reply/route.ts`, which passes its route client the same way.

- [ ] **Step 3: Verifier check**

Run: `uv run .claude/verifiers/verify_changes.py`
Expected: no new findings for the two routes (auth guard present, no raw PG error returned).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/integrations/ebay/fees
git commit -m "feat(integrations): eBay fee overwrite preview and apply routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Client selection helpers (`feeOverwriteSelection.ts`)

**Files:**
- Create: `src/app/dashboard/integrations/_lib/feeOverwriteSelection.ts`
- Test: `src/app/dashboard/integrations/_lib/feeOverwriteSelection.test.ts`

**Interfaces:**
- Consumes: nothing server-side (mirrors Task 1's `FeeChange`/`FeeOverwritePreview` shapes).
- Produces:
  ```ts
  export type OverwriteFeeField = "platform_fee" | "advertising_fee";
  export interface FeeChangeDto { saleId: string; externalOrderId: string; currency: string; date: string; field: OverwriteFeeField; from: number | null; to: number }
  export interface FeeOverwritePreviewDto { changes: FeeChangeDto[]; currencyMismatch: number; notImported: number }
  export interface FeeCell { from: number | null; to: number }
  export interface OverwriteRow { saleId: string; externalOrderId: string; currency: string; date: string; platform_fee?: FeeCell; advertising_fee?: FeeCell }
  export function groupOverwriteRows(changes: FeeChangeDto[]): OverwriteRow[];
  export function applyPayload(connectionId: string, rows: OverwriteRow[], selected: Set<string>): { connectionId: string; changes: { saleId: string; field: OverwriteFeeField; from: number | null; to: number }[] };
  export function previewSkipNote(p: Pick<FeeOverwritePreviewDto, "currencyMismatch" | "notImported">): string | null;
  export function applySummary(r: { applied: number; staleSkipped: number }): string;
  ```

- [ ] **Step 1: Failing tests**

```ts
import { applyPayload, applySummary, groupOverwriteRows, previewSkipNote, type FeeChangeDto } from "./feeOverwriteSelection";

const c = (saleId: string, field: FeeChangeDto["field"], from: number | null, to: number): FeeChangeDto => ({
  saleId, externalOrderId: `${saleId}:L1`, currency: "EUR", date: "2026-10-01", field, from, to,
});

describe("groupOverwriteRows", () => {
  it("merges a sale's two field changes into one row, keeping first-seen order", () => {
    const rows = groupOverwriteRows([c("a", "platform_fee", 2, 1.2), c("b", "advertising_fee", null, 1), c("a", "advertising_fee", null, 0.5)]);
    expect(rows).toEqual([
      { saleId: "a", externalOrderId: "a:L1", currency: "EUR", date: "2026-10-01", platform_fee: { from: 2, to: 1.2 }, advertising_fee: { from: null, to: 0.5 } },
      { saleId: "b", externalOrderId: "b:L1", currency: "EUR", date: "2026-10-01", advertising_fee: { from: null, to: 1 } },
    ]);
  });
});

describe("applyPayload", () => {
  it("includes only selected rows, one change per changed field", () => {
    const rows = groupOverwriteRows([c("a", "platform_fee", 2, 1.2), c("a", "advertising_fee", null, 0.5), c("b", "platform_fee", 1, 3)]);
    expect(applyPayload("conn", rows, new Set(["a"]))).toEqual({
      connectionId: "conn",
      changes: [
        { saleId: "a", field: "platform_fee", from: 2, to: 1.2 },
        { saleId: "a", field: "advertising_fee", from: null, to: 0.5 },
      ],
    });
  });
});

describe("previewSkipNote", () => {
  it("is null when nothing was skipped", () => expect(previewSkipNote({ currencyMismatch: 0, notImported: 0 })).toBeNull());
  it("lists non-zero counts", () =>
    expect(previewSkipNote({ currencyMismatch: 1, notImported: 3 })).toBe("Not shown: 3 orders not imported yet, 1 fee in a different currency from its order."));
});

describe("applySummary", () => {
  it("reports applied orders-fees and stale skips", () => {
    expect(applySummary({ applied: 1, staleSkipped: 0 })).toBe("Updated 1 fee.");
    expect(applySummary({ applied: 4, staleSkipped: 2 })).toBe("Updated 4 fees. 2 skipped because they changed since the preview.");
  });
});
```

- [ ] **Step 2: Run** `npx jest dashboard/integrations/_lib/feeOverwriteSelection` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Client side of the eBay fee overwrite (FeeOverwriteModal). Mirrors the response
 * shapes of src/lib/integrations/ebay/feeOverwrite.ts without importing that
 * server-only module. Pure.
 */
export type OverwriteFeeField = "platform_fee" | "advertising_fee";
export interface FeeChangeDto {
  saleId: string; externalOrderId: string; currency: string; date: string;
  field: OverwriteFeeField; from: number | null; to: number;
}
export interface FeeOverwritePreviewDto { changes: FeeChangeDto[]; currencyMismatch: number; notImported: number }
export interface FeeCell { from: number | null; to: number }
export interface OverwriteRow {
  saleId: string; externalOrderId: string; currency: string; date: string;
  platform_fee?: FeeCell; advertising_fee?: FeeCell;
}

const FIELDS: OverwriteFeeField[] = ["platform_fee", "advertising_fee"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One row per sale (order line), both fee cells merged; first-seen order. */
export function groupOverwriteRows(changes: FeeChangeDto[]): OverwriteRow[] {
  const rows = new Map<string, OverwriteRow>();
  for (const ch of changes) {
    const r = rows.get(ch.saleId) ?? { saleId: ch.saleId, externalOrderId: ch.externalOrderId, currency: ch.currency, date: ch.date };
    r[ch.field] = { from: ch.from, to: ch.to };
    rows.set(ch.saleId, r);
  }
  return [...rows.values()];
}

/** The apply request body for the ticked rows. */
export function applyPayload(connectionId: string, rows: OverwriteRow[], selected: Set<string>) {
  const changes = rows
    .filter((r) => selected.has(r.saleId))
    .flatMap((r) => FIELDS.flatMap((field) => {
      const cell = r[field];
      return cell ? [{ saleId: r.saleId, field, from: cell.from, to: cell.to }] : [];
    }));
  return { connectionId, changes };
}

export function previewSkipNote(p: { currencyMismatch: number; notImported: number }): string | null {
  const parts: string[] = [];
  if (p.notImported > 0) parts.push(plural(p.notImported, "order not imported yet", "orders not imported yet"));
  if (p.currencyMismatch > 0) parts.push(plural(p.currencyMismatch, "fee in a different currency from its order", "fees in a different currency from their orders"));
  return parts.length ? `Not shown: ${parts.join(", ")}.` : null;
}

export function applySummary(r: { applied: number; staleSkipped: number }): string {
  const head = `Updated ${plural(r.applied, "fee", "fees")}.`;
  return r.staleSkipped > 0 ? `${head} ${r.staleSkipped} skipped because they changed since the preview.` : head;
}
```

- [ ] **Step 4: Run** `npx jest dashboard/integrations/_lib/feeOverwriteSelection` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations/_lib/feeOverwriteSelection.ts src/app/dashboard/integrations/_lib/feeOverwriteSelection.test.ts
git commit -m "feat(integrations): client helpers for eBay fee overwrite review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `FeeOverwriteModal` + `ConnectionCard` button

**Files:**
- Create: `src/app/dashboard/integrations/_components/FeeOverwriteModal.tsx`
- Modify: `src/app/dashboard/integrations/_components/ConnectionCard.tsx`

**Interfaces:**
- Consumes: Task 5 helpers/types; `canOverwriteEbayFees` (Task 3); `Modal`, `Button`, `DataTable`, `useToast`; `formatCurrency` (`@/lib/utils/currency`), `formatDate` (`@/lib/utils/date`); `integrationErrorMessage`.
- Produces: `<FeeOverwriteModal open connectionId accountName onClose />`.

- [ ] **Step 1: Create the modal**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { integrationErrorMessage } from "@/lib/utils/integrationErrors";
import type { Currency } from "@/types";
import {
  applyPayload, applySummary, groupOverwriteRows, previewSkipNote,
  type FeeCell, type FeeOverwritePreviewDto, type OverwriteRow,
} from "../_lib/feeOverwriteSelection";

interface FeeOverwriteModalProps {
  open: boolean;
  connectionId: string;
  accountName: string;
  onClose: () => void;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: FeeOverwritePreviewDto };

function Cell({ cell, currency, current }: { cell?: FeeCell; currency: string; current?: number | null }) {
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatCurrency(n, currency as Currency));
  if (!cell) return <span className="text-[var(--color-text-muted)]">{fmt(current)}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--color-text-muted)] line-through">{fmt(cell.from)}</span>
      {" → "}
      <span className="font-semibold text-[var(--color-text-strong)]">{fmt(cell.to)}</span>
    </span>
  );
}

export function FeeOverwriteModal({ open, connectionId, accountName, onClose }: FeeOverwriteModalProps) {
  const { success, error: toastError } = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/integrations/ebay/fees/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId }),
        });
        const json = (await res.json().catch(() => ({}))) as FeeOverwritePreviewDto & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoad({ status: "error", message: integrationErrorMessage(json.error, json.error ?? "Please try again.") });
          return;
        }
        setLoad({ status: "ready", preview: json });
        setSelected(new Set(json.changes.map((c) => c.saleId)));
      } catch {
        if (!cancelled) setLoad({ status: "error", message: "Couldn't load fees from eBay. Please try again." });
      }
    })();
    return () => { cancelled = true; };
  }, [open, connectionId]);

  const rows = useMemo(() => (load.status === "ready" ? groupOverwriteRows(load.preview.changes) : []), [load]);

  async function handleApply() {
    setApplying(true);
    try {
      const res = await fetch("/api/integrations/ebay/fees/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyPayload(connectionId, rows, selected)),
      });
      const json = (await res.json().catch(() => ({}))) as { applied?: number; staleSkipped?: number; error?: string };
      if (!res.ok) {
        toastError("Couldn't update fees", integrationErrorMessage(json.error, json.error ?? "Please try again."));
        return; // keep the modal and selection so the user can retry
      }
      success("Fees updated from eBay", applySummary({ applied: json.applied ?? 0, staleSkipped: json.staleSkipped ?? 0 }));
      onClose();
    } catch {
      toastError("Couldn't update fees", "Please try again.");
    } finally {
      setApplying(false);
    }
  }

  const ready = load.status === "ready";
  const hasChanges = ready && rows.length > 0;
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={applying}>
        {hasChanges ? "Cancel" : "Close"}
      </Button>
      {hasChanges && (
        <Button onClick={handleApply} disabled={applying || selected.size === 0}>
          {applying ? "Applying…" : `Apply ${selected.size} ${selected.size === 1 ? "order" : "orders"}`}
        </Button>
      )}
    </>
  );

  return (
    <Modal title={`Overwrite fees from eBay — ${accountName}`} open={open} onClose={onClose} footer={footer}>
      {load.status === "loading" && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Checking eBay…
        </p>
      )}
      {load.status === "error" && <p className="text-sm text-[var(--color-danger-text)]">{load.message}</p>}
      {ready && (
        <div className="space-y-4">
          <p className="text-sm">
            These orders&apos; fees differ from eBay (last 90 days). Ticked orders get eBay&apos;s values; untick any you want to keep.
          </p>
          <DataTable<OverwriteRow>
            rows={rows}
            keyField="saleId"
            selectedIds={selected}
            onSelectionChange={setSelected}
            emptyMessage="All fees already match eBay."
            columns={[
              { header: "Order", accessor: "externalOrderId" },
              { header: "Date", render: (r) => formatDate(r.date), sortValue: (r) => r.date },
              { header: "Platform Fee", render: (r) => <Cell cell={r.platform_fee} currency={r.currency} /> },
              { header: "Ad Fee", render: (r) => <Cell cell={r.advertising_fee} currency={r.currency} /> },
            ]}
          />
          {previewSkipNote(load.preview) && (
            <p className="text-xs text-[var(--color-text-muted)]">{previewSkipNote(load.preview)}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
```

Note: a row only carries the fields that change; an unchanged field shows "—" (the preview doesn't return unchanged values). That's acceptable for v1 — the column header makes it clear only changes are listed; don't widen the API for it.

- [ ] **Step 2: Wire the button into `ConnectionCard.tsx`**

Add imports:

```tsx
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { canOverwriteEbayFees } from "@/lib/utils/feeOverwriteAccess";
import { FeeOverwriteModal } from "./FeeOverwriteModal";
```

Add state/selector inside the component, next to `syncingCharges`:

```tsx
const [overwriteOpen, setOverwriteOpen] = useState(false);
const canOverwriteFees = canOverwriteEbayFees(useAppSelector((s) => s.currentUser.profile?.role));
```

Right after the "Sync eBay charges" button block:

```tsx
{platform === "ebay" && state === "active" && canOverwriteFees && (
  <Button size="sm" variant="secondary" onClick={() => setOverwriteOpen(true)}>
    Overwrite fees from eBay
  </Button>
)}
```

Next to `<DeleteConfirmModal …/>`:

```tsx
{overwriteOpen && (
  <FeeOverwriteModal open connectionId={id} accountName={displayName} onClose={() => setOverwriteOpen(false)} />
)}
```

(Mount only when open so each opening re-fetches a fresh preview.)

- [ ] **Step 3: Run the integration feature tests**

Run: `npx jest dashboard/integrations src/lib/utils/feeOverwriteAccess`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Ask the user (`npm run dev` already running, or Playwright MCP if connected) to:
1. As `super_admin`, open Integrations → active eBay card → "Overwrite fees from eBay"; see the spinner then the table.
2. Untick one order, Apply → toast "Updated N fees."; open that order in Orders and check the fee changed; the unticked order is unchanged.
3. Re-open → the applied orders no longer appear.
4. As `admin`, confirm the button is absent.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations/_components/FeeOverwriteModal.tsx src/app/dashboard/integrations/_components/ConnectionCard.tsx
git commit -m "feat(integrations): super_admin review-and-apply modal for eBay fee overwrite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs + spec deviations

**Files:**
- Modify: `src/app/dashboard/integrations/CLAUDE.md`, `src/app/dashboard/integrations/SKILL.md`, `src/lib/integrations/SKILL.md`, `docs/superpowers/specs/2026-10-21-ebay-fee-overwrite-design.md`

- [ ] **Step 1: `integrations/CLAUDE.md`**
  - `ConnectionCard.tsx` bullet: add "super_admin-only 'Overwrite fees from eBay' (active eBay accounts; `canOverwriteEbayFees`) opening `FeeOverwriteModal`".
  - New bullets: `_components/FeeOverwriteModal.tsx` (POST preview on open, `DataTable` selection, POST apply, toasts, keeps selection on failure); `_lib/feeOverwriteSelection.ts` (+ test).
  - API routes: `/api/integrations/ebay/fees/preview` and `/apply` with request/response shapes and error codes.
  - Tests line: add the new test files.

- [ ] **Step 2: `integrations/SKILL.md`** — minimal file set "Change the fee overwrite" (`feeOverwrite.ts`, `feeOverwriteApply.ts`, the two routes, the modal, `feeOverwriteSelection.ts`) and a Gotcha: "Overwrite is the ONLY path that replaces a non-null order fee; it never clears one, and apply is compare-and-set on the previewed value (stale rows are skipped, not overwritten)."

- [ ] **Step 3: `src/lib/integrations/SKILL.md`** — under "Gotchas — Finances": the overwrite reuses `feesByLineItem`/`orderLinkedChargeFees` (so it can never disagree with charge sync), SALE ad fee precedence, no `connection_id` filter on writes (legacy rows), `requireIntegrationSuperAdmin`.

- [ ] **Step 4: Spec** — append a "Revisions (planning)" section recording the two spec deviations from this plan's header.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations/CLAUDE.md src/app/dashboard/integrations/SKILL.md src/lib/integrations/SKILL.md docs/superpowers/specs/2026-10-21-ebay-fee-overwrite-design.md
git commit -m "docs(integrations): document super_admin eBay fee overwrite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Project rule says docs ship in the same commit as code. If the reviewer insists, squash Task 7 into Task 6's commit before pushing.)
