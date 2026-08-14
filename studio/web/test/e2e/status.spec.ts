import { test, expect } from "@playwright/test";

test("status tab shows budget bar", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Status" }).click();

  await expect(page.getByLabel("Production status").getByText(/\$0\.84/)).toBeVisible();
});

test("stale episode shows staleness analysis", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  /* Click the stale episode. */
  await page.getByText("CPU Pipelines and Branch Prediction", { exact: true }).click();

  await page.getByRole("tab", { name: "Status" }).click();

  await expect(page.getByRole("heading", { name: "Staleness" })).toBeVisible();
  await expect(page.getByLabel("Staleness analysis").getByText("2 stages stale")).toBeVisible();
});

test("blocked episode shows blocker details in status tab", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("Deep Dives").click();
  await page.getByText("Cache Coherence Protocols").click();

  await page.getByRole("tab", { name: "Status" }).click();

  await expect(page.getByLabel("Production status").getByText(/quota exceeded/)).toBeVisible();
});
