import { test, expect } from "@playwright/test";
import { e2eName } from "./helpers";

test.describe("Orders (sales)", () => {
  const productName = e2eName("order");

  test("add order → row visible, Fees cell shows shipping_cost + advertising_fee", async ({ page }) => {
    await page.goto("/dashboard/sales");

    // Open Add Order modal
    await page.getByRole("button", { name: "+ Add Order" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Fill product name
    await page.getByRole("dialog").getByPlaceholder("e.g. Wireless Headphones").fill(productName);

    // Fill unit price (required)
    await page.getByRole("dialog").getByPlaceholder("0.00").first().fill("10.00");

    // Expand Fees & shipping section
    await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).click();

    // After expanding fees section, fill the fee fields by label proximity
    await page.getByRole("dialog").getByText("Shipping Cost (paid by you)").locator("..").locator("input").fill("4.99");
    await page.getByRole("dialog").getByText("Shipping Charged (billed to buyer)").locator("..").locator("input").fill("5.99");
    await page.getByRole("dialog").getByText("Advertising Fee").locator("..").locator("input").fill("1.50");

    // Submit
    await page.getByRole("button", { name: "Add Order" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Wait for row in table
    await expect(page.getByRole("link", { name: productName })).toBeVisible({ timeout: 10_000 });

    // Fees cell: shipping_cost(4.99) + advertising_fee(1.50) = 6.49
    // Find the row containing our product and check the Fees column
    const row = page.locator("tr").filter({ hasText: productName });
    await expect(row).toBeVisible();
    // The Fees column should show 6.49 (formatted as EUR 6.49 or similar)
    await expect(row).toContainText("6.49");
  });

  test("edit order → change advertising_fee to 2.50", async ({ page }) => {
    await page.goto("/dashboard/sales");

    // Find the row for our product and click the edit (pencil) button
    const row = page.locator("tr").filter({ hasText: productName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();

    // Expand Fees & shipping section if not already open
    const feeInput = page.getByRole("dialog").getByText("Advertising Fee").locator("..").locator("input");
    // If the fees section is collapsed, expand it
    const isVisible = await feeInput.isVisible().catch(() => false);
    if (!isVisible) {
      await page.getByRole("dialog").getByRole("button", { name: /fees.*shipping/i }).click();
    }

    // Clear and fill advertising_fee with 2.50
    await feeInput.fill("2.50");

    // Fill required edit reason (EditSaleModal requires a reason)
    const reasonField = page.getByRole("dialog").getByPlaceholder(/reason/i);
    if (await reasonField.isVisible()) {
      await reasonField.fill("E2E test: update advertising fee");
    }

    // Save
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    // Fees should now be 4.99 + 2.50 = 7.49
    const updatedRow = page.locator("tr").filter({ hasText: productName });
    await expect(updatedRow).toContainText("7.49", { timeout: 10_000 });
  });

  test("audit log shows advertising_fee change", async ({ page }) => {
    await page.goto("/dashboard/audit-logs");

    // Find the most recent "update" action row in the audit log table and open its detail modal.
    // The diff for the edit is stored in metadata.before/after and rendered as a KVTable
    // by AuditLogDetailModal — we need to open it to see field-level keys like advertising_fee.
    const updateRow = page.locator("tr").filter({ hasText: /update/i }).first();
    await expect(updateRow).toBeVisible({ timeout: 10_000 });
    await updateRow.getByRole("button", { name: "View details" }).click();

    // AuditLogDetailModal renders before/after KVTables; each field key appears as a <span>
    // with font-mono styling. Assert advertising_fee is present in the diff.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("dialog").getByText(/advertising_fee/i)).toBeVisible({ timeout: 5_000 });
  });

  test.afterAll(async ({ browser }) => {
    // Clean up: delete the created row via the UI
    const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const page = await context.newPage();
    await page.goto("/dashboard/sales");

    const row = page.locator("tr").filter({ hasText: productName });
    if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await row.getByRole("button", { name: "Delete" }).click();
      // DeleteConfirmModal — fill reason and confirm
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
      const reasonInput = page.getByRole("dialog").locator("input, textarea").first();
      if (await reasonInput.isVisible()) await reasonInput.fill("E2E cleanup");
      await page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    }
    await context.close();
  });
});
