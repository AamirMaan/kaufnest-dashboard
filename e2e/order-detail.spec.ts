import { test, expect } from "@playwright/test";

test.describe("Order detail page", () => {
  test("clicking product name link navigates to /dashboard/sales/<uuid>", async ({ page }) => {
    await page.goto("/dashboard/sales");

    // Find the first product link in the table
    const firstLink = page.locator("td a[href*='/dashboard/sales/']").first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });

    const href = await firstLink.getAttribute("href");
    expect(href).toMatch(/\/dashboard\/sales\/[0-9a-f-]{36}/);

    await firstLink.click();
    await expect(page).toHaveURL(/\/dashboard\/sales\/[0-9a-f-]{36}/);
  });

  test("order detail page shows Financials card with Net Proceeds", async ({ page }) => {
    await page.goto("/dashboard/sales");

    const firstLink = page.locator("td a[href*='/dashboard/sales/']").first();
    await firstLink.click();
    await expect(page).toHaveURL(/\/dashboard\/sales\/[0-9a-f-]{36}/);

    // Financials card should be visible
    await expect(page.getByRole("heading", { name: "Financials" })).toBeVisible();
    // Net Proceeds row should be visible
    await expect(page.getByText("Net Proceeds")).toBeVisible();
  });

  test("direct page.goto to order URL renders without store hydration (DB fallback)", async ({ page }) => {
    // First navigate to the list to get a real ID
    await page.goto("/dashboard/sales");
    const firstLink = page.locator("td a[href*='/dashboard/sales/']").first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });
    const href = await firstLink.getAttribute("href");
    expect(href).toBeTruthy();

    // Navigate directly (fresh page load — bypasses Redux store hydration)
    await page.goto(href!);
    await expect(page).toHaveURL(/\/dashboard\/sales\/[0-9a-f-]{36}/);

    // Page should render — not stuck in loading state
    await expect(page.getByText("Loading order…")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Financials" })).toBeVisible({ timeout: 10_000 });
  });

  test("invalid UUID shows not-found state", async ({ page }) => {
    await page.goto("/dashboard/sales/00000000-0000-0000-0000-000000000000");

    // Should show not-found message (not crash)
    await expect(page.getByText(/order not found/i)).toBeVisible({ timeout: 10_000 });
    // Should show a link back to orders
    await expect(page.getByRole("link", { name: /back to orders/i })).toBeVisible();
  });
});
