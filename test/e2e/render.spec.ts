import { test, expect } from "@playwright/test";

test("scene viewer has render tab", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await expect(page.getByRole("tab", { name: "Render" })).toBeVisible();
});

test("render tab shows current deliverable and video placeholder", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Render" }).click();

  await expect(page.getByText("Current Deliverable")).toBeVisible();
  await expect(page.getByText("80.3 MB")).toBeVisible();
});

test("render tab shows quality report findings", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Render" }).click();

  await expect(page.getByText("Quality Report")).toBeVisible();
  await expect(page.getByText("RESOLUTION_MATCH")).toBeVisible();
  await expect(page.getByText("LOUDNESS", { exact: true })).toBeVisible();
  await expect(page.getByText("6 pass")).toBeVisible();
});

test("render tab has review button", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  await page.getByRole("tab", { name: "Render" }).click();

  await expect(page.getByRole("button", { name: /Add review/ })).toBeVisible();
});
