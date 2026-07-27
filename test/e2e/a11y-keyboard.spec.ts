import { test, expect } from "@playwright/test";

/* Keyboard navigation journeys through core workflows. */

test("keyboard: navigate library tree with Arrow keys", async ({ page }) => {
  await page.goto("/");

  const techExplainer = page.locator("button", { has: page.getByText("Tech Explainer", { exact: true }) });
  await techExplainer.focus();
  await expect(techExplainer).toBeFocused();

  /* Expand with Enter. */
  await page.keyboard.press("Enter");
  await expect(page.getByText("How It Works")).toBeVisible();

  /* ArrowRight should also expand. */
  await page.keyboard.press("ArrowLeft");
  /* Collapsed again. */
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("How It Works")).toBeVisible();
});

test("keyboard: navigate stage rail", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Tab to first stage button. */
  const stageBtn = page.locator('nav[aria-label="Pipeline stages"] button').first();
  await stageBtn.focus();
  await page.keyboard.press("Enter");
  await expect(stageBtn).toHaveAttribute(
    "aria-current",
    "step",
  );
});

test("keyboard: navigate inspector tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Focus and activate Reviews tab. */
  await page.getByRole("tab", { name: "Reviews" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Reviews" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("keyboard: bottom panel tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Navigate to Narration tab. */
  await page.getByRole("tab", { name: "Narration" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Narration" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
