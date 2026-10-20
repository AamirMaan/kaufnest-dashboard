/**
 * The purchase forms take the **total paid** and derive the unit price from
 * it — users know what the invoice came to, not the per-unit figure.
 *
 * `total` is stored as entered, rounded to cents (`total_amount` is a plain writable
 * column and is what VAT, landed cost and every summary read). `unitPrice`
 * is `total / quantity` rounded to cents to fit `unit_price numeric(12,2)`,
 * so `unitPrice * quantity` can differ from `total` by a rounding cent on
 * uneven splits — `total` stays authoritative. A total too small for the
 * quantity rounds `unitPrice` to 0; callers treat that as invalid.
 */
export interface PurchaseAmounts {
  quantity: number;
  total: number;
  unitPrice: number;
}

// toPrecision(15) strips float noise (1.005 * 100 = 100.4999…) so typed
// halves round up at any magnitude; EPSILON alone only helps below ~8.
const round2 = (n: number) => Math.round(Number((n * 100).toPrecision(15))) / 100;

export function purchaseAmounts(totalInput: string, quantityInput: string): PurchaseAmounts {
  const quantity = Math.max(1, parseInt(quantityInput) || 1);
  const parsed = parseFloat(totalInput);
  const total = Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 0;
  return { quantity, total, unitPrice: round2(total / quantity) };
}
