export interface LandedCostInput {
  totalAmount: number; // gross purchase total, VAT included
  vatAmount?: number | null;
  quantity: number;
  freightCost?: number | null;
  customsCost?: number | null;
  otherCost?: number | null;
}

/**
 * Landed unit cost of a purchase batch. MUST stay identical to
 * `inv_landed_unit_cost()` in supabase/migrations/047_advanced_inventory.sql —
 * the database is the source of truth for stored costs; this mirror only
 * powers the live read-out in the purchase form. VAT is excluded because it
 * is normally reclaimable, so it is not part of the cost of goods.
 */
export function landedUnitCost(input: LandedCostInput): number | null {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const net = input.totalAmount - (input.vatAmount ?? 0);
  const extras = (input.freightCost ?? 0) + (input.customsCost ?? 0) + (input.otherCost ?? 0);
  return Math.round(((net + extras) / input.quantity) * 10000) / 10000;
}
