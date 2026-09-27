# Advanced Inventory — Phase 4 (Transfers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Business tenants move stock between their own locations from a new **Transfers** tab on the Inventory page. The tab has a paginated history, a **Transfer stock** modal that previews exactly which batches move and what they cost at the destination, and delete-to-undo.

**Architecture:** UI only. The ledger side (the `stock_transfers` table, its INSERT/DELETE triggers, `INV_INSUFFICIENT`/`INV_DROPSHIP_LOCATION`/`INV_CONSUMED`, RLS and grants) shipped in Phase 1's installer (`047`) and is live on every tenant, so this phase adds **no migration**. A pure `_lib/transfers.ts` mirrors the trigger's FIFO and transfer-cost maths for the preview, and also holds the form validation and payload. A small `transfersSlice` pages the history. Two thin components, `TransfersTab` and `TransferStockModal`, are wired into the existing tab shell.

**Tech Stack:** Next.js App Router client components, Redux Toolkit, Supabase JS, Jest.

**Spec:** `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md`, specifically the "Transfers" trigger section, "UI → Inventory page → Transfers", "Audit" and "Phasing" item 4.
**Builds on:** Phases 1–3 (#109, #110, #111), all merged. `049` was verified applied on all 5 tenants on 2026-09-26.

## Global Constraints

- Branch `feat/advanced-inventory-phase-4` (already created from `main`). Never commit to `main`.
- The Transfers tab exists only when the advanced view is `"active"`. Starter/Pro and not-yet-enabled tenants see no change.
- **Admins only** (`admin`/`super_admin`) may record or delete transfers in the UI. RLS lets any tenant member insert or delete, so the restriction is a UI rule, as in the spec. Non-admins see the history read-only.
- Transfer locations: **active, non-dropship** only, for both ends. The trigger rejects dropship ends with `INV_DROPSHIP_LOCATION`. The source defaults to `inventory_settings.default_location_id`, and the destination starts empty.
- The preview mirrors `inv_transfer_after_insert` (047) exactly:
  - it consumes source lots with `kind <> 'shortfall' AND qty_remaining > 0`, in FIFO order `received_at, created_at, id`;
  - per-unit add-on = `round(transfer_cost / quantity, 4)` (0 when there is no cost);
  - destination unit cost = `source unit_cost + add-on`.
- Insufficient source stock **blocks** the transfer. The form is invalid when quantity > available, and the DB raises `INV_INSUFFICIENT` anyway. This is unlike sales, which never block.
- Transfers are immutable (the trigger raises `INV_TRANSFER_IMMUTABLE`), so there is no edit UI. Delete is allowed only while every destination batch is untouched; otherwise the trigger raises `INV_CONSUMED`. Deletes go through `DeleteConfirmModal`.
- Never show a raw Postgres error: `inventoryErrorMessage(err, fallback)` from `@/lib/inventory/inventoryErrors`.
- Every mutation: try/catch/finally, so the button never stays stuck busy. Toast on success AND failure. The post-success audit write (`entityType: "stock_transfer"`) goes in its own error-swallowing try/catch. RLS no-op deletes are detected with `.select("id")`.
- Supabase checklist:
  - the history is a page the user moves through: `.select(…, { count: "exact" }).range()` via `rangeFor`;
  - source lots for one (product, location) are read with `fetchAllRowsOrThrow`, capped at `PRODUCT_LOTS_CAP`;
  - the product list comes from `s.inventory.selectorItems`, which is already hydrated by `StoreProvider`.
- React: this repo's eslint treats `react-hooks/set-state-in-effect` as an **error**. Async results loaded in an effect are stored keyed by their request key, guarded with a `cancelled` flag, and derived at render. Never reset them with a synchronous setState in the effect body; `ProductLotsModal.tsx` is the reference. Don't call a `useCallback` that sets state from an effect.
- Form conventions (AGENTS.md):
  - a real `<form id>`;
  - `required` on both the `<Field>` and the control;
  - `type="submit" form=…`;
  - `disabled={saving || !isFormValid}`;
  - the busy verb "Transferring…".
- UI conventions: tokens only, one primary button per view, `emptyMessage` on every `DataTable`, `aria-label` on every icon button.
- Tests: pure logic lives in `_lib/`, and reducers in the slice test. Components aren't unit-tested in this project. Run focused `npx jest <paths>`. Don't run tsc/lint by hand; pre-commit does it. No dev server: browser checks happen only through a connected Playwright MCP against an already-running dev server; otherwise list manual checks in the report.
- SQL: none in this phase. Agents must NOT run SQL. The `supabase-data` MCP is read-only, and the user runs SQL.
- Docs: update the touched feature's `CLAUDE.md`/`SKILL.md` in the same commit as the code (AGENTS.md). Task 5 reconciles them.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/dashboard/inventory/_lib/transfers.ts` (+ test) | Pure: FIFO preview, cost add-on, location options, draft validation, insert payload, page-after-delete |
| `src/app/dashboard/inventory/_store/productLots.ts` (modify) | + `fetchAvailableLots(productId, locationId)` |
| `src/app/dashboard/inventory/_store/transfersSlice.ts` (+ test) | Paginated history: `fetchTransfersPage` |
| `src/store/store.ts` (modify) | Register `stockTransfers` reducer |
| `src/app/dashboard/inventory/_components/TransferStockModal.tsx` | Form + live batch preview + insert + audit |
| `src/app/dashboard/inventory/_components/TransfersTab.tsx` | History table, pagination, delete |
| `src/app/dashboard/inventory/_components/InventoryTabs.tsx` (modify) | `InventoryTabId` gains `"transfers"` |
| `src/app/dashboard/inventory/page.tsx` (modify) | Third tab, header button, `stockVersion` refresh |
| `src/app/dashboard/inventory/_components/{ProductsTab,LocationsTab}.tsx` (modify) | Accept `stockVersion` so stock re-fetches after a transfer |
| Docs | inventory `CLAUDE.md`/`SKILL.md`, `supabase/SKILL.md` (049 row), spec phasing note |

---

### Task 1: Pure transfer logic + source-lot fetcher

**Files:**
- Create: `src/app/dashboard/inventory/_lib/transfers.ts`
- Create: `src/app/dashboard/inventory/_lib/transfers.test.ts`
- Modify: `src/app/dashboard/inventory/_store/productLots.ts`
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`

**Interfaces:**
- Consumes:
  - `sortLotsFifo(lots: StockLot[]): StockLot[]` from `../_lib/productLots`;
  - `defaultLocationOptions(locations: StockLocation[]): StockLocation[]` (active + non-dropship, sorted by name) from `../_lib/advancedInventory`;
  - `fetchAllRowsOrThrow`;
  - `PRODUCT_LOTS_CAP`;
  - types `StockLot`, `StockLocation`, `StockTransfer` from `@/types`.
- Produces (exact names used by Tasks 3–4):
  - `transferCostAddon(transferCost: number | null, quantity: number): number`
  - `interface TransferPortion { lot: StockLot; take: number; sourceUnitCost: number; destUnitCost: number }`
  - `interface TransferPreview { available: number; portions: TransferPortion[]; movedQty: number; shortBy: number; addon: number; movedCost: number; destAvgUnitCost: number | null }`
  - `fifoPreview(lots: StockLot[], quantity: number, transferCost: number | null): TransferPreview`
  - `transferLocationOptions(locations: StockLocation[]): StockLocation[]`
  - `interface TransferDraft { productId: string; fromLocationId: string; toLocationId: string; quantity: string; transferCost: string; date: string; note: string }`
  - `emptyTransferDraft(defaultLocationId: string | null, today: string): TransferDraft`
  - `parseTransferQuantity(raw: string): number | null`
  - `parseTransferCost(raw: string): { valid: boolean; value: number | null }`
  - `transferDraftError(draft: TransferDraft, locations: StockLocation[], available: number | null): string | null`
  - `transferInsertPayload(draft: TransferDraft, userId: string): Omit<StockTransfer, "id" | "created_at">`
  - `pageAfterRemoval(page: number, pageSize: number, totalBefore: number): number`
  - `fetchAvailableLots(productId: string, locationId: string): Promise<StockLot[]>` (in `_store/productLots.ts`)

- [ ] **Step 1: Write the failing test** at `src/app/dashboard/inventory/_lib/transfers.test.ts`

```ts
import {
  emptyTransferDraft,
  fifoPreview,
  pageAfterRemoval,
  parseTransferCost,
  parseTransferQuantity,
  transferCostAddon,
  transferDraftError,
  transferInsertPayload,
  transferLocationOptions,
  type TransferDraft,
} from "./transfers";
import type { StockLocation, StockLot } from "@/types";

const lot = (id: string, overrides: Partial<StockLot> = {}): StockLot => ({
  id,
  product_id: "p1",
  location_id: "main",
  purchase_id: null,
  source_lot_id: null,
  kind: "purchase",
  received_at: "2026-09-01T00:00:00.000Z",
  cost_addon: 0,
  unit_cost: 10,
  qty_received: 5,
  qty_remaining: 5,
  created_at: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id,
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const locations = [loc("main"), loc("fba", { type: "fba" }), loc("drop", { type: "dropship" }), loc("old", { is_active: false })];

const draft = (overrides: Partial<TransferDraft> = {}): TransferDraft => ({
  productId: "p1",
  fromLocationId: "main",
  toLocationId: "fba",
  quantity: "3",
  transferCost: "",
  date: "2026-09-26",
  note: "",
  ...overrides,
});

describe("transferCostAddon", () => {
  it("is 0 without a cost", () => {
    expect(transferCostAddon(null, 3)).toBe(0);
    expect(transferCostAddon(0, 3)).toBe(0);
  });
  it("rounds cost per unit to 4 decimals like the trigger", () => {
    expect(transferCostAddon(10, 3)).toBe(3.3333);
    expect(transferCostAddon(5, 2)).toBe(2.5);
  });
  it("is 0 for a non-positive quantity", () => {
    expect(transferCostAddon(10, 0)).toBe(0);
  });
});

describe("fifoPreview", () => {
  it("takes from one lot when it covers the quantity", () => {
    const p = fifoPreview([lot("a")], 3, null);
    expect(p.available).toBe(5);
    expect(p.portions.map((x) => [x.lot.id, x.take, x.sourceUnitCost, x.destUnitCost])).toEqual([["a", 3, 10, 10]]);
    expect(p.movedQty).toBe(3);
    expect(p.shortBy).toBe(0);
    expect(p.movedCost).toBe(30);
    expect(p.destAvgUnitCost).toBe(10);
  });

  it("splits across lots oldest first (received_at, then created_at, then id)", () => {
    const lots = [
      lot("new", { received_at: "2026-09-10T00:00:00.000Z", unit_cost: 20, qty_remaining: 4 }),
      lot("old-b", { unit_cost: 12, qty_remaining: 1, created_at: "2026-09-02T00:00:00.000Z" }),
      lot("old-a", { unit_cost: 10, qty_remaining: 2 }),
    ];
    const p = fifoPreview(lots, 5, null);
    expect(p.portions.map((x) => [x.lot.id, x.take])).toEqual([["old-a", 2], ["old-b", 1], ["new", 2]]);
    expect(p.movedCost).toBe(2 * 10 + 12 + 2 * 20);
    expect(p.destAvgUnitCost).toBe(14.4);
  });

  it("adds the per-unit transfer cost share to every portion", () => {
    const p = fifoPreview([lot("a", { unit_cost: 10, qty_remaining: 2 }), lot("b", { unit_cost: 11, received_at: "2026-09-05T00:00:00.000Z" })], 3, 10);
    expect(p.addon).toBe(3.3333);
    expect(p.portions.map((x) => x.destUnitCost)).toEqual([13.3333, 14.3333]);
    expect(p.movedCost).toBe(41);
    expect(p.destAvgUnitCost).toBe(13.6666);
  });

  it("ignores shortfall and empty lots, and reports the shortage", () => {
    const lots = [lot("s", { kind: "shortfall", qty_remaining: -2, qty_received: 0 }), lot("z", { qty_remaining: 0 }), lot("a", { qty_remaining: 2 })];
    const p = fifoPreview(lots, 5, null);
    expect(p.available).toBe(2);
    expect(p.movedQty).toBe(2);
    expect(p.shortBy).toBe(3);
  });

  it("has no average when nothing moves", () => {
    const p = fifoPreview([], 3, null);
    expect(p.portions).toEqual([]);
    expect(p.destAvgUnitCost).toBeNull();
    expect(p.shortBy).toBe(3);
  });

  it("treats a zero or negative quantity as nothing to move", () => {
    const p = fifoPreview([lot("a")], 0, 5);
    expect(p.portions).toEqual([]);
    expect(p.shortBy).toBe(0);
    expect(p.addon).toBe(0);
  });

  it("accepts numeric strings for unit_cost (PostgREST numeric)", () => {
    const p = fifoPreview([lot("a", { unit_cost: "9.5" as unknown as number })], 2, null);
    expect(p.portions[0].sourceUnitCost).toBe(9.5);
    expect(p.movedCost).toBe(19);
  });
});

describe("transferLocationOptions", () => {
  it("keeps active, non-dropship locations sorted by name", () => {
    expect(transferLocationOptions(locations).map((l) => l.id)).toEqual(["fba", "main"]);
  });
});

describe("emptyTransferDraft", () => {
  it("defaults the source to the tenant default and the date to today", () => {
    expect(emptyTransferDraft("main", "2026-09-26")).toEqual(draft({ productId: "", toLocationId: "", quantity: "" }));
  });
  it("leaves the source empty when there is no default", () => {
    expect(emptyTransferDraft(null, "2026-09-26").fromLocationId).toBe("");
  });
});

describe("parseTransferQuantity", () => {
  it("accepts positive whole numbers", () => {
    expect(parseTransferQuantity("3")).toBe(3);
    expect(parseTransferQuantity(" 12 ")).toBe(12);
  });
  it("rejects empty, zero, negative and fractional values", () => {
    for (const raw of ["", "0", "-1", "1.5", "abc"]) expect(parseTransferQuantity(raw)).toBeNull();
  });
});

describe("parseTransferCost", () => {
  it("treats empty as no cost", () => {
    expect(parseTransferCost("  ")).toEqual({ valid: true, value: null });
  });
  it("parses and rounds to cents", () => {
    expect(parseTransferCost("12.346")).toEqual({ valid: true, value: 12.35 });
    expect(parseTransferCost("0")).toEqual({ valid: true, value: 0 });
  });
  it("rejects negative and non-numeric input", () => {
    expect(parseTransferCost("-1").valid).toBe(false);
    expect(parseTransferCost("x").valid).toBe(false);
  });
});

describe("transferDraftError", () => {
  it("is null for a complete draft within availability", () => {
    expect(transferDraftError(draft(), locations, 5)).toBeNull();
  });
  it("skips the availability check while availability is unknown", () => {
    expect(transferDraftError(draft({ quantity: "50" }), locations, null)).toBeNull();
  });
  it.each([
    [{ productId: "" }, "Choose a product."],
    [{ fromLocationId: "" }, "Choose where the stock comes from."],
    [{ toLocationId: "" }, "Choose where the stock goes."],
    [{ fromLocationId: "drop" }, "Choose where the stock comes from."],
    [{ toLocationId: "old" }, "Choose where the stock goes."],
    [{ toLocationId: "main" }, "The source and destination must be different locations."],
    [{ quantity: "1.5" }, "Enter a whole number of units, 1 or more."],
    [{ transferCost: "-2" }, "The transfer cost can't be negative."],
    [{ date: "" }, "Choose a date."],
  ])("reports %o", (overrides, message) => {
    expect(transferDraftError(draft(overrides), locations, 5)).toBe(message);
  });
  it("blocks more units than the source has", () => {
    expect(transferDraftError(draft({ quantity: "6" }), locations, 5)).toBe("Only 5 units are available at the source location.");
    expect(transferDraftError(draft({ quantity: "2" }), locations, 1)).toBe("Only 1 unit is available at the source location.");
  });
});

describe("transferInsertPayload", () => {
  it("builds the row the trigger expects", () => {
    expect(transferInsertPayload(draft({ transferCost: "7.5", note: "  pallet 4 " }), "u1")).toEqual({
      product_id: "p1",
      from_location_id: "main",
      to_location_id: "fba",
      quantity: 3,
      transfer_cost: 7.5,
      date: "2026-09-26",
      note: "pallet 4",
      created_by: "u1",
    });
  });
  it("sends null for an empty cost and note", () => {
    const p = transferInsertPayload(draft(), "u1");
    expect(p.transfer_cost).toBeNull();
    expect(p.note).toBeNull();
  });
});

describe("pageAfterRemoval", () => {
  it("stays on the page when rows remain", () => {
    expect(pageAfterRemoval(2, 50, 75)).toBe(2);
  });
  it("steps back when the last row of the last page goes", () => {
    expect(pageAfterRemoval(2, 50, 51)).toBe(1);
  });
  it("never goes below page 1", () => {
    expect(pageAfterRemoval(1, 50, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/app/dashboard/inventory/_lib/transfers.test.ts`
Expected: FAIL with "Cannot find module './transfers'".

- [ ] **Step 3: Implement** `src/app/dashboard/inventory/_lib/transfers.ts`

```ts
import type { StockLocation, StockLot, StockTransfer } from "@/types";
import { defaultLocationOptions } from "./advancedInventory";
import { sortLotsFifo } from "./productLots";

/**
 * Pure logic behind the Transfers tab and the Transfer stock modal. The
 * preview mirrors inv_transfer_after_insert (047): FIFO over the source
 * location's non-shortfall lots with units left, a per-unit add-on of
 * round(transfer_cost / quantity, 4), destination unit cost = source unit
 * cost + add-on. Keep the two in sync.
 */

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function transferCostAddon(transferCost: number | null, quantity: number): number {
  if (!transferCost || quantity <= 0) return 0;
  return round(transferCost / quantity, 4);
}

export interface TransferPortion {
  lot: StockLot;
  take: number;
  sourceUnitCost: number;
  destUnitCost: number;
}

export interface TransferPreview {
  /** Units the source can give (shortfall and empty lots excluded). */
  available: number;
  portions: TransferPortion[];
  movedQty: number;
  /** Units asked for beyond what's available — the trigger would reject the transfer. */
  shortBy: number;
  addon: number;
  /** Total landed value arriving at the destination, rounded to cents. */
  movedCost: number;
  /** Weighted unit cost at the destination (4 dp), or null when nothing moves. */
  destAvgUnitCost: number | null;
}

export function fifoPreview(lots: StockLot[], quantity: number, transferCost: number | null): TransferPreview {
  const usable = sortLotsFifo(lots.filter((l) => l.kind !== "shortfall" && l.qty_remaining > 0));
  const available = usable.reduce((sum, l) => sum + l.qty_remaining, 0);
  const wanted = quantity > 0 ? quantity : 0;
  const addon = transferCostAddon(transferCost, wanted);

  const portions: TransferPortion[] = [];
  let remaining = wanted;
  let cost = 0;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.qty_remaining, remaining);
    const sourceUnitCost = Number(lot.unit_cost);
    const destUnitCost = round(sourceUnitCost + addon, 4);
    portions.push({ lot, take, sourceUnitCost, destUnitCost });
    cost += take * destUnitCost;
    remaining -= take;
  }

  const movedQty = wanted - remaining;
  return {
    available,
    portions,
    movedQty,
    shortBy: remaining,
    addon,
    movedCost: round(cost, 2),
    destAvgUnitCost: movedQty > 0 ? round(cost / movedQty, 4) : null,
  };
}

/** Both ends of a transfer must hold stock: active and not dropship. */
export function transferLocationOptions(locations: StockLocation[]): StockLocation[] {
  return defaultLocationOptions(locations);
}

export interface TransferDraft {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  transferCost: string;
  date: string;
  note: string;
}

export function emptyTransferDraft(defaultLocationId: string | null, today: string): TransferDraft {
  return {
    productId: "",
    fromLocationId: defaultLocationId ?? "",
    toLocationId: "",
    quantity: "",
    transferCost: "",
    date: today,
    note: "",
  };
}

export function parseTransferQuantity(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

export function parseTransferCost(raw: string): { valid: boolean; value: number | null } {
  const t = raw.trim();
  if (t === "") return { valid: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { valid: false, value: null };
  return { valid: true, value: round(n, 2) };
}

/**
 * The first reason the draft can't be submitted, or null. `available` is
 * the source's usable units from the preview; null while it is loading or
 * failed to load — then the DB's INV_INSUFFICIENT is the only guard.
 */
export function transferDraftError(
  draft: TransferDraft,
  locations: StockLocation[],
  available: number | null,
): string | null {
  const options = new Set(transferLocationOptions(locations).map((l) => l.id));
  if (!draft.productId) return "Choose a product.";
  if (!options.has(draft.fromLocationId)) return "Choose where the stock comes from.";
  if (!options.has(draft.toLocationId)) return "Choose where the stock goes.";
  if (draft.fromLocationId === draft.toLocationId) return "The source and destination must be different locations.";
  const qty = parseTransferQuantity(draft.quantity);
  if (qty === null) return "Enter a whole number of units, 1 or more.";
  if (!parseTransferCost(draft.transferCost).valid) return "The transfer cost can't be negative.";
  if (!draft.date) return "Choose a date.";
  if (available !== null && qty > available) {
    return `Only ${available} ${available === 1 ? "unit is" : "units are"} available at the source location.`;
  }
  return null;
}

/** Call only when transferDraftError(...) is null. */
export function transferInsertPayload(
  draft: TransferDraft,
  userId: string,
): Omit<StockTransfer, "id" | "created_at"> {
  return {
    product_id: draft.productId,
    from_location_id: draft.fromLocationId,
    to_location_id: draft.toLocationId,
    quantity: parseTransferQuantity(draft.quantity) ?? 0,
    transfer_cost: parseTransferCost(draft.transferCost).value,
    date: draft.date,
    note: draft.note.trim() || null,
    created_by: userId,
  };
}

/** The page to show after deleting one row, so the last page never ends up empty. */
export function pageAfterRemoval(page: number, pageSize: number, totalBefore: number): number {
  const lastPage = Math.ceil(Math.max(0, totalBefore - 1) / pageSize);
  return Math.max(1, Math.min(page, lastPage));
}
```

Note on `destAvgUnitCost`: it is display-only (the DB stores each lot's own `unit_cost`). In the transfer-cost test, cost = 2 × 13.3333 + 14.3333 = 40.9999, so the average rounds to 13.6666 and `movedCost` rounds to 41.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/app/dashboard/inventory/_lib/transfers.test.ts`
Expected: PASS. If `StockLot` has fields the `lot()` factory doesn't set, or lacks `cost_addon`, adjust the factory to match `src/types/index.ts`, where `StockLot` is defined around line 238. Don't change the type.

- [ ] **Step 5: Add the source-lot fetcher** to `src/app/dashboard/inventory/_store/productLots.ts`, appended below `fetchOpenLots`:

```ts
/**
 * The batches a transfer can draw from: one product at one location with
 * units left, never the shortfall lot — the same set, in the same FIFO
 * order, that inv_transfer_after_insert (047) consumes. Feeds fifoPreview.
 */
export async function fetchAvailableLots(productId: string, locationId: string): Promise<StockLot[]> {
  const supabase = await createTenantClient();
  try {
    return await fetchAllRowsOrThrow<StockLot>(
      async (from, to) =>
        await supabase
          .from("stock_lots")
          .select("*", { count: "exact" })
          .eq("product_id", productId)
          .eq("location_id", locationId)
          .neq("kind", "shortfall")
          .gt("qty_remaining", 0)
          .order("received_at", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      PRODUCT_LOTS_CAP,
    );
  } catch (e) {
    throw new Error(inventoryErrorMessage(e, "Could not load the stock at this location."));
  }
}
```

- [ ] **Step 6: Docs.** In `src/app/dashboard/inventory/CLAUDE.md`'s file map, add `_lib/transfers.ts` (+ test), which holds the pure transfer preview, validation and payload and mirrors `inv_transfer_after_insert`, and note `fetchAvailableLots` next to `fetchOpenLots`. In `SKILL.md`, add a gotcha: "The transfer preview in `_lib/transfers.ts` mirrors 047's `inv_transfer_after_insert` (FIFO order, shortfall exclusion, `round(cost/qty, 4)` add-on). Change both together."

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/inventory/_lib/transfers.ts src/app/dashboard/inventory/_lib/transfers.test.ts src/app/dashboard/inventory/_store/productLots.ts src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md
git commit -m "feat(inventory): pure transfer preview, validation and source-lot fetch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Transfers history slice

**Files:**
- Create: `src/app/dashboard/inventory/_store/transfersSlice.ts`
- Create: `src/app/dashboard/inventory/_store/transfersSlice.test.ts`
- Modify: `src/store/store.ts`
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`

**Interfaces:**
- Consumes: `rangeFor`, `DEFAULT_PAGE_SIZE` from `@/lib/utils/pagedQuery`; `createTenantClient` from `@/lib/supabase/client`; `inventoryErrorMessage`; `StockTransfer` from `@/types`.
- Produces:
  - `interface StockTransferRow extends StockTransfer { product_name: string | null }`
  - `transfersSlice` (registered as `state.stockTransfers`), with state `{ items: StockTransferRow[]; page: number; pageSize: number; total: number; loaded: boolean; isFetching: boolean; error: string | null }`
  - `fetchTransfersPage({ page: number; pageSize: number })`, which fulfils with `{ data: StockTransferRow[]; count: number; page: number; pageSize: number }`

- [ ] **Step 1: Write the failing test** at `src/app/dashboard/inventory/_store/transfersSlice.test.ts`

```ts
import { fetchTransfersPage, transfersSlice, type StockTransferRow } from "./transfersSlice";

const { reducer } = transfersSlice;

const row = (id: string): StockTransferRow => ({
  id,
  product_id: "p1",
  product_name: "Mug",
  from_location_id: "main",
  to_location_id: "fba",
  quantity: 2,
  transfer_cost: null,
  date: "2026-09-26",
  note: null,
  created_by: "u1",
  created_at: "2026-09-26T10:00:00.000Z",
});

describe("transfersSlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      loaded: false,
      isFetching: false,
      error: null,
    });
  });

  it("marks a fetch in flight and clears the last error", () => {
    const failed = { ...reducer(undefined, { type: "@@INIT" }), error: "boom" };
    const s = reducer(failed, { type: fetchTransfersPage.pending.type });
    expect(s.isFetching).toBe(true);
    expect(s.error).toBeNull();
  });

  it("stores a fetched page", () => {
    const s = reducer(undefined, {
      type: fetchTransfersPage.fulfilled.type,
      payload: { data: [row("t1")], count: 51, page: 2, pageSize: 50 },
    });
    expect(s).toEqual({ items: [row("t1")], page: 2, pageSize: 50, total: 51, loaded: true, isFetching: false, error: null });
  });

  it("keeps the rows it has when a fetch fails", () => {
    const loaded = reducer(undefined, {
      type: fetchTransfersPage.fulfilled.type,
      payload: { data: [row("t1")], count: 1, page: 1, pageSize: 50 },
    });
    const s = reducer(loaded, { type: fetchTransfersPage.rejected.type, error: { message: "Could not load transfers." } });
    expect(s.items).toEqual([row("t1")]);
    expect(s.isFetching).toBe(false);
    expect(s.error).toBe("Could not load transfers.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/app/dashboard/inventory/_store/transfersSlice.test.ts`
Expected: FAIL with "Cannot find module './transfersSlice'".

- [ ] **Step 3: Implement** `src/app/dashboard/inventory/_store/transfersSlice.ts`

```ts
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import { DEFAULT_PAGE_SIZE, rangeFor } from "@/lib/utils/pagedQuery";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import type { StockTransfer } from "@/types";

/** A transfer as the history table shows it — product name embedded via the product_id FK. */
export interface StockTransferRow extends StockTransfer {
  product_name: string | null;
}

interface TransfersState {
  items: StockTransferRow[];
  page: number;
  pageSize: number;
  total: number;
  loaded: boolean;
  isFetching: boolean;
  error: string | null;
}

const initialState: TransfersState = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  loaded: false,
  isFetching: false,
  error: null,
};

type TransferWithProduct = StockTransfer & { products: { name: string } | null };

/** Newest first. Transfers grow with the business, so always paged. */
export const fetchTransfersPage = createAsyncThunk(
  "stockTransfers/fetchPage",
  async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const supabase = await createTenantClient();
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await supabase
      .from("stock_transfers")
      .select("*, products(name)", { count: "exact" })
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(inventoryErrorMessage(error, "Could not load transfers."));
    const rows = ((data ?? []) as TransferWithProduct[]).map(({ products, ...t }) => ({
      ...t,
      product_name: products?.name ?? null,
    }));
    return { data: rows, count: count ?? 0, page, pageSize };
  },
);

export const transfersSlice = createSlice({
  name: "stockTransfers",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransfersPage.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchTransfersPage.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.total = action.payload.count;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchTransfersPage.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message ?? "Could not load transfers.";
      });
  },
});
```

- [ ] **Step 4: Register the reducer** in `src/store/store.ts`. Add the import `import { transfersSlice } from "@/app/dashboard/inventory/_store/transfersSlice";` next to the `advancedInventorySlice` import, and the key `stockTransfers: transfersSlice.reducer,` directly below `advancedInventory: advancedInventorySlice.reducer,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/dashboard/inventory/_store/transfersSlice.test.ts`
Expected: PASS.

- [ ] **Step 6: Docs.** Add `_store/transfersSlice.ts` (+ test, `state.stockTransfers`, `fetchTransfersPage`, product name embedded via `products(name)`) to `inventory/CLAUDE.md`'s file map and its data-flow section. Also add it to the list of paged tables if that doc keeps one.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/inventory/_store/transfersSlice.ts src/app/dashboard/inventory/_store/transfersSlice.test.ts src/store/store.ts src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md
git commit -m "feat(inventory): paged stock transfer history slice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Transfer stock modal with live batch preview

**Files:**
- Create: `src/app/dashboard/inventory/_components/TransferStockModal.tsx`
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`

**Interfaces:**
- Consumes:
  - from Task 1: `fifoPreview`, `transferLocationOptions`, `emptyTransferDraft`, `parseTransferQuantity`, `parseTransferCost`, `transferDraftError`, `transferInsertPayload`, `TransferDraft`, and `fetchAvailableLots`;
  - `lotSourceLabel`, `lotReceivedLabel` (`../_lib/productLots`);
  - `useAdvancedInventory()`, which returns `{ locations, settings, … }`;
  - `s.inventory.selectorItems`, typed `ProductSelector[]` (`{ id, name, current_stock, sku? }`);
  - `writeAuditLog`, `addAuditLog`, `useToast`, `Modal`, `Button`, `DataTable`, `Field`/`Input`/`Select`/`Textarea`/`Row` from `@/components/ui/FormFields`.
- Produces: `TransferStockModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void })`. The parent remounts it with a new `key` on every open, so the draft starts fresh.

- [ ] **Step 1: Implement** `src/app/dashboard/inventory/_components/TransferStockModal.tsx`

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input, Row, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { useAdvancedInventory } from "../_store/useAdvancedInventory";
import { fetchAvailableLots } from "../_store/productLots";
import { lotReceivedLabel, lotSourceLabel } from "../_lib/productLots";
import {
  emptyTransferDraft,
  fifoPreview,
  parseTransferCost,
  parseTransferQuantity,
  transferDraftError,
  transferInsertPayload,
  transferLocationOptions,
  type TransferDraft,
  type TransferPortion,
} from "../_lib/transfers";
import type { StockLot, StockTransfer } from "@/types";

/** DataTable needs a string key; a lot appears at most once per preview. */
type PreviewRow = TransferPortion & { id: string };

const FORM_ID = "transfer-stock-form";
const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a transfer is recorded, so the page can refresh the history and stock. */
  onSaved: () => void;
}

/**
 * Source lots keyed by the "<product>:<location>" they were fetched for —
 * derived at render, never reset with a synchronous setState in the effect
 * (react-hooks/set-state-in-effect is an error here). Same pattern as
 * ProductLotsModal.tsx's LotsResult.
 */
interface SourceLotsResult {
  key: string;
  data: StockLot[] | null;
  error: string | null;
}

export function TransferStockModal({ open, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { locations, settings } = useAdvancedInventory();
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const [draft, setDraft] = useState<TransferDraft>(() => emptyTransferDraft(settings?.default_location_id ?? null, today()));
  const [saving, setSaving] = useState(false);
  const [sourceResult, setSourceResult] = useState<SourceLotsResult | null>(null);

  const options = useMemo(() => transferLocationOptions(locations), [locations]);
  const sourceKey = draft.productId && draft.fromLocationId ? `${draft.productId}:${draft.fromLocationId}` : "";

  useEffect(() => {
    if (!open || sourceKey === "") return;
    let cancelled = false;
    const [productId, locationId] = sourceKey.split(":");
    fetchAvailableLots(productId, locationId)
      .then((rows) => {
        if (!cancelled) setSourceResult({ key: sourceKey, data: rows, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setSourceResult({ key: sourceKey, data: null, error: e.message });
      });
    return () => { cancelled = true; };
  }, [open, sourceKey]);

  const sourceMatches = sourceKey !== "" && sourceResult?.key === sourceKey;
  const sourceLots = sourceMatches ? sourceResult!.data : null;
  const sourceError = sourceMatches ? sourceResult!.error : null;
  const sourceLoading = sourceKey !== "" && !sourceMatches;

  const quantity = parseTransferQuantity(draft.quantity);
  const cost = parseTransferCost(draft.transferCost);
  const preview = sourceLots ? fifoPreview(sourceLots, quantity ?? 0, cost.valid ? cost.value : null) : null;
  const available = preview ? preview.available : null;
  const draftError = transferDraftError(draft, locations, available);
  const isFormValid = draftError === null && !sourceLoading;
  const previewRows: PreviewRow[] = preview ? preview.portions.map((p) => ({ ...p, id: p.lot.id })) : [];

  const set = (patch: Partial<TransferDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "this product";

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toastError("Transfer not saved", "Your session has expired. Please sign in again.");
        return;
      }
      const payload = transferInsertPayload(draft, user.id);
      const { data, error } = await supabase.from("stock_transfers").insert(payload).select("*").single<StockTransfer>();
      if (error || !data) {
        toastError("Transfer not saved", inventoryErrorMessage(error, "Could not record the transfer."));
        return;
      }
      try {
        const log = await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "create",
          entityType: "stock_transfer",
          entityId: data.id,
          metadata: {
            product_name: productName(data.product_id),
            from: locationName(data.from_location_id),
            to: locationName(data.to_location_id),
            quantity: data.quantity,
            transfer_cost: data.transfer_cost,
          },
        });
        if (log) dispatch(addAuditLog(log));
      } catch {
        // Best-effort: the transfer is already recorded.
      }
      success(
        "Stock transferred",
        `${data.quantity} × ${productName(data.product_id)} moved from ${locationName(data.from_location_id)} to ${locationName(data.to_location_id)}.`,
      );
      onSaved();
      onClose();
    } catch {
      toastError("Transfer not saved", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const previewColumns = [
    { header: "Batch", render: (p: PreviewRow) => <span className="text-sm text-(--color-text-base)">{lotSourceLabel(p.lot)}</span> },
    { header: "Received", render: (p: PreviewRow) => <span className="text-sm text-(--color-text-muted)">{lotReceivedLabel(p.lot)}</span> },
    { header: "Units", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{p.take}</span> },
    { header: "Unit cost", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{p.sourceUnitCost.toFixed(2)}</span> },
    { header: "At destination", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-strong)">{p.destUnitCost.toFixed(2)}</span> },
  ];

  return (
    <Modal
      title="Transfer Stock"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Transferring…" : "Transfer"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <Field label="Product" required>
          <Select value={draft.productId} onChange={(e) => set({ productId: e.target.value })} required>
            <option value="">— Choose a product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
            ))}
          </Select>
        </Field>

        <Row>
          <Field label="From" required>
            <Select value={draft.fromLocationId} onChange={(e) => set({ fromLocationId: e.target.value })} required>
              <option value="">— Choose —</option>
              {options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="To" required>
            <Select value={draft.toLocationId} onChange={(e) => set({ toLocationId: e.target.value })} required>
              <option value="">— Choose —</option>
              {options.filter((l) => l.id !== draft.fromLocationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </Row>

        <Row>
          <Field label="Units" required>
            <Input type="number" min="1" step="1" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} required />
          </Field>
          <Field label="Transfer cost (optional)">
            <Input type="number" min="0" step="0.01" value={draft.transferCost} onChange={(e) => set({ transferCost: e.target.value })} placeholder="0.00" />
          </Field>
        </Row>

        <Field label="Date" required>
          <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} required />
        </Field>

        <Field label="Note">
          <Textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Inbound shipment FBA15XYZ" />
        </Field>
      </form>

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold text-(--color-text-strong)">Batches that will move</h3>
        {sourceKey === "" ? (
          <p className="text-sm text-(--color-text-muted)">Choose a product and a source location to see its batches.</p>
        ) : sourceLoading ? (
          <p className="flex items-center gap-2 text-sm text-(--color-text-muted)">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading stock at {locationName(draft.fromLocationId)}…
          </p>
        ) : sourceError ? (
          <p className="text-sm text-(--color-danger-text)">{sourceError}</p>
        ) : preview ? (
          <>
            <p className="text-xs text-(--color-text-muted)">
              Available at {locationName(draft.fromLocationId)}: <span className="tabular-nums">{preview.available}</span> units. Oldest batches move first; each keeps its cost{preview.addon > 0 ? `, plus ${preview.addon.toFixed(4)} per unit transfer cost` : ""}.
            </p>
            <DataTable
              columns={previewColumns}
              rows={previewRows}
              keyField="id"
              emptyMessage={preview.available === 0 ? "No stock at this location to transfer." : "Enter how many units to move."}
            />
            {preview.destAvgUnitCost !== null && (
              <p className="text-sm text-(--color-text-base)">
                Arrives at <span className="tabular-nums font-medium">{preview.destAvgUnitCost.toFixed(2)}</span> per unit on average
                (<span className="tabular-nums">{preview.movedCost.toFixed(2)}</span> total).
              </p>
            )}
          </>
        ) : null}
        {draftError && (draft.quantity !== "" || draft.toLocationId !== "") && (
          <p className="text-xs text-(--color-danger-text)">{draftError}</p>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Docs.** Add `_components/TransferStockModal.tsx` to `inventory/CLAUDE.md`'s file map, with one line on its flow: product plus source → `fetchAvailableLots` → `fifoPreview`; insert into `stock_transfers`; audit `stock_transfer`/`create`; `onSaved`. In `SKILL.md`, under "Minimal file set", add "Change the transfer form or preview → `_lib/transfers.ts` (+ test), `_components/TransferStockModal.tsx`".

- [ ] **Step 3: Commit.** The component isn't mounted until Task 4. Pre-commit type-checks and lints it.

```bash
git add src/app/dashboard/inventory/_components/TransferStockModal.tsx src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md
git commit -m "feat(inventory): Transfer stock modal with FIFO batch preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Transfers tab, page wiring, stock refresh

**Files:**
- Create: `src/app/dashboard/inventory/_components/TransfersTab.tsx`
- Modify: `src/app/dashboard/inventory/_components/InventoryTabs.tsx` (`InventoryTabId`)
- Modify: `src/app/dashboard/inventory/page.tsx`
- Modify: `src/app/dashboard/inventory/_components/ProductsTab.tsx` (`stockVersion` prop)
- Modify: `src/app/dashboard/inventory/_components/LocationsTab.tsx` (`stockVersion` prop)
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`

**Interfaces:**
- Consumes:
  - `fetchTransfersPage`, `StockTransferRow`, `state.stockTransfers` (Task 2);
  - `pageAfterRemoval` (Task 1);
  - `TransferStockModal` (Task 3);
  - `formatDate` from `@/lib/utils/date`;
  - `Pagination` from `@/components/ui/Pagination`, with props `{ page, pageSize, total, onPageChange, onPageSizeChange? }`;
  - `DeleteConfirmModal`, with props `{ open, title, description, onConfirm(reason): Promise<void>, onClose }`.
- Produces:
  - `TransfersTab({ isAdmin, addOpen, onAddClose, hidden, onStockChanged })`;
  - `InventoryTabId = "products" | "locations" | "transfers"`;
  - `ProductsTab` and `LocationsTab` each accept an optional `stockVersion?: number`.

- [ ] **Step 1: Widen the tab id** in `InventoryTabs.tsx`:

```ts
export type InventoryTabId = "products" | "locations" | "transfers";
```

- [ ] **Step 2: Implement** `src/app/dashboard/inventory/_components/TransfersTab.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatDate } from "@/lib/utils/date";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { fetchTransfersPage, type StockTransferRow } from "../_store/transfersSlice";
import { pageAfterRemoval } from "../_lib/transfers";
import { TransferStockModal } from "./TransferStockModal";

interface Props {
  isAdmin: boolean;
  /** The page header owns the "+ Transfer Stock" button; this tab owns the modal. */
  addOpen: boolean;
  onAddClose: () => void;
  /** Kept mounted while another tab shows (same as LocationsTab). */
  hidden?: boolean;
  /** A transfer was recorded or deleted — per-location stock elsewhere is stale. */
  onStockChanged: () => void;
}

export function TransfersTab({ isAdmin, addOpen, onAddClose, hidden, onStockChanged }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { items, page, pageSize, total, loaded, isFetching, error } = useAppSelector((s) => s.stockTransfers);
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const [deleteTarget, setDeleteTarget] = useState<StockTransferRow | null>(null);
  // Remounts the modal on every open so its draft starts fresh.
  const [modalSession, setModalSession] = useState(0);

  useEffect(() => {
    if (!loaded) dispatch(fetchTransfersPage({ page: 1, pageSize }));
  }, [loaded, pageSize, dispatch]);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const productLabel = (t: StockTransferRow) => t.product_name ?? "Deleted product";

  function handleSaved() {
    dispatch(fetchTransfersPage({ page: 1, pageSize }));
    onStockChanged();
  }

  function handleModalClose() {
    setModalSession((n) => n + 1);
    onAddClose();
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const supabase = await createTenantClient();
      const { data, error: deleteError } = await supabase.from("stock_transfers").delete().eq("id", target.id).select("id");
      if (deleteError) {
        toastError("Delete failed", inventoryErrorMessage(deleteError, "Could not delete the transfer."));
        return;
      }
      if (!data || data.length === 0) {
        toastError("Delete failed", "You don't have permission to delete this transfer, or it no longer exists.");
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "delete",
            entityType: "stock_transfer",
            entityId: target.id,
            metadata: {
              before: target,
              product_name: productLabel(target),
              from: locationName(target.from_location_id),
              to: locationName(target.to_location_id),
              reason,
            },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Best-effort: the transfer is already deleted.
      }
      success("Transfer deleted", `${target.quantity} × ${productLabel(target)} are back at ${locationName(target.from_location_id)}.`);
      setDeleteTarget(null);
      dispatch(fetchTransfersPage({ page: pageAfterRemoval(page, pageSize, total), pageSize }));
      onStockChanged();
    } catch {
      // Keep deleteTarget so the modal stays open for a retry.
      toastError("Delete failed", "Please check your connection and try again.");
    }
  }

  const columns = [
    { header: "Date", render: (t: StockTransferRow) => <span className="text-sm text-(--color-text-base)">{formatDate(t.date)}</span> },
    { header: "Product", render: (t: StockTransferRow) => <span className="text-sm font-medium text-(--color-text-strong)">{productLabel(t)}</span> },
    {
      header: "Route",
      render: (t: StockTransferRow) => (
        <span className="flex items-center gap-1 text-sm text-(--color-text-base)">
          {locationName(t.from_location_id)} <ArrowRight size={14} aria-label="to" /> {locationName(t.to_location_id)}
        </span>
      ),
    },
    { header: "Units", render: (t: StockTransferRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{t.quantity}</span> },
    {
      header: "Transfer cost",
      render: (t: StockTransferRow) => (
        <span className="text-sm tabular-nums text-(--color-text-base)">{t.transfer_cost === null ? "—" : Number(t.transfer_cost).toFixed(2)}</span>
      ),
    },
    { header: "Note", render: (t: StockTransferRow) => <span className="text-sm text-(--color-text-muted)">{t.note ?? ""}</span> },
    ...(isAdmin
      ? [
          {
            header: "Actions",
            render: (t: StockTransferRow) => (
              <Button size="icon" variant="danger" onClick={() => setDeleteTarget(t)} title="Delete" aria-label={`Delete transfer of ${productLabel(t)}`}>
                <Trash2 size={15} />
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div id="inventory-panel-transfers" role="tabpanel" aria-labelledby="inventory-tab-transfers" hidden={hidden} className="space-y-4">
      {!isAdmin && <p className="text-sm text-(--color-text-muted)">Only admins can record or delete transfers.</p>}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchTransfersPage({ page, pageSize }))}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <DataTable
          columns={columns}
          rows={items}
          keyField="id"
          emptyMessage={loaded ? "No transfers yet — move stock between your locations with “Transfer Stock”." : "Loading transfers…"}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchTransfersPage({ page: p, pageSize }))}
          onPageSizeChange={(s) => dispatch(fetchTransfersPage({ page: 1, pageSize: s }))}
        />
      </div>

      {isAdmin && (
        <TransferStockModal key={modalSession} open={addOpen} onClose={handleModalClose} onSaved={handleSaved} />
      )}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Transfer"
        description={
          deleteTarget
            ? `Move ${deleteTarget.quantity} × ${productLabel(deleteTarget)} back from ${locationName(deleteTarget.to_location_id)} to ${locationName(deleteTarget.from_location_id)}? This only works while none of the transferred units have been sold or moved on.`
            : ""
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

If `ArrowRight`'s `aria-label` trips a lint or type rule, use `aria-hidden` plus a visually hidden `<span className="sr-only">to</span>` instead.

- [ ] **Step 3: Add `stockVersion` to `ProductsTab.tsx`.** Add `stockVersion?: number` to its `Props`, with the doc comment `/** Bumped by the page after a transfer, so per-location stock re-fetches. */`, and destructure it. Change the request key to include it:

```ts
const stockRequestKey = `${advanced.active}:${pageIds}:${stockRefresh}:${stockVersion ?? 0}`;
```

(The effect already depends on `stockRequestKey`.)

- [ ] **Step 4: Add `stockVersion` to `LocationsTab.tsx`.** Add `stockVersion?: number` to `Props` with the same doc comment, and destructure it. Include it in the on-hand key:

```ts
const onHandKey = `${locationsKey}|${stockVersion ?? 0}`;
```

Then use `onHandKey` wherever the on-hand effect and its derivation currently use `locationsKey`: in `setOnHandResult({ key: … })` in both branches, in the effect's dependency array, and in the `onHandResult.key === …` comparison. `defaultsKey` is unchanged.

- [ ] **Step 5: Wire `page.tsx`**
  - add the state `const [transferOpen, setTransferOpen] = useState(false);` and `const [stockVersion, setStockVersion] = useState(0);`;
  - add the tab entry `{ id: "transfers", label: "Transfers" }` after Locations;
  - header action: on the Locations tab, keep the current behaviour. On the Transfers tab (`view === "active" && tab === "transfers"`), show `isAdmin ? <Button onClick={() => setTransferOpen(true)}>+ Transfer Stock</Button> : undefined`. Everywhere else, show "+ Add Product". Implement it as:

```tsx
const showLocations = view === "active" && tab === "locations";
const showTransfers = view === "active" && tab === "transfers";
const bumpStock = () => setStockVersion((n) => n + 1);
// …
action={
  showLocations ? (
    isAdmin ? <Button onClick={() => setAddLocationOpen(true)}>+ Add Location</Button> : undefined
  ) : showTransfers ? (
    isAdmin ? <Button onClick={() => setTransferOpen(true)}>+ Transfer Stock</Button> : undefined
  ) : (
    <Button onClick={() => setAddProductOpen(true)}>+ Add Product</Button>
  )
}
```

  - pass `stockVersion={stockVersion}` to `<ProductsTab>` and `<LocationsTab>`;
  - after `<LocationsTab …/>`, add:

```tsx
{view === "active" && (
  <TransfersTab
    isAdmin={isAdmin}
    addOpen={transferOpen}
    onAddClose={() => setTransferOpen(false)}
    hidden={tab !== "transfers"}
    onStockChanged={bumpStock}
  />
)}
```

  - import `TransfersTab` from `./_components/TransfersTab`.

- [ ] **Step 6: Run the inventory tests.** Nothing new is unit-testable here. This confirms the widened type and props broke nothing:

Run: `npx jest src/app/dashboard/inventory`
Expected: PASS.

- [ ] **Step 7: Manual checks for the report.** Browser checks happen only through a Playwright MCP against an already-running dev server; otherwise list these for the user:
  - Business tenant, advanced on: a Transfers tab appears, and "+ Transfer Stock" shows for admins only.
  - Picking product + From shows that location's batches oldest first. Units > available disables Transfer and shows "Only N units are available…". A transfer cost shows per-unit add-on and the destination average.
  - Transferring adds a history row; the Products tab's per-location columns and the Locations tab's On hand move by the quantity without a page reload.
  - Deleting a fresh transfer restores stock. Deleting after selling some moved units shows the `INV_CONSUMED` copy and keeps the row.
  - Non-admin: read-only history, no button, no delete icon.

- [ ] **Step 8: Docs.** Update `inventory/CLAUDE.md`:
  - file map: add `TransfersTab.tsx`;
  - page composition: three tabs, header button per tab, `stockVersion` bump;
  - `ProductsTab`/`LocationsTab` gain the `stockVersion` prop.

  Add to `SKILL.md`:
  - "Add a tab → `InventoryTabs.tsx` id union + `page.tsx` tabs/header action + panel id `inventory-panel-<id>`";
  - a gotcha: "stock caches on other tabs are keyed by `stockVersion`; bump it after any mutation that moves stock between locations".

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/inventory/_components/TransfersTab.tsx src/app/dashboard/inventory/_components/InventoryTabs.tsx src/app/dashboard/inventory/page.tsx src/app/dashboard/inventory/_components/ProductsTab.tsx src/app/dashboard/inventory/_components/LocationsTab.tsx src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md
git commit -m "feat(inventory): Transfers tab with history, delete and stock refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs reconciliation

**Files:**
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`
- Modify: `supabase/SKILL.md` (the `049` row)
- Modify: `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md` ("Phasing" item 4)
- Modify: `AGENTS.md`, only if its `src/lib/inventory/` bullet mentions the tabs; otherwise leave it alone

- [ ] **Step 1: Inventory docs.** Read both files end to end and make them consistent with Tasks 1–4. Cover:
  - the three tabs;
  - transfer data flow: modal → insert → trigger → `stockVersion` bump;
  - the `state.stockTransfers` slice;
  - admin-only UI over member-level RLS;
  - no edit, because transfers are immutable;
  - delete blocked by `INV_CONSUMED`.

  Remove any line that still says transfers are "Phase 4 / not built yet".

- [ ] **Step 2: `supabase/SKILL.md` 049 row.** Replace the "⏳ **pending** …" status with: "✅ **applied** — verified live 2026-09-26: 5 of 5 tenant schemas have `inventory_stock_by_location` and `inventory_stock_by_location_totals`." Keep the description of what 049 does. In the `047` row, drop the sentence that points at 049 as outstanding. Phase 4 adds no migration; say so in one line under the table if that section tracks phases.

- [ ] **Step 3: Spec phasing note.** Under item 4 ("**Transfers** — tab, modal, preview."), add:

```markdown
   Phase 4 status: implemented per
   `docs/superpowers/plans/2026-09-26-advanced-inventory-phase-4-transfers.md`.
   UI only — the transfer triggers, RLS and grants shipped in Phase 1, so no
   migration. Transfers are admin-only in the UI, immutable (delete to undo),
   and blocked when the source lacks stock.
```

- [ ] **Step 4: Run the feature's tests once more**

Run: `npx jest src/app/dashboard/inventory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md supabase/SKILL.md docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
git commit -m "docs(inventory): phase 4 — transfers; 049 applied

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
