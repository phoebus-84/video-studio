import { test, expect } from "@playwright/test";

test("shell renders with structure, canvas, and inspector regions", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("header[aria-label='Episode header']")).toBeVisible();
  await expect(page.getByText("Studio")).toBeVisible();

  await expect(page.locator("nav[aria-label='Library structure']")).toBeVisible();
  await expect(page.getByText("Tech Explainer")).toBeVisible();

  await expect(
    page.locator("main[aria-label='Production canvas']"),
  ).toBeVisible();
  await expect(page.getByText("No episode selected")).toBeVisible();

  await expect(
    page.locator("aside[aria-label='Contextual inspector']"),
  ).toBeVisible();
});

test("shell shows offline banner when not connected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/Gateway offline/)).toBeVisible();
});
