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

  test("loads the source editor locally only after opening a document", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.route(/^https?:\/\/(?!localhost:1420(?:\/|$))/, (route) => route.abort());
    await page.goto("/");
    const newFile = page.getByRole("button", { name: /New Typst file/ });
    await expect(newFile).toBeVisible();
    expect(requests.some((url) => url.includes("monacoSetup"))).toBe(false);
    await newFile.click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 });
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.type("Hello offline source editor");
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("Hello offline source editor");
    expect(requests.some((url) => /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url))).toBe(false);
  });

  test("preserves Markdown when switching between rich and source modes", async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost:1420(?:\/|$))/, (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: /New Markdown file/ }).click();
    const richEditor = page.locator(".cm-content");
    await expect(richEditor).toBeVisible();
    await richEditor.fill("Markdown stays intact across editor modes.");
    await page.getByTitle("Markdown source mode").click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("Markdown stays intact across editor modes.");
    await page.getByTitle("Rich Markdown mode").click();
    await expect(richEditor).toHaveText("Markdown stays intact across editor modes.");
  });
});
