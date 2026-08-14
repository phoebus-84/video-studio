import { test, expect } from "@playwright/test";

test("scene viewer has storyboard and narration tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await expect(page.getByRole("tab", { name: "Storyboard" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Narration" })).toBeVisible();
});

test("switching to narration tab shows segments", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Narration" }).click();

  await expect(page.getByText("Default Narrator")).toBeVisible();
  await expect(page.getByText("seg-1")).toBeVisible();
});

test("narration shows ready and generating statuses", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Narration" }).click();

  /* Ready segments have play buttons. */
  const playBtns = page.locator(".np-play-btn");
  expect(await playBtns.count()).toBeGreaterThanOrEqual(3);

  /* Generating segment should be visible. */
  await expect(page.getByText("Cache lines are the fundamental")).toBeVisible();
});
