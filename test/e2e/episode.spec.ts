import { test, expect } from "@playwright/test";

test("selecting a running episode shows workspace with header and stage rail", async ({
  page,
}) => {
  await page.goto("/");

  /* Expand to the running episode. */
  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Episode header. */
  await expect(page.getByText("Memory Hierarchies Explained").first()).toBeVisible();
  await expect(page.getByText("Autopilot")).toBeVisible();
  await expect(page.getByText(/\$0\.84/)).toBeVisible();

  /* Stage rail. */
  await expect(page.getByText("Brief")).toBeVisible();
  await expect(page.getByText("Illustrations")).toBeVisible();
  await expect(page.getByText("Compose")).toBeVisible();
});

test("blocked episode shows blocked reason in header", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("Deep Dives").click();
  await page.getByText("Cache Coherence Protocols").click();

  await expect(page.getByText(/quota exceeded/)).toBeVisible();
});

test("stale episode shows stale count in header", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("CPU Pipelines and Branch Prediction").click();

  await expect(page.getByText(/2 stages? stale/)).toBeVisible();
});

test("stage rail is keyboard accessible", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Tab to first stage button and press Enter. */
  const stageB = page.locator("button.stage-item").first();
  await stageB.focus();
  await stageB.press("Enter");

  /* Now this stage should be selected. */
  await expect(stageB).toHaveAttribute("aria-current", "step");
});
