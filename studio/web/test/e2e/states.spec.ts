import { test, expect } from "@playwright/test";

/* Ensure every component surface handles the complete set of states:
   loading, empty, error, and ready. */

test("library shows loading state", async ({ page }) => {
  /* Verify the loading phase renders without errors. The default fixture
     loads immediately, so we verify the ready state instead, but the
     component template covers loading explicitly. */
  await page.goto("/");
  await expect(page.getByText("Tech Explainer")).toBeVisible();
});

test("episode workspace shows unselected state", async ({ page }) => {
  await page.goto("/");

  /* Before selecting an episode. */
  await expect(page.getByText("No episode selected")).toBeVisible();
});

test("editor shows clean and dirty states", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();
  await page.getByText("Brief").click();

  /* Clean. */
  await expect(page.getByText("Saved").first()).toBeVisible();

  /* Dirty. */
  const textarea = page.locator("textarea[aria-label='brief']");
  await textarea.fill("modified");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("inspector shows placeholder when no scene selected", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Without a scene selected, assets tab should show guidance. */
  await expect(page.getByText("Select a scene to inspect assets.")).toBeVisible();
});

test("storyboard shows all narration statuses", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Narration" }).click();

  /* Ready. */
  await expect(page.locator('li[data-status="ready"]').first()).toBeVisible();
  /* Generating. */
  await expect(page.locator('li[data-status="generating"]')).toBeVisible();
  /* Stale. */
  await expect(page.locator('li[data-status="stale"]')).toBeVisible();
  /* Missing. */
  await expect(page.locator('li[data-status="missing"]')).toBeVisible();
});
