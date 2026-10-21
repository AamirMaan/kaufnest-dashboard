import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "./expenseCategories";

describe("expense categories", () => {
  it("includes platform_fees exactly once, before other", () => {
    expect(EXPENSE_CATEGORIES.filter((c) => c === "platform_fees")).toHaveLength(1);
    expect(EXPENSE_CATEGORIES.at(-1)).toBe("other");
  });

  it("labels every category without underscores", () => {
    for (const c of EXPENSE_CATEGORIES) expect(expenseCategoryLabel(c)).not.toContain("_");
    expect(expenseCategoryLabel("platform_fees")).toBe("Platform fees");
    expect(expenseCategoryLabel("shipping")).toBe("Shipping");
  });
});
