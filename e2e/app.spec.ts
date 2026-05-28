import { test, expect } from "@playwright/test";

test.describe("App shell", () => {
  test("loads the application", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Type Studio|grapheme/i);
  });

  test("renders the main layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});
