import { test, expect } from "@playwright/test";

// Auth tests — no storageState for unauthenticated scenarios
test.describe("Auth", () => {
  test("valid credentials → /dashboard", async ({ browser }) => {
    // Use a fresh context with no storageState so this test exercises the login form,
    // not just a pre-saved cookie.
    const context = await browser.newContext(); // no storageState
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator('[id="email"]').fill(process.env.E2E_EMAIL!);
    await page.locator('[id="password"]').fill(process.env.E2E_PASSWORD!);
    await page.locator('[type="submit"]').click();
    await page.waitForURL("**/dashboard**");
    await expect(page).toHaveURL(/\/dashboard/);
    await context.close();
  });

  test("logout navigates to /login", async ({ page }) => {
    await page.goto("/dashboard");
    // Open the user menu (top-right user button)
    await page.click('[aria-label="Open navigation"], button:has(.lucide-user), button:has([data-lucide="user"])', { timeout: 5000 }).catch(async () => {
      // Fallback: find the user dropdown button via the header
      await page.locator("header button").filter({ hasText: /./ }).last().click();
    });
    // Click Sign out
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("**/login**");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated GET /dashboard/sales redirects to /login", async ({ browser }) => {
    // New context with no saved auth state
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/dashboard/sales");
    await page.waitForURL("**/login**");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
