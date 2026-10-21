import type { ExpenseCategory } from "@/types";

/** Display order for every expense category picker/filter. `other` stays last. */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "platform_fees", "other",
];

const LABELS: Partial<Record<ExpenseCategory, string>> = { platform_fees: "Platform fees" };

export function expenseCategoryLabel(c: ExpenseCategory): string {
  return LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}
