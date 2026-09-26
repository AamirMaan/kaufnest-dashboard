import type { Purchase } from "@/types";

/** Advanced-inventory fields on a purchase form (Business plan, feature enabled). "" = default location. */
export interface PurchaseInventoryFieldsState {
  locationId: string;
  freight: string;
  customs: string;
  other: string;
}

export function emptyPurchaseInventoryFields(): PurchaseInventoryFieldsState {
  return { locationId: "", freight: "", customs: "", other: "" };
}

const toField = (n: number | null | undefined) => (n == null ? "" : String(n));

export function purchaseInventoryFieldsFrom(
  p: Partial<Pick<Purchase, "location_id" | "freight_cost" | "customs_cost" | "other_cost">>,
): PurchaseInventoryFieldsState {
  return {
    locationId: p.location_id ?? "",
    freight: toField(p.freight_cost),
    customs: toField(p.customs_cost),
    other: toField(p.other_cost),
  };
}

/** "" → null; a finite number ≥ 0 → rounded to 2 dp; anything else → undefined (invalid). */
function parseCost(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

export function isPurchaseInventoryFieldsValid(s: PurchaseInventoryFieldsState): boolean {
  return [s.freight, s.customs, s.other].every((v) => parseCost(v) !== undefined);
}

export function purchaseInventoryPayload(s: PurchaseInventoryFieldsState) {
  return {
    location_id: s.locationId || null,
    freight_cost: parseCost(s.freight) ?? null,
    customs_cost: parseCost(s.customs) ?? null,
    other_cost: parseCost(s.other) ?? null,
  };
}

export function hasLandedCosts(s: PurchaseInventoryFieldsState): boolean {
  return [s.freight, s.customs, s.other].some((v) => v.trim() !== "");
}

/** Lenient parse for the live read-out only: invalid or empty counts as 0. */
export function parseLandedPreview(raw: string): number {
  const n = parseCost(raw);
  return typeof n === "number" ? n : 0;
}
