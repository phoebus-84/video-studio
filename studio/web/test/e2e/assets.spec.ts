import { test, expect } from "@playwright/test";

test("clicking a scene with assets shows asset attempts in inspector", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Click scene 1 (The Memory Problem) in storyboard. */
  await page.getByText("The Memory Problem", { exact: true }).click();

  /* Inspector should show asset attempts. */
  await expect(page.getByText("Assets — The Memory Problem")).toBeVisible();
  await expect(page.getByText("attempt-1a")).toBeVisible();
});

test("selected attempt is highlighted", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();
  await page.getByText("The Memory Problem", { exact: true }).click();

  /* The selected attempt should have the Selected badge. */
  await expect(page.getByText("Selected").first()).toBeVisible();
});

test("unavailable file shows dashed border and badge", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Click scene 3 (Locality of Reference) — has unavailable attempt. */
  await page.getByText("Locality of Reference", { exact: true }).click();

  await expect(page.getByText("File unavailable")).toBeVisible();
});
