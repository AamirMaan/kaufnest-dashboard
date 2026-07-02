import { test, expect } from "@playwright/test";

test.describe("Invoice", () => {
  test("Download Invoice on order detail page → filename matches INV pattern, deterministic", async ({ page }) => {
    // Navigate to sales list and get the first order's detail URL
    await page.goto("/dashboard/sales");
    const firstLink = page.locator("td a[href*='/dashboard/sales/']").first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });
    await firstLink.click();
    await expect(page).toHaveURL(/\/dashboard\/sales\/[0-9a-f-]{36}/);

    // Wait for the Download Invoice button to be enabled (company profile must hydrate)
    const downloadButton = page.getByRole("button", { name: /download invoice/i });
    await expect(downloadButton).toBeVisible({ timeout: 10_000 });
    await expect(downloadButton).toBeEnabled({ timeout: 10_000 });

    // First download
    const download1Promise = page.waitForEvent("download");
    await downloadButton.click();
    const download1 = await download1Promise;

    const filename1 = download1.suggestedFilename();
    // Filename should match INV-NNNNNN-xxxxxxxx.pdf
    expect(filename1).toMatch(/^INV-\d{6}-[0-9a-f]{8}\.pdf$/i);

    // Second download — same order should produce same invoice number (deterministic)
    const download2Promise = page.waitForEvent("download");
    await downloadButton.click();
    const download2 = await download2Promise;

    const filename2 = download2.suggestedFilename();
    expect(filename2).toBe(filename1);
  });

  test("InvoiceModal (bulk) on sales list → totals contain Shipping text → download succeeds", async ({ page }) => {
    await page.goto("/dashboard/sales");

    // Open InvoiceModal via the "Invoice" header button
    await page.getByRole("button", { name: /^invoice$/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });

    // Assert the modal body contains "Shipping" text
    await expect(page.getByRole("dialog").getByText(/shipping/i)).toBeVisible({ timeout: 10_000 });

    // Download from InvoiceModal
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: /download/i }).click();
    const download = await downloadPromise;

    // Download should succeed with a non-null filename
    expect(download.suggestedFilename()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});
