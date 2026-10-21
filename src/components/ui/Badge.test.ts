import { CATEGORY_LABELS } from "./Badge";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/utils/expenseCategories";

describe("CATEGORY_LABELS", () => {
  it("has exactly one label per expense category, taken from expenseCategoryLabel", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...EXPENSE_CATEGORIES].sort());
    for (const c of EXPENSE_CATEGORIES) expect(CATEGORY_LABELS[c]).toBe(expenseCategoryLabel(c));
    expect(CATEGORY_LABELS.platform_fees).toBe("Platform fees");
  });
});
