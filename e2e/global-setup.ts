import { chromium } from "@playwright/test";

export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login");
  await page.fill('[id="email"]', process.env.E2E_EMAIL!);
  await page.fill('[id="password"]', process.env.E2E_PASSWORD!);
  await page.click('[type="submit"]');
  await page.waitForURL("**/dashboard**");
  await page.context().storageState({ path: "e2e/.auth/user.json" });
  await browser.close();
}
