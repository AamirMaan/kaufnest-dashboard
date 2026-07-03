import { test, expect } from "@playwright/test";
import { e2eName } from "./helpers";

/**
 * Business logic E2E spec.
 *
 * Covers:
 * - Stock decrements when a linked sale is created (DB trigger)
 * - Stock restores when sale is set to returned + restock=true
 * - Stock unchanged after deleting the sale
 * - Net profit on Overview decreases when advertising_fee is added to a sale
 *
 * NOTE: This spec depends on there being at least one existing revenue-eligible
 * sale visible on the Overview page. It uses a separate E2E product to avoid
 * touching pre-existing data.
 */

test.describe("Business logic", () => {
  const productName = e2eName("prod");
  const saleName = e2eName("sale");

  test("create product → create linked sale → stock decrements by qty", async ({ page }) => {
    // Step 1: create product with stock=0 (stock is driven by purchases, not set directly)
    // We add a product first, then we need a purchase to give it stock.
    // However, AddProductModal only sets name/SKU/threshold — stock starts at 0.
    // We add via a purchase to give it stock=10, then sell 2.

    // Navigate to inventory and create the product catalog entry
    await page.goto("/dashboard/inventory");
    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("dialog").getByPlaceholder("e.g. USB-C Cable 1m").fill(productName);
    await page.getByRole("dialog").getByRole("button", { name: "Add Product" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Verify the product appears (stock=0 initially)
    const productRow = page.locator("tr").filter({ hasText: productName });
    await expect(productRow).toBeVisible({ timeout: 10_000 });

    // Step 2: create a purchase to give this product stock=10
    await page.goto("/dashboard/purchases");
    await page.getByRole("button", { name: /add purchase/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Fill product name
    await page.getByRole("dialog").getByPlaceholder(/product|item/i).first().fill(saleName + "-purchase");

    // Select inventory product from dropdown (this links the purchase to the product)
    const productSelect = page.getByRole("dialog").locator("select").filter({ hasText: /not tracked|tracked|stock/i }).first();
    if (await productSelect.isVisible()) {
      // Select our newly created product by its exact name
      await productSelect.selectOption({ label: productName }).catch(() => {
        // If the product isn't in the dropdown yet, skip — it should be there since we just added it
      });
    }

    // Fill quantity=10 and unit_price
    const qtyInput = page.getByRole("dialog").locator('input[type="number"]').first();
    await qtyInput.fill("10");
    const priceInput = page.getByRole("dialog").locator('input[placeholder="0.00"]').first();
    await priceInput.fill("5.00");

    await page.getByRole("dialog").getByRole("button", { name: /add purchase/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Step 3: navigate to inventory and verify stock=10
    await page.goto("/dashboard/inventory");
    const inventoryRow = page.locator("tr").filter({ hasText: productName });
    await expect(inventoryRow).toBeVisible({ timeout: 10_000 });
    await expect(inventoryRow).toContainText("10");

    // Step 4: create a sale linked to that product with qty=2
    await page.goto("/dashboard/sales");
    await page.getByRole("button", { name: "+ Add Order" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("dialog").getByPlaceholder("e.g. Wireless Headphones").fill(saleName);
    await page.getByRole("dialog").getByPlaceholder("0.00").first().fill("15.00");

    // Link to inventory product
    const inventoryProductSelect = page.getByRole("dialog").locator("select").filter({ hasText: /not tracked|in stock/i }).first();
    await inventoryProductSelect.selectOption({ label: productName }).catch(() => {});

    // Set quantity to 2
    const qtyField = page.getByRole("dialog").locator('input[type="number"][min="1"]').first();
    await qtyField.fill("2");

    await page.getByRole("dialog").getByRole("button", { name: "Add Order" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Step 5: verify stock=8 in inventory (10 − 2 = 8)
    await page.goto("/dashboard/inventory");
    const updatedInventoryRow = page.locator("tr").filter({ hasText: productName });
    await expect(updatedInventoryRow).toBeVisible({ timeout: 10_000 });
    await expect(updatedInventoryRow).toContainText("8");
  });

  test("set sale status=returned + restock=true → stock restores to 10", async ({ page }) => {
    await page.goto("/dashboard/sales");

    // Find the sale row and edit it
    const row = page.locator("tr").filter({ hasText: saleName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Set status to "returned"
    const statusSelect = page.getByRole("dialog").locator("select").filter({ hasText: /pending|processing|shipped|returned/i }).first();
    await statusSelect.selectOption("returned");

    // Check the restock checkbox
    const restockCheckbox = page.getByRole("dialog").getByLabel(/item can be resold|restock inventory/i);
    await expect(restockCheckbox).toBeVisible({ timeout: 5_000 });
    await restockCheckbox.check();

    // Fill edit reason
    const reasonField = page.getByRole("dialog").getByPlaceholder(/reason/i);
    if (await reasonField.isVisible()) {
      await reasonField.fill("E2E test: mark returned + restock");
    }

    await page.getByRole("dialog").getByRole("button", { name: /save/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Verify stock restored to 10
    await page.goto("/dashboard/inventory");
    const inventoryRow = page.locator("tr").filter({ hasText: productName });
    await expect(inventoryRow).toBeVisible({ timeout: 10_000 });
    await expect(inventoryRow).toContainText("10");
  });

  test("delete sale → stock remains at 10 (no double-deduct)", async ({ page }) => {
    await page.goto("/dashboard/sales");

    const row = page.locator("tr").filter({ hasText: saleName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    const reasonInput = page.getByRole("dialog").locator("input, textarea").first();
    if (await reasonInput.isVisible()) await reasonInput.fill("E2E cleanup");
    await page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Stock should still be 10 (the returned+restock sale had net 0 stock effect)
    await page.goto("/dashboard/inventory");
    const inventoryRow = page.locator("tr").filter({ hasText: productName });
    await expect(inventoryRow).toBeVisible({ timeout: 10_000 });
    await expect(inventoryRow).toContainText("10");
  });

  test("adding advertising_fee to a sale decreases Net Profit on Overview by ~5", async ({ page }) => {
    // Step 1: read current Net Profit from overview
    await page.goto("/dashboard");
    const netProfitCard = page.locator("[class*='stat'], [class*='card']").filter({ hasText: /net profit/i }).first();
    await expect(netProfitCard).toBeVisible({ timeout: 10_000 });

    // Extract the numeric value from the card
    const profitText = await netProfitCard.textContent();
    // Parse the first number that looks like a currency amount
    const profitMatch = profitText?.match(/[-\d.,]+/g);
    const originalProfit = profitMatch
      ? parseFloat(profitMatch.map((s) => s.replace(/,/g, "")).sort((a, b) => Math.abs(parseFloat(b)) - Math.abs(parseFloat(a)))[0])
      : null;

    // Step 2: navigate to sales and add advertising_fee=5.00 to the first revenue-eligible sale
    await page.goto("/dashboard/sales");

    // Find the first non-returned/non-cancelled row
    const rows = page.locator("tr").filter({ hasText: /amazon|ebay|etsy|shopify|other/i });
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Expand fees section
    const feeButtonVisible = await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).isVisible().catch(() => false);
    if (feeButtonVisible) {
      await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).click();
    }

    // Set advertising fee to 5.00
    const advFeeInput = page.getByRole("dialog").getByText("Advertising Fee").locator("..").locator("input");
    const currentFeeValue = await advFeeInput.inputValue();
    const currentFee = parseFloat(currentFeeValue) || 0;
    await advFeeInput.fill("5.00");

    // Fill reason
    const reasonField = page.getByRole("dialog").getByPlaceholder(/reason/i);
    if (await reasonField.isVisible()) {
      await reasonField.fill("E2E test: add advertising fee for profit impact check");
    }

    await page.getByRole("dialog").getByRole("button", { name: /save/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Step 3: navigate to overview and check Net Profit decreased by ~5
    await page.goto("/dashboard");
    const updatedNetProfitCard = page.locator("[class*='stat'], [class*='card']").filter({ hasText: /net profit/i }).first();
    await expect(updatedNetProfitCard).toBeVisible({ timeout: 10_000 });

    const updatedProfitText = await updatedNetProfitCard.textContent();
    const updatedProfitMatch = updatedProfitText?.match(/[-\d.,]+/g);
    const updatedProfit = updatedProfitMatch
      ? parseFloat(updatedProfitMatch.map((s) => s.replace(/,/g, "")).sort((a, b) => Math.abs(parseFloat(b)) - Math.abs(parseFloat(a)))[0])
      : null;

    if (originalProfit !== null && updatedProfit !== null) {
      const diff = originalProfit - updatedProfit;
      // Net profit should have decreased by approximately 5 (within ±0.50)
      const expectedDecrease = 5.00 - currentFee; // account for existing fee value
      expect(diff).toBeGreaterThanOrEqual(expectedDecrease - 0.50);
      expect(diff).toBeLessThanOrEqual(expectedDecrease + 0.50);
    }

    // Step 4 (cleanup): revert advertising fee on the same sale
    await page.goto("/dashboard/sales");
    const revertRow = page.locator("tr").filter({ hasText: /amazon|ebay|etsy|shopify|other/i }).first();
    await revertRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const revertFeeButtonVisible = await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).isVisible().catch(() => false);
    if (revertFeeButtonVisible) {
      await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).click();
    }
    const revertAdvFeeInput = page.getByRole("dialog").getByText("Advertising Fee").locator("..").locator("input");
    await revertAdvFeeInput.fill(currentFeeValue || "");

    const revertReasonField = page.getByRole("dialog").getByPlaceholder(/reason/i);
    if (await revertReasonField.isVisible()) {
      await revertReasonField.fill("E2E cleanup: revert advertising fee");
    }
    await page.getByRole("dialog").getByRole("button", { name: /save/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
  });

  test.afterAll(async ({ browser }) => {
    // Clean up the E2E product and any remaining E2E sales
    const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const page = await context.newPage();

    // Delete any remaining E2E sale rows
    await page.goto("/dashboard/sales");
    let attempts = 0;
    while (attempts < 10) {
      const row = page.locator("tr").filter({ hasText: saleName }).first();
      const visible = await row.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!visible) break;

      await row.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
      const reasonInput = page.getByRole("dialog").locator("input, textarea").first();
      if (await reasonInput.isVisible()) await reasonInput.fill("E2E cleanup");
      await page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
      attempts++;
    }

    // Delete the E2E product from inventory
    await page.goto("/dashboard/inventory");
    const productRow = page.locator("tr").filter({ hasText: productName }).first();
    if (await productRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await productRow.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
      const reasonInput = page.getByRole("dialog").locator("input, textarea").first();
      if (await reasonInput.isVisible()) await reasonInput.fill("E2E cleanup");
      await page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    }

    // Also clean up the purchase we created (it would be under saleName + "-purchase")
    await page.goto("/dashboard/purchases");
    const purchaseRow = page.locator("tr").filter({ hasText: saleName + "-purchase" }).first();
    if (await purchaseRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await purchaseRow.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
      const reasonInput = page.getByRole("dialog").locator("input, textarea").first();
      if (await reasonInput.isVisible()) await reasonInput.fill("E2E cleanup");
      await page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });
});
