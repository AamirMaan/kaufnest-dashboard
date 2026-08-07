import { vatAmountFromGross } from "@/lib/utils/currency";

/**
 * The subset of `EditExpenseModal`'s form state a VAT figure derives from.
 * Deliberately just these three fields (not the whole `FormState`) so this
 * module stays pure and doesn't need to know the shape of the rest of the form.
 */
export interface VatFormSnapshot {
  amount: string;
  vat_rate: string;
  vat_included: boolean;
}

/**
 * Has the user touched any input a VAT amount derives from, since the modal
 * loaded this expense?
 *
 * This must compare the CURRENT form against its OWN INITIAL snapshot, never
 * against the underlying `Expense` row directly. `expenseToForm` seeds
 * `vat_rate` from the tenant's default whenever the expense's own rate is
 * `null` (see `EditExpenseModal.tsx`), so a row like `vat_amount: 96.26,
 * vat_rate: null` loads with `form.vat_rate` already at, say, "19" — compared
 * against the expense's `vat_rate` of `null` that reads as "changed" even
 * though the user touched nothing, and the stored 96.26 would be silently
 * recomputed away. Comparing against the form's own initial values sidesteps
 * this entirely: they were seeded by the exact same defaulting logic, so an
 * untouched field always compares equal.
 */
export function vatInputsUnchanged(current: VatFormSnapshot, initial: VatFormSnapshot): boolean {
  return (
    current.amount === initial.amount &&
    current.vat_rate === initial.vat_rate &&
    current.vat_included === initial.vat_included
  );
}

/**
 * Decide what `vat_amount` a save should write.
 *
 * An imported Vorsteuerkonto row can legitimately carry a `vat_rate` that
 * disagrees with its `vat_amount` (Amazon states 19% against €0.00 on some
 * fee lines) — the stored figure is the authority, so it is only ever
 * replaced with a fresh `amount × vat_rate` derivation when the user actually
 * changed one of the inputs that formula depends on.
 */
export function resolveVatAmount(params: {
  current: VatFormSnapshot;
  initial: VatFormSnapshot;
  storedVatAmount: number | null;
  amount: number;
  vatRate: number;
}): number | null {
  const { current, initial, storedVatAmount, amount, vatRate } = params;
  if (!current.vat_included) return null;
  return vatInputsUnchanged(current, initial) ? storedVatAmount : vatAmountFromGross(amount, vatRate);
}
