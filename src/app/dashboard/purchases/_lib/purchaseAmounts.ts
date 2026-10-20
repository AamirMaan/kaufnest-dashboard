/**
 * The purchase forms take the **total paid** and derive the unit price from
 * it — users know what the invoice came to, not the per-unit figure.
 *
 * `total` is stored exactly as entered (`total_amount` is a plain writable
 * column and is what VAT, landed cost and every summary read). `unitPrice`
 * is `total / quantity` rounded to cents to fit `unit_price numeric(12,2)`,
 * so `unitPrice * quantity` can differ from `total` by a rounding cent on
 * uneven splits — `total` stays authoritative.
 */
export interface PurchaseAmounts {
  quantity: number;
  total: number;
  unitPrice: number;
}

const toCents = (n: number) => Math.round(n * 100) / 100;

export function purchaseAmounts(totalInput: string, quantityInput: string): PurchaseAmounts {
  const quantity = Math.max(1, parseInt(quantityInput) || 1);
  const parsed = parseFloat(totalInput);
  const total = Number.isFinite(parsed) && parsed > 0 ? toCents(parsed) : 0;
  return { quantity, total, unitPrice: toCents(total / quantity) };
}
