import { test, expect } from "@playwright/test";

test("storyboard appears when an episode is selected", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await expect(page.getByText("Storyboard")).toBeVisible();
  await expect(page.getByText("6 scenes")).toBeVisible();
});

test("storyboard shows all scene titles", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await expect(page.getByText("The Memory Problem")).toBeVisible();
  await expect(page.getByText("The Hierarchy", { exact: true })).toBeVisible();
  await expect(page.getByText("Cache Lines", { exact: true })).toBeVisible();
});

test("storyboard shows asset statuses", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Scene with selected asset. */
  await expect(page.getByText("img-a1b2")).toBeVisible();

  /* Scene with unselected attempts. */
  await expect(page.getByText("4 attempts")).toBeVisible();

  /* Scene with no attempts. */
  const dashes = page.locator(".sb-asset-missing");
  expect(await dashes.count()).toBeGreaterThan(0);
});

test("storyboard shows narration and caption status", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Status badges — check that the ready symbol appears. */
  const readyBadges = page.locator('.sb-badge[data-status="ready"]');
  expect(await readyBadges.count()).toBeGreaterThan(1);

  /* Generating badge exists. */
  await expect(page.locator('.sb-badge[data-status="generating"]')).toBeVisible();
});
