import type { StockLot } from "@/types";

const SOURCE_LABELS: Record<StockLot["kind"], string> = {
  purchase: "Purchase",
  opening: "Opening balance",
  transfer: "Transferred in",
  shortfall: "Shortfall (awaiting stock)",
};

export function lotSourceLabel(lot: StockLot): string {
  return SOURCE_LABELS[lot.kind];
}

/** Opening batches carry a 1970 FIFO placeholder date — don't show it as a real date. */
export function lotReceivedLabel(lot: StockLot): string {
  return lot.kind === "opening" ? "Before tracking" : lot.received_at.slice(0, 10);
}

/** Same order as the ledger's FIFO: received_at, then created_at, then id. */
export function sortLotsFifo(lots: StockLot[]): StockLot[] {
  return [...lots].sort(
    (a, b) =>
      a.received_at.localeCompare(b.received_at) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Mirrors set_opening_lot_cost (047): admins, opening batches only. */
export function canEditLotCost(lot: StockLot, isAdmin: boolean): boolean {
  return isAdmin && lot.kind === "opening";
}

export function parseUnitCostInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10000) / 10000;
}
