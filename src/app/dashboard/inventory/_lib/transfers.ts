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
