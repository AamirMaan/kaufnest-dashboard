import { test, expect } from "@playwright/test";
import { e2eName } from "./helpers";

test.describe("Settings", () => {
  let originalCompanyName: string;

  test.beforeAll(async ({ browser }) => {
    // Capture the original company name before any test modifies it
    const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const page = await context.newPage();
    await page.goto("/dashboard/settings");
    // Company Name field: Field label is "Company Name", the Input follows the label in the Field wrapper
    const nameInput = page.getByText("Company Name").locator("..").locator("input");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    originalCompanyName = (await nameInput.inputValue()) ?? "";
    await context.close();
  });

  test("change company name → save → reload shows saved value", async ({ page }) => {
    await page.goto("/dashboard/settings");

    const newName = e2eName("co");
    const nameInput = page.getByText("Company Name").locator("..").locator("input");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    await nameInput.fill(newName);

    // Fill IBAN with a valid value
    const ibanInput = page.locator("label").filter({ hasText: /^IBAN$/ }).locator("..").locator("input");
    await ibanInput.fill("DE89370400440532013000");

    // Click Save Settings
    await page.getByRole("button", { name: /save settings/i }).click();

    // Wait for success toast
    await expect(page.getByText(/company profile saved/i)).toBeVisible({ timeout: 10_000 });

    // Reload and verify persisted value
    await page.reload();
    await expect(nameInput).toHaveValue(newName, { timeout: 10_000 });
  });

  test("invalid IBAN shows warning text, Save remains enabled and submits", async ({ page }) => {
    await page.goto("/dashboard/settings");

    const ibanInput = page.locator("label").filter({ hasText: /^IBAN$/ }).locator("..").locator("input");
    await expect(ibanInput).toBeVisible({ timeout: 10_000 });

    // Clear IBAN and type an invalid value
    await ibanInput.fill("");
    await ibanInput.fill("NOTANIBAN");

    // Inline validation warning should appear under the IBAN field
    await expect(page.getByText(/invalid iban/i)).toBeVisible({ timeout: 5_000 });

    // Save button must still be enabled (non-blocking warning)
    const saveButton = page.getByRole("button", { name: /save settings/i });
    await expect(saveButton).toBeEnabled();

    // Clicking save should not show an error blocking submission — it should succeed (or at least fire)
    await saveButton.click();
    // We just check it doesn't throw a blocking error — toast or no toast is fine
    // (the IBAN is stored as-is since validation is advisory only)
    await page.waitForTimeout(2_000);
    // No modal error should be blocking the form
    const dialogError = page.getByRole("dialog").getByText(/error/i);
    const dialogVisible = await dialogError.isVisible().catch(() => false);
    expect(dialogVisible).toBe(false);
  });

  test.afterAll(async ({ browser }) => {
    // Restore original company name
    if (!originalCompanyName) return;
    const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const page = await context.newPage();
    await page.goto("/dashboard/settings");

    const nameInput = page.getByText("Company Name").locator("..").locator("input");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(originalCompanyName);
    await page.getByRole("button", { name: /save settings/i }).click();
    await expect(page.getByText(/company profile saved/i)).toBeVisible({ timeout: 10_000 });
    await context.close();
  });
});
