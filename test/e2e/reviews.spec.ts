import { test, expect } from "@playwright/test";

test("inspector has assets and reviews tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await expect(page.getByRole("tab", { name: "Assets" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Reviews" })).toBeVisible();
});

test("reviews tab shows open threads", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Reviews" }).click();

  await expect(page.getByText("2 open")).toBeVisible();
});

test("expanding a thread shows messages and reply box", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Reviews" }).click();

  /* Click the thread with scene anchor "scene-3". */
  await page.locator("button", { hasText: "scene-3" }).click();

  /* Messages should be visible. */
  await expect(page.getByText(/Regenerated scene 3/)).toBeVisible();

  /* Reply box should be visible. */
  await expect(page.getByPlaceholder("Reply or send to Pi…")).toBeVisible();
});
